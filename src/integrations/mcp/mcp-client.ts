// ─────────────────────────────────────────────────────────────────────────────
// Aahi — MCP Client (Model Context Protocol)
// First-class MCP client — not a plugin, not an extension.
// Connects to any MCP server and exposes its tools as agent actions.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AahiIntegration,
  IntegrationCategory,
  AuthMethod,
  DataType,
  PermissionLevel,
  Credentials,
  ConnectionResult,
  HealthStatus,
  ContextQuery,
  ContextChunk,
  AgentAction,
  ActionParamDef,
  ActionParams,
  ActionResult,
  RedactionRule,
  SystemEvent,
  ApprovalGate,
  EventHandler,
} from '../registry/types.js';

// ─── MCP Protocol Types ─────────────────────────────────────────────────────

interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

// ─── MCP Integration ────────────────────────────────────────────────────────

export class MCPClientIntegration implements AahiIntegration {
  readonly id: string;
  readonly name: string;
  readonly category: IntegrationCategory = 'custom';
  readonly authMethod: AuthMethod = 'mcp';
  readonly dataTypes: DataType[] = ['events'];
  readonly permissions: PermissionLevel = 'read';
  readonly redactionRules: RedactionRule[] = [];

  private serverConfig: MCPServerConfig;
  private tools: MCPTool[] = [];
  private resources: MCPResource[] = [];
  private prompts: MCPPrompt[] = [];
  private connected = false;
  private process: any = null;

  // Dynamic actions built from MCP server capabilities
  private _readActions: AgentAction[] = [];
  private _writeActions: AgentAction[] = [];

  get readActions(): AgentAction[] { return this._readActions; }
  get writeActions(): AgentAction[] { return this._writeActions; }

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig;
    this.id = `mcp:${serverConfig.name}`;
    this.name = `MCP: ${serverConfig.name}`;
  }

  async connect(_credentials: Credentials): Promise<ConnectionResult> {
    try {
      if (this.serverConfig.transport === 'stdio') {
        return await this.connectStdio();
      } else if (this.serverConfig.transport === 'http' || this.serverConfig.transport === 'sse') {
        return await this.connectHttp();
      }
      return { connected: false, error: `Unsupported transport: ${this.serverConfig.transport}` };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill?.();
      this.process = null;
    }
    this.connected = false;
    this.tools = [];
    this.resources = [];
    this._readActions = [];
    this._writeActions = [];
  }

  async fetchContext(query: ContextQuery): Promise<ContextChunk[]> {
    const chunks: ContextChunk[] = [];

    // Fetch from MCP resources
    for (const resource of this.resources) {
      if (query.query && !resource.name.includes(query.query)) continue;

      try {
        const content = await this.readResource(resource.uri);
        chunks.push({
          source: this.id,
          type: 'events',
          content,
          timestamp: new Date(),
          metadata: { uri: resource.uri, name: resource.name },
        });
      } catch {
        // Skip failed resources
      }
    }

    return chunks;
  }

  async executeAction(
    action: AgentAction,
    params: ActionParams,
    _approval: ApprovalGate,
  ): Promise<ActionResult> {
    const start = Date.now();

    try {
      const result = await this.callTool(action.id.replace(`${this.id}:`, ''), params);
      return {
        success: !result.isError,
        data: result.content,
        error: result.isError ? result.content.map(c => c.text).join('\n') : undefined,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  async *streamEvents(_handler: EventHandler): AsyncIterable<SystemEvent> {
    // MCP servers can emit notifications — will be handled by transport layer
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: this.connected,
      latencyMs: 0,
      lastChecked: new Date(),
      error: this.connected ? undefined : 'Not connected',
    };
  }

  /**
   * List available MCP tools.
   */
  getTools(): MCPTool[] {
    return [...this.tools];
  }

  /**
   * List available MCP resources.
   */
  getResources(): MCPResource[] {
    return [...this.resources];
  }

  /**
   * List available MCP prompts.
   */
  getPrompts(): MCPPrompt[] {
    return [...this.prompts];
  }

  // ─── Transport implementations ──────────────────────────────────────────

  private async connectStdio(): Promise<ConnectionResult> {
    if (!this.serverConfig.command) {
      return { connected: false, error: 'No command specified for stdio transport' };
    }

    const { spawn } = await import('child_process');

    this.process = spawn(this.serverConfig.command, this.serverConfig.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.serverConfig.env },
    });

    // Initialize MCP session
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: { subscribe: true },
        prompts: {},
      },
      clientInfo: { name: 'aahi', version: '0.1.0' },
    });

    if (!initResult) {
      return { connected: false, error: 'MCP initialization failed' };
    }

    // Send initialized notification
    await this.sendNotification('notifications/initialized', {});

    // Discover capabilities
    await this.discoverCapabilities();

    this.connected = true;
    return {
      connected: true,
      metadata: {
        serverName: this.serverConfig.name,
        tools: this.tools.length,
        resources: this.resources.length,
        prompts: this.prompts.length,
      },
    };
  }

  private async connectHttp(): Promise<ConnectionResult> {
    if (!this.serverConfig.url) {
      return { connected: false, error: 'No URL specified for HTTP transport' };
    }

    // HTTP/SSE transport would use fetch-based communication
    // For now, mark as connected if URL is reachable
    try {
      const response = await fetch(this.serverConfig.url, { method: 'HEAD' });
      this.connected = response.ok;
      return {
        connected: response.ok,
        error: response.ok ? undefined : `Server responded with ${response.status}`,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async discoverCapabilities(): Promise<void> {
    // List tools
    try {
      const toolsResult = await this.sendRequest('tools/list', {});
      if (toolsResult?.tools) {
        this.tools = toolsResult.tools;
        this.buildActionsFromTools();
      }
    } catch {
      // Server might not support tools
    }

    // List resources
    try {
      const resourcesResult = await this.sendRequest('resources/list', {});
      if (resourcesResult?.resources) {
        this.resources = resourcesResult.resources;
      }
    } catch {
      // Server might not support resources
    }

    // List prompts
    try {
      const promptsResult = await this.sendRequest('prompts/list', {});
      if (promptsResult?.prompts) {
        this.prompts = promptsResult.prompts;
      }
    } catch {
      // Server might not support prompts
    }
  }

  private buildActionsFromTools(): void {
    this._readActions = [];
    this._writeActions = [];

    for (const tool of this.tools) {
      const params = this.schemaToParams(tool.inputSchema);
      const action: AgentAction = {
        id: `${this.id}:${tool.name}`,
        name: tool.name,
        description: tool.description,
        category: 'read', // Default to read; MCP doesn't distinguish
        params,
        requiresApproval: false,
      };
      this._readActions.push(action);
    }
  }

  private schemaToParams(schema: Record<string, unknown>): ActionParamDef[] {
    const params: ActionParamDef[] = [];
    const properties = (schema as any).properties ?? {};
    const required = new Set((schema as any).required ?? []);

    for (const [name, prop] of Object.entries(properties)) {
      const p = prop as Record<string, unknown>;
      params.push({
        name,
        type: (p.type as any) ?? 'string',
        description: (p.description as string) ?? '',
        required: required.has(name),
        default: p.default,
      });
    }

    return params;
  }

  private async callTool(name: string, params: ActionParams): Promise<MCPToolResult> {
    const result = await this.sendRequest('tools/call', { name, arguments: params });
    return result as MCPToolResult;
  }

  private async readResource(uri: string): Promise<string> {
    const result = await this.sendRequest('resources/read', { uri });
    const contents = (result as any)?.contents;
    if (!contents || contents.length === 0) return '';
    return contents[0].text ?? '';
  }

  // ─── JSON-RPC Communication ─────────────────────────────────────────────

  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  private async sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
    if (!this.process?.stdin) {
      throw new Error('MCP process not running');
    }

    const id = ++this.requestId;
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n';

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Set up stdout listener for this request
      const onData = (data: Buffer) => {
        try {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            const response = JSON.parse(line);
            if (response.id !== undefined) {
              const pending = this.pendingRequests.get(response.id);
              if (pending) {
                this.pendingRequests.delete(response.id);
                if (response.error) {
                  pending.reject(new Error(response.error.message));
                } else {
                  pending.resolve(response.result);
                }
              }
            }
          }
        } catch {
          // Partial JSON — wait for more data
        }
      };

      this.process.stdout.on('data', onData);

      this.process.stdin.write(message);

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.process?.stdout.removeListener('data', onData);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30_000);
    });
  }

  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    if (!this.process?.stdin) return;

    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }) + '\n';

    this.process.stdin.write(message);
  }
}
