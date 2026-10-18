export function createDevforgeSignedOwner(options: {
  publicKeyPem: string;
  requestDecision: (request: Record<string, unknown>) => Promise<{
    payload: Record<string, unknown>;
    signature: string;
  }>;
  now?: () => number;
}): {
  verifyIndependentAuthority: (request: unknown) => Promise<boolean>;
  verifyOwningReceipt: (request: unknown) => Promise<unknown>;
};
