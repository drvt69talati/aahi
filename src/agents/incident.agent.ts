// ─────────────────────────────────────────────────────────────────────────────
// Aahi — IncidentAgent
// Automates incident response: triage, correlation, blast-radius, postmortem.
// Triggers: /incident, PagerDuty alert, OpsGenie alert
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class IncidentAgent implements AgentDefinition {
  readonly id = 'incident';
  readonly name = 'IncidentAgent';
  readonly description = 'Responds to incidents by correlating logs, traces, metrics, identifying blast radius, and drafting postmortems';
  readonly triggers = ['/incident', 'pagerduty.alert', 'opsgenie.alert'];
  readonly requiredIntegrations = ['pagerduty', 'slack', 'jira'];
  readonly capabilities = ['incident.triage', 'incident.correlate', 'incident.postmortem', 'incident.notify'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Fetch incident details from alerting system
    const fetchIncidentStep: AgentStep = {
      id: uuid(),
      name: 'Fetch incident details',
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: {
        integrationId: 'pagerduty',
        actionId: 'pagerduty.get_incident',
        params: {
          incidentId: this.extractParam(intent, 'incident', ''),
        },
      },
    };

    // Step 2: Correlate observability signals in parallel
    const correlateStep: AgentStep = {
      id: uuid(),
      name: 'Correlate observability signals',
      type: 'parallel',
      status: 'pending',
      dependsOn: [fetchIncidentStep.id],
      parallelSteps: [
        this.createToolStep('Fetch service logs', 'datadog', 'datadog.query_logs', {
          query: this.extractParam(intent, 'service', ''),
          timeRange: '1h',
        }),
        this.createToolStep('Fetch traces', 'datadog', 'datadog.query_traces', {
          service: this.extractParam(intent, 'service', ''),
          timeRange: '1h',
        }),
        this.createToolStep('Fetch metrics', 'datadog', 'datadog.query_metrics', {
          service: this.extractParam(intent, 'service', ''),
          timeRange: '1h',
        }),
      ],
    };

    // Step 3: Identify blast radius via dependency graph
    const blastRadiusStep: AgentStep = {
      id: uuid(),
      name: 'Identify blast radius',
      type: 'tool',
      status: 'pending',
      dependsOn: [correlateStep.id],
      toolAction: {
        integrationId: 'kubernetes',
        actionId: 'k8s.get_dependent_services',
        params: {
          service: this.extractParam(intent, 'service', ''),
          namespace: this.extractParam(intent, 'namespace', 'default'),
        },
      },
    };

    // Step 4: Check recent deploys
    const recentDeploysStep: AgentStep = {
      id: uuid(),
      name: 'Check recent deploys',
      type: 'tool',
      status: 'pending',
      dependsOn: [fetchIncidentStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.list_deployments',
        params: {
          repo: this.extractParam(intent, 'repo', ''),
          since: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        },
      },
    };

    // Step 5: Detect causal commit
    const causalCommitStep: AgentStep = {
      id: uuid(),
      name: 'Detect causal commit',
      type: 'a2a',
      status: 'pending',
      dependsOn: [correlateStep.id, recentDeploysStep.id],
      a2aMessage: {
        id: uuid(),
        fromAgent: this.id,
        toAgent: 'debug',
        intent: 'correlate.deploy-to-error',
        context,
        constraints: [{ type: 'max_time', value: 30_000 }],
        timestamp: new Date(),
      },
    };

    // Step 6: LLM synthesis — draft postmortem
    const postmortemStep: AgentStep = {
      id: uuid(),
      name: 'Draft postmortem',
      type: 'llm',
      status: 'pending',
      dependsOn: [blastRadiusStep.id, causalCommitStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's IncidentAgent. Using the gathered incident data, logs, traces, metrics, blast radius analysis, recent deploys, and causal commit detection, draft a structured postmortem:

1. **Incident Summary**: What happened, severity, duration
2. **Timeline**: Chronological sequence of events
3. **Root Cause**: The causal commit or configuration change
4. **Blast Radius**: Affected services and users
5. **Mitigation**: Steps taken to resolve
6. **Action Items**: Preventive measures with owners
7. **Rollback Recommendation**: Whether a rollback is advisable and exact steps

Be precise. Reference commit SHAs, timestamps, service names, and error signatures.`,
        messages: [
          {
            role: 'user',
            content: `Incident intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    // Step 7: Notify Slack
    const slackNotifyStep: AgentStep = {
      id: uuid(),
      name: 'Notify Slack',
      type: 'tool',
      status: 'pending',
      dependsOn: [postmortemStep.id],
      toolAction: {
        integrationId: 'slack',
        actionId: 'slack.post_message',
        params: {
          channel: this.extractParam(intent, 'channel', '#incidents'),
          threadBroadcast: true,
        },
      },
      approvalGate: {
        actionId: 'slack.post_message',
        integration: 'slack',
        actionType: 'write',
        description: 'Post incident summary to Slack',
        params: {},
        riskLevel: 'medium',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 300_000,
      },
    };

    // Step 8: Create Jira ticket
    const jiraStep: AgentStep = {
      id: uuid(),
      name: 'Create Jira postmortem ticket',
      type: 'tool',
      status: 'pending',
      dependsOn: [postmortemStep.id],
      toolAction: {
        integrationId: 'jira',
        actionId: 'jira.create_issue',
        params: {
          project: this.extractParam(intent, 'project', ''),
          issueType: 'Post-Mortem',
          priority: 'High',
        },
      },
      approvalGate: {
        actionId: 'jira.create_issue',
        integration: 'jira',
        actionType: 'write',
        description: 'Create Jira ticket for incident postmortem',
        params: {},
        riskLevel: 'low',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 300_000,
      },
    };

    // Step 9: Suggest rollback if needed
    const rollbackStep: AgentStep = {
      id: uuid(),
      name: 'Suggest rollback plan',
      type: 'llm',
      status: 'pending',
      dependsOn: [postmortemStep.id, slackNotifyStep.id, jiraStep.id],
      modelRequest: {
        systemPrompt: `Based on the incident postmortem, generate a concrete rollback plan if warranted. Include exact commands, target revision, and verification steps. If rollback is not recommended, explain why and suggest alternative remediation.`,
        messages: [
          {
            role: 'user',
            content: `Incident: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.1,
      },
    };

    return {
      id: planId,
      intent,
      steps: [
        fetchIncidentStep,
        correlateStep,
        blastRadiusStep,
        recentDeploysStep,
        causalCommitStep,
        postmortemStep,
        slackNotifyStep,
        jiraStep,
        rollbackStep,
      ],
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
