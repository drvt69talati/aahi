// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Model Router
// Routes tasks to the optimal model based on task type, user config, and
// model capabilities. Users can override any routing rule.
// ─────────────────────────────────────────────────────────────────────────────

import type { AahiModelAdapter, ModelConfig, TaskType } from './types.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';

export interface RoutingRule {
  taskType: TaskType;
  provider: string;
  model: string;
  /** Why this model is chosen for this task */
  rationale: string;
}

export interface ModelRouterConfig {
  models: ModelConfig[];
  routing: RoutingRule[];
  defaultModel: { provider: string; model: string };
}

const DEFAULT_ROUTING: RoutingRule[] = [
  {
    taskType: 'fim-autocomplete',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    rationale: 'Fast, low-latency completions',
  },
  {
    taskType: 'proactive-watcher',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    rationale: 'Lightweight background processing',
  },
  {
    taskType: 'chat',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    rationale: 'Balanced capability and speed for interactive chat',
  },
  {
    taskType: 'agent-planning',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    rationale: 'Most capable model for complex planning',
  },
  {
    taskType: 'agent-tool-execution',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    rationale: 'Balanced for tool execution',
  },
  {
    taskType: 'temporal-reasoning',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    rationale: 'Deep reasoning for temporal correlation',
  },
  {
    taskType: 'security-analysis',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    rationale: 'Strong analysis with tool use',
  },
  {
    taskType: 'embedding',
    provider: 'openai',
    model: 'text-embedding-3-large',
    rationale: 'Best embedding quality',
  },
];

export class ModelRouter {
  private adapters = new Map<string, AahiModelAdapter>();
  private routing: RoutingRule[];
  private defaultKey: string;

  constructor(config: ModelRouterConfig) {
    this.routing = config.routing.length > 0 ? config.routing : DEFAULT_ROUTING;
    this.defaultKey = `${config.defaultModel.provider}:${config.defaultModel.model}`;

    for (const modelConfig of config.models) {
      const adapter = this.createAdapter(modelConfig);
      const key = `${modelConfig.provider}:${modelConfig.model}`;
      this.adapters.set(key, adapter);
    }
  }

  /**
   * Get the appropriate model adapter for a given task type.
   * Falls back to default model if no specific routing rule exists.
   */
  getAdapter(taskType: TaskType): AahiModelAdapter {
    const rule = this.routing.find(r => r.taskType === taskType);
    if (rule) {
      const key = `${rule.provider}:${rule.model}`;
      const adapter = this.adapters.get(key);
      if (adapter) return adapter;
    }

    const defaultAdapter = this.adapters.get(this.defaultKey);
    if (!defaultAdapter) {
      throw new Error(
        `No model adapter found for task "${taskType}" and no default configured. ` +
        `Available: ${[...this.adapters.keys()].join(', ')}`
      );
    }
    return defaultAdapter;
  }

  /**
   * Get a specific adapter by provider and model name.
   */
  getSpecificAdapter(provider: string, model: string): AahiModelAdapter {
    const key = `${provider}:${model}`;
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new Error(`No adapter registered for ${key}`);
    }
    return adapter;
  }

  /**
   * Register a new adapter at runtime (e.g., user adds a new model config).
   */
  registerAdapter(config: ModelConfig): void {
    const adapter = this.createAdapter(config);
    const key = `${config.provider}:${config.model}`;
    this.adapters.set(key, adapter);
  }

  /**
   * Override a routing rule at runtime.
   */
  setRouting(taskType: TaskType, provider: string, model: string): void {
    const existing = this.routing.find(r => r.taskType === taskType);
    if (existing) {
      existing.provider = provider;
      existing.model = model;
      existing.rationale = 'User override';
    } else {
      this.routing.push({
        taskType,
        provider,
        model,
        rationale: 'User override',
      });
    }
  }

  /**
   * List all registered adapters.
   */
  listAdapters(): Array<{ provider: string; model: string; capabilities: string[] }> {
    return [...this.adapters.entries()].map(([, adapter]) => ({
      provider: adapter.provider,
      model: adapter.model,
      capabilities: [...adapter.capabilities],
    }));
  }

  /**
   * List current routing rules.
   */
  listRouting(): RoutingRule[] {
    return [...this.routing];
  }

  private createAdapter(config: ModelConfig): AahiModelAdapter {
    switch (config.provider) {
      case 'anthropic':
        return new AnthropicAdapter(config);
      case 'openai':
      case 'azure-openai':
        return new OpenAIAdapter(config);
      case 'ollama':
        return new OllamaAdapter(config);
      default:
        // For unknown providers, try OpenAI-compatible API (most common)
        return new OpenAIAdapter({ ...config, provider: 'openai' });
    }
  }
}
