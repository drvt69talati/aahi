import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../../runtime/agents/registry/agent-registry.js';
import type { AgentDefinition, ExecutionPlan } from '../../runtime/agents/runtime/types.js';
import type { ContextChunk } from '../../runtime/integrations/registry/types.js';

/** Minimal stub agent for testing */
function createStubAgent(overrides: Partial<AgentDefinition> & { id: string }): AgentDefinition {
  return {
    name: overrides.name ?? overrides.id,
    description: overrides.description ?? `Stub agent ${overrides.id}`,
    triggers: overrides.triggers ?? [],
    requiredIntegrations: overrides.requiredIntegrations ?? [],
    capabilities: overrides.capabilities ?? [],
    async plan(_intent: string, _context: ContextChunk[]): Promise<ExecutionPlan> {
      return {
        id: 'plan-1',
        intent: _intent,
        steps: [],
        createdAt: new Date(),
        status: 'pending',
        agentId: overrides.id,
      };
    },
    ...overrides,
  };
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('registers and retrieves an agent by id', () => {
    const agent = createStubAgent({ id: 'test-agent' });
    registry.register(agent);

    expect(registry.get('test-agent')).toBe(agent);
    expect(registry.has('test-agent')).toBe(true);
  });

  it('returns undefined for unknown agent id', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('lists all registered agents', () => {
    registry.register(createStubAgent({ id: 'a' }));
    registry.register(createStubAgent({ id: 'b' }));
    registry.register(createStubAgent({ id: 'c' }));

    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list.map(a => a.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('finds agents by trigger', () => {
    registry.register(createStubAgent({ id: 'debug', triggers: ['/debug', 'error.highlight'] }));
    registry.register(createStubAgent({ id: 'deploy', triggers: ['/deploy', 'deploy.start'] }));

    const found = registry.findByTrigger('/debug');
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('debug');
  });

  it('returns multiple agents for the same trigger', () => {
    registry.register(createStubAgent({ id: 'agent-a', triggers: ['shared.trigger'] }));
    registry.register(createStubAgent({ id: 'agent-b', triggers: ['shared.trigger'] }));

    const found = registry.findByTrigger('shared.trigger');
    expect(found).toHaveLength(2);
  });

  it('returns empty array for unmatched trigger', () => {
    registry.register(createStubAgent({ id: 'debug', triggers: ['/debug'] }));
    expect(registry.findByTrigger('/unknown')).toEqual([]);
  });

  it('unregisters an agent and cleans up trigger index', () => {
    registry.register(createStubAgent({ id: 'temp', triggers: ['/temp', 'temp.event'] }));
    expect(registry.has('temp')).toBe(true);

    registry.unregister('temp');
    expect(registry.has('temp')).toBe(false);
    expect(registry.findByTrigger('/temp')).toEqual([]);
    expect(registry.findByTrigger('temp.event')).toEqual([]);
  });

  it('unregistering a non-existent agent is a no-op', () => {
    expect(() => registry.unregister('ghost')).not.toThrow();
  });

  it('reports correct size', () => {
    expect(registry.size).toBe(0);
    registry.register(createStubAgent({ id: 'a' }));
    registry.register(createStubAgent({ id: 'b' }));
    expect(registry.size).toBe(2);
    registry.unregister('a');
    expect(registry.size).toBe(1);
  });

  it('does not duplicate agents on re-registration with same trigger', () => {
    const agent = createStubAgent({ id: 'dup', triggers: ['/dup'] });
    registry.register(agent);
    registry.register(agent);

    expect(registry.size).toBe(1);
    expect(registry.findByTrigger('/dup')).toHaveLength(1);
  });
});
