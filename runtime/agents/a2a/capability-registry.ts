// ─────────────────────────────────────────────────────────────────────────────
// Aahi — A2A Capability Registry
// Agents register their capabilities. PlannerAgent uses this to route
// subtasks to the right agent. Community agents register via this same API.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentCapability,
  A2AMessage,
  AgentConstraint,
} from '../runtime/types.js';
import type { ContextChunk } from '../../integrations/registry/types.js';

export type A2AHandler = (message: A2AMessage) => Promise<A2AMessage>;

interface RegisteredAgent {
  capability: AgentCapability;
  handler: A2AHandler;
}

export class CapabilityRegistry {
  private agents = new Map<string, RegisteredAgent>();

  /**
   * Register an agent's capabilities and handler.
   */
  register(capability: AgentCapability, handler: A2AHandler): void {
    this.agents.set(capability.agentId, { capability, handler });
  }

  /**
   * Unregister an agent.
   */
  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * Find agents capable of handling a given intent.
   */
  findAgents(intent: string): AgentCapability[] {
    const results: AgentCapability[] = [];
    for (const { capability } of this.agents.values()) {
      if (capability.intents.some(i => this.intentMatches(i, intent))) {
        results.push(capability);
      }
    }
    return results;
  }

  /**
   * Send an A2A message to a specific agent.
   */
  async sendMessage(
    fromAgent: string,
    toAgent: string,
    intent: string,
    context: ContextChunk[],
    constraints: AgentConstraint[] = [],
    replyTo?: string,
  ): Promise<A2AMessage> {
    const target = this.agents.get(toAgent);
    if (!target) {
      throw new Error(`Agent "${toAgent}" not found in capability registry`);
    }

    const message: A2AMessage = {
      id: uuid(),
      fromAgent,
      toAgent,
      intent,
      context,
      constraints,
      replyTo,
      timestamp: new Date(),
    };

    return target.handler(message);
  }

  /**
   * Broadcast intent to all capable agents and collect responses.
   */
  async broadcast(
    fromAgent: string,
    intent: string,
    context: ContextChunk[],
    constraints: AgentConstraint[] = [],
  ): Promise<A2AMessage[]> {
    const capable = this.findAgents(intent);
    const responses = await Promise.allSettled(
      capable.map(cap =>
        this.sendMessage(fromAgent, cap.agentId, intent, context, constraints)
      ),
    );

    return responses
      .filter((r): r is PromiseFulfilledResult<A2AMessage> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * List all registered agent capabilities.
   */
  listCapabilities(): AgentCapability[] {
    return [...this.agents.values()].map(a => a.capability);
  }

  /**
   * Check if a specific agent is registered.
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  private intentMatches(pattern: string, intent: string): boolean {
    // Support wildcards: "debug.*" matches "debug.pod" and "debug.service"
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return intent.startsWith(prefix);
    }
    return pattern === intent;
  }
}
