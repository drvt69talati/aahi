// ─────────────────────────────────────────────────────────────────────────────
// Aahi — TemporalAgent (AAHI EXCLUSIVE)
// Reasons across the unified timeline to find causal chains.
// No other IDE does temporal causal reasoning. This is Aahi's signature.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';
import type { TimelineStore, TimelineEvent, EventCategory } from '../intelligence/timeline/timeline-store.js';

export class TemporalAgent implements AgentDefinition {
  readonly id = 'temporal';
  readonly name = 'TemporalAgent';
  readonly description = 'Reasons across the unified event timeline to find causal chains and root causes';
  readonly triggers = ['/timeline', 'incident.rca', 'anomaly.detected'];
  readonly requiredIntegrations = [];
  readonly capabilities = ['correlate.*', 'timeline.*', 'rca.*'];

  constructor(private timelineStore: TimelineStore) {}

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Query timeline for relevant events
    const queryStep: AgentStep = {
      id: uuid(),
      name: 'Query unified timeline',
      type: 'llm',
      status: 'pending',
      dependsOn: [],
      modelRequest: {
        systemPrompt: `You are Aahi's TemporalAgent. Your role is to identify the time window and event categories relevant to the user's query. Output a JSON object with:
- startTime: ISO timestamp for the start of the search window
- endTime: ISO timestamp for the end
- categories: array of event categories to search
- services: array of service names to focus on
- searchTerms: array of keywords to search for`,
        messages: [
          {
            role: 'user',
            content: `Analyze this intent and determine the search parameters:\n\nIntent: ${intent}\n\nAvailable context:\n${context.map(c => `[${c.source}] ${c.content.slice(0, 500)}`).join('\n')}`,
          },
        ],
        temperature: 0.1,
        maxTokens: 1024,
      },
    };

    // Step 2: Build causal chain from timeline data
    const causalStep: AgentStep = {
      id: uuid(),
      name: 'Build causal chain',
      type: 'llm',
      status: 'pending',
      dependsOn: [queryStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's TemporalAgent performing causal analysis. You have a timeline of events from multiple sources (code, deploys, alerts, incidents, config changes, infra events).

Your task:
1. Identify temporal correlations — events that happened close in time
2. Determine causal relationships — which event likely CAUSED which outcome
3. Build a causal chain from root cause to observed symptom
4. Assign confidence scores to each causal link
5. Identify the most likely root cause event

Output format:
- **Causal Chain**: ordered list of events with timestamps and causal links
- **Root Cause**: the triggering event with confidence score
- **Contributing Factors**: other events that made the issue worse
- **Timeline Visualization**: ASCII timeline of key events
- **Recommendation**: what to do about it

Be precise. Use exact timestamps, event IDs, and service names.`,
        messages: [
          {
            role: 'user',
            content: `Build a causal chain for: ${intent}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 4096,
      },
    };

    return {
      id: planId,
      intent,
      steps: [queryStep, causalStep],
      createdAt: new Date(),
      status: 'pending',
      agentId: this.id,
    };
  }

  /**
   * Direct correlation API — used by other agents via A2A.
   * Finds events temporally correlated with a given event or timestamp.
   */
  correlate(
    targetTimestamp: Date,
    service?: string,
    windowMs: number = 3_600_000,
  ): {
    nearbyEvents: TimelineEvent[];
    likelyCause: TimelineEvent | null;
    confidence: number;
  } {
    const nearbyEvents = this.timelineStore.findNearest(
      targetTimestamp,
      windowMs,
      { services: service ? [service] : undefined },
    );

    // Find the most likely causal event:
    // Priority: deploy > config > code > infra > alert
    const causalPriority: EventCategory[] = ['deploy', 'config', 'code', 'infra'];
    let likelyCause: TimelineEvent | null = null;
    let confidence = 0;

    for (const priority of causalPriority) {
      const candidates = nearbyEvents.filter(
        e => e.category === priority && e.timestamp <= targetTimestamp
      );

      if (candidates.length > 0) {
        // Pick the closest event before the target
        candidates.sort((a, b) =>
          Math.abs(targetTimestamp.getTime() - a.timestamp.getTime()) -
          Math.abs(targetTimestamp.getTime() - b.timestamp.getTime())
        );
        likelyCause = candidates[0];

        // Confidence based on temporal proximity and category
        const timeDiffMs = targetTimestamp.getTime() - likelyCause.timestamp.getTime();
        const timeFactor = Math.max(0, 1 - timeDiffMs / windowMs);
        const categoryBoost = priority === 'deploy' ? 0.3 : priority === 'config' ? 0.2 : 0.1;
        confidence = Math.min(0.99, timeFactor * 0.7 + categoryBoost);
        break;
      }
    }

    return { nearbyEvents, likelyCause, confidence };
  }

  /**
   * Build a human-readable timeline view for a time window.
   */
  buildTimelineView(
    start: Date,
    end: Date,
    services?: string[],
  ): string {
    const events = this.timelineStore.query({
      timeRange: { start, end },
      services,
    });

    if (events.length === 0) return 'No events in this time window.';

    const lines: string[] = ['Timeline:', ''];

    // Reverse to show chronological order
    for (const event of events.reverse()) {
      const time = event.timestamp.toISOString().slice(11, 19); // HH:MM:SS
      const severity = event.severity === 'critical' ? '🔴' :
                       event.severity === 'error' ? '🟠' :
                       event.severity === 'warning' ? '🟡' : '⚪';
      const line = `  ${time} ${severity} [${event.source}/${event.category}] ${event.title}`;
      lines.push(line);
      if (event.service) {
        lines.push(`           └─ service: ${event.service}`);
      }
    }

    return lines.join('\n');
  }
}
