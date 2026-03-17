// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Integration Test: Chat Flow
// User sends message → ChatService processes → model called → response streamed
// Verifies: message stored, context assembled, redaction applied, response complete
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService, type ChatSession } from '../../runtime/ai/chat/chat-service.js';
import { ContextEngine } from '../../runtime/ai/context/context-engine.js';
import { RedactionPipeline } from '../../runtime/ai/redaction/redaction-pipeline.js';
import type {
  AahiModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelChunk,
} from '../../runtime/ai/models/types.js';

// ─── Mock Model Adapter ─────────────────────────────────────────────────────

function createMockModelAdapter(opts?: {
  response?: string;
  shouldFail?: boolean;
}): AahiModelAdapter {
  const responseText = opts?.response ?? 'Hello from the model!';
  const shouldFail = opts?.shouldFail ?? false;

  return {
    provider: 'mock',
    model: 'mock-chat-1',
    capabilities: ['chat'],
    maxContextTokens: 100_000,
    supportsToolUse: true,
    call: vi.fn().mockImplementation(async (req: ModelRequest) => {
      if (shouldFail) throw new Error('Model call failed');
      return {
        content: responseText,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
        model: 'mock-chat-1',
      } satisfies ModelResponse;
    }),
    streamCall: vi.fn().mockImplementation(function* (req: ModelRequest) {
      if (shouldFail) throw new Error('Model stream failed');
      // Yield text chunks, then a done chunk
      const words = responseText.split(' ');
      for (const word of words) {
        yield { type: 'text', text: word + ' ' } satisfies ModelChunk;
      }
      yield {
        type: 'done',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } satisfies ModelChunk;
    }),
    countTokens: vi.fn().mockResolvedValue(10),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function collectStream(
  stream: AsyncIterable<{ type: 'text' | 'done'; text?: string; message?: any }>,
): Promise<{ chunks: string[]; finalMessage: any }> {
  const chunks: string[] = [];
  let finalMessage: any = null;
  for await (const item of stream) {
    if (item.type === 'text' && item.text) {
      chunks.push(item.text);
    }
    if (item.type === 'done' && item.message) {
      finalMessage = item.message;
    }
  }
  return { chunks, finalMessage };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Chat Flow — Integration', () => {
  let modelAdapter: AahiModelAdapter;
  let contextEngine: ContextEngine;
  let chatService: ChatService;

  beforeEach(() => {
    modelAdapter = createMockModelAdapter({ response: 'The answer is 42.' });
    contextEngine = new ContextEngine(100_000, new RedactionPipeline());
    chatService = new ChatService({
      contextEngine,
      modelAdapter,
    });
  });

  // ── Basic send flow ────────────────────────────────────────────────────

  it('sends a chat message and receives a streamed response', async () => {
    const session = chatService.createSession();
    const stream = chatService.sendMessage(session.id, 'What is the meaning of life?');
    const { chunks, finalMessage } = await collectStream(stream);

    // Chunks should contain the response text
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('The answer is 42.');

    // Final message should be recorded
    expect(finalMessage).toBeDefined();
    expect(finalMessage.role).toBe('assistant');
    expect(finalMessage.content).toBe('The answer is 42. ');

    // Session should have both user and assistant messages
    const savedSession = chatService.getSession(session.id)!;
    expect(savedSession.messages).toHaveLength(2);
    expect(savedSession.messages[0].role).toBe('user');
    expect(savedSession.messages[0].content).toBe('What is the meaning of life?');
    expect(savedSession.messages[1].role).toBe('assistant');
  });

  it('model adapter is called with assembled context', async () => {
    // Add a context source
    contextEngine.addSource({
      id: 'test-file',
      type: 'file',
      priority: 80,
      chunks: [
        {
          source: 'test-file',
          type: 'code',
          content: 'function hello() { return "world"; }',
          timestamp: new Date(),
          tokenEstimate: 10,
        },
      ],
    });

    const session = chatService.createSession();
    await collectStream(chatService.sendMessage(session.id, 'Explain this code'));

    // The model should have been called
    expect(modelAdapter.streamCall).toHaveBeenCalledTimes(1);

    // The request should contain context in a system message
    const callArgs = (modelAdapter.streamCall as any).mock.calls[0][0] as ModelRequest;
    const systemMessages = callArgs.messages.filter((m: any) => m.role === 'system');
    expect(systemMessages.length).toBeGreaterThan(0);
    // The context should include our file content
    const contextContent = systemMessages.map((m: any) => m.content).join(' ');
    expect(contextContent).toContain('hello');
  });

  // ── Redaction in context ──────────────────────────────────────────────

  it('redacts sensitive data in context before model call', async () => {
    contextEngine.addSource({
      id: 'env-file',
      type: 'file',
      priority: 90,
      chunks: [
        {
          source: 'env-file',
          type: 'code',
          content: 'API_KEY=sk-secretkeyvalue1234567890',
          timestamp: new Date(),
          tokenEstimate: 15,
        },
      ],
    });

    const session = chatService.createSession();
    await collectStream(chatService.sendMessage(session.id, 'Check my env file'));

    const callArgs = (modelAdapter.streamCall as any).mock.calls[0][0] as ModelRequest;
    const allContent = callArgs.messages.map((m: any) => m.content).join(' ');

    // The raw secret should NOT appear in the model call
    expect(allContent).not.toContain('sk-secretkeyvalue1234567890');
    // A redaction placeholder should appear
    expect(allContent).toMatch(/<API_KEY_\d+>/);
  });

  // ── @file mention parsing ─────────────────────────────────────────────

  it('parses @file mention from user message', async () => {
    const session = chatService.createSession();
    await collectStream(
      chatService.sendMessage(session.id, 'Explain @file:src/auth.ts'),
    );

    const savedSession = chatService.getSession(session.id)!;
    const userMessage = savedSession.messages[0];
    expect(userMessage.mentions).toBeDefined();
    expect(userMessage.mentions!.length).toBe(1);
    expect(userMessage.mentions![0].type).toBe('file');
    expect(userMessage.mentions![0].value).toBe('src/auth.ts');
  });

  // ── /debug slash command ──────────────────────────────────────────────

  it('identifies /debug slash command and routes it', async () => {
    const session = chatService.createSession();
    await collectStream(
      chatService.sendMessage(session.id, '/debug CrashLoopBackOff in auth-service'),
    );

    const savedSession = chatService.getSession(session.id)!;
    const userMessage = savedSession.messages[0];

    // Slash command should be parsed
    expect(userMessage.slashCommand).toBeDefined();
    expect(userMessage.slashCommand!.command.name).toBe('debug');
    expect(userMessage.slashCommand!.args).toBe('CrashLoopBackOff in auth-service');

    // The content sent to the model should be the routed agent prompt
    expect(userMessage.content).toContain('Agent: agent-debug');
  });

  // ── Chat history across messages ──────────────────────────────────────

  it('maintains chat history across multiple messages', async () => {
    const session = chatService.createSession();

    // Send first message
    await collectStream(chatService.sendMessage(session.id, 'Hello'));
    // Send second message
    await collectStream(chatService.sendMessage(session.id, 'Follow up question'));

    const savedSession = chatService.getSession(session.id)!;
    // Should have: user1, assistant1, user2, assistant2
    expect(savedSession.messages).toHaveLength(4);
    expect(savedSession.messages[0].content).toBe('Hello');
    expect(savedSession.messages[1].role).toBe('assistant');
    expect(savedSession.messages[2].content).toBe('Follow up question');
    expect(savedSession.messages[3].role).toBe('assistant');

    // The second model call should include the full history
    const secondCall = (modelAdapter.streamCall as any).mock.calls[1][0] as ModelRequest;
    const userMessages = secondCall.messages.filter((m: any) => m.role === 'user');
    expect(userMessages.length).toBe(2);
  });

  // ── Error handling ────────────────────────────────────────────────────

  it('propagates error when model call fails', async () => {
    const failingAdapter = createMockModelAdapter({ shouldFail: true });
    const failService = new ChatService({
      contextEngine,
      modelAdapter: failingAdapter,
    });

    const session = failService.createSession();

    await expect(async () => {
      await collectStream(failService.sendMessage(session.id, 'This should fail'));
    }).rejects.toThrow('Model stream failed');
  });

  it('throws when sending to a non-existent session', async () => {
    await expect(async () => {
      await collectStream(chatService.sendMessage('non-existent-id', 'Hello'));
    }).rejects.toThrow(/[Ss]ession not found/);
  });
});
