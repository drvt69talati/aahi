import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityRegistry } from '../../src/agents/a2a/capability-registry.js';
import type { A2AMessage } from '../../src/agents/runtime/types.js';

describe('CapabilityRegistry', () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it('registers and finds agents by intent', () => {
    registry.register(
      { agentId: 'debug', intents: ['debug.*'], requiredIntegrations: [] },
      async (msg) => ({ ...msg, fromAgent: 'debug', toAgent: msg.fromAgent, timestamp: new Date() }),
    );

    const found = registry.findAgents('debug.pod');
    expect(found).toHaveLength(1);
    expect(found[0].agentId).toBe('debug');
  });

  it('returns empty for unmatched intents', () => {
    registry.register(
      { agentId: 'debug', intents: ['debug.*'], requiredIntegrations: [] },
      async (msg) => msg,
    );

    expect(registry.findAgents('deploy.service')).toHaveLength(0);
  });

  it('sends A2A messages', async () => {
    let received: A2AMessage | null = null;

    registry.register(
      { agentId: 'temporal', intents: ['correlate.*'], requiredIntegrations: [] },
      async (msg) => {
        received = msg;
        return { ...msg, fromAgent: 'temporal', toAgent: msg.fromAgent, timestamp: new Date() };
      },
    );

    const response = await registry.sendMessage(
      'debug',
      'temporal',
      'correlate.error',
      [],
      [],
    );

    expect(received).not.toBeNull();
    expect(received!.fromAgent).toBe('debug');
    expect(response.fromAgent).toBe('temporal');
  });

  it('broadcasts to all capable agents', async () => {
    let count = 0;

    registry.register(
      { agentId: 'agent-a', intents: ['analyze.*'], requiredIntegrations: [] },
      async (msg) => { count++; return { ...msg, fromAgent: 'agent-a', toAgent: msg.fromAgent, timestamp: new Date() }; },
    );
    registry.register(
      { agentId: 'agent-b', intents: ['analyze.*'], requiredIntegrations: [] },
      async (msg) => { count++; return { ...msg, fromAgent: 'agent-b', toAgent: msg.fromAgent, timestamp: new Date() }; },
    );

    const responses = await registry.broadcast('planner', 'analyze.code', []);
    expect(responses).toHaveLength(2);
    expect(count).toBe(2);
  });

  it('throws when sending to unregistered agent', async () => {
    await expect(
      registry.sendMessage('debug', 'nonexistent', 'test', []),
    ).rejects.toThrow('not found');
  });

  it('unregisters agents', () => {
    registry.register(
      { agentId: 'debug', intents: ['debug.*'], requiredIntegrations: [] },
      async (msg) => msg,
    );

    expect(registry.has('debug')).toBe(true);
    registry.unregister('debug');
    expect(registry.has('debug')).toBe(false);
  });

  it('supports wildcard intent matching', () => {
    registry.register(
      { agentId: 'catch-all', intents: ['*'], requiredIntegrations: [] },
      async (msg) => msg,
    );

    expect(registry.findAgents('anything.goes')).toHaveLength(1);
  });

  it('lists all capabilities', () => {
    registry.register(
      { agentId: 'a', intents: ['debug.*'], requiredIntegrations: ['github'] },
      async (msg) => msg,
    );
    registry.register(
      { agentId: 'b', intents: ['deploy.*'], requiredIntegrations: ['k8s'] },
      async (msg) => msg,
    );

    const caps = registry.listCapabilities();
    expect(caps).toHaveLength(2);
  });
});
