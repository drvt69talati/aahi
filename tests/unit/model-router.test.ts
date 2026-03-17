import { describe, it, expect } from 'vitest';
import { ModelRouter } from '../../runtime/ai/models/model-router.js';
import type { ModelConfig } from '../../runtime/ai/models/types.js';

describe('ModelRouter', () => {
  const models: ModelConfig[] = [
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
      maxContextTokens: 200_000,
      defaultMaxOutputTokens: 4096,
    },
    {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      apiKey: 'test-key',
      maxContextTokens: 1_000_000,
      defaultMaxOutputTokens: 4096,
    },
    {
      provider: 'ollama',
      model: 'llama3.3',
      baseUrl: 'http://localhost:11434',
      maxContextTokens: 128_000,
      defaultMaxOutputTokens: 4096,
    },
  ];

  it('routes chat tasks to the default model', () => {
    const router = new ModelRouter({
      models,
      routing: [],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    const adapter = router.getAdapter('chat');
    expect(adapter.provider).toBe('anthropic');
    expect(adapter.model).toBe('claude-sonnet-4-6');
  });

  it('routes agent-planning to Opus when configured', () => {
    const router = new ModelRouter({
      models,
      routing: [
        {
          taskType: 'agent-planning',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          rationale: 'Most capable',
        },
      ],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    const adapter = router.getAdapter('agent-planning');
    expect(adapter.model).toBe('claude-opus-4-6');
  });

  it('allows runtime routing overrides', () => {
    const router = new ModelRouter({
      models,
      routing: [],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    router.setRouting('chat', 'ollama', 'llama3.3');
    const adapter = router.getAdapter('chat');
    expect(adapter.provider).toBe('ollama');
  });

  it('falls back to default for unknown task types', () => {
    const router = new ModelRouter({
      models,
      routing: [],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    const adapter = router.getAdapter('security-analysis');
    expect(adapter.model).toBe('claude-sonnet-4-6');
  });

  it('lists all registered adapters', () => {
    const router = new ModelRouter({
      models,
      routing: [],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    const adapters = router.listAdapters();
    expect(adapters).toHaveLength(3);
    expect(adapters.map(a => a.provider)).toContain('ollama');
  });

  it('gets specific adapter by provider and model', () => {
    const router = new ModelRouter({
      models,
      routing: [],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    const adapter = router.getSpecificAdapter('ollama', 'llama3.3');
    expect(adapter.provider).toBe('ollama');
    expect(adapter.maxContextTokens).toBe(128_000);
  });

  it('throws for unregistered specific adapter', () => {
    const router = new ModelRouter({
      models,
      routing: [],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    expect(() => router.getSpecificAdapter('openai', 'gpt-99')).toThrow();
  });

  it('registers new adapters at runtime', () => {
    const router = new ModelRouter({
      models,
      routing: [],
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });

    router.registerAdapter({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test',
      maxContextTokens: 128_000,
      defaultMaxOutputTokens: 4096,
    });

    const adapter = router.getSpecificAdapter('openai', 'gpt-4o');
    expect(adapter.provider).toBe('openai');
  });
});
