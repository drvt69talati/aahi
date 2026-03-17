// ─────────────────────────────────────────────────────────────────────────────
// Aahi — LSP Manager
// Manages multiple LSP servers, one per language.
// Auto-detects language from file extension and routes to correct server.
// ─────────────────────────────────────────────────────────────────────────────

import { LSPClient } from './lsp-client.js';
import type {
  LSPServerConfig,
  Position,
  Range,
  Diagnostic,
  CompletionItem,
  HoverResult,
  Location,
  TextEdit,
  CodeAction,
} from './lsp-client.js';

// ─── Extension → Language Mapping ───────────────────────────────────────────

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.lua': 'lua',
  '.zig': 'zig',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.scala': 'scala',
  '.r': 'r',
  '.R': 'r',
  '.dart': 'dart',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
};

// ─── Pre-configured Server Templates ────────────────────────────────────────

/**
 * Returns pre-configured LSP server configs for common languages.
 * The `rootUri` must be supplied by the caller.
 */
export function getDefaultServerConfigs(rootUri: string): LSPServerConfig[] {
  return [
    {
      languageId: 'typescript',
      command: 'typescript-language-server',
      args: ['--stdio'],
      rootUri,
    },
    {
      languageId: 'typescriptreact',
      command: 'typescript-language-server',
      args: ['--stdio'],
      rootUri,
    },
    {
      languageId: 'javascript',
      command: 'typescript-language-server',
      args: ['--stdio'],
      rootUri,
    },
    {
      languageId: 'javascriptreact',
      command: 'typescript-language-server',
      args: ['--stdio'],
      rootUri,
    },
    {
      languageId: 'python',
      command: 'pylsp',
      rootUri,
    },
    {
      languageId: 'rust',
      command: 'rust-analyzer',
      rootUri,
    },
    {
      languageId: 'go',
      command: 'gopls',
      rootUri,
    },
    {
      languageId: 'java',
      command: 'jdtls',
      rootUri,
    },
  ];
}

// ─── LSP Manager ────────────────────────────────────────────────────────────

export class LSPManager {
  private configs = new Map<string, LSPServerConfig>();
  private clients = new Map<string, LSPClient>();
  private diagnosticHandlers: Array<(uri: string, diagnostics: Diagnostic[]) => void> = [];
  private unsubscribers: Array<() => void> = [];

  /**
   * Register a language server configuration. Does not start the server yet.
   */
  registerServer(config: LSPServerConfig): void {
    this.configs.set(config.languageId, config);
  }

  /**
   * Register default server configs for common languages.
   */
  registerDefaults(rootUri: string): void {
    for (const config of getDefaultServerConfigs(rootUri)) {
      // Don't overwrite user-provided configs
      if (!this.configs.has(config.languageId)) {
        this.configs.set(config.languageId, config);
      }
    }
  }

  /**
   * Get or start the LSP client for a file URI.
   * Auto-detects language from file extension.
   * Returns null if no server is configured for the language.
   */
  async getServerForFile(uri: string): Promise<LSPClient | null> {
    const languageId = this.detectLanguage(uri);
    if (!languageId) return null;

    // Already running?
    const existing = this.clients.get(languageId);
    if (existing?.isRunning) return existing;

    // Do we have a config?
    const config = this.configs.get(languageId);
    if (!config) return null;

    // Start the server
    const client = new LSPClient(config);

    // Wire diagnostics
    const unsub = client.onDiagnostics((diagUri, diagnostics) => {
      for (const handler of this.diagnosticHandlers) {
        handler(diagUri, diagnostics);
      }
    });
    this.unsubscribers.push(unsub);

    await client.start();
    this.clients.set(languageId, client);

    return client;
  }

  /**
   * Get a running client for a specific language ID.
   * Returns null if not started.
   */
  getClient(languageId: string): LSPClient | null {
    return this.clients.get(languageId) ?? null;
  }

  /**
   * Start all registered language servers.
   */
  async startAll(): Promise<void> {
    const startPromises: Promise<void>[] = [];

    for (const [languageId, config] of this.configs) {
      if (this.clients.has(languageId)) continue;

      const client = new LSPClient(config);
      const unsub = client.onDiagnostics((diagUri, diagnostics) => {
        for (const handler of this.diagnosticHandlers) {
          handler(diagUri, diagnostics);
        }
      });
      this.unsubscribers.push(unsub);

      this.clients.set(languageId, client);
      startPromises.push(client.start());
    }

    await Promise.allSettled(startPromises);
  }

  /**
   * Stop all running language servers.
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const client of this.clients.values()) {
      stopPromises.push(client.stop());
    }

    await Promise.allSettled(stopPromises);
    this.clients.clear();

    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  /**
   * Subscribe to diagnostics from all managed servers.
   */
  onDiagnostics(handler: (uri: string, diagnostics: Diagnostic[]) => void): () => void {
    this.diagnosticHandlers.push(handler);
    return () => {
      const idx = this.diagnosticHandlers.indexOf(handler);
      if (idx !== -1) this.diagnosticHandlers.splice(idx, 1);
    };
  }

  // ── Convenience: route requests to the correct server ─────────────────

  async getCompletions(uri: string, position: Position): Promise<CompletionItem[]> {
    const client = await this.getServerForFile(uri);
    if (!client) return [];
    return client.getCompletions(uri, position);
  }

  async getHover(uri: string, position: Position): Promise<HoverResult | null> {
    const client = await this.getServerForFile(uri);
    if (!client) return null;
    return client.getHover(uri, position);
  }

  async getDefinition(uri: string, position: Position): Promise<Location[]> {
    const client = await this.getServerForFile(uri);
    if (!client) return [];
    return client.getDefinition(uri, position);
  }

  async getReferences(uri: string, position: Position): Promise<Location[]> {
    const client = await this.getServerForFile(uri);
    if (!client) return [];
    return client.getReferences(uri, position);
  }

  async formatDocument(uri: string): Promise<TextEdit[]> {
    const client = await this.getServerForFile(uri);
    if (!client) return [];
    return client.formatDocument(uri);
  }

  async getCodeActions(uri: string, range: Range, diagnostics: Diagnostic[]): Promise<CodeAction[]> {
    const client = await this.getServerForFile(uri);
    if (!client) return [];
    return client.getCodeActions(uri, range, diagnostics);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Detect language ID from a file URI or path.
   */
  detectLanguage(uri: string): string | null {
    // Strip query params and fragments
    const path = uri.replace(/[?#].*$/, '');
    const dotIndex = path.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const ext = path.slice(dotIndex);
    return EXTENSION_TO_LANGUAGE[ext] ?? null;
  }

  /**
   * List all registered language IDs.
   */
  getRegisteredLanguages(): string[] {
    return [...this.configs.keys()];
  }

  /**
   * List all currently running language server IDs.
   */
  getRunningLanguages(): string[] {
    return [...this.clients.entries()]
      .filter(([, client]) => client.isRunning)
      .map(([lang]) => lang);
  }
}
