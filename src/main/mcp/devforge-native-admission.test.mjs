import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDevforgeNativeAdmission, DevforgeHostAdmissionError } from './devforge-native-admission.mjs';

const caller = Object.freeze({
  requestId: 'cos-req-1', conversationId: 'conversation-1', sessionId: 'session-1',
  setupProfileId: 'profile-1', transportKey: 'transport-1'
});
const child = {
  taskId: 'TASK-1', capability: 'development.slice_progression',
  expectedProvider: 'host-runtime', expectedHost: 'windows-1',
  gitHead: 'a'.repeat(40), writerToken: 'writer-1',
  args: { cmd: "python -B -c 'print(1)'", workdir: 'D:/approved/fixture' }
};
function fixture({ callerOverride, verifier, nativeTool, readback } = {}) {
  const calls = [];
  const bridge = createDevforgeNativeAdmission({
    getCallContext: () => ({ caller: callerOverride ?? caller }),
    verifyCanonical: verifier ?? (async x => ({
      admitted: true, taskId: x.taskId, capability: x.capability,
      provider: x.expectedProvider, hostId: x.expectedHost,
      gitHead: x.gitHead, writerToken: x.writerToken,
      requestId: x.caller.requestId, conversationId: x.caller.conversationId,
      sessionId: x.caller.sessionId, setupProfileId: x.caller.setupProfileId,
      transportKey: x.caller.transportKey, requiredAction: 'implementation',
      allowedAction: 'implementation', planApproved: true,
      durableAuthorizationActive: true, transportVerified: true, writerOwned: true,
      approvedCommand: x.args.cmd, approvedWorkdir: x.args.workdir,
      allowedPaths: ['sample.py']
    })),
    invokeCoreTool: nativeTool ?? (async (name, args, parent) => {
      calls.push({ name, args, parent });
      return { structuredContent: { exit_code: 0 } };
    }),
    rereadCanonical: readback ?? (async x => ({
      readbackVerified: true, taskId: x.taskId, capability: x.capability,
      writerToken: x.writerToken, provider: child.expectedProvider,
      hostId: child.expectedHost, gitHead: 'b'.repeat(40),
      owningReceiptRef: 'receipt-from-owner', changedPaths: ['sample.py']
    }))
  });
  return { bridge, calls };
}
test('native Core dispatch and independent readback', async () => {
  const { bridge, calls } = fixture();
  const result = await bridge.executeChild(child);
  assert.equal(result.readbackVerified, true);
  assert.equal(result.owningReceiptRef, 'receipt-from-owner');
  assert.equal(result.acceptanceProven, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'exec_command');
  assert.equal(calls[0].parent.caller, caller);
  await assert.rejects(() => bridge.executeChild(child), /CoreOperationAlreadyDispatched/);
  assert.equal(calls.length, 1);
});
test('rejects unknown/unattributed Core caller before any tool', async () => {
  const { bridge, calls } = fixture({ callerOverride: { ...caller, conversationId: '' } });
  await assert.rejects(() => bridge.executeChild(child), /COSCallProvenanceUnavailable/);
  assert.equal(calls.length, 0);
});
test('rejects a forged canonical admission', async () => {
  const { bridge, calls } = fixture({ verifier: async () => ({
    admitted: true, requestId: caller.requestId
  }) });
  await assert.rejects(() => bridge.executeChild(child), /CanonicalDevforgeOperationNotAdmitted/);
  assert.equal(calls.length, 0);
});
test('unknown tool effect is not replayed after failure', async () => {
  let count = 0;
  const { bridge } = fixture({ nativeTool: async () => {
    count += 1;
    return { structuredContent: { session_id: 77 } };
  } });
  await assert.rejects(() => bridge.executeChild(child), /CoreChildEffectUncertain/);
  await assert.rejects(() => bridge.executeChild(child), /CoreOperationAlreadyDispatched/);
  assert.equal(count, 1);
});
test('rejects command substitution and out-of-scope file edits', async () => {
  let launches = 0;
  const badCommand = fixture({ verifier: async x => ({
    admitted: true, taskId: x.taskId, capability: x.capability,
    provider: x.expectedProvider, hostId: x.expectedHost,
    gitHead: x.gitHead, writerToken: x.writerToken,
    requestId: x.caller.requestId, conversationId: x.caller.conversationId,
    sessionId: x.caller.sessionId, setupProfileId: x.caller.setupProfileId,
    transportKey: x.caller.transportKey, requiredAction: 'implementation',
    allowedAction: 'implementation', planApproved: true,
    durableAuthorizationActive: true, transportVerified: true, writerOwned: true,
    approvedCommand: 'unapproved different command', approvedWorkdir: x.args.workdir,
    allowedPaths: ['sample.py']
  }), nativeTool: async () => { launches++; return { structuredContent: { exit_code: 0 } }; } });
  await assert.rejects(() => badCommand.bridge.executeChild(child), /CanonicalDevforgeOperationNotAdmitted/);
  assert.equal(launches, 0);
  const badScope = fixture({ readback: async x => ({
    readbackVerified: true, taskId: x.taskId, capability: x.capability,
    writerToken: x.writerToken, provider: child.expectedProvider,
    hostId: child.expectedHost, gitHead: 'b'.repeat(40),
    changedPaths: ['outside.py']
  }) });
  await assert.rejects(() => badScope.bridge.executeChild(child), /PostChildCanonicalReadbackUnverified/);
  assert.equal(badScope.calls.length, 1);
});
test('missing receipt readback stops after one command', async () => {
  let count = 0;
  const { bridge } = fixture({
    nativeTool: async () => { count += 1; return { structuredContent: { exit_code: 0 } }; },
    readback: async () => ({ readbackVerified: false })
  });
  await assert.rejects(() => bridge.executeChild(child), /PostChildCanonicalReadbackUnverified/);
  assert.equal(count, 1);
});
test('binding functions cannot be absent', () => {
  assert.throws(() => createDevforgeNativeAdmission({}), DevforgeHostAdmissionError);
});
