import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrustedDevforgeNativeRuntime } from './devforge-native-runtime.mjs';

test('requires actual original DevForge owner functions before activation', () => {
  assert.throws(() => createTrustedDevforgeNativeRuntime({
    workspace: '.', sources: {}, approvedOperations: {},
    currentCall: () => ({}), invokeCoreTool: async () => ({})
  }), /DevforgeOriginalOwnerAndCOSHostBindingsRequired/);
});

test('refuses model-controlled configuration without required canonical Git sources', () => {
  assert.throws(() => createTrustedDevforgeNativeRuntime({
    workspace: '.', sources: {}, approvedOperations: {},
    currentCall: () => ({}), invokeCoreTool: async () => ({}),
    verifyIndependentAuthority: async () => false,
    verifyOwningReceipt: async () => null
  }), /TrustedOwnerConfigMissing/);
});
