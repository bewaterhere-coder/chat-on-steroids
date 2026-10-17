/** Trusted COS Core dispatch binding for DevForge A03.
 *
 * This is an internal main-process helper, not a model-facing MCP endpoint.
 * The caller and live capabilities are obtained from COS, never from a
 * serialized DevForge request or the Python controller.
 */
import { currentCall, type CallContext } from './call-context.js';
import { createRegistrar, type ToolContext, type ToolResult } from './kernel.js';
import { registerCoreTools } from './tools-core.js';
import { withManagedSkills } from '../skill-access.js';
import { createTrustedDevforgeNativeRuntime } from './devforge-native-runtime.mjs';

export type TrustedDevforgeCoreInvoker = (
  name: string, args: unknown, parent: CallContext
) => Promise<ToolResult>;

export function createTrustedDevforgeCoreInvoker(liveContext: () => ToolContext): TrustedDevforgeCoreInvoker {
  return async (name, args, parent) => {
    const liveCall = currentCall();
    // Parent must be the *current* COS Core call, not a caller-supplied
    // serialized identity and not a previous session replay.
    if (!liveCall || liveCall !== parent ||
        !liveCall.caller.requestId || !liveCall.caller.conversationId ||
        !liveCall.caller.sessionId || !liveCall.caller.setupProfileId ||
        !liveCall.caller.transportKey) {
      throw new Error('DevforgeCOSLiveCallerRequired');
    }
    if (name !== 'exec_command' && name !== 'write_stdin') {
      throw new Error('DevforgeCOSCoreToolNotAllowed');
    }
    // A fresh registrar reloads the current permission/root configuration
    // for EACH child rather than retaining the state from an earlier call.
    const reg = createRegistrar(null, withManagedSkills(liveContext()), 'core');
    registerCoreTools(reg);
    return reg.invokeNested(name, args, parent);
  };
}

/** A main-process-only activation point; neither owner callback can be supplied
 * from an MCP argument. A missing original owner is an activation error. */
export function bindTrustedDevforgeNativeRuntime(
  liveContext: () => ToolContext,
  owner: {
    workspace: string;
    sources: Record<string, string>;
    approvedOperations: Record<string, unknown>;
    verifyIndependentAuthority: (x: unknown) => Promise<boolean>;
    verifyOwningReceipt: (x: unknown) => Promise<unknown>;
  }
) {
  return createTrustedDevforgeNativeRuntime({
    ...owner,
    currentCall,
    invokeCoreTool: createTrustedDevforgeCoreInvoker(liveContext)
  });
}
