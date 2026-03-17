// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Main Entry Point
// Wires together the Model Layer, Integration Registry, Timeline Store,
// Agent Runtime, Context Engine, Redaction Pipeline, Knowledge Graph,
// Impact Engine, and Proactive Engine.
// ─────────────────────────────────────────────────────────────────────────────

import { ModelRouter } from './ai/models/model-router.js';
import type { ModelRouterConfig, ModelConfig, TaskType } from './ai/models/index.js';
import { RedactionPipeline } from './ai/redaction/redaction-pipeline.js';
import { IntegrationRegistry } from './integrations/registry/integration-registry.js';
import { TimelineStore } from './intelligence/timeline/timeline-store.js';
import { KnowledgeGraph } from './intelligence/teambrain/knowledge-graph.js';
import { ImpactEngine } from './intelligence/impact/impact-engine.js';
import { DAGExecutor } from './agents/runtime/dag-executor.js';
import { CapabilityRegistry } from './agents/a2a/capability-registry.js';
import { AgentRegistry } from './agents/registry/agent-registry.js';
import { PlannerAgent } from './agents/planner/planner-agent.js';
import { ProactiveAgent } from './agents/proactive.agent.js';
import { TemporalAgent } from './agents/temporal.agent.js';
import { DebugAgent } from './agents/debug.agent.js';
import { IncidentAgent } from './agents/incident.agent.js';
import { DeployAgent } from './agents/deploy.agent.js';
import { ReviewAgent } from './agents/review.agent.js';
import { SecurityAgent } from './agents/security.agent.js';
import { ImpactAgent } from './agents/impact.agent.js';
import { CostAgent } from './agents/cost.agent.js';
import { QueryAgent } from './agents/query.agent.js';
import { ScaffoldAgent } from './agents/scaffold.agent.js';
import { ReleaseAgent } from './agents/release.agent.js';
import { OnCallAgent } from './agents/oncall.agent.js';
import { FeatureFlagAgent } from './agents/featureflag.agent.js';
import { GitHubIntegration } from './integrations/devops/github-integration.js';
import { KubernetesIntegration } from './integrations/devops/kubernetes-integration.js';
import { ArgoCDIntegration } from './integrations/devops/argocd-integration.js';
import { SentryIntegration } from './integrations/observability/sentry-integration.js';
import { DatadogIntegration } from './integrations/observability/datadog-integration.js';
import { PagerDutyIntegration } from './integrations/observability/pagerduty-integration.js';
import { SlackIntegration } from './integrations/collaboration/slack-integration.js';
import { JiraIntegration } from './integrations/collaboration/jira-integration.js';
import { MCPClientIntegration } from './integrations/mcp/mcp-client.js';
import type { AgentCallbacks, ExecutionPlan, AgentDefinition } from './agents/runtime/types.js';
import type { Credentials } from './integrations/registry/types.js';

export interface AahiConfig {
  models: ModelConfig[];
  defaultModel: { provider: string; model: string };
  routing?: ModelRouterConfig['routing'];
}

export class Aahi {
  readonly modelRouter: ModelRouter;
  readonly redaction: RedactionPipeline;
  readonly integrations: IntegrationRegistry;
  readonly timeline: TimelineStore;
  readonly knowledgeGraph: KnowledgeGraph;
  readonly impactEngine: ImpactEngine;
  readonly capabilities: CapabilityRegistry;
  readonly agents: AgentRegistry;
  readonly proactive: ProactiveAgent;

  // Core agents (direct references for convenience)
  readonly plannerAgent: PlannerAgent;
  readonly temporalAgent: TemporalAgent;
  readonly debugAgent: DebugAgent;
  readonly incidentAgent: IncidentAgent;
  readonly deployAgent: DeployAgent;
  readonly reviewAgent: ReviewAgent;
  readonly securityAgent: SecurityAgent;
  readonly impactAgent: ImpactAgent;

  constructor(config: AahiConfig) {
    // 1. Model Router
    this.modelRouter = new ModelRouter({
      models: config.models,
      routing: config.routing ?? [],
      defaultModel: config.defaultModel,
    });

    // 2. Redaction Pipeline — ALL data flows through this
    this.redaction = new RedactionPipeline();

    // 3. Integration Registry + built-in integrations
    this.integrations = new IntegrationRegistry();
    this.integrations.register(new GitHubIntegration());
    this.integrations.register(new KubernetesIntegration());
    this.integrations.register(new ArgoCDIntegration());
    this.integrations.register(new SentryIntegration());
    this.integrations.register(new DatadogIntegration());
    this.integrations.register(new PagerDutyIntegration());
    this.integrations.register(new SlackIntegration());
    this.integrations.register(new JiraIntegration());

    // 4. Timeline Store — append-only event log
    this.timeline = new TimelineStore();

    // 5. Knowledge Graph — org-local, never sent to LLM cloud
    this.knowledgeGraph = new KnowledgeGraph();

    // 6. Impact Engine — predictive foresight
    this.impactEngine = new ImpactEngine(this.knowledgeGraph, this.timeline);

    // 7. A2A Capability Registry
    this.capabilities = new CapabilityRegistry();

    // 8. Agents
    this.temporalAgent = new TemporalAgent(this.timeline);
    this.debugAgent = new DebugAgent();
    this.incidentAgent = new IncidentAgent();
    this.deployAgent = new DeployAgent();
    this.reviewAgent = new ReviewAgent();
    this.securityAgent = new SecurityAgent();
    this.impactAgent = new ImpactAgent();
    this.plannerAgent = new PlannerAgent(this.capabilities);

    // 9. Agent Registry — all agents indexed by trigger
    this.agents = new AgentRegistry();
    const allAgents: AgentDefinition[] = [
      this.debugAgent,
      this.incidentAgent,
      this.deployAgent,
      this.reviewAgent,
      this.securityAgent,
      this.impactAgent,
      this.temporalAgent,
      new CostAgent(),
      new QueryAgent(),
      new ScaffoldAgent(),
      new ReleaseAgent(),
      new OnCallAgent(),
      new FeatureFlagAgent(),
    ];
    for (const agent of allAgents) {
      this.agents.register(agent);
    }

    // 10. Register A2A capabilities for all agents
    for (const agent of allAgents) {
      this.capabilities.register(
        {
          agentId: agent.id,
          intents: agent.capabilities,
          requiredIntegrations: agent.requiredIntegrations,
        },
        async (message) => ({
          ...message,
          fromAgent: agent.id,
          toAgent: message.fromAgent,
          intent: `${agent.id}.result`,
          replyTo: message.id,
          timestamp: new Date(),
        }),
      );
    }

    // 11. Proactive Agent
    this.proactive = new ProactiveAgent(
      this.integrations,
      this.timeline,
    );

    // Wire integration events → timeline
    this.integrations.onEvent((event) => {
      this.timeline.append({
        timestamp: event.timestamp,
        source: event.source as any,
        category: 'alert',
        severity: event.severity ?? 'info',
        title: event.type,
        description: JSON.stringify(event.data),
        data: event.data,
        relatedEventIds: [],
        tags: [event.source, event.type],
      });
    });
  }

  /**
   * Connect an integration by ID.
   */
  async connectIntegration(integrationId: string, credentials: Credentials) {
    return this.integrations.connect(integrationId, credentials);
  }

  /**
   * Register an MCP server as an integration.
   */
  registerMCPServer(config: {
    name: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }): MCPClientIntegration {
    const mcp = new MCPClientIntegration(config);
    this.integrations.register(mcp);
    return mcp;
  }

  /**
   * Create a DAG executor for running agent plans.
   */
  createExecutor(
    taskType: TaskType = 'agent-tool-execution',
    callbacks?: AgentCallbacks,
  ): DAGExecutor {
    const adapter = this.modelRouter.getAdapter(taskType);
    return new DAGExecutor(
      adapter,
      this.integrations,
      this.redaction,
      callbacks,
      (message) => this.capabilities.sendMessage(
        message.fromAgent,
        message.toAgent,
        message.intent,
        message.context,
        message.constraints,
        message.replyTo,
      ),
    );
  }

  /**
   * Run any agent by ID with a natural language intent.
   */
  async runAgent(
    agentId: string,
    intent: string,
    callbacks?: AgentCallbacks,
  ): Promise<ExecutionPlan> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found`);
    const plan = await agent.plan(intent, []);
    const executor = this.createExecutor('agent-planning', callbacks);
    return executor.execute(plan);
  }

  /**
   * Run the PlannerAgent — decomposes complex intents across multiple agents.
   */
  async plan(intent: string, callbacks?: AgentCallbacks): Promise<ExecutionPlan> {
    const plan = await this.plannerAgent.plan(intent, []);
    const executor = this.createExecutor('agent-planning', callbacks);
    return executor.execute(plan);
  }

  /**
   * Run a debug session — the full DebugAgent pipeline.
   */
  async debug(intent: string, callbacks?: AgentCallbacks): Promise<ExecutionPlan> {
    return this.runAgent('debug', intent, callbacks);
  }

  /**
   * Start the proactive engine.
   */
  startProactive(): void {
    this.proactive.start();
    this.integrations.startHealthChecks(60_000);
  }

  /**
   * Stop the proactive engine.
   */
  stopProactive(): void {
    this.proactive.stop();
    this.integrations.stopHealthChecks();
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    this.stopProactive();
    this.redaction.pruneOldMaps(0);
    await this.integrations.shutdown();
  }
}

export default Aahi;
