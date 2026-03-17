// ─────────────────────────────────────────────────────────────────────────────
// Aahi — FeatureFlagAgent
// Manages feature flags with metrics correlation and safe toggling.
// Triggers: /flag, flag change webhook
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class FeatureFlagAgent implements AgentDefinition {
  readonly id = 'featureflag';
  readonly name = 'FeatureFlagAgent';
  readonly description = 'Manages feature flags with metrics correlation and approval-gated toggling';
  readonly triggers = ['/flag', 'flag.change'];
  readonly requiredIntegrations = [];
  readonly capabilities = ['flag.*', 'feature-flag.*'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Fetch flag state
    const fetchFlagStep: AgentStep = {
      id: uuid(),
      name: 'Fetch flag state',
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: {
        integrationId: 'featureflags',
        actionId: 'featureflags.get_flag',
        params: {
          flag_key: this.extractParam(intent, 'flag', ''),
          environment: this.extractParam(intent, 'env', 'production'),
        },
      },
    };

    // Step 2: Correlate with metrics via TemporalAgent (A2A)
    const correlateStep: AgentStep = {
      id: uuid(),
      name: 'Correlate with metrics',
      type: 'a2a',
      status: 'pending',
      dependsOn: [fetchFlagStep.id],
      a2aMessage: {
        id: uuid(),
        fromAgent: this.id,
        toAgent: 'temporal',
        intent: 'correlate.flag_change',
        context,
        constraints: [
          { type: 'max_time', value: 30_000 },
          { type: 'read_only', value: true },
        ],
        timestamp: new Date(),
      },
    };

    // Step 3: Recommend action
    const recommendStep: AgentStep = {
      id: uuid(),
      name: 'Recommend action',
      type: 'llm',
      status: 'pending',
      dependsOn: [fetchFlagStep.id, correlateStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's FeatureFlagAgent. Based on the flag state and correlated metrics, provide:

1. **Current state**: Flag value, targeting rules, rollout percentage
2. **Impact analysis**: How the flag has affected key metrics (error rate, latency, throughput)
3. **Recommendation**: Whether to roll forward, roll back, or hold
4. **Risk assessment**: Potential risks of the recommended action
5. **Rollout plan**: If rolling forward, suggest a safe rollout schedule

Be data-driven. Reference specific metric changes and timeframes.`,
        messages: [
          {
            role: 'user',
            content: `Feature flag intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    // Step 4: Toggle flag (approval-gated)
    const toggleStep: AgentStep = {
      id: uuid(),
      name: 'Toggle flag',
      type: 'tool',
      status: 'pending',
      dependsOn: [recommendStep.id],
      toolAction: {
        integrationId: 'featureflags',
        actionId: 'featureflags.update_flag',
        params: {
          flag_key: this.extractParam(intent, 'flag', ''),
          environment: this.extractParam(intent, 'env', 'production'),
          action: '{{recommended_action}}',
        },
      },
      approvalGate: {
        actionId: uuid(),
        integration: 'featureflag',
        actionType: 'write',
        description: 'Toggling a feature flag in the target environment',
        params: {},
        riskLevel: 'high',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 900_000,
      },
    };

    return {
      id: planId,
      intent,
      steps: [fetchFlagStep, correlateStep, recommendStep, toggleStep],
      createdAt: new Date(),
      status: 'pending',
      agentId: this.id,
    };
  }

  private extractParam(intent: string, key: string, defaultValue: string): string {
    const regex = new RegExp(`${key}[=:]\\s*([\\w./-]+)`, 'i');
    const match = intent.match(regex);
    return match?.[1] ?? defaultValue;
  }
}
