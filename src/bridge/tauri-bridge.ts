// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Bridge to Tauri native commands (file I/O, keychain, indexing, etc.)
// Falls back to helpful errors when running in browser mode (not Tauri).
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      event: {
        listen: (
          event: string,
          handler: (event: { payload: unknown }) => void,
        ) => Promise<() => void>;
      };
    };
  }
}

export const isTauri = (): boolean => typeof window !== 'undefined' && !!window.__TAURI__;

function requireTauri(): Window['__TAURI__'] & NonNullable<unknown> {
  if (!isTauri()) {
    throw new Error(
      'This operation requires the Tauri desktop environment. ' +
      'When running in the browser, start the runtime server manually.',
    );
  }
  return window.__TAURI__!;
}

export interface DirEntry {
  path: string;
  name: string;
  isDir: boolean;
}

export interface IndexEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  extension: string | null;
}

export interface SecretFinding {
  file: string;
  line: number;
  secret_type: string;
  snippet: string;
}

export interface FsChangeEvent {
  type: string;
  paths: string[];
}

export const tauri = {
  // ── Runtime lifecycle ────────────────────────────────────────────────

  async startRuntime(): Promise<string> {
    if (!isTauri()) return 'Browser mode — runtime should be started externally';
    return requireTauri().core.invoke('start_runtime') as Promise<string>;
  },

  async stopRuntime(): Promise<string> {
    if (!isTauri()) return 'Browser mode — no runtime to stop';
    return requireTauri().core.invoke('stop_runtime') as Promise<string>;
  },

  // ── File system ──────────────────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    const t = requireTauri();
    return t.core.invoke('read_file', { path }) as Promise<string>;
  },

  async writeFile(path: string, content: string): Promise<void> {
    const t = requireTauri();
    await t.core.invoke('write_file', { path, content });
  },

  async readDir(path: string): Promise<DirEntry[]> {
    const t = requireTauri();
    return t.core.invoke('read_dir', { path }) as Promise<DirEntry[]>;
  },

  // ── Secrets / Keychain ───────────────────────────────────────────────

  async getSecret(key: string): Promise<string> {
    const t = requireTauri();
    return t.core.invoke('get_secret', { key }) as Promise<string>;
  },

  async setSecret(key: string, value: string): Promise<void> {
    const t = requireTauri();
    await t.core.invoke('set_secret', { key, value });
  },

  // ── Tokenization ────────────────────────────────────────────────────

  async countTokens(text: string): Promise<number> {
    const t = requireTauri();
    return t.core.invoke('count_tokens', { text }) as Promise<number>;
  },

  // ── Workspace indexing ───────────────────────────────────────────────

  async indexWorkspace(root: string): Promise<IndexEntry[]> {
    const t = requireTauri();
    return t.core.invoke('index_workspace', { root }) as Promise<IndexEntry[]>;
  },

  // ── Secret scanning ─────────────────────────────────────────────────

  async scanSecrets(content: string, filename: string): Promise<SecretFinding[]> {
    const t = requireTauri();
    return t.core.invoke('scan_secrets', { content, filename }) as Promise<SecretFinding[]>;
  },

  // ── File system watching ─────────────────────────────────────────────

  onFsChange(handler: (event: FsChangeEvent) => void): () => void {
    if (!isTauri()) {
      // No-op in browser mode
      return () => {};
    }

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    window.__TAURI__!.event
      .listen('fs-change', (tauriEvent) => {
        if (!cancelled) {
          handler(tauriEvent.payload as FsChangeEvent);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.error('[TauriBridge] Failed to listen for fs-change:', err);
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  },
};
