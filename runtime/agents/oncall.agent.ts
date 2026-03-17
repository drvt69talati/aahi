// ─────────────────────────────────────────────────────────────────────────────
// Aahi — OnCallAgent
// Generates on-call briefings: schedule, incidents, alerts, deploys.
// Triggers: /oncall, shift start
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class OnCallAgent implements AgentDefinition {
  readonly id = 'oncall';
  readonly name = 'OnCallAgent';
  readonly description = 'Generates on-call briefings with schedule, open incidents, alert analysis, and deploy calendar';
  readonly triggers = ['/oncall', 'shift.start'];
  readonly requiredIntegrations = ['pagerduty'];
  readonly capabilities = ['oncall.*', 'briefing.*'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Fetch schedule
    const scheduleStep: AgentStep = {
      id: uuid(),
      name: 'Fetch schedule',
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: {
        integrationId: 'pagerduty',
        actionId: 'pagerduty.get_schedule',
        params: {
          schedule_id: this.extractParam(intent, 'schedule', ''),
          since: new Date().toISOString(),
          until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    };

    // Step 2: Check open incidents
    const incidentsStep: AgentStep = {
      id: uuid(),
      name: 'Check open incidents',
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: {
        integrationId: 'pagerduty',
        actionId: 'pagerduty.list_incidents',
        params: {
          statuses: ['triggered', 'acknowledged'],
          sort_by: 'urgency:DESC',
        },
      },
    };

    // Step 3: Summarize alerts
    const alertsStep: AgentStep = {
      id: uuid(),
      name: 'Summarize alerts',
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: {
        integrationId: 'pagerduty',
        actionId: 'pagerduty.list_alerts',
        params: {
          since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          until: new Date().toISOString(),
        },
      },
    };

    // Step 4: Identify noisy monitors
    const noisyStep: AgentStep = {
      id: uuid(),
      name: 'Identify noisy monitors',
      type: 'llm',
      status: 'pending',
      dependsOn: [alertsStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's OnCallAgent. Analyze the alerts from the past 24 hours and identify:

1. **Noisy monitors**: Alerts that fired repeatedly without actionable cause
2. **Alert frequency**: How often each monitor triggered
3. **Recommendations**: Which monitors to tune, silence, or escalate
4. **Patterns**: Any correlated alert storms or cascading failures

Rank monitors by noise level and provide specific tuning recommendations.`,
        messages: [
          {
            role: 'user',
            content: `On-call intent: ${intent}\n\nAlerts: {{alerts_data}}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    // Step 5: Check deploy calendar
    const deployCalendarStep: AgentStep = {
      id: uuid(),
      name: 'Check deploy calendar',
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: {
        integrationId: 'pagerduty',
        actionId: 'pagerduty.get_change_events',
        params: {
          since: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    };

    // Step 6: Generate briefing
    const briefingStep: AgentStep = {
      id: uuid(),
      name: 'Generate briefing',
      type: 'llm',
      status: 'pending',
      dependsOn: [scheduleStep.id, incidentsStep.id, noisyStep.id, deployCalendarStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's OnCallAgent. Generate a comprehensive on-call briefing that includes:

1. **Schedule**: Who is on-call, shift times, escalation contacts
2. **Open incidents**: Priority-ordered list with status and owner
3. **Alert summary**: Key alerts from the past 24 hours
4. **Noisy monitors**: Monitors that need attention or tuning
5. **Deploy calendar**: Recent and upcoming deployments that may affect stability
6. **Action items**: Prioritized list of things the on-call engineer should address

Format the briefing for quick scanning. Use severity indicators and clear headings.`,
        messages: [
          {
            role: 'user',
            content: `On-call briefing intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.3,
      },
    };

    return {
      id: planId,
      intent,
      steps: [scheduleStep, incidentsStep, alertsStep, noisyStep, deployCalendarStep, briefingStep],
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
