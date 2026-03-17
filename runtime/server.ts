// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Intelligence Runtime Server
// WebSocket server that bridges the Tauri shell / browser UI to the
// Intelligence Runtime (agents, AI models, integrations, LSP, etc.)
//
// Requires: npm install ws (devDependency: @types/ws)
// ─────────────────────────────────────────────────────────────────────────────

import { WebSocketServer } from 'ws';
import type { WebSocket, RawData } from 'ws';
import { Aahi } from './aahi.js';
import type { AahiConfig } from './aahi.js';
import { LSPManager } from './integrations/lsp/lsp-manager.js';
import { AahiLSPExtensions } from './integrations/lsp/aahi-lsp-extensions.js';
import type { AahiLSPMethodName, AahiLSPRequest } from './integrations/lsp/aahi-lsp-extensions.js';

// ─── IPC Message Types ──────────────────────────────────────────────────────

export interface IPCRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface IPCResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface IPCEvent {
  event: string;
  data: unknown;
}

// ─── Server ─────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 9741;

export class AahiServer {
  private wss: WebSocketServer | null = null;
  private aahi: Aahi;
  private lspManager: LSPManager;
  private lspExtensions: AahiLSPExtensions;
  private port: number;
  private clients = new Set<WebSocket>();

  constructor(config: AahiConfig, rootUri?: string) {
    this.port = parseInt(process.env.AAHI_IPC_PORT ?? '', 10) || DEFAULT_PORT;
    this.aahi = new Aahi(config);

    // LSP Manager
    this.lspManager = new LSPManager();
    if (rootUri) {
      this.lspManager.registerDefaults(rootUri);
    }

    // Wire LSP diagnostics → broadcast to all clients
    this.lspManager.onDiagnostics((uri, diagnostics) => {
      this.broadcast({
        event: 'lsp.diagnostics',
        data: { uri, diagnostics },
      });
    });

    // Aahi LSP Extensions
    this.lspExtensions = new AahiLSPExtensions({
      askModel: async (prompt) => {
        const adapter = this.aahi.modelRouter.getAdapter('chat');
        const response = await adapter.call({
          messages: [{ role: 'user', content: prompt }],
        });
        return response.content;
      },
      analyzeImpact: async (filePath, _diff) => {
        const report = await this.aahi.impactEngine.analyze([filePath]);
        return {
          riskLevel: report.riskLevel,
          affectedFiles: report.changedFiles,
          warnings: report.warnings.map((w) => ({
            message: w.description,
            severity: w.severity,
          })),
          suggestedTests: [],
        };
      },
      attachToContext: (_symbol) => {
        // Context attachment is stored in-memory; UI picks it up via events
      },
      readFile: async (uri) => {
        const { readFile } = await import('node:fs/promises');
        const filePath = uri.replace(/^file:\/\//, '');
        return readFile(filePath, 'utf-8');
      },
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        console.log(`[aahi] Intelligence Runtime listening on ws://localhost:${this.port}`);
        resolve();
      });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);

        ws.on('message', (raw) => {
          this.handleMessage(ws, raw).catch((err) => {
            console.error('[aahi] Unhandled message error:', err);
          });
        });

        ws.on('close', () => {
          this.clients.delete(ws);
        });

        ws.on('error', (err) => {
          console.error('[aahi] WebSocket client error:', err.message);
          this.clients.delete(ws);
        });
      });

      this.wss.on('error', (err) => {
        console.error('[aahi] Server error:', err.message);
      });
    });
  }

  async stop(): Promise<void> {
    // Shutdown LSP servers
    await this.lspManager.stopAll();

    // Shutdown Aahi runtime
    await this.aahi.shutdown();

    // Close WebSocket server
    if (this.wss) {
      for (const ws of this.clients) {
        ws.close(1001, 'Server shutting down');
      }
      this.clients.clear();

      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    console.log('[aahi] Server stopped.');
  }

  // ── Message Handling ──────────────────────────────────────────────────

  private async handleMessage(ws: WebSocket, raw: RawData): Promise<void> {
    let request: IPCRequest;

    try {
      request = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({
        id: 'unknown',
        error: { code: -32700, message: 'Parse error' },
      } satisfies IPCResponse));
      return;
    }

    if (!request.id || !request.method) {
      ws.send(JSON.stringify({
        id: request.id ?? 'unknown',
        error: { code: -32600, message: 'Invalid request: missing id or method' },
      } satisfies IPCResponse));
      return;
    }

    try {
      const result = await this.routeRequest(request, ws);
      ws.send(JSON.stringify({ id: request.id, result } satisfies IPCResponse));
    } catch (err: any) {
      ws.send(JSON.stringify({
        id: request.id,
        error: { code: -32603, message: err.message ?? 'Internal error' },
      } satisfies IPCResponse));
    }
  }

  private async routeRequest(request: IPCRequest, ws: WebSocket): Promise<unknown> {
    const [domain, ...rest] = request.method.split('.');
    const action = rest.join('.');

    switch (domain) {
      case 'model':
        return this.handleModel(action, request.params);
      case 'chat':
        return this.handleChat(action, request.params, ws);
      case 'agent':
        return this.handleAgent(action, request.params, ws);
      case 'integration':
        return this.handleIntegration(action, request.params);
      case 'timeline':
        return this.handleTimeline(action, request.params);
      case 'lsp':
        return this.handleLSP(action, request.params);
      case 'context':
        return this.handleContext(action, request.params);
      case 'redact':
        return this.handleRedact(action, request.params);
      case 'knowledgeGraph':
        return this.handleKnowledgeGraph(action, request.params);
      case 'impact':
        return this.handleImpact(action, request.params);
      default:
        throw new Error(`Unknown domain: ${domain}`);
    }
  }

  // ── Domain Handlers ───────────────────────────────────────────────────

  private async handleModel(action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'call': {
        const adapter = this.aahi.modelRouter.getAdapter(
          ((params.taskType as string) ?? 'chat') as import('./ai/models/types.js').TaskType,
        );
        return adapter.call(params.request as any);
      }
      case 'listAdapters':
        return this.aahi.modelRouter.listAdapters();
      default:
        throw new Error(`Unknown model action: ${action}`);
    }
  }

  private async handleChat(
    action: string,
    params: Record<string, unknown>,
    ws: WebSocket,
  ): Promise<unknown> {
    switch (action) {
      case 'stream': {
        const adapter = this.aahi.modelRouter.getAdapter('chat');
        const stream = adapter.streamCall(params.request as any);
        for await (const chunk of stream) {
          ws.send(JSON.stringify({
            event: 'chat.chunk',
            data: chunk,
          } satisfies IPCEvent));
        }
        return { done: true };
      }
      default:
        throw new Error(`Unknown chat action: ${action}`);
    }
  }

  private async handleAgent(
    action: string,
    params: Record<string, unknown>,
    ws: WebSocket,
  ): Promise<unknown> {
    switch (action) {
      case 'run': {
        const agentId = params.agentId as string;
        const intent = params.intent as string;
        return this.aahi.runAgent(agentId, intent, {
          onStepStart: (step) => {
            ws.send(JSON.stringify({
              event: 'agent.stepStart',
              data: step,
            } satisfies IPCEvent));
          },
          onStepComplete: (step) => {
            ws.send(JSON.stringify({
              event: 'agent.stepComplete',
              data: step,
            } satisfies IPCEvent));
          },
          onApprovalRequired: async (gate) => {
            ws.send(JSON.stringify({
              event: 'agent.approvalRequired',
              data: gate,
            } satisfies IPCEvent));
            // Auto-approve for now — UI should implement approval flow
            return true;
          },
        });
      }
      case 'plan': {
        const intent = params.intent as string;
        return this.aahi.plan(intent);
      }
      case 'list':
        return this.aahi.agents.list().map(a => ({ id: a.id, name: a.name, description: a.description, triggers: a.triggers }));
      default:
        throw new Error(`Unknown agent action: ${action}`);
    }
  }

  private async handleIntegration(
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (action) {
      case 'connect':
        return this.aahi.connectIntegration(
          params.integrationId as string,
          params.credentials as any,
        );
      case 'list':
        return this.aahi.integrations.list();
      case 'health':
        return this.aahi.integrations.checkHealth();
      default:
        throw new Error(`Unknown integration action: ${action}`);
    }
  }

  private async handleTimeline(
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (action) {
      case 'query':
        return this.aahi.timeline.query(params as any);
      case 'append':
        return this.aahi.timeline.append(params.event as any);
      default:
        throw new Error(`Unknown timeline action: ${action}`);
    }
  }

  private async handleLSP(action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'registerServer':
        this.lspManager.registerServer(params.config as any);
        return { ok: true };
      case 'startAll':
        await this.lspManager.startAll();
        return { ok: true };
      case 'stopAll':
        await this.lspManager.stopAll();
        return { ok: true };
      case 'completions':
        return this.lspManager.getCompletions(params.uri as string, params.position as any);
      case 'hover':
        return this.lspManager.getHover(params.uri as string, params.position as any);
      case 'definition':
        return this.lspManager.getDefinition(params.uri as string, params.position as any);
      case 'references':
        return this.lspManager.getReferences(params.uri as string, params.position as any);
      case 'formatting':
        return this.lspManager.formatDocument(params.uri as string);
      case 'codeActions':
        return this.lspManager.getCodeActions(
          params.uri as string,
          params.range as any,
          params.diagnostics as any,
        );
      case 'languages':
        return {
          registered: this.lspManager.getRegisteredLanguages(),
          running: this.lspManager.getRunningLanguages(),
        };
      // Aahi custom LSP extensions
      case 'explainSymbol':
      case 'impactAnalysis':
      case 'generateTests':
      case 'inlineRefactor':
      case 'contextAttach': {
        const method = `aahi/${action}` as AahiLSPMethodName;
        return this.lspExtensions.handle(method, params as AahiLSPRequest[typeof method]);
      }
      default:
        throw new Error(`Unknown lsp action: ${action}`);
    }
  }

  private async handleContext(
    action: string,
    _params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (action) {
      // Placeholder — ContextEngine methods will be wired here
      default:
        throw new Error(`Unknown context action: ${action}`);
    }
  }

  private async handleRedact(
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (action) {
      case 'redact':
        return this.aahi.redaction.redact(params.text as string);
      case 'deRedact':
        return this.aahi.redaction.deRedact(
          params.text as string,
          params.mapId as string,
        );
      default:
        throw new Error(`Unknown redact action: ${action}`);
    }
  }

  private async handleKnowledgeGraph(
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (action) {
      case 'getServiceContext':
        return this.aahi.knowledgeGraph.getServiceContext(params.service as string);
      case 'whoOwns':
        return this.aahi.knowledgeGraph.whoOwns(params.service as string);
      case 'whoKnows':
        return this.aahi.knowledgeGraph.whoKnows(params.filePath as string);
      case 'getExpertise':
        return this.aahi.knowledgeGraph.getExpertise(params.person as string);
      default:
        throw new Error(`Unknown knowledgeGraph action: ${action}`);
    }
  }

  private async handleImpact(
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (action) {
      case 'analyze':
        return this.aahi.impactEngine.analyze(params.files as string[]);
      default:
        throw new Error(`Unknown impact action: ${action}`);
    }
  }

  // ── Broadcasting ──────────────────────────────────────────────────────

  private broadcast(event: IPCEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  }
}

// ─── Standalone Entrypoint ──────────────────────────────────────────────────

export async function startServer(config: AahiConfig, rootUri?: string): Promise<AahiServer> {
  const server = new AahiServer(config, rootUri);
  await server.start();

  // Graceful shutdown on signals
  const shutdown = async () => {
    console.log('[aahi] Shutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
