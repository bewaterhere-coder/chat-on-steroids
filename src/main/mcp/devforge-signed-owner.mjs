/** Independently signed, operation-scoped DevForge decisions.
 *
 * A trusted owner must provision its public key and authenticated decision
 * transport in the COS main process. No local Git file, renderer setting,
 * environment flag, or unsigned JSON can issue execution permission.
 */
import { createPublicKey, verify, randomBytes } from 'node:crypto';

const IDENT = /^[a-zA-Z0-9._:/-]{1,512}$/;
const canonical = x => {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
};
const fail = () => { throw new Error('DevforgeIndependentDecisionUnavailable'); };

export function createDevforgeSignedOwner({ publicKeyPem, requestDecision, now = () => Date.now() }) {
  if (typeof publicKeyPem !== 'string' || typeof requestDecision !== 'function') fail();
  let key;
  try {
    key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') fail();
  } catch { fail(); }
  const used = new Set();
  const decision = async (kind, input) => {
    if (!input || !IDENT.test(input.taskId) || !IDENT.test(input.capability) ||
        !/^[0-9a-f]{40}$/.test(input.head) || !IDENT.test(input.approvalRef)) fail();
    const nonce = randomBytes(32).toString('hex');
    const query = Object.freeze({ kind, nonce, taskId: input.taskId,
      capability: input.capability, head: input.head, approvalRef: input.approvalRef,
      writerToken: input.writerToken, requestId: input.caller?.requestId,
      changedPaths: input.changedPaths ?? [] });
    const response = await requestDecision(query);
    const payload = response?.payload;
    if (!payload || typeof response.signature !== 'string' ||
        !/^[0-9a-f]{64}$/.test(payload.nonce) || payload.nonce !== nonce ||
        payload.kind !== kind || payload.taskId !== query.taskId ||
        payload.capability !== query.capability || payload.head !== query.head ||
        payload.approvalRef !== query.approvalRef ||
        payload.writerToken !== query.writerToken ||
        payload.requestId !== query.requestId ||
        canonical(payload.changedPaths) !== canonical(query.changedPaths) ||
        !Number.isSafeInteger(payload.expiresAt) ||
        payload.expiresAt < now() || payload.expiresAt > now() + 60_000 ||
        payload.allowed !== true || used.has(nonce)) fail();
    let ok = false;
    try {
      ok = verify(null, Buffer.from(canonical(payload)), key,
        Buffer.from(response.signature, 'base64'));
    } catch { fail(); }
    if (!ok) fail();
    used.add(nonce);
    if (used.size > 4096) used.clear();
    return payload;
  };
  return Object.freeze({
    verifyIndependentAuthority: async input => {
      const d = await decision('authorization', input);
      return d.allowed === true;
    },
    verifyOwningReceipt: async input => {
      const d = await decision('receipt', input);
      return typeof d.receiptRef === 'string' && IDENT.test(d.receiptRef)
        ? { verified: true, ref: d.receiptRef } : null;
    }
  });
}
