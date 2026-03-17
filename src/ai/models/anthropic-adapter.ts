// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Anthropic Model Adapter (Claude)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AahiModelAdapter,
  ModelCapability,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  Message,
  ToolDefinition,
  ToolCall,
  ModelConfig,
} from './types.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: { type: string; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class AnthropicAdapter implements AahiModelAdapter {
  readonly provider = 'anthropic';
  readonly model: string;
  readonly capabilities: ModelCapability[];
  readonly maxContextTokens: number;
  readonly supportsToolUse = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ModelConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.maxContextTokens = config.maxContextTokens;
    this.capabilities = this.resolveCapabilities(config.model);
  }

  private resolveCapabilities(model: string): ModelCapability[] {
    const base: ModelCapability[] = ['chat'];
    if (model.includes('opus') || model.includes('sonnet')) {
      base.push('reasoning', 'vision');
    }
    if (model.includes('haiku')) {
      base.push('vision');
    }
    return base;
  }

  async call(request: ModelRequest): Promise<ModelResponse> {
    const body = this.buildRequestBody(request, false);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${error}`);
    }

    const data = await response.json() as Record<string, any>;
    return this.parseResponse(data);
  }

  async *streamCall(request: ModelRequest): AsyncIterable<ModelChunk> {
    const body = this.buildRequestBody(request, true);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          yield { type: 'done' };
          return;
        }

        try {
          const event = JSON.parse(payload);
          const chunk = this.parseStreamEvent(event);
          if (chunk) yield chunk;
        } catch {
          // skip malformed events
        }
      }
    }
  }

  async countTokens(text: string): Promise<number> {
    // Rough approximation: ~4 chars per token for English
    // TODO: Use Anthropic's token counting API when available
    return Math.ceil(text.length / 4);
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private buildRequestBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const { systemPrompt, messages, tools, temperature, maxTokens } = request;
    const anthropicMessages = this.convertMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: anthropicMessages,
      max_tokens: maxTokens ?? 4096,
      stream,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (temperature !== undefined) {
      body.temperature = temperature;
    }
    if (tools && tools.length > 0) {
      body.tools = this.convertTools(tools);
    }

    return body;
  }

  private convertMessages(messages: Message[]): AnthropicMessage[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (typeof m.content === 'string') {
          return {
            role: m.role === 'tool' ? 'user' as const : m.role as 'user' | 'assistant',
            content: m.role === 'tool'
              ? [{ type: 'tool_result' as const, tool_use_id: m.toolCallId!, content: m.content }]
              : m.content,
          };
        }

        const blocks: AnthropicContentBlock[] = m.content.map(block => {
          if (block.type === 'text') return { type: 'text' as const, text: block.text };
          if (block.type === 'image') {
            return {
              type: 'image' as const,
              source: {
                type: block.source!.type,
                media_type: block.source!.mediaType,
                data: block.source!.data,
              },
            };
          }
          if (block.type === 'tool_use') {
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input,
            };
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: block.toolUseId,
            content: block.content,
          };
        });

        return {
          role: m.role as 'user' | 'assistant',
          content: blocks,
        };
      });
  }

  private convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  private parseResponse(data: Record<string, any>): ModelResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content ?? []) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      finishReason: data.stop_reason === 'tool_use' ? 'tool_use' : 'stop',
      model: data.model ?? this.model,
    };
  }

  private parseStreamEvent(event: Record<string, any>): ModelChunk | null {
    switch (event.type) {
      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          return {
            type: 'tool_use_start',
            toolCall: {
              id: event.content_block.id,
              name: event.content_block.name,
            },
          };
        }
        return null;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta') {
          return { type: 'text', text: event.delta.text };
        }
        if (event.delta?.type === 'input_json_delta') {
          return { type: 'tool_use_delta', text: event.delta.partial_json };
        }
        return null;

      case 'content_block_stop':
        return { type: 'tool_use_end' };

      case 'message_delta':
        return {
          type: 'done',
          usage: {
            promptTokens: 0,
            completionTokens: event.usage?.output_tokens ?? 0,
            totalTokens: event.usage?.output_tokens ?? 0,
          },
        };

      default:
        return null;
    }
  }
}
