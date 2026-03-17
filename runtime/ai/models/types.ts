// ─────────────────────────────────────────────────────────────────────────────
// Aahi Model Layer — Core Types
// ─────────────────────────────────────────────────────────────────────────────

export type ModelCapability = 'chat' | 'fim' | 'embedding' | 'vision' | 'reasoning';

export type TaskType =
  | 'fim-autocomplete'
  | 'proactive-watcher'
  | 'chat'
  | 'agent-planning'
  | 'agent-tool-execution'
  | 'temporal-reasoning'
  | 'security-analysis'
  | 'embedding';

export interface ModelRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  systemPrompt?: string;
  /** Prefix for FIM completions */
  prefix?: string;
  /** Suffix for FIM completions */
  suffix?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: ImageSource;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
}

export interface ImageSource {
  type: 'base64' | 'url';
  mediaType: string;
  data: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: 'stop' | 'tool_use' | 'max_tokens' | 'error';
  model: string;
}

export interface ModelChunk {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'done';
  text?: string;
  toolCall?: Partial<ToolCall>;
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  orgId?: string;
  /** Max tokens the model supports */
  maxContextTokens: number;
  /** Default max output tokens */
  defaultMaxOutputTokens: number;
}

export interface AahiModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: ModelCapability[];
  readonly maxContextTokens: number;
  readonly supportsToolUse: boolean;

  call(request: ModelRequest): Promise<ModelResponse>;
  streamCall(request: ModelRequest): AsyncIterable<ModelChunk>;
  countTokens(text: string): Promise<number>;
}
