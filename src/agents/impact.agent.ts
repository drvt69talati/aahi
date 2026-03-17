// ─────────────────────────────────────────────────────────────────────────────
// Aahi — ImpactAgent (AAHI EXCLUSIVE)
// Predicts downstream impact of code changes before they ship.
// Triggers: /impact, before deploy, before merge
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class ImpactAgent implements AgentDefinition {
  readonly id = 'impact';
  readonly name = 'ImpactAgent';
  readonly description = 'Analyzes code changes to predict downstream service impact, estimate risk from historical data, and identify missing safeguards';
  readonly triggers = ['/impact', 'pre.deploy', 'pre.merge'];
  readonly requiredIntegrations = ['github', 'kubernetes'];
  readonly capabilities = ['impact.diff-analysis', 'impact.downstream', 'impact.risk-estimate', 'impact.safeguards'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();
    const repo = this.extractParam(intent, 'repo', '');
    const ref = this.extractParam(intent, 'ref', 'HEAD');

    // Step 1: Analyze the diff
    const diffStep: AgentStep = {
      id: uuid(),
      name: 'Analyze diff',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Fetch diff', 'github', 'github.compare_commits', {
          owner: this.extractParam(intent, 'owner', ''),
          repo,
          base: this.extractParam(intent, 'base', 'main'),
          head: ref,
        }),
        this.createToolStep('Fetch changed file history', 'github', 'github.get_file_history', {
          owner: this.extractParam(intent, 'owner', ''),
          repo,
          ref,
          depth: 50,
        }),
      ],
    };

    // Step 2: Identify downstream services via K8s service mesh
    const downstreamStep: AgentStep = {
      id: uuid(),
      name: 'Identify downstream services',
      type: 'parallel',
      status: 'pending',
      dependsOn: [diffStep.id],
      parallelSteps: [
        this.createToolStep('Query service dependency graph', 'kubernetes', 'k8s.get_service_graph', {
          service: this.extractParam(intent, 'service', ''),
          namespace: this.extractParam(intent, 'namespace', 'default'),
          depth: 3,
        }),
        this.createToolStep('Fetch API consumers', 'kubernetes', 'k8s.get_ingress_routes', {
          service: this.extractParam(intent, 'service', ''),
        }),
      ],
    };

    // Step 3: Estimate impact from historical data
    const historyStep: AgentStep = {
      id: uuid(),
      name: 'Estimate impact from history',
      type: 'llm',
      status: 'pending',
      dependsOn: [diffStep.id, downstreamStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's ImpactAgent. Analyze the code diff and historical change data to estimate the risk and impact of this change:

1. **Change Classification**: Schema change, API contract change, behavioral change, config change, dependency update
2. **Historical Pattern**: How similar past changes performed (incident rate, rollback rate)
3. **Risk Score**: 1-10 with justification based on:
   - Size and complexity of change
   - Criticality of affected paths
   - Historical stability of modified files
   - Number of downstream consumers
4. **Estimated Blast Radius**: Services, endpoints, and user flows affected`,
        messages: [
          {
            role: 'user',
            content: `Impact analysis for ${repo}@${ref}:\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.2,
      },
    };

    // Step 4: Check test coverage for changed paths
    const coverageStep: AgentStep = {
      id: uuid(),
      name: 'Check test coverage',
      type: 'tool',
      status: 'pending',
      dependsOn: [diffStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.get_coverage_report',
        params: {
          owner: this.extractParam(intent, 'owner', ''),
          repo,
          ref,
        },
      },
    };

    // Step 5: Identify missing safeguards
    const safeguardsStep: AgentStep = {
      id: uuid(),
      name: 'Identify missing safeguards',
      type: 'llm',
      status: 'pending',
      dependsOn: [historyStep.id, coverageStep.id],
      modelRequest: {
        systemPrompt: `Based on the impact analysis and test coverage, identify missing safeguards:

1. **Missing Tests**: Specific untested code paths that are high risk
2. **Missing Feature Flags**: Changes that should be behind a flag but aren't
3. **Missing Rollback Plan**: Destructive changes without rollback strategy
4. **Missing Monitoring**: New code paths without observability
5. **Missing API Versioning**: Breaking changes without version bump
6. **Missing Rate Limiting**: New endpoints without protection
7. **Missing Documentation**: API changes without updated docs`,
        messages: [
          {
            role: 'user',
            content: `Safeguard check for ${repo}@${ref}:\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.2,
      },
    };

    // Step 6: Generate impact report
    const reportStep: AgentStep = {
      id: uuid(),
      name: 'Generate impact report',
      type: 'llm',
      status: 'pending',
      dependsOn: [historyStep.id, safeguardsStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's ImpactAgent. Compile all analysis into a final impact report:

1. **Impact Score**: Overall risk rating with confidence interval
2. **Change Summary**: What changed and why it matters
3. **Downstream Impact Map**: Visual representation of affected services
4. **Risk Factors**: Ranked list of concerns
5. **Missing Safeguards**: Blocking issues vs recommendations
6. **Deploy Recommendation**: Ship / Ship with caution / Block with reasons
7. **Suggested Mitigations**: Specific actions to reduce risk before shipping

This report is used as a gate before deploys and merges. Be precise and actionable.`,
        messages: [
          {
            role: 'user',
            content: `Final impact report for ${repo}@${ref}:\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    return {
      id: planId,
      intent,
      steps: [diffStep, downstreamStep, historyStep, coverageStep, safeguardsStep, reportStep],
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
