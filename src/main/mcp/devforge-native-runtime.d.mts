export function createTrustedDevforgeNativeRuntime(config: {
  workspace: string;
  sources: Record<string, string>;
  approvedOperations: Record<string, unknown>;
  verifyIndependentAuthority: (x: unknown) => Promise<boolean>;
  verifyOwningReceipt: (x: unknown) => Promise<unknown>;
  currentCall: () => unknown;
  invokeCoreTool: (name: string, args: unknown, parent: import('./call-context.js').CallContext) => Promise<unknown>;
}): Readonly<{ executeChild: (request: unknown) => Promise<unknown> }>;
