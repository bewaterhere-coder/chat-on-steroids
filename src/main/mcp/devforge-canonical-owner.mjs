/** Canonical Git/DevForge readback provider for the COS native adapter.
 * Install only from trusted COS main-process configuration; it does not
 * accept paths, authorization facts, or approvals from MCP/model arguments.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = ['task', 'plan', 'slice_set', 'authorization',
  'execution_binding', 'transport', 'checkpoint'];
const actions = Object.freeze({
  'development.slice_progression': 'implementation',
  'development.verification_transition': 'verification',
  'development.acceptance_repair_loop': 'verification',
  'development.plan_review_loop': 'review',
  'development.finalize': 'finalization'
});
const blocked = reason => { throw new Error(`DevforgeCanonical:${reason}`); };
const text = x => typeof x === 'string' && x.length > 0 ? x : '';
const dict = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};

export function createDevforgeCanonicalOwner({ workspace, sources, approvedOperations,
  verifyIndependentAuthority, verifyOwningReceipt, git = null }) {
  // These are constructor arguments installed by trusted main-process code,
  // NOT options passed through any exposed MCP tool.
  if (!text(workspace) || !sources || Object.keys(sources).sort().join() !== [...NAMES].sort().join() ||
      typeof verifyIndependentAuthority !== 'function' || typeof verifyOwningReceipt !== 'function' ||
      !approvedOperations || typeof approvedOperations !== 'object') blocked('TrustedOwnerConfigMissing');
  const root = realpathSync(workspace);
  const gitExec = git ?? (args => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  }).trim());
  const paths = {};
  for (const name of NAMES) {
    const path = sources[name];
    if (!text(path) || path.includes('\\') || path.startsWith('/') ||
        path.split('/').some(p => !p || p === '.' || p === '..')) blocked('UnsafeSourcePath');
    paths[name] = path;
  }
  const head = () => {
    const sha = gitExec(['rev-parse', '--verify', 'HEAD']);
    if (!/^[0-9a-f]{40}$/.test(sha)) blocked('InvalidGitHead');
    return sha;
  };
  const snapshot = () => {
    const sha = head();
    const result = {};
    for (const name of NAMES) {
      if (gitExec(['status', '--porcelain', '--', paths[name]])) blocked('DirtyCanonicalOwner');
      const item = JSON.parse(gitExec(['show', `${sha}:${paths[name]}`]));
      if (!item || typeof item !== 'object' || Array.isArray(item)) blocked('MalformedOwner');
      result[name] = item;
    }
    return { sha, data: result };
  };
  const check = (x, snap, requireOriginalHead = true) => {
    const { task, plan, slice_set: slices, authorization: auth,
      execution_binding: binding, transport } = snap.data;
    const scope = dict(approvedOperations[x.capability]);
    const selection = dict(scope.taskBinding);
    const planLink = dict(slices.plan), authLink = dict(auth.bindings);
    const expectedAction = actions[x.capability];
    const allowed = auth.allowed_actions;
    if (!expectedAction || !Array.isArray(scope.argv) || scope.argv.length === 0 ||
        !Array.isArray(scope.allowedPaths) ||
        scope.allowedPaths.length === 0 || !scope.allowedPaths.every(text) ||
        !text(scope.command) || !text(scope.workdir) ||
        !text(scope.approvalRef) || selection.taskId !== x.taskId ||
        task.task_id !== x.taskId || !text(task.repository) ||
        plan.task_id !== x.taskId || plan.state !== 'Approved' ||
        !text(plan.ref) || !text(String(plan.revision ?? '')) ||
        slices.current !== true || dict(slices.identity).task_id !== x.taskId ||
        planLink.ref !== plan.ref || String(planLink.revision) !== String(plan.revision) ||
        auth.mode !== 'durable' || auth.state !== 'active' ||
        dict(auth.subject).task_id !== x.taskId ||
        dict(auth.subject).repository !== task.repository ||
        authLink.plan_ref !== plan.ref || String(authLink.plan_revision) !== String(plan.revision) ||
        authLink.transport_ref !== transport.ref || transport.readback_verified !== true ||
        !Array.isArray(allowed) || !allowed.includes(expectedAction) ||
        binding.cos_core !== true || binding.provider !== x.expectedProvider ||
        binding.host_id !== x.expectedHost || (requireOriginalHead && snap.sha !== x.gitHead) ||
        scope.command !== x.args.cmd || scope.workdir !== x.args.workdir ||
        selection.provider !== x.expectedProvider || selection.hostId !== x.expectedHost ||
        realpathSync(scope.workdir) !== root) blocked('CanonicalTaskApprovalMismatch');
    const path = gitExec(['rev-parse', '--absolute-git-dir']);
    const lock = JSON.parse(readFileSync(join(path, `cos-a03-${x.taskId}.writer`), 'utf8'));
    if (lock.task_id !== x.taskId || lock.token !== x.writerToken ||
        lock.provider !== x.expectedProvider || lock.host_id !== x.expectedHost)
      blocked('WriterNotOwned');
    return { scope, expectedAction };
  };
  return Object.freeze({
    async verifyCanonical(x) {
      const snap = snapshot();
      const { scope, expectedAction } = check(x, snap);
      // A committed JSON authorization is NOT sufficient by itself. Owner
      // verifies its independent current gate and original authorization.
      const independence = await verifyIndependentAuthority({ ...x, snapshot: snap.data,
        head: snap.sha, allowedPaths: scope.allowedPaths, approvalRef: scope.approvalRef });
      if (independence !== true) blocked('IndependentAuthorityDenied');
      return {
        admitted: true, taskId: x.taskId, capability: x.capability,
        provider: x.expectedProvider, hostId: x.expectedHost, gitHead: x.gitHead,
        writerToken: x.writerToken, requestId: x.caller.requestId,
        conversationId: x.caller.conversationId, sessionId: x.caller.sessionId,
        setupProfileId: x.caller.setupProfileId, transportKey: x.caller.transportKey,
        requiredAction: expectedAction, allowedAction: expectedAction,
        planApproved: true, durableAuthorizationActive: true,
        transportVerified: true, writerOwned: true,
        approvedCommand: scope.command, approvedWorkdir: scope.workdir,
        allowedPaths: [...scope.allowedPaths]
      };
    },
    async rereadCanonical(x) {
      const snap = snapshot();
      // Recheck *all* bindings against the new HEAD, not only the Task ID and
      // the committed authorization flag. A side effect may have changed the
      // plan, transport, provider, host, or writer ownership.
      const { scope } = check(x, snap, false);
      const changed = gitExec(['diff', '--name-only', x.gitHead, snap.sha])
        .split(/\r?\n/).filter(Boolean);
      if (changed.some(p => !scope.allowedPaths.includes(p)) ||
          gitExec(['status', '--porcelain'])) blocked('PostOperationOutsideScopeOrDirty');
      // Approval is owned independently of committed Git JSON. It may be
      // revoked while the guarded Core child runs; never accept a receipt
      // without checking the original authority again after the effect.
      const independence = await verifyIndependentAuthority({ ...x,
        snapshot: snap.data, head: snap.sha,
        allowedPaths: scope.allowedPaths, approvalRef: scope.approvalRef });
      if (independence !== true) blocked('PostOperationIndependentAuthorityDenied');
      const receipt = await verifyOwningReceipt({ ...x, head: snap.sha,
        snapshot: snap.data, changedPaths: changed });
      if (!receipt || receipt.verified !== true || !text(receipt.ref))
        blocked('OwningReceiptMissing');
      return { readbackVerified: true, taskId: x.taskId, capability: x.capability,
        writerToken: x.writerToken, provider: scope.taskBinding.provider,
        hostId: scope.taskBinding.hostId, gitHead: snap.sha,
        changedPaths: changed, owningReceiptRef: receipt.ref };
    }
  });
}
