// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Persistent session manager.  Saves and restores IDE state across
// restarts, working in both Tauri (file-based) and browser (localStorage) modes.
// ─────────────────────────────────────────────────────────────────────────────

import { useAppStore } from './app-store';
import { useRuntimeStore } from './runtime-store';
import { tauri, isTauri } from '../bridge/tauri-bridge';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceSession {
  id: string;
  name: string;
  rootPath: string;
  savedAt: string; // ISO string for serialization

  // Restored state
  openFiles: Array<{ path: string; language: string; active: boolean }>;
  chatHistory: Array<{ role: string; content: string; timestamp: string }>;
  sidebarPanel: string;
  bottomPanel: string;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  currentModel: string;
  focusMode: boolean;

  // Integration state
  connectedIntegrations: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSIONS_DIR = '~/.aahi/sessions';
const LS_PREFIX = 'aahi:session:';
const LS_META_KEY = 'aahi:sessions:meta';

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  return debounced as unknown as T;
}

// ── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  private lastSnapshot: string = '';
  private unsubscribers: Array<() => void> = [];
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Snapshot current state into a WorkspaceSession ─────────────────────

  private captureSession(): WorkspaceSession {
    const app = useAppStore.getState();
    const rt = useRuntimeStore.getState();

    const openFiles: WorkspaceSession['openFiles'] = [];
    rt.openFiles.forEach((file, path) => {
      openFiles.push({
        path,
        language: file.language,
        active: path === rt.activeFilePath,
      });
    });

    const chatHistory: WorkspaceSession['chatHistory'] = rt.chatMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
    }));

    const connectedIntegrations = rt.integrations
      .filter((i) => i.connected)
      .map((i) => i.id);

    const name = app.currentWorkspace || 'default';

    return {
      id: `session_${sanitizeName(name)}`,
      name,
      rootPath: rt.workspaceRoot || '.',
      savedAt: new Date().toISOString(),
      openFiles,
      chatHistory,
      sidebarPanel: app.activeSidebarPanel,
      bottomPanel: app.activeBottomPanel,
      leftSidebarOpen: app.leftSidebarOpen,
      rightPanelOpen: app.rightPanelOpen,
      bottomPanelOpen: app.bottomPanelOpen,
      currentModel: app.currentModel,
      focusMode: app.focusMode,
      connectedIntegrations,
    };
  }

  // ── Persistence layer (Tauri vs browser) ───────────────────────────────

  private async writeSession(name: string, session: WorkspaceSession): Promise<void> {
    const json = JSON.stringify(session, null, 2);

    if (isTauri()) {
      const safeName = sanitizeName(name);
      const path = `${SESSIONS_DIR}/${safeName}.json`;
      // Ensure directory exists by writing (Tauri write_file creates parent dirs)
      try {
        await tauri.writeFile(path, json);
      } catch {
        // Directory might not exist — try creating it first
        try {
          await tauri.writeFile(`${SESSIONS_DIR}/.keep`, '');
        } catch { /* ignore */ }
        await tauri.writeFile(path, json);
      }
    } else {
      localStorage.setItem(`${LS_PREFIX}${name}`, json);
      // Update meta index
      const meta = this.getLocalMeta();
      meta[name] = { savedAt: session.savedAt, rootPath: session.rootPath };
      localStorage.setItem(LS_META_KEY, JSON.stringify(meta));
    }
  }

  private async readSession(name: string): Promise<WorkspaceSession | null> {
    try {
      if (isTauri()) {
        const safeName = sanitizeName(name);
        const path = `${SESSIONS_DIR}/${safeName}.json`;
        const json = await tauri.readFile(path);
        return JSON.parse(json) as WorkspaceSession;
      } else {
        const json = localStorage.getItem(`${LS_PREFIX}${name}`);
        if (!json) return null;
        return JSON.parse(json) as WorkspaceSession;
      }
    } catch {
      return null;
    }
  }

  private async removeSession(name: string): Promise<void> {
    if (isTauri()) {
      // Overwrite with empty to "delete" (Tauri doesn't expose a delete command directly)
      try {
        const safeName = sanitizeName(name);
        await tauri.writeFile(`${SESSIONS_DIR}/${safeName}.json`, '');
      } catch { /* ignore */ }
    } else {
      localStorage.removeItem(`${LS_PREFIX}${name}`);
      const meta = this.getLocalMeta();
      delete meta[name];
      localStorage.setItem(LS_META_KEY, JSON.stringify(meta));
    }
  }

  private getLocalMeta(): Record<string, { savedAt: string; rootPath: string }> {
    try {
      const raw = localStorage.getItem(LS_META_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Save the current IDE state as a session. */
  async saveSession(): Promise<void> {
    const session = this.captureSession();
    const snapshot = JSON.stringify(session);
    this.lastSnapshot = snapshot;
    await this.writeSession(session.name, session);
  }

  /** Synchronous save for beforeunload — best-effort localStorage fallback. */
  saveSessionSync(): void {
    try {
      const session = this.captureSession();
      const json = JSON.stringify(session, null, 2);
      // Always write to localStorage as a safety net
      localStorage.setItem(`${LS_PREFIX}${session.name}`, json);
      const meta = this.getLocalMeta();
      meta[session.name] = { savedAt: session.savedAt, rootPath: session.rootPath };
      localStorage.setItem(LS_META_KEY, JSON.stringify(meta));
    } catch {
      // Best-effort — nothing we can do in beforeunload
    }
  }

  /** Load and restore a named session. */
  async loadSession(workspaceName: string): Promise<boolean> {
    const session = await this.readSession(workspaceName);
    if (!session) return false;

    const app = useAppStore.getState();
    const rt = useRuntimeStore.getState();

    // Restore UI layout
    if (session.leftSidebarOpen !== app.leftSidebarOpen) app.toggleLeftSidebar();
    if (session.rightPanelOpen !== app.rightPanelOpen) app.toggleRightPanel();
    if (session.bottomPanelOpen !== app.bottomPanelOpen) app.toggleBottomPanel();
    app.setSidebarPanel(session.sidebarPanel as Parameters<typeof app.setSidebarPanel>[0]);
    app.setBottomPanel(session.bottomPanel as Parameters<typeof app.setBottomPanel>[0]);
    app.setModel(session.currentModel);
    app.setWorkspace(session.name);
    if (session.focusMode !== app.focusMode) app.toggleFocusMode();

    // Restore workspace root & file tree
    if (session.rootPath) {
      try {
        await rt.loadFileTree(session.rootPath);
      } catch {
        // Non-critical
      }
    }

    // Restore open files
    for (const file of session.openFiles) {
      try {
        await rt.openFile(file.path);
      } catch {
        // File may no longer exist — skip
      }
    }

    // Restore active file
    const activeFile = session.openFiles.find((f) => f.active);
    if (activeFile) {
      try {
        await rt.openFile(activeFile.path);
      } catch { /* skip */ }
    }

    this.lastSnapshot = JSON.stringify(this.captureSession());
    return true;
  }

  /** List all saved sessions. */
  async listSessions(): Promise<Array<{ name: string; savedAt: string; rootPath: string }>> {
    if (isTauri()) {
      try {
        const entries = await tauri.readDir(SESSIONS_DIR);
        const sessions: Array<{ name: string; savedAt: string; rootPath: string }> = [];

        for (const entry of entries) {
          if (entry.name.endsWith('.json') && entry.name !== '.keep') {
            try {
              const json = await tauri.readFile(entry.path);
              if (!json || json.trim() === '') continue;
              const session = JSON.parse(json) as WorkspaceSession;
              sessions.push({
                name: session.name,
                savedAt: session.savedAt,
                rootPath: session.rootPath,
              });
            } catch { /* skip corrupt sessions */ }
          }
        }

        return sessions.sort(
          (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
        );
      } catch {
        return [];
      }
    } else {
      const meta = this.getLocalMeta();
      return Object.entries(meta)
        .map(([name, info]) => ({ name, savedAt: info.savedAt, rootPath: info.rootPath }))
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    }
  }

  /** Delete a saved session. */
  async deleteSession(name: string): Promise<void> {
    await this.removeSession(name);
  }

  /** Get the most recently saved session name. */
  async getLastSession(): Promise<string | null> {
    const sessions = await this.listSessions();
    return sessions.length > 0 ? sessions[0].name : null;
  }

  /** Start debounced auto-save that monitors both stores. */
  autoSave(): () => void {
    const debouncedSave = debounce(async () => {
      const snapshot = JSON.stringify(this.captureSession());
      if (snapshot !== this.lastSnapshot) {
        await this.saveSession();
      }
    }, 30_000);

    // Subscribe to both stores
    const unsubApp = useAppStore.subscribe(() => debouncedSave());
    const unsubRuntime = useRuntimeStore.subscribe(() => debouncedSave());

    this.unsubscribers.push(unsubApp, unsubRuntime);

    // Return cleanup function
    return () => {
      unsubApp();
      unsubRuntime();
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    };
  }

  /** Stop all subscriptions. */
  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
  }
}

// ── Singleton for app-wide use ───────────────────────────────────────────────

let _instance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!_instance) _instance = new SessionManager();
  return _instance;
}
