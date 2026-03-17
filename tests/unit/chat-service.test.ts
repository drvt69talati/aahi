import { describe, it, expect, beforeEach } from 'vitest';
import { ChatService } from '../../src/ai/chat/chat-service.js';
import { SlashCommandRouter } from '../../src/ai/chat/slash-command-router.js';
import { ContextEngine } from '../../src/ai/context/context-engine.js';
import type { AahiModelAdapter, ModelRequest, ModelChunk, ModelResponse } from '../../src/ai/models/types.js';

// ─── Mock Model Adapter ──────────────────────────────────────────────────────

function createMockAdapter(responseText: string = 'Mock response'): AahiModelAdapter {
  return {
    provider: 'mock',
    model: 'mock-model',
    capabilities: ['chat'],
    maxContextTokens: 8192,
    supportsToolUse: false,

    async call(request: ModelRequest): Promise<ModelResponse> {
      return {
        content: responseText,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        model: 'mock-model',
      };
    },

    async *streamCall(request: ModelRequest): AsyncIterable<ModelChunk> {
      yield { type: 'text', text: responseText };
      yield {
        type: 'done',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },

    async countTokens(text: string): Promise<number> {
      return Math.ceil(text.length / 4);
    },
  };
}

// ─── Slash Command Router Tests ──────────────────────────────────────────────

describe('SlashCommandRouter', () => {
  let router: SlashCommandRouter;

  beforeEach(() => {
    router = new SlashCommandRouter();
  });

  it('recognizes built-in commands', () => {
    expect(router.isSlashCommand('/debug some error')).toBe(true);
    expect(router.isSlashCommand('/deploy api-service production')).toBe(true);
    expect(router.isSlashCommand('/review')).toBe(true);
    expect(router.isSlashCommand('/security')).toBe(true);
    expect(router.isSlashCommand('/incident')).toBe(true);
    expect(router.isSlashCommand('/cost')).toBe(true);
    expect(router.isSlashCommand('/query')).toBe(true);
    expect(router.isSlashCommand('/impact')).toBe(true);
    expect(router.isSlashCommand('/timeline')).toBe(true);
    expect(router.isSlashCommand('/who-owns')).toBe(true);
    expect(router.isSlashCommand('/onboard')).toBe(true);
    expect(router.isSlashCommand('/flag')).toBe(true);
    expect(router.isSlashCommand('/release')).toBe(true);
    expect(router.isSlashCommand('/oncall')).toBe(true);
    expect(router.isSlashCommand('/scaffold')).toBe(true);
  });

  it('rejects unknown commands', () => {
    expect(router.isSlashCommand('/unknown-command')).toBe(false);
    expect(router.isSlashCommand('not a command')).toBe(false);
  });

  it('parses command name and args', () => {
    const parsed = router.parse('/debug NullPointerException in UserService');
    expect(parsed).toBeDefined();
    expect(parsed!.command.name).toBe('debug');
    expect(parsed!.command.agentId).toBe('agent-debug');
    expect(parsed!.args).toBe('NullPointerException in UserService');
  });

  it('handles commands with no args', () => {
    const parsed = router.parse('/review');
    expect(parsed).toBeDefined();
    expect(parsed!.command.name).toBe('review');
    expect(parsed!.args).toBe('');
  });

  it('returns undefined for non-commands', () => {
    expect(router.parse('just a message')).toBeUndefined();
    expect(router.parse('/nonexistent foo')).toBeUndefined();
  });

  it('lists all built-in commands', () => {
    const commands = router.listCommands();
    expect(commands.length).toBeGreaterThanOrEqual(15);
    const names = commands.map((c) => c.name);
    expect(names).toContain('debug');
    expect(names).toContain('deploy');
    expect(names).toContain('scaffold');
  });

  it('registers custom commands', () => {
    router.register({
      name: 'custom',
      description: 'A custom command',
      agentId: 'agent-custom',
      usage: '/custom <args>',
    });
    expect(router.isSlashCommand('/custom hello')).toBe(true);
    const parsed = router.parse('/custom hello world');
    expect(parsed!.command.agentId).toBe('agent-custom');
    expect(parsed!.args).toBe('hello world');
  });

  it('unregisters commands', () => {
    router.unregister('debug');
    expect(router.isSlashCommand('/debug error')).toBe(false);
  });
});

// ─── Chat Service Tests ──────────────────────────────────────────────────────

describe('ChatService', () => {
  let service: ChatService;
  let contextEngine: ContextEngine;

  beforeEach(() => {
    contextEngine = new ContextEngine(8192);
    service = new ChatService({
      contextEngine,
      modelAdapter: createMockAdapter(),
    });
  });

  // ─── Session Management ──────────────────────────────────────────

  it('creates and retrieves sessions', () => {
    const session = service.createSession();
    expect(session.id).toBeDefined();
    expect(session.messages).toHaveLength(0);
    expect(service.getSession(session.id)).toBe(session);
  });

  it('deletes sessions', () => {
    const session = service.createSession();
    service.deleteSession(session.id);
    expect(service.getSession(session.id)).toBeUndefined();
  });

  it('lists sessions', () => {
    service.createSession();
    service.createSession();
    expect(service.listSessions()).toHaveLength(2);
  });

  // ─── Messaging ──────────────────────────────────────────────────

  it('sends a message and receives a streamed response', async () => {
    const session = service.createSession();
    const chunks: string[] = [];

    for await (const event of service.sendMessage(session.id, 'Hello')) {
      if (event.type === 'text' && event.text) {
        chunks.push(event.text);
      }
    }

    expect(chunks.join('')).toBe('Mock response');
    expect(session.messages).toHaveLength(2); // user + assistant
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('Mock response');
  });

  it('throws for unknown session', async () => {
    const iter = service.sendMessage('nonexistent', 'Hello');
    await expect(iter.next()).rejects.toThrow('Session not found');
  });

  // ─── Mention Extraction ────────────────────────────────────────

  it('extracts mentions from user messages', async () => {
    const session = service.createSession();

    for await (const _ of service.sendMessage(
      session.id,
      'Check @file:src/auth.ts and @logs:api',
    )) {
      // consume
    }

    const userMsg = session.messages[0];
    expect(userMsg.mentions).toBeDefined();
    expect(userMsg.mentions).toHaveLength(2);
    expect(userMsg.mentions![0].type).toBe('file');
    expect(userMsg.mentions![1].type).toBe('logs');
  });

  // ─── Slash Command Routing ────────────────────────────────────

  it('detects slash commands in messages', async () => {
    const session = service.createSession();

    for await (const _ of service.sendMessage(
      session.id,
      '/debug NullPointerException',
    )) {
      // consume
    }

    const userMsg = session.messages[0];
    expect(userMsg.slashCommand).toBeDefined();
    expect(userMsg.slashCommand!.command.name).toBe('debug');
    expect(userMsg.slashCommand!.command.agentId).toBe('agent-debug');
  });

  // ─── Model Switching ─────────────────────────────────────────

  it('switches model adapter', async () => {
    const newAdapter = createMockAdapter('New model response');
    service.switchModel(newAdapter);

    const session = service.createSession();
    const chunks: string[] = [];

    for await (const event of service.sendMessage(session.id, 'Hello')) {
      if (event.type === 'text' && event.text) {
        chunks.push(event.text);
      }
    }

    expect(chunks.join('')).toBe('New model response');
    expect(session.messages[1].modelUsed).toBe('mock-model');
  });

  // ─── Token Usage Tracking ────────────────────────────────────

  it('tracks token usage on assistant messages', async () => {
    const session = service.createSession();

    for await (const _ of service.sendMessage(session.id, 'Hello')) {
      // consume
    }

    const assistantMsg = session.messages[1];
    expect(assistantMsg.tokenUsage).toBeDefined();
    expect(assistantMsg.tokenUsage!.totalTokens).toBe(15);
  });
});
