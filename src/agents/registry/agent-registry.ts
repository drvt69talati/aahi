// ─────────────────────────────────────────────────────────────────────────────
// Aahi — AgentRegistry
// Central registry for all built-in and custom agents.
// Agents are registered externally (by Aahi main class) to handle dependency
// injection correctly. YAML custom agents are loaded from directory.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentDefinition } from '../runtime/types.js';
import { CustomAgentLoader } from '../custom.agent.js';

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private triggerIndex = new Map<string, string[]>();

  /**
   * Register an agent definition.
   */
  register(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);

    for (const trigger of agent.triggers) {
      const existing = this.triggerIndex.get(trigger) ?? [];
      if (!existing.includes(agent.id)) {
        existing.push(agent.id);
      }
      this.triggerIndex.set(trigger, existing);
    }
  }

  /**
   * Get an agent by its ID.
   */
  get(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all registered agents.
   */
  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  /**
   * Find agents that respond to a given trigger.
   */
  findByTrigger(trigger: string): AgentDefinition[] {
    const agentIds = this.triggerIndex.get(trigger) ?? [];
    return agentIds
      .map(id => this.agents.get(id))
      .filter((a): a is AgentDefinition => a !== undefined);
  }

  /**
   * Check if an agent is registered.
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Unregister an agent.
   */
  unregister(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      for (const trigger of agent.triggers) {
        const ids = this.triggerIndex.get(trigger);
        if (ids) {
          const filtered = ids.filter(id => id !== agentId);
          if (filtered.length === 0) {
            this.triggerIndex.delete(trigger);
          } else {
            this.triggerIndex.set(trigger, filtered);
          }
        }
      }
      this.agents.delete(agentId);
    }
  }

  /**
   * Load custom agents from YAML files in a directory and register them.
   */
  loadCustomAgents(yamlDir: string): AgentDefinition[] {
    const agents = CustomAgentLoader.loadFromDirectory(yamlDir);
    for (const agent of agents) {
      this.register(agent);
    }
    return agents;
  }

  /**
   * Total count of registered agents.
   */
  get size(): number {
    return this.agents.size;
  }
}
