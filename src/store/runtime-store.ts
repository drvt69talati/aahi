// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Zustand store that syncs UI state with the runtime via WebSocket.
// This is the primary data layer for all runtime-driven UI.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { runtime } from '../bridge/runtime-client';
import { tauri, isTauri } from '../bridge/tauri-bridge';
import type { IndexEntry } from '../bridge/tauri-bridge';

// ── Types matching runtime IPC protocol ──────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  model?: string;
}

export interface AgentExecution {
  planId: string;
  agentId: string;
  intent: string;
  status: 'running' | 'completed' | 'failed';
  steps: AgentStepState[];
}

export interface AgentStepState {
  id: string;
  name: string;
  type: string;
  status: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ApprovalRequest {
  id: string;
  actionId: string;
  integration: string;
  actionType: string;
  description: string;
  riskLevel: string;
  params: Record<string, unknown>;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  source: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  service?: string;
}

export interface ProactiveAlert {
  id: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction?: string;
  timestamp: string;
}

export interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
  children?: FileEntry[];
}

export interface OpenFile {
  path: string;
  content: string;
  language: string;
  dirty: boolean;
}

export interface IntegrationInfo {
  id: string;
  name: string;
  connected: boolean;
  health: string;
}

// ── Store interface ──────────────────────────────────────────────────────

interface RuntimeState {
  // Connection
  connected: boolean;
  error: string | null;

  // Chat
  chatMessages: ChatMessage[];
  chatStreaming: boolean;

  // Agents
  agentExecutions: AgentExecution[];

  // Approvals
  pendingApprovals: ApprovalRequest[];

  // Timeline
  timelineEvents: TimelineEvent[];

  // Proactive
  proactiveAlerts: ProactiveAlert[];

  // File system
  workspaceRoot: string;
  fileTree: FileEntry[];
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;

  // Integrations
  integrations: IntegrationInfo[];

  // Actions
  initialize: () => Promise<void>;
  disconnect: () => void;

  // Chat actions
  sendChatMessage: (content: string, model?: string) => Promise<void>;

  // Agent actions
  runAgent: (agentId: string, intent: string) => Promise<void>;
  runPlan: (intent: string) => Promise<void>;

  // Approval actions
  respondToApproval: (requestId: string, approved: boolean) => Promise<void>;

  // File actions
  openFile: (path: string) => Promise<void>;
  saveFile: (path: string, content: string) => Promise<void>;
  loadFileTree: (root: string) => Promise<void>;

  // Integration actions
  connectIntegration: (id: string, credentials: Record<string, unknown>) => Promise<void>;
  loadIntegrations: () => Promise<void>;

  // Timeline
  loadTimeline: (query?: Record<string, unknown>) => Promise<void>;

  // FIM
  requestCompletion: (
    prefix: string,
    suffix: string,
    language: string,
    line: number,
    col: number,
  ) => Promise<{ text: string } | null>;

  // LSP
  getCompletions: (uri: string, line: number, character: number) => Promise<unknown[]>;
  getHover: (uri: string, line: number, character: number) => Promise<unknown>;
  getDefinition: (uri: string, line: number, character: number) => Promise<unknown[]>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

let messageCounter = 0;
function nextMessageId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact',
    js: 'javascript', jsx: 'javascriptreact',
    py: 'python', rs: 'rust', go: 'go',
    java: 'java', rb: 'ruby', cpp: 'cpp',
    c: 'c', cs: 'csharp', swift: 'swift',
    kt: 'kotlin', md: 'markdown', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml',
    html: 'html', css: 'css', scss: 'scss',
    sql: 'sql', sh: 'shellscript', bash: 'shellscript',
    dockerfile: 'dockerfile',
  };
  return map[ext] || 'plaintext';
}

/** Convert flat IndexEntry[] into a nested FileEntry tree. */
function buildFileTree(entries: IndexEntry[], root: string): FileEntry[] {
  // Sort so directories come first, then alphabetical
  const sorted = [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Build a map of path -> entry with children
  const nodeMap = new Map<string, FileEntry>();
  const topLevel: FileEntry[] = [];

  for (const entry of sorted) {
    const node: FileEntry = {
      path: entry.path,
      name: entry.name,
      isDir: entry.isDir,
      children: entry.isDir ? [] : undefined,
    };
    nodeMap.set(entry.path, node);

    // Find parent path
    const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
    const parent = nodeMap.get(parentPath);

    if (parent && parent.children) {
      parent.children.push(node);
    } else if (parentPath === root || parentPath === root.replace(/\/$/, '')) {
      topLevel.push(node);
    } else {
      // Orphan — add to top level
      topLevel.push(node);
    }
  }

  return topLevel;
}

// ── Event unsubscribe handles ────────────────────────────────────────────

const unsubscribers: Array<() => void> = [];

// ── Store ────────────────────────────────────────────────────────────────

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  // Initial state
  connected: false,
  error: null,
  chatMessages: [],
  chatStreaming: false,
  agentExecutions: [],
  pendingApprovals: [],
  timelineEvents: [],
  proactiveAlerts: [],
  workspaceRoot: '',
  fileTree: [],
  openFiles: new Map(),
  activeFilePath: null,
  integrations: [],

  // ── Initialize ───────────────────────────────────────────────────────

  initialize: async () => {
    try {
      // Start Tauri runtime if running inside Tauri shell
      if (isTauri()) {
        try {
          await tauri.startRuntime();
        } catch (err) {
          console.warn('[RuntimeStore] Could not start Tauri runtime:', err);
        }
      }

      // Connect WebSocket
      await runtime.connect();
      set({ connected: true, error: null });

      // ── Subscribe to all server events ───────────────────────────────

      // Chat streaming chunks
      unsubscribers.push(
        runtime.on('chat.chunk', (data) => {
          const chunk = data as { content?: string; done?: boolean };
          set((s) => {
            const messages = [...s.chatMessages];
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              messages[messages.length - 1] = {
                ...lastMsg,
                content: lastMsg.content + (chunk.content ?? ''),
              };
            }
            return {
              chatMessages: messages,
              chatStreaming: !chunk.done,
            };
          });
        }),
      );

      // Agent step start
      unsubscribers.push(
        runtime.on('agent.stepStart', (data) => {
          const step = data as AgentStepState & { agentId?: string; planId?: string };
          set((s) => {
            const executions = [...s.agentExecutions];
            const exec = executions.find(
              (e) => e.agentId === step.agentId || e.planId === step.planId,
            );
            if (exec) {
              exec.steps = [...exec.steps, { ...step, status: 'running' }];
            }
            return { agentExecutions: executions };
          });
        }),
      );

      // Agent step complete
      unsubscribers.push(
        runtime.on('agent.stepComplete', (data) => {
          const step = data as AgentStepState & { agentId?: string; planId?: string };
          set((s) => {
            const executions = [...s.agentExecutions];
            const exec = executions.find(
              (e) => e.agentId === step.agentId || e.planId === step.planId,
            );
            if (exec) {
              exec.steps = exec.steps.map((s) =>
                s.id === step.id ? { ...s, ...step, status: step.status || 'completed' } : s,
              );
            }
            return { agentExecutions: executions };
          });
        }),
      );

      // Agent approval required
      unsubscribers.push(
        runtime.on('agent.approvalRequired', (data) => {
          const approval = data as ApprovalRequest;
          set((s) => ({
            pendingApprovals: [...s.pendingApprovals, approval],
          }));
        }),
      );

      // LSP diagnostics
      unsubscribers.push(
        runtime.on('lsp.diagnostics', (data) => {
          // Diagnostics are stored per-file; components can subscribe to
          // this event directly via runtime.on() for real-time updates.
          // We emit it here for logging/debugging.
          console.debug('[RuntimeStore] LSP diagnostics:', data);
        }),
      );

      // Timeline events
      unsubscribers.push(
        runtime.on('timeline.event', (data) => {
          const event = data as TimelineEvent;
          set((s) => ({
            timelineEvents: [event, ...s.timelineEvents],
          }));
        }),
      );

      // Proactive alerts
      unsubscribers.push(
        runtime.on('proactive.alert', (data) => {
          const alert = data as ProactiveAlert;
          set((s) => ({
            proactiveAlerts: [alert, ...s.proactiveAlerts],
          }));
        }),
      );

      // Load initial data
      try {
        await get().loadIntegrations();
      } catch {
        // Non-critical — integrations can load later
      }

      // Load workspace file tree
      try {
        const cwd = isTauri() ? '.' : process.cwd?.() ?? '.';
        await get().loadFileTree(cwd);
      } catch {
        // Non-critical — file tree loads on demand
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to runtime';
      set({ connected: false, error: message });
      console.error('[RuntimeStore] Initialization failed:', message);
    }
  },

  // ── Disconnect ─────────────────────────────────────────────────────────

  disconnect: () => {
    // Unsubscribe from all events
    for (const unsub of unsubscribers) {
      unsub();
    }
    unsubscribers.length = 0;

    runtime.disconnect();
    set({ connected: false, error: null });
  },

  // ── Chat ───────────────────────────────────────────────────────────────

  sendChatMessage: async (content: string, model?: string) => {
    const userMessage: ChatMessage = {
      id: nextMessageId(),
      role: 'user',
      content,
      timestamp: new Date(),
      model,
    };

    // Add user message and create placeholder for assistant response
    const assistantMessage: ChatMessage = {
      id: nextMessageId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      model,
    };

    set((s) => ({
      chatMessages: [...s.chatMessages, userMessage, assistantMessage],
      chatStreaming: true,
    }));

    try {
      await runtime.request('chat.stream', {
        request: {
          messages: get().chatMessages
            .filter((m) => m.role !== 'system' || m.content.length > 0)
            .map((m) => ({ role: m.role, content: m.content })),
          ...(model ? { model } : {}),
        },
      });
      // Stream is complete (chunks arrived via event handler above)
      set({ chatStreaming: false });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Chat request failed';
      set((s) => {
        const messages = [...s.chatMessages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          messages[messages.length - 1] = {
            ...lastMsg,
            content: lastMsg.content || `Error: ${errorMsg}`,
          };
        }
        return { chatMessages: messages, chatStreaming: false, error: errorMsg };
      });
    }
  },

  // ── Agents ─────────────────────────────────────────────────────────────

  runAgent: async (agentId: string, intent: string) => {
    const execution: AgentExecution = {
      planId: `plan_${Date.now()}`,
      agentId,
      intent,
      status: 'running',
      steps: [],
    };

    set((s) => ({
      agentExecutions: [...s.agentExecutions, execution],
    }));

    try {
      const result = await runtime.request('agent.run', { agentId, intent });

      set((s) => ({
        agentExecutions: s.agentExecutions.map((e) =>
          e.planId === execution.planId
            ? { ...e, status: 'completed' as const, result }
            : e,
        ),
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Agent execution failed';
      set((s) => ({
        agentExecutions: s.agentExecutions.map((e) =>
          e.planId === execution.planId
            ? { ...e, status: 'failed' as const }
            : e,
        ),
        error: errorMsg,
      }));
    }
  },

  runPlan: async (intent: string) => {
    try {
      const plan = await runtime.request<{ id: string }>('agent.plan', { intent });
      // The plan result can be used by the UI to display planned steps
      console.debug('[RuntimeStore] Plan created:', plan);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Planning failed';
      set({ error: errorMsg });
    }
  },

  // ── Approvals ──────────────────────────────────────────────────────────

  respondToApproval: async (requestId: string, approved: boolean) => {
    try {
      await runtime.request('approval.respond', { requestId, approved });
      set((s) => ({
        pendingApprovals: s.pendingApprovals.filter((a) => a.actionId !== requestId),
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Approval response failed';
      set({ error: errorMsg });
    }
  },

  // ── File operations ────────────────────────────────────────────────────

  openFile: async (path: string) => {
    // Check if already open
    if (get().openFiles.has(path)) {
      set({ activeFilePath: path });
      return;
    }

    try {
      const content = await tauri.readFile(path);
      const language = guessLanguage(path);
      set((s) => {
        const files = new Map(s.openFiles);
        files.set(path, { path, content, language, dirty: false });
        return { openFiles: files, activeFilePath: path };
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : `Failed to open ${path}`;
      set({ error: errorMsg });
    }
  },

  saveFile: async (path: string, content: string) => {
    try {
      await tauri.writeFile(path, content);
      set((s) => {
        const files = new Map(s.openFiles);
        const existing = files.get(path);
        if (existing) {
          files.set(path, { ...existing, content, dirty: false });
        }
        return { openFiles: files };
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : `Failed to save ${path}`;
      set({ error: errorMsg });
    }
  },

  loadFileTree: async (root: string) => {
    try {
      let tree: FileEntry[];

      if (isTauri()) {
        const entries = await tauri.indexWorkspace(root);
        tree = buildFileTree(entries, root);
      } else {
        // In browser mode, file tree must come from the runtime server
        // (not yet implemented on server side; return empty for now)
        tree = [];
      }

      set({ workspaceRoot: root, fileTree: tree });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load file tree';
      set({ error: errorMsg });
    }
  },

  // ── Integrations ───────────────────────────────────────────────────────

  connectIntegration: async (id: string, credentials: Record<string, unknown>) => {
    try {
      await runtime.request('integration.connect', { integrationId: id, credentials });
      // Reload integration list to reflect new status
      await get().loadIntegrations();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : `Failed to connect integration ${id}`;
      set({ error: errorMsg });
    }
  },

  loadIntegrations: async () => {
    try {
      const list = await runtime.request<IntegrationInfo[]>('integration.list');
      set({ integrations: list ?? [] });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load integrations';
      set({ error: errorMsg });
    }
  },

  // ── Timeline ───────────────────────────────────────────────────────────

  loadTimeline: async (query?: Record<string, unknown>) => {
    try {
      const events = await runtime.request<TimelineEvent[]>('timeline.query', query ?? {});
      set({ timelineEvents: events ?? [] });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load timeline';
      set({ error: errorMsg });
    }
  },

  // ── FIM (Fill-in-the-Middle) completion ────────────────────────────────

  requestCompletion: async (
    prefix: string,
    suffix: string,
    language: string,
    line: number,
    col: number,
  ) => {
    try {
      const result = await runtime.request<{ text: string }>('model.call', {
        taskType: 'fim',
        request: { prefix, suffix, language, line, col },
      });
      return result ?? null;
    } catch {
      return null;
    }
  },

  // ── LSP passthrough ────────────────────────────────────────────────────

  getCompletions: async (uri: string, line: number, character: number) => {
    try {
      const result = await runtime.request<unknown[]>('lsp.completions', {
        uri,
        position: { line, character },
      });
      return result ?? [];
    } catch {
      return [];
    }
  },

  getHover: async (uri: string, line: number, character: number) => {
    try {
      return await runtime.request('lsp.hover', {
        uri,
        position: { line, character },
      });
    } catch {
      return null;
    }
  },

  getDefinition: async (uri: string, line: number, character: number) => {
    try {
      const result = await runtime.request<unknown[]>('lsp.definition', {
        uri,
        position: { line, character },
      });
      return result ?? [];
    } catch {
      return [];
    }
  },
}));
