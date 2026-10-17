/** Trusted COS main-process composition for DevForge's existing A03 transport.
 * This does not issue authorization or receipts. The original DevForge owner
 * must provide independently implemented verifiers at initialization.
 */
import { createDevforgeCanonicalOwner } from './devforge-canonical-owner.mjs';
import { createDevforgeNativeAdmission } from './devforge-native-admission.mjs';

export function createTrustedDevforgeNativeRuntime({
  workspace, sources, approvedOperations,
  verifyIndependentAuthority, verifyOwningReceipt,
  currentCall, invokeCoreTool, git = null
}) {
  if (typeof currentCall !== 'function' || typeof invokeCoreTool !== 'function' ||
      typeof verifyIndependentAuthority !== 'function' ||
      typeof verifyOwningReceipt !== 'function') {
    throw new Error('DevforgeOriginalOwnerAndCOSHostBindingsRequired');
  }
  const canonical = createDevforgeCanonicalOwner({
    workspace, sources, approvedOperations, verifyIndependentAuthority,
    verifyOwningReceipt, git
  });
  const admission = createDevforgeNativeAdmission({
    getCallContext: currentCall,
    verifyCanonical: x => canonical.verifyCanonical(x),
    rereadCanonical: x => canonical.rereadCanonical(x),
    invokeCoreTool
  });
  return Object.freeze({ executeChild: x => admission.executeChild(x) });
}
