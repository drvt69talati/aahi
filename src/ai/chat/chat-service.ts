// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Chat Service
// Powers the Cmd+L chat panel. Manages sessions, assembles context,
// parses mentions & slash commands, and streams LLM responses.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AahiModelAdapter,
  ModelRequest,
  ModelChunk,
  TokenUsage,
  Message,
} from '../models/types.js';
import { ContextEngine, type ContextAssembly, type Mention } from '../context/index.js';
import { SlashCommandRouter, type ParsedSlashCommand } from './slash-command-router.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  mentions?: Mention[];
  modelUsed?: string;
  tokenUsage?: TokenUsage;
  slashCommand?: ParsedSlashCommand;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  model: string;
  createdAt: Date;
  contextAssembly?: ContextAssembly;
}

export interface ChatServiceOptions {
  contextEngine: ContextEngine;
  modelAdapter: AahiModelAdapter;
  systemPrompt?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class ChatService {
  private sessions = new Map<string, ChatSession>();
  private contextEngine: ContextEngine;
  private modelAdapter: AahiModelAdapter;
  private commandRouter: SlashCommandRouter;
  private systemPrompt: string;

  constructor(options: ChatServiceOptions) {
    this.contextEngine = options.contextEngine;
    this.modelAdapter = options.modelAdapter;
    this.commandRouter = new SlashCommandRouter();
    this.systemPrompt = options.systemPrompt ?? this.defaultSystemPrompt();
  }

  // ─── Session Management ─────────────────────────────────────────────

  /**
   * Create a new chat session.
   */
  createSession(): ChatSession {
    const session: ChatSession = {
      id: uuid(),
      messages: [],
      model: this.modelAdapter.model,
      createdAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get an existing session.
   */
  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Delete a session.
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * List all active sessions.
   */
  listSessions(): ChatSession[] {
    return [...this.sessions.values()];
  }

  // ─── Messaging ──────────────────────────────────────────────────────

  /**
   * Send a user message and get a streamed response.
   * Handles @mentions, /commands, context assembly, and streaming.
   */
  async *sendMessage(
    sessionId: string,
    content: string,
  ): AsyncIterable<{ type: 'text' | 'done'; text?: string; message?: ChatMessage }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Parse mentions
    const mentions = this.contextEngine.parseMentions(content);

    // Check for slash commands
    const slashCommand = this.commandRouter.parse(content);

    // Record user message
    const userMessage: ChatMessage = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: new Date(),
      mentions: mentions.length > 0 ? mentions : undefined,
      slashCommand: slashCommand ?? undefined,
    };
    session.messages.push(userMessage);

    // If this is a slash command, route it
    if (slashCommand) {
      const routedContent = `[Agent: ${slashCommand.command.agentId}] ${slashCommand.command.description}\nUser request: ${slashCommand.args}`;
      // Replace content with agent-routed prompt for the LLM
      userMessage.content = routedContent;
    }

    // Assemble context
    const contextAssembly = this.contextEngine.assemble();
    session.contextAssembly = contextAssembly;

    // Build messages for model
    const modelMessages = this.buildModelMessages(session, contextAssembly);

    // Stream response
    const request: ModelRequest = {
      messages: modelMessages,
      systemPrompt: this.systemPrompt,
    };

    let fullResponse = '';
    let usage: TokenUsage | undefined;

    for await (const chunk of this.modelAdapter.streamCall(request)) {
      if (chunk.type === 'text' && chunk.text) {
        fullResponse += chunk.text;
        yield { type: 'text', text: chunk.text };
      }
      if (chunk.type === 'done' && chunk.usage) {
        usage = chunk.usage;
      }
    }

    // Record assistant message
    const assistantMessage: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: fullResponse,
      timestamp: new Date(),
      modelUsed: this.modelAdapter.model,
      tokenUsage: usage,
    };
    session.messages.push(assistantMessage);

    yield { type: 'done', message: assistantMessage };
  }

  // ─── Model Switching ───────────────────────────────────────────────

  /**
   * Switch the model adapter mid-conversation.
   */
  switchModel(adapter: AahiModelAdapter): void {
    this.modelAdapter = adapter;
  }

  // ─── Slash Commands ─────────────────────────────────────────────────

  /**
   * Get the slash command router for registration/listing.
   */
  getCommandRouter(): SlashCommandRouter {
    return this.commandRouter;
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /**
   * Build the message array for the model call, including context.
   */
  private buildModelMessages(
    session: ChatSession,
    contextAssembly: ContextAssembly,
  ): Message[] {
    const messages: Message[] = [];

    // Inject assembled context as a system-like preamble
    if (contextAssembly.sources.length > 0) {
      const contextText = contextAssembly.sources
        .map((source) => {
          const header = `--- [${source.type}] ${source.id} (priority: ${source.priority}) ---`;
          const body = source.chunks.map((c) => c.content).join('\n');
          return `${header}\n${body}`;
        })
        .join('\n\n');

      messages.push({
        role: 'system',
        content: `<context>\n${contextText}\n</context>`,
      });
    }

    // Add conversation history
    for (const msg of session.messages) {
      messages.push({
        role: msg.role,
        content: msg.role === 'user' && msg.slashCommand
          ? msg.content // already routed
          : msg.content,
      });
    }

    return messages;
  }

  private defaultSystemPrompt(): string {
    return [
      'You are Aahi, an AI assistant embedded in a cloud-native IDE.',
      'You have access to the user\'s codebase, logs, traces, metrics, and infrastructure.',
      'Always be precise and reference specific files, services, or data when possible.',
      'If you perform destructive actions, always confirm with the user first.',
    ].join(' ');
  }
}
