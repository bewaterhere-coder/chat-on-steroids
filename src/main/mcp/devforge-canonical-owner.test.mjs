import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevforgeCanonicalOwner } from './devforge-canonical-owner.mjs';

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const taskId = 'TASK-TEST';
const capability = 'development.slice_progression';
const sources = Object.fromEntries(['task','plan','slice_set','authorization',
  'execution_binding','transport','checkpoint'].map(x => [x, `owner/${x}.json`]));
function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), 'cos-owner-'));
  mkdirSync(join(workspace, '.git'));
  const token = 'lease-1';
  writeFileSync(join(workspace, '.git', `cos-a03-${taskId}.writer`), JSON.stringify({
    task_id: taskId, token, provider: 'host-runtime', host_id: 'windows-1'
  }));
  const data = {
    task: { task_id: taskId, repository: 'org/repo', stage: 'implementation' },
    plan: { task_id: taskId, ref: 'plans/1.json', revision: '2', state: 'Approved',
      slices: [{ slice_id: 'S01', acceptance_criteria: ['works'], changed_files: ['sample.py'] }] },
    slice_set: { current: true, identity: { task_id: taskId },
      plan: { ref: 'plans/1.json', revision: '2' },
      slices: [{ slice_id: 'S01', state: 'pending' }] },
    authorization: { mode: 'durable', state: 'active',
      subject: { task_id: taskId, repository: 'org/repo' },
      allowed_actions: ['implementation'],
      bindings: { plan_ref: 'plans/1.json', plan_revision: '2', transport_ref: 'PR-7' } },
    execution_binding: { provider: 'host-runtime', host_id: 'windows-1', cos_core: true },
    transport: { ref: 'PR-7', readback_verified: true }, checkpoint: {}
  };
  let currentHead = HEAD;
  let authorized = true;
  let receipt = true;
  let changed = 'sample.py';
  const git = args => {
    if (args[0] === 'rev-parse' && args[1] === '--verify') return currentHead;
    if (args[0] === 'rev-parse' && args[1] === '--absolute-git-dir') return join(workspace, '.git');
    if (args[0] === 'status') return '';
    if (args[0] === 'show') {
      const entry = Object.entries(sources).find(([,path]) => `${currentHead}:${path}` === args[1]);
      if (!entry) throw Error('unrecognized git blob');
      return JSON.stringify(data[entry[0]]);
    }
    if (args[0] === 'diff') return changed;
    throw Error('unrecognized git command ' + args.join(' '));
  };
  const args = { taskId, capability, expectedProvider: 'host-runtime',
    expectedHost: 'windows-1', gitHead: HEAD, writerToken: token,
    caller: { requestId: 'request', conversationId: 'chat', sessionId: 'session',
      setupProfileId: 'profile', transportKey: 'transport' },
    args: { cmd: 'python -B test_sample.py', workdir: workspace } };
  const owner = createDevforgeCanonicalOwner({ workspace, sources, git,
    approvedOperations: { [capability]: { taskBinding: { taskId,
      provider: 'host-runtime', hostId: 'windows-1' },
      argv: ['python','-B','test_sample.py'], allowedPaths: ['sample.py'],
      command: args.args.cmd, workdir: workspace, approvalRef: 'approved-1' } },
    verifyIndependentAuthority: async () => authorized,
    verifyOwningReceipt: async () => receipt ? { verified: true, ref: 'receipt-1' } : null
  });
  return { owner, args, data,
    next: () => { currentHead = NEXT; },
    deny: () => { authorized = false; },
    noReceipt: () => { receipt = false; },
    outside: () => { changed = 'outside.py'; },
    close: () => rmSync(workspace, { force: true, recursive: true }) };
}
test('admission requires independently checked canonical owner; receipt is separate', async () => {
  const f = fixture();
  try {
    const a = await f.owner.verifyCanonical(f.args);
    assert.equal(a.admitted, true);
    assert.equal(a.approvedCommand, f.args.args.cmd);
    f.next();
    const r = await f.owner.rereadCanonical(f.args);
    assert.equal(r.readbackVerified, true);
    assert.deepEqual(r.changedPaths, ['sample.py']);
    assert.equal(r.owningReceiptRef, 'receipt-1');
  } finally { f.close(); }
});
test('independent authority revocation blocks even committed active auth', async () => {
  const f = fixture();
  try { f.deny(); await assert.rejects(f.owner.verifyCanonical(f.args), /IndependentAuthorityDenied/); }
  finally { f.close(); }
});
test('revocation during a Core child denies post-effect readback before receipt', async () => {
  const f = fixture();
  try {
    await f.owner.verifyCanonical(f.args);
    f.next();
    f.deny();
    await assert.rejects(f.owner.rereadCanonical(f.args), /PostOperationIndependentAuthorityDenied/);
  } finally { f.close(); }
});
test('post-effect plan drift denies readback even when receipt would be present', async () => {
  const f = fixture();
  try {
    await f.owner.verifyCanonical(f.args);
    f.next();
    f.data.plan.state = 'Draft';
    await assert.rejects(f.owner.rereadCanonical(f.args), /CanonicalTaskApprovalMismatch/);
  } finally { f.close(); }
});
test('approved plan drift fails closed', async () => {
  const f = fixture();
  try { f.data.plan.state = 'Draft';
    await assert.rejects(f.owner.verifyCanonical(f.args), /CanonicalTaskApprovalMismatch/); }
  finally { f.close(); }
});
test('post-execution out-of-scope path is never admitted as readback', async () => {
  const f = fixture();
  try { f.next(); f.outside();
    await assert.rejects(f.owner.rereadCanonical(f.args), /PostOperationOutsideScopeOrDirty/); }
  finally { f.close(); }
});
test('missing owning receipt blocks progress', async () => {
  const f = fixture();
  try { f.next(); f.noReceipt();
    await assert.rejects(f.owner.rereadCanonical(f.args), /OwningReceiptMissing/); }
  finally { f.close(); }
});
