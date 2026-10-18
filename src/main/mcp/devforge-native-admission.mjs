/**
 * COS Core-owned DevForge child execution boundary.
 *
 * Install inside the trusted COS Core main process, not inside a DevForge
 * Python subprocess or a model-authored code-mode script. COS supplies the
 * verified CallContext and its native nested tool dispatcher. DevForge's
 * original owner supplies canonical authorization and post-call readback.
 *
 * An API return is NOT a canonical Acceptance/Completion receipt.
 */

const CHILD_TOOL = Object.freeze({
  'development.slice_progression': 'exec_command',
  'development.verification_transition': 'exec_command',
  'development.acceptance_repair_loop': 'exec_command',
  'development.plan_review_loop': 'exec_command',
  'development.finalize': 'exec_command'
});

export class DevforgeHostAdmissionError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'DevforgeHostAdmissionError';
  }
}

const fail = (reason) => { throw new DevforgeHostAdmissionError(reason); };
const value = (x) => typeof x === 'string' && x.length > 0 ? x : '';

/**
 * All dependencies are *trusted* COS Core or DevForge-owning functions.
 * No model-facing arguments may supply the caller, verifier, or invoker.
 */
export function createDevforgeNativeAdmission({ getCallContext, verifyCanonical, invokeCoreTool, rereadCanonical }) {
  if ([getCallContext, verifyCanonical, invokeCoreTool, rereadCanonical].some(fn => typeof fn !== 'function'))
    fail('TrustedNativeBindingsRequired');
  const consumed = new Set();
  let active = false;

  return Object.freeze({
    async executeChild({ taskId, capability, expectedProvider, expectedHost, gitHead, writerToken, args }) {
      if (active) fail('NativeDevforgeWriterAlreadyActive');
      active = true;
      try {
        const ctx = getCallContext();
        const caller = ctx?.caller;
        // Require real conversation provenance. "Allow unattributed" is never
        // enough to approve a durable DevForge task.
        if (!value(caller?.requestId) || !value(caller?.conversationId) ||
            !value(caller?.sessionId) || !value(caller?.setupProfileId) ||
            !value(caller?.transportKey))
          fail('COSCallProvenanceUnavailable');
        if (!value(taskId) || !value(expectedProvider) || !value(expectedHost) ||
            !value(gitHead) || !value(writerToken) || !CHILD_TOOL[capability])
          fail('ExactChildIdentityRequired');
        if (!args || typeof args !== 'object' || Array.isArray(args) || !value(args.cmd) ||
            !value(args.workdir) || Object.keys(args).some(k => !['cmd', 'workdir', 'tty', 'yield_time_ms'].includes(k)))
          fail('ExactCoreCommandRequired');

        // This function is executed *inside* the same COS Core call and
        // receives the caller object directly, not as JSON from Python.
        const owner = await verifyCanonical({
          taskId, capability, expectedProvider, expectedHost, gitHead,
          writerToken, caller, requestedTool: CHILD_TOOL[capability], args
        });
        if (!owner || owner.admitted !== true ||
            owner.taskId !== taskId || owner.capability !== capability ||
            owner.provider !== expectedProvider || owner.hostId !== expectedHost ||
            owner.gitHead !== gitHead || owner.writerToken !== writerToken ||
            owner.requestId !== caller.requestId ||
            owner.conversationId !== caller.conversationId ||
            owner.sessionId !== caller.sessionId ||
            owner.setupProfileId !== caller.setupProfileId ||
            owner.transportKey !== caller.transportKey ||
            owner.allowedAction !== owner.requiredAction ||
            owner.planApproved !== true || owner.durableAuthorizationActive !== true ||
            owner.transportVerified !== true || owner.writerOwned !== true ||
            owner.approvedCommand !== args.cmd || owner.approvedWorkdir !== args.workdir ||
            !Array.isArray(owner.allowedPaths) || owner.allowedPaths.length === 0 ||
            owner.allowedPaths.some(p => !value(p)))
          fail('CanonicalDevforgeOperationNotAdmitted');
        const key = [taskId, caller.requestId, capability, gitHead, writerToken].join('\0');
        if (consumed.has(key)) fail('CoreOperationAlreadyDispatched');
        consumed.add(key); // Before awaiting a potentially mutating tool.

        const result = await invokeCoreTool(CHILD_TOOL[capability], args, ctx);
        const details = result?.structuredContent;
        // A background process is not a successful child; owner must reconcile
        // the exact session, and never repeat this child.
        if (result?.isError === true || !details || typeof details !== 'object')
          fail('CoreToolResultUnverified');
        if (typeof details.exit_code !== 'number' || !Number.isInteger(details.exit_code))
          fail('CoreChildEffectUncertain');
        const after = await rereadCanonical({ taskId, capability, gitHead, writerToken, caller });
        if (!after || after.readbackVerified !== true || after.taskId !== taskId ||
            after.capability !== capability || after.writerToken !== writerToken ||
            after.provider !== expectedProvider || after.hostId !== expectedHost ||
            !Array.isArray(after.changedPaths) ||
            after.changedPaths.some(p => !owner.allowedPaths.includes(p)))
          fail('PostChildCanonicalReadbackUnverified');
        return Object.freeze({
          kind: 'devforge_cos_core_child_observation',
          taskId, capability, requestId: caller.requestId,
          exitCode: details.exit_code,
          newHead: after.gitHead,
          owningReceiptRef: after.owningReceiptRef ?? null,
          readbackVerified: true,
          acceptanceProven: false,
          completionProven: false
        });
      } finally {
        active = false;
      }
    }
  });
}
