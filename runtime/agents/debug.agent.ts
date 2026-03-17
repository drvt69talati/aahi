// ─────────────────────────────────────────────────────────────────────────────
// Aahi — DebugAgent
// Correlates errors across code, logs, traces, deployments, and incidents.
// Triggers: /debug, error highlight, CrashLoopBackOff, Sentry alert
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class DebugAgent implements AgentDefinition {
  readonly id = 'debug';
  readonly name = 'DebugAgent';
  readonly description = 'Diagnoses errors by correlating code, logs, traces, deploys, and incidents';
  readonly triggers = ['/debug', 'error.highlight', 'k8s.crashloopbackoff', 'sentry.alert'];
  readonly requiredIntegrations = ['github'];
  readonly capabilities = ['debug.*', 'diagnose.*', 'root-cause.*'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Gather error context
    const gatherStep: AgentStep = {
      id: uuid(),
      name: 'Gather error context',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Fetch pod logs', 'kubernetes', 'k8s.get_pod_logs', {
          namespace: this.extractParam(intent, 'namespace', 'default'),
          pod: this.extractParam(intent, 'pod', ''),
          tailLines: 200,
        }),
        this.createToolStep('Fetch K8s events', 'kubernetes', 'k8s.get_events', {
          namespace: this.extractParam(intent, 'namespace', 'default'),
        }),
        this.createToolStep('Fetch recent commits', 'github', 'github.list_commits', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        }),
      ],
    };

    // Step 2: Correlate with timeline (A2A to TemporalAgent)
    const correlateStep: AgentStep = {
      id: uuid(),
      name: 'Temporal correlation',
      type: 'a2a',
      status: 'pending',
      dependsOn: [gatherStep.id],
      a2aMessage: {
        id: uuid(),
        fromAgent: this.id,
        toAgent: 'temporal',
        intent: 'correlate.error',
        context,
        constraints: [{ type: 'max_time', value: 30_000 }],
        timestamp: new Date(),
      },
    };

    // Step 3: LLM analysis — synthesize all gathered data into diagnosis
    const analyzeStep: AgentStep = {
      id: uuid(),
      name: 'Root cause analysis',
      type: 'llm',
      status: 'pending',
      dependsOn: [gatherStep.id, correlateStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's DebugAgent. You have gathered logs, traces, events, recent commits, and temporal correlations for an error. Analyze all evidence and provide:

1. **Root Cause**: The most likely root cause with confidence level
2. **Evidence Chain**: What data points led to this conclusion
3. **Causal Timeline**: Sequence of events that led to the error
4. **Fix Recommendation**: Specific code changes or operational actions
5. **Prevention**: How to prevent recurrence

Be specific. Reference exact log lines, commit SHAs, timestamps, and file paths.`,
        messages: [
          {
            role: 'user',
            content: `Debug intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    return {
      id: planId,
      intent,
      steps: [gatherStep, correlateStep, analyzeStep],
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
    // Simple parameter extraction from intent string
    const regex = new RegExp(`${key}[=:]\\s*([\\w.-]+)`, 'i');
    const match = intent.match(regex);
    return match?.[1] ?? defaultValue;
  }
}
