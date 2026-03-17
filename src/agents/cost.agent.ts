// ─────────────────────────────────────────────────────────────────────────────
// Aahi — CostAgent
// Cloud cost intelligence: analysis, attribution, recommendations.
// Triggers: /cost, cost spike detected
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class CostAgent implements AgentDefinition {
  readonly id = 'cost';
  readonly name = 'CostAgent';
  readonly description = 'Analyzes cloud costs, identifies top spenders, correlates with services, and generates optimization recommendations';
  readonly triggers = ['/cost', 'cloud.cost_spike'];
  readonly requiredIntegrations: string[] = [];
  readonly capabilities = ['cost.analyze', 'cost.attribute', 'cost.recommend', 'cost.forecast'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Query cloud cost data from multiple providers in parallel
    const queryStep: AgentStep = {
      id: uuid(),
      name: 'Query cloud costs',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Query AWS costs', 'aws', 'aws.cost_explorer_query', {
          granularity: this.extractParam(intent, 'granularity', 'DAILY'),
          timePeriod: {
            start: this.extractParam(intent, 'start', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
            end: this.extractParam(intent, 'end', new Date().toISOString().split('T')[0]),
          },
          groupBy: ['SERVICE', 'USAGE_TYPE'],
        }),
        this.createToolStep('Query K8s resource usage', 'kubernetes', 'k8s.get_resource_usage', {
          namespace: this.extractParam(intent, 'namespace', ''),
          aggregateBy: 'namespace',
        }),
      ],
    };

    // Step 2: Identify top spenders and anomalies
    const identifyStep: AgentStep = {
      id: uuid(),
      name: 'Identify top spenders and anomalies',
      type: 'llm',
      status: 'pending',
      dependsOn: [queryStep.id],
      modelRequest: {
        systemPrompt: `Analyze the cloud cost data and identify:

1. **Top 10 Spenders**: Services/resources consuming the most budget
2. **Cost Anomalies**: Unusual spikes or patterns compared to historical baseline
3. **Idle Resources**: Resources running but unused or underutilized
4. **Growth Trends**: Services with fastest cost growth rate

Output structured data with exact dollar amounts, percentages, and time ranges.`,
        messages: [
          {
            role: 'user',
            content: `Cost analysis request: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.1,
      },
    };

    // Step 3: Correlate costs with services and teams
    const correlateStep: AgentStep = {
      id: uuid(),
      name: 'Correlate with services',
      type: 'a2a',
      status: 'pending',
      dependsOn: [identifyStep.id],
      a2aMessage: {
        id: uuid(),
        fromAgent: this.id,
        toAgent: 'teambrain',
        intent: 'map.cost-to-teams',
        context,
        constraints: [{ type: 'max_time', value: 30_000 }, { type: 'read_only', value: true }],
        timestamp: new Date(),
      },
    };

    // Step 4: Generate optimization recommendations
    const recommendStep: AgentStep = {
      id: uuid(),
      name: 'Generate recommendations',
      type: 'llm',
      status: 'pending',
      dependsOn: [identifyStep.id, correlateStep.id],
      modelRequest: {
        systemPrompt: `Generate specific cloud cost optimization recommendations:

1. **Right-sizing**: Instances/containers that can be downsized with specific target sizes
2. **Reserved Instances**: Workloads suitable for RI/Savings Plans with estimated savings
3. **Spot/Preemptible**: Workloads that can safely use spot instances
4. **Cleanup**: Unused resources to delete (EBS volumes, old snapshots, idle LBs)
5. **Architecture**: Structural changes (serverless migration, caching, CDN)
6. **Scheduling**: Non-prod resources that can be shut down off-hours

For each recommendation provide:
- Estimated monthly savings
- Implementation effort (low/medium/high)
- Risk level
- Owner team`,
        messages: [
          {
            role: 'user',
            content: `Generate cost recommendations: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    // Step 5: Generate final cost report
    const reportStep: AgentStep = {
      id: uuid(),
      name: 'Generate cost report',
      type: 'llm',
      status: 'pending',
      dependsOn: [recommendStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's CostAgent. Compile all cost analysis into a final report:

1. **Executive Summary**: Total spend, month-over-month trend, budget utilization
2. **Top Spenders**: Table with service, cost, % of total, trend
3. **Anomalies**: Cost spikes with root cause if identified
4. **Service-to-Team Attribution**: Cost broken down by owning team
5. **Optimization Opportunities**: Ranked by savings potential
6. **Total Potential Savings**: Sum of all recommendations
7. **30/60/90 Day Action Plan**: Prioritized implementation roadmap

Format with clear tables and charts-ready data. Include both executive and detailed views.`,
        messages: [
          {
            role: 'user',
            content: `Final cost report: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    return {
      id: planId,
      intent,
      steps: [queryStep, identifyStep, correlateStep, recommendStep, reportStep],
      createdAt: new Date(),
      status: 'pending',
      agentId: this.id,
    };
  }

  private createToolStep(
    name: string,
    integrationId: string,
    actionId: string,
    params: Record<string, unknown>,
  ): AgentStep {
    return {
      id: uuid(),
      name,
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: { integrationId, actionId, params },
    };
  }

  private extractParam(intent: string, key: string, defaultValue: string): string {
    const regex = new RegExp(`${key}[=:]\\s*([\\w.-]+)`, 'i');
    const match = intent.match(regex);
    return match?.[1] ?? defaultValue;
  }
}
