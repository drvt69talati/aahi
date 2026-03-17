// ─────────────────────────────────────────────────────────────────────────────
// Aahi — OpenAI Model Adapter (GPT, o1, o3)
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

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class OpenAIAdapter implements AahiModelAdapter {
  readonly provider = 'openai';
  readonly model: string;
  readonly capabilities: ModelCapability[];
  readonly maxContextTokens: number;
  readonly supportsToolUse = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly orgId?: string;

  constructor(config: ModelConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com';
    this.orgId = config.orgId;
    this.maxContextTokens = config.maxContextTokens;
    this.capabilities = this.resolveCapabilities(config.model);
  }

  private resolveCapabilities(model: string): ModelCapability[] {
    const caps: ModelCapability[] = ['chat'];
    if (model.includes('gpt-4o')) caps.push('vision');
    if (model.startsWith('o1') || model.startsWith('o3')) caps.push('reasoning');
    return caps;
  }

  async call(request: ModelRequest): Promise<ModelResponse> {
    const body = this.buildRequestBody(request, false);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${error}`);
    }

    const data = await response.json() as Record<string, any>;
    return this.parseResponse(data);
  }

  async *streamCall(request: ModelRequest): AsyncIterable<ModelChunk> {
    const body = this.buildRequestBody(request, true);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${error}`);
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
          const delta = event.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: 'text', text: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                yield {
                  type: 'tool_use_start',
                  toolCall: { id: tc.id, name: tc.function.name },
                };
              }
              if (tc.function?.arguments) {
                yield { type: 'tool_use_delta', text: tc.function.arguments };
              }
            }
          }

          if (event.choices?.[0]?.finish_reason) {
            yield {
              type: 'done',
              usage: event.usage ? {
                promptTokens: event.usage.prompt_tokens,
                completionTokens: event.usage.completion_tokens,
                totalTokens: event.usage.total_tokens,
              } : undefined,
            };
          }
        } catch {
          // skip malformed
        }
      }
    }
  }

  async countTokens(text: string): Promise<number> {
    // Rough: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (this.orgId) h['OpenAI-Organization'] = this.orgId;
    return h;
  }

  private buildRequestBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const openaiMessages: OpenAIMessage[] = [];

    if (request.systemPrompt) {
      openaiMessages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      if (msg.role === 'system') continue; // already handled
      if (msg.role === 'tool') {
        openaiMessages.push({
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.toolCallId,
        });
        continue;
      }
      const m: OpenAIMessage = {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : null,
      };
      if (msg.toolCalls) {
        m.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      openaiMessages.push(m);
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      stream,
    };

    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stop) body.stop = request.stop;

    if (request.tools && request.tools.length > 0) {
      body.tools = this.convertTools(request.tools);
    }

    if (stream) {
      body.stream_options = { include_usage: true };
    }

    return body;
  }

  private convertTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  private parseResponse(data: Record<string, any>): ModelResponse {
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc: OpenAIToolCall) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: message?.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'stop',
      model: data.model ?? this.model,
    };
  }
}
