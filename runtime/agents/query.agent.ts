// ─────────────────────────────────────────────────────────────────────────────
// Aahi — QueryAgent
// Natural language to observability queries: SQL, PromQL, LogQL.
// Triggers: /query, @metrics, @logs
// Always read-only by default.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
  AgentConstraint,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class QueryAgent implements AgentDefinition {
  readonly id = 'query';
  readonly name = 'QueryAgent';
  readonly description = 'Translates natural language questions into observability queries (SQL, PromQL, LogQL), executes them read-only, and explains results';
  readonly triggers = ['/query', '@metrics', '@logs'];
  readonly requiredIntegrations: string[] = [];
  readonly capabilities = ['query.sql', 'query.promql', 'query.logql', 'query.explain'];
  readonly defaultModel = 'claude-sonnet';

  /** Enforced read-only constraint on all plans */
  private readonly readOnlyConstraint: AgentConstraint = {
    type: 'read_only',
    value: true,
  };

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Parse intent and select datasource
    const parseStep: AgentStep = {
      id: uuid(),
      name: 'Parse query intent',
      type: 'llm',
      status: 'pending',
      dependsOn: [],
      modelRequest: {
        systemPrompt: `You are Aahi's QueryAgent intent parser. Analyze the user's natural language question and determine:

1. **Query Type**: metrics (PromQL), logs (LogQL), database (SQL), traces (TraceQL)
2. **Datasource**: Which system to query (Prometheus, Loki, PostgreSQL, Jaeger, etc.)
3. **Time Range**: Extract or infer the time window
4. **Entities**: Services, endpoints, error types, or resources mentioned
5. **Aggregation**: What aggregation is implied (rate, sum, avg, percentile, count)
6. **Filters**: Any filtering conditions

Output a structured JSON with these fields. If the query type is ambiguous, default to metrics.`,
        messages: [
          {
            role: 'user',
            content: `Parse this query: ${intent}`,
          },
        ],
        maxTokens: 1024,
        temperature: 0.1,
      },
    };

    // Step 2: Generate the query in the target language
    const generateStep: AgentStep = {
      id: uuid(),
      name: 'Generate query',
      type: 'llm',
      status: 'pending',
      dependsOn: [parseStep.id],
      modelRequest: {
        systemPrompt: `You are an expert at writing observability queries. Based on the parsed intent, generate the appropriate query:

- **PromQL**: For Prometheus metrics. Use rate(), histogram_quantile(), avg_over_time() etc.
- **LogQL**: For Loki logs. Use line filters, label matchers, and log pipeline stages.
- **SQL**: For database queries. Use read-only SELECT statements only. NEVER generate INSERT/UPDATE/DELETE/DROP.
- **TraceQL**: For Jaeger/Tempo traces.

CRITICAL: All generated queries MUST be read-only. Never generate mutation queries.

Output the raw query string and a brief explanation of what it does.`,
        messages: [
          {
            role: 'user',
            content: `Generate query for: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 1024,
        temperature: 0.1,
      },
    };

    // Step 3: Execute the query (read-only)
    const executeStep: AgentStep = {
      id: uuid(),
      name: 'Execute query',
      type: 'tool',
      status: 'pending',
      dependsOn: [generateStep.id],
      toolAction: {
        integrationId: this.inferDatasource(intent),
        actionId: `${this.inferDatasource(intent)}.execute_query`,
        params: {
          readOnly: true,
          timeout: 30_000,
        },
      },
      approvalGate: {
        actionId: `${this.inferDatasource(intent)}.execute_query`,
        integration: this.inferDatasource(intent),
        actionType: 'read',
        description: 'Execute read-only observability query',
        params: {},
        riskLevel: 'low',
        requiresApproval: false,
        requiresTypedConfirmation: false,
        timeout: 60_000,
      },
    };

    // Step 4: Render and visualize results
    const renderStep: AgentStep = {
      id: uuid(),
      name: 'Render results',
      type: 'llm',
      status: 'pending',
      dependsOn: [executeStep.id],
      modelRequest: {
        systemPrompt: `Format the query results for display:

1. **Summary**: One-line answer to the user's original question
2. **Data Table**: Formatted table of results (limit to top 20 rows)
3. **Chart Suggestion**: Recommend the best visualization type (line, bar, heatmap, table)
4. **Chart Config**: JSON config for rendering the chart (axes, series, colors)

If the result set is large, aggregate and highlight the most relevant data points.`,
        messages: [
          {
            role: 'user',
            content: `Render results for: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.2,
      },
    };

    // Step 5: Explain the results in context
    const explainStep: AgentStep = {
      id: uuid(),
      name: 'Explain results',
      type: 'llm',
      status: 'pending',
      dependsOn: [renderStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's QueryAgent. Provide a comprehensive explanation of the query results:

1. **Direct Answer**: Answer the user's original question clearly
2. **Key Insights**: Notable patterns, anomalies, or trends in the data
3. **Context**: How these numbers compare to normal baselines
4. **Follow-up Queries**: 2-3 suggested follow-up queries the user might want to run
5. **Query Used**: Show the exact query that was executed for transparency

Make the explanation accessible to both engineers and non-technical stakeholders.`,
        messages: [
          {
            role: 'user',
            content: `Explain results for: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.3,
      },
    };

    return {
      id: planId,
      intent,
      steps: [parseStep, generateStep, executeStep, renderStep, explainStep],
      createdAt: new Date(),
      status: 'pending',
      agentId: this.id,
    };
  }

  /** Infer the target datasource from the intent */
  private inferDatasource(intent: string): string {
    const lower = intent.toLowerCase();
    if (lower.includes('log') || lower.includes('loki') || lower.includes('@logs')) return 'loki';
    if (lower.includes('trace') || lower.includes('jaeger') || lower.includes('tempo')) return 'jaeger';
    if (lower.includes('sql') || lower.includes('database') || lower.includes('postgres')) return 'postgresql';
    return 'prometheus';
  }

  private extractParam(intent: string, key: string, defaultValue: string): string {
    const regex = new RegExp(`${key}[=:]\\s*([\\w.-]+)`, 'i');
    const match = intent.match(regex);
    return match?.[1] ?? defaultValue;
  }
}
