// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Slack Integration
// Read + write for Slack channels, messages, and search.
// ─────────────────────────────────────────────────────────────────────────────

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
  ActionParams,
  ActionResult,
  RedactionRule,
  SystemEvent,
  ApprovalGate,
  EventHandler,
} from '../registry/types.js';

export class SlackIntegration implements AahiIntegration {
  readonly id = 'slack';
  readonly name = 'Slack';
  readonly category: IntegrationCategory = 'collaboration';
  readonly authMethod: AuthMethod = 'token';
  readonly dataTypes: DataType[] = ['events'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/g, replacement: '<SLACK_BOT_TOKEN>', description: 'Slack bot token' },
    { pattern: /xoxp-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+/g, replacement: '<SLACK_USER_TOKEN>', description: 'Slack user token' },
    { pattern: /xoxs-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+/g, replacement: '<SLACK_SESSION_TOKEN>', description: 'Slack session token' },
    { pattern: /xoxa-[0-9]+-[0-9]+-[a-f0-9]+/g, replacement: '<SLACK_APP_TOKEN>', description: 'Slack app token' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'slack.list_channels',
      name: 'List Channels',
      description: 'List Slack channels the bot has access to',
      category: 'read',
      params: [
        { name: 'types', type: 'string', description: 'Channel types (public_channel, private_channel)', required: false, default: 'public_channel' },
        { name: 'limit', type: 'number', description: 'Max channels to return', required: false, default: 100 },
      ],
      requiresApproval: false,
    },
    {
      id: 'slack.get_channel_history',
      name: 'Get Channel History',
      description: 'Fetch recent messages from a Slack channel',
      category: 'read',
      params: [
        { name: 'channel', type: 'string', description: 'Channel ID', required: true },
        { name: 'limit', type: 'number', description: 'Max messages to return', required: false, default: 50 },
        { name: 'oldest', type: 'string', description: 'Only messages after this UNIX timestamp', required: false },
        { name: 'latest', type: 'string', description: 'Only messages before this UNIX timestamp', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'slack.search_messages',
      name: 'Search Messages',
      description: 'Search Slack messages across channels',
      category: 'read',
      params: [
        { name: 'query', type: 'string', description: 'Search query', required: true },
        { name: 'count', type: 'number', description: 'Max results to return', required: false, default: 20 },
        { name: 'sort', type: 'string', description: 'Sort order (score or timestamp)', required: false, default: 'score' },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'slack.post_message',
      name: 'Post Message',
      description: 'Post a message to a Slack channel',
      category: 'write',
      params: [
        { name: 'channel', type: 'string', description: 'Channel ID', required: true },
        { name: 'text', type: 'string', description: 'Message text (supports mrkdwn)', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'slack.post_thread_reply',
      name: 'Post Thread Reply',
      description: 'Post a threaded reply to a Slack message',
      category: 'write',
      params: [
        { name: 'channel', type: 'string', description: 'Channel ID', required: true },
        { name: 'thread_ts', type: 'string', description: 'Timestamp of the parent message', required: true },
        { name: 'text', type: 'string', description: 'Reply text (supports mrkdwn)', required: true },
      ],
      requiresApproval: true,
    },
  ];

  private token: string | null = null;
  private baseUrl = 'https://slack.com/api';

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.token = credentials.token ?? credentials.apiKey ?? null;
    if (!this.token) {
      return { connected: false, error: 'Slack bot token is required' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/auth.test`, {
        method: 'POST',
        headers: this.headers(),
      });

      const result = await response.json() as Record<string, any>;
      if (!result.ok) {
        return { connected: false, error: `Slack auth failed: ${result.error}` };
      }

      return {
        connected: true,
        metadata: { team: result.team, user: result.user, bot_id: result.bot_id },
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(): Promise<void> {
    this.token = null;
  }

  async fetchContext(query: ContextQuery): Promise<ContextChunk[]> {
    return [];
  }

  async executeAction(
    action: AgentAction,
    params: ActionParams,
    _approval: ApprovalGate,
  ): Promise<ActionResult> {
    const start = Date.now();

    try {
      switch (action.id) {
        case 'slack.list_channels':
          return await this.listChannels(params, start);
        case 'slack.get_channel_history':
          return await this.getChannelHistory(params, start);
        case 'slack.search_messages':
          return await this.searchMessages(params, start);
        case 'slack.post_message':
          return await this.postMessage(params, start);
        case 'slack.post_thread_reply':
          return await this.postThreadReply(params, start);
        default:
          return { success: false, error: `Unknown action: ${action.id}`, duration: Date.now() - start };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  async *streamEvents(_handler: EventHandler): AsyncIterable<SystemEvent> {
    // In production, this would use Slack Events API or Socket Mode
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/auth.test`, {
        method: 'POST',
        headers: this.headers(),
      });
      const result = await response.json() as Record<string, any>;
      return {
        healthy: result.ok === true,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        error: result.ok ? undefined : result.error,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── Action Implementations ─────────────────────────────────────────────

  private async listChannels(params: ActionParams, start: number): Promise<ActionResult> {
    const types = (params.types as string) ?? 'public_channel';
    const limit = (params.limit as number) ?? 100;
    const data = await this.apiGet(
      `/conversations.list?types=${encodeURIComponent(types)}&limit=${limit}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async getChannelHistory(params: ActionParams, start: number): Promise<ActionResult> {
    const queryParts = [`channel=${params.channel}`, `limit=${(params.limit as number) ?? 50}`];
    if (params.oldest) queryParts.push(`oldest=${params.oldest}`);
    if (params.latest) queryParts.push(`latest=${params.latest}`);
    const data = await this.apiGet(`/conversations.history?${queryParts.join('&')}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async searchMessages(params: ActionParams, start: number): Promise<ActionResult> {
    const count = (params.count as number) ?? 20;
    const sort = (params.sort as string) ?? 'score';
    const data = await this.apiGet(
      `/search.messages?query=${encodeURIComponent(params.query as string)}&count=${count}&sort=${sort}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async postMessage(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPost('/chat.postMessage', {
      channel: params.channel as string,
      text: params.text as string,
    });
    return { success: true, data, duration: Date.now() - start };
  }

  private async postThreadReply(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPost('/chat.postMessage', {
      channel: params.channel as string,
      thread_ts: params.thread_ts as string,
      text: params.text as string,
    });
    return { success: true, data, duration: Date.now() - start };
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async apiGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`Slack API HTTP error ${response.status}: ${await response.text()}`);
    }
    const result = await response.json() as Record<string, any>;
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }
    return result;
  }

  private async apiPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Slack API HTTP error ${response.status}: ${await response.text()}`);
    }
    const result = await response.json() as Record<string, any>;
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }
    return result;
  }
}
