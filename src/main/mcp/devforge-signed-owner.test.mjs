import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createDevforgeSignedOwner } from './devforge-signed-owner.mjs';

const canonical = x => x === null || typeof x !== 'object'
  ? JSON.stringify(x) : Array.isArray(x)
    ? `[${x.map(canonical).join(',')}]`
    : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const input = { taskId: 'T-1', capability: 'development.slice_progression',
  head: 'a'.repeat(40), approvalRef: 'github-review/1', writerToken: 'writer',
  caller: { requestId: 'call' }, changedPaths: ['src/test.ts'] };
function fixture(change = x => x) {
  const requestDecision = async q => {
    const payload = change({ ...q, allowed: true, expiresAt: Date.now() + 5000,
      ...(q.kind === 'receipt' ? { receiptRef: 'receipt/123' } : {}) });
    return { payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
  };
  return createDevforgeSignedOwner({ publicKeyPem, requestDecision });
}
test('accepts independently signed per-operation authorization and receipt', async () => {
  const owner = fixture();
  assert.equal(await owner.verifyIndependentAuthority(input), true);
  assert.deepEqual(await owner.verifyOwningReceipt(input), { verified: true, ref: 'receipt/123' });
});
test('rejects expired and wrong-task decisions', async () => {
  await assert.rejects(fixture(x => ({ ...x, expiresAt: Date.now() - 1 }))
    .verifyIndependentAuthority(input), /IndependentDecisionUnavailable/);
  await assert.rejects(fixture(x => ({ ...x, taskId: 'T-2' }))
    .verifyIndependentAuthority(input), /IndependentDecisionUnavailable/);
});
test('rejects unsigned, tampered or replayed decisions', async () => {
  const owner = createDevforgeSignedOwner({ publicKeyPem,
    requestDecision: async () => ({ payload: { allowed: true }, signature: '' }) });
  await assert.rejects(owner.verifyIndependentAuthority(input), /IndependentDecisionUnavailable/);
  const bad = createDevforgeSignedOwner({ publicKeyPem,
    requestDecision: async q => {
      const payload = { ...q, allowed: true, expiresAt: Date.now() + 5000 };
      return { payload, signature: sign(null, Buffer.from(canonical({ ...payload, allowed: false })), privateKey).toString('base64') };
    } });
  await assert.rejects(bad.verifyIndependentAuthority(input), /IndependentDecisionUnavailable/);
});
test('cannot use arbitrary non-Ed25519 public key or missing signer', () => {
  assert.throws(() => createDevforgeSignedOwner({ publicKeyPem, requestDecision: null }), /IndependentDecisionUnavailable/);
});
