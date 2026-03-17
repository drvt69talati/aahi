// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Ollama Adapter (Local LLMs — air-gap compatible)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AahiModelAdapter,
  ModelCapability,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  ModelConfig,
  ToolCall,
} from './types.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export class OllamaAdapter implements AahiModelAdapter {
  readonly provider = 'ollama';
  readonly model: string;
  readonly capabilities: ModelCapability[];
  readonly maxContextTokens: number;
  readonly supportsToolUse: boolean;

  private readonly baseUrl: string;

  constructor(config: ModelConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.maxContextTokens = config.maxContextTokens;

    // Most Ollama models support chat; vision/tool-use depends on model
    this.capabilities = ['chat'];
    if (config.model.includes('llava') || config.model.includes('bakllava')) {
      this.capabilities.push('vision');
    }
    // Newer Ollama versions support tool use for some models
    this.supportsToolUse = false;
  }

  async call(request: ModelRequest): Promise<ModelResponse> {
    const messages = this.convertMessages(request);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? 4096,
          stop: request.stop,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${error}`);
    }

    const data = await response.json() as Record<string, any>;

    return {
      content: data.message?.content ?? '',
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      finishReason: 'stop',
      model: this.model,
    };
  }

  async *streamCall(request: ModelRequest): AsyncIterable<ModelChunk> {
    const messages = this.convertMessages(request);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? 4096,
          stop: request.stop,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${error}`);
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
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.done) {
            yield {
              type: 'done',
              usage: {
                promptTokens: data.prompt_eval_count ?? 0,
                completionTokens: data.eval_count ?? 0,
                totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
              },
            };
            return;
          }
          if (data.message?.content) {
            yield { type: 'text', text: data.message.content };
          }
        } catch {
          // skip malformed
        }
      }
    }
  }

  async countTokens(text: string): Promise<number> {
    // Ollama doesn't expose tokenization — rough estimate
    return Math.ceil(text.length / 4);
  }

  private convertMessages(request: ModelRequest): OllamaMessage[] {
    const messages: OllamaMessage[] = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      if (msg.role === 'system') continue;
      messages.push({
        role: msg.role === 'tool' ? 'user' : msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }

    return messages;
  }
}
