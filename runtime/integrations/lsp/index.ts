// ─────────────────────────────────────────────────────────────────────────────
// Aahi — LSP Integration (barrel exports)
// ─────────────────────────────────────────────────────────────────────────────

export { LSPClient } from './lsp-client.js';
export type {
  LSPServerConfig,
  Position,
  Range,
  Diagnostic,
  CompletionItem,
  TextEdit,
  HoverResult,
  Location,
  CodeAction,
  WorkspaceEdit,
} from './lsp-client.js';

export { LSPManager, getDefaultServerConfigs } from './lsp-manager.js';

export {
  AAHI_LSP_METHODS,
  AahiLSPExtensions,
} from './aahi-lsp-extensions.js';
export type { AahiLSPRequest, AahiLSPResult } from './aahi-lsp-extensions.js';
