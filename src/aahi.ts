// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Main Entry Point
// Wires together the Model Layer, Integration Registry, Timeline Store,
// Agent Runtime, Redaction Pipeline, and Proactive Engine.
// ─────────────────────────────────────────────────────────────────────────────

import { ModelRouter } from './ai/models/model-router.js';
import type { ModelRouterConfig, ModelConfig, TaskType } from './ai/models/index.js';
import { RedactionPipeline } from './ai/redaction/redaction-pipeline.js';
import { IntegrationRegistry } from './integrations/registry/integration-registry.js';
import { TimelineStore } from './intelligence/timeline/timeline-store.js';
import { DAGExecutor } from './agents/runtime/dag-executor.js';
import { CapabilityRegistry } from './agents/a2a/capability-registry.js';
import { ProactiveAgent } from './agents/proactive.agent.js';
import { TemporalAgent } from './agents/temporal.agent.js';
import { DebugAgent } from './agents/debug.agent.js';
import { GitHubIntegration } from './integrations/devops/github-integration.js';
import { KubernetesIntegration } from './integrations/devops/kubernetes-integration.js';
import { MCPClientIntegration } from './integrations/mcp/mcp-client.js';
import type { AgentCallbacks, ExecutionPlan } from './agents/runtime/types.js';
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
  readonly capabilities: CapabilityRegistry;
  readonly proactive: ProactiveAgent;

  // Agents
  readonly temporalAgent: TemporalAgent;
  readonly debugAgent: DebugAgent;

  constructor(config: AahiConfig) {
    // 1. Model Router
    this.modelRouter = new ModelRouter({
      models: config.models,
      routing: config.routing ?? [],
      defaultModel: config.defaultModel,
    });

    // 2. Redaction Pipeline — ALL data flows through this
    this.redaction = new RedactionPipeline();

    // 3. Integration Registry
    this.integrations = new IntegrationRegistry();

    // Register built-in integrations
    this.integrations.register(new GitHubIntegration());
    this.integrations.register(new KubernetesIntegration());

    // 4. Timeline Store — append-only event log
    this.timeline = new TimelineStore();

    // 5. A2A Capability Registry
    this.capabilities = new CapabilityRegistry();

    // 6. Agents
    this.temporalAgent = new TemporalAgent(this.timeline);
    this.debugAgent = new DebugAgent();

    // Register agent capabilities for A2A
    this.capabilities.register(
      {
        agentId: 'temporal',
        intents: ['correlate.*', 'timeline.*', 'rca.*'],
        requiredIntegrations: [],
      },
      async (message) => {
        // Handle A2A messages to TemporalAgent
        const result = this.temporalAgent.correlate(
          message.timestamp,
          undefined,
          3_600_000,
        );
        return {
          ...message,
          id: message.id,
          fromAgent: 'temporal',
          toAgent: message.fromAgent,
          intent: 'correlate.result',
          context: [{
            source: 'temporal',
            type: 'events',
            content: JSON.stringify(result),
            timestamp: new Date(),
          }],
          constraints: [],
          replyTo: message.id,
          timestamp: new Date(),
        };
      },
    );

    this.capabilities.register(
      {
        agentId: 'debug',
        intents: ['debug.*', 'diagnose.*', 'root-cause.*'],
        requiredIntegrations: ['github'],
      },
      async (message) => {
        return {
          ...message,
          fromAgent: 'debug',
          toAgent: message.fromAgent,
          replyTo: message.id,
          timestamp: new Date(),
        };
      },
    );

    // 7. Proactive Agent
    this.proactive = new ProactiveAgent(
      this.integrations,
      this.timeline,
    );

    // Wire integration events to timeline
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
   * Run a debug session — the full DebugAgent pipeline.
   */
  async debug(intent: string, callbacks?: AgentCallbacks): Promise<ExecutionPlan> {
    const plan = await this.debugAgent.plan(intent, []);
    const executor = this.createExecutor('agent-planning', callbacks);
    return executor.execute(plan);
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
