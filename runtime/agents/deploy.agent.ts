// ─────────────────────────────────────────────────────────────────────────────
// Aahi — DeployAgent
// Orchestrates safe deployments with security scans, monitoring, and rollback.
// Triggers: /deploy, merge to main
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class DeployAgent implements AgentDefinition {
  readonly id = 'deploy';
  readonly name = 'DeployAgent';
  readonly description = 'Orchestrates deployments with pre-deploy checks, monitoring, and post-deploy verification';
  readonly triggers = ['/deploy', 'github.merge_to_main'];
  readonly requiredIntegrations = ['github', 'kubernetes', 'argocd'];
  readonly capabilities = ['deploy.trigger', 'deploy.monitor', 'deploy.rollback', 'deploy.verify'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Pre-deploy checks in parallel
    const preDeployStep: AgentStep = {
      id: uuid(),
      name: 'Pre-deploy checks',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Security scan', 'github', 'github.run_security_scan', {
          repo: this.extractParam(intent, 'repo', ''),
          ref: this.extractParam(intent, 'ref', 'main'),
        }),
        this.createToolStep('Check test results', 'github', 'github.get_check_runs', {
          repo: this.extractParam(intent, 'repo', ''),
          ref: this.extractParam(intent, 'ref', 'main'),
        }),
        this.createToolStep('Validate K8s manifests', 'kubernetes', 'k8s.validate_manifests', {
          namespace: this.extractParam(intent, 'namespace', 'default'),
          dryRun: true,
        }),
      ],
    };

    // Step 2: Delegate to ImpactAgent for pre-deploy impact analysis
    const impactStep: AgentStep = {
      id: uuid(),
      name: 'Pre-deploy impact analysis',
      type: 'a2a',
      status: 'pending',
      dependsOn: [preDeployStep.id],
      a2aMessage: {
        id: uuid(),
        fromAgent: this.id,
        toAgent: 'impact',
        intent: 'assess.deploy-impact',
        context,
        constraints: [{ type: 'max_time', value: 60_000 }],
        timestamp: new Date(),
      },
    };

    // Step 3: Trigger CI/CD pipeline
    const triggerDeployStep: AgentStep = {
      id: uuid(),
      name: 'Trigger deployment',
      type: 'tool',
      status: 'pending',
      dependsOn: [impactStep.id],
      toolAction: {
        integrationId: 'argocd',
        actionId: 'argocd.sync_application',
        params: {
          application: this.extractParam(intent, 'app', ''),
          revision: this.extractParam(intent, 'ref', 'main'),
          prune: false,
        },
      },
      approvalGate: {
        actionId: 'argocd.sync_application',
        integration: 'argocd',
        actionType: 'write',
        description: 'Trigger deployment via ArgoCD sync',
        params: {},
        riskLevel: 'high',
        requiresApproval: true,
        requiresTypedConfirmation: true,
        timeout: 600_000,
      },
    };

    // Step 4: Monitor deployment rollout
    const monitorStep: AgentStep = {
      id: uuid(),
      name: 'Monitor deployment rollout',
      type: 'tool',
      status: 'pending',
      dependsOn: [triggerDeployStep.id],
      toolAction: {
        integrationId: 'kubernetes',
        actionId: 'k8s.watch_rollout',
        params: {
          namespace: this.extractParam(intent, 'namespace', 'default'),
          deployment: this.extractParam(intent, 'app', ''),
          timeoutSeconds: 300,
        },
      },
    };

    // Step 5: Verify health post-deploy
    const verifyStep: AgentStep = {
      id: uuid(),
      name: 'Verify service health',
      type: 'parallel',
      status: 'pending',
      dependsOn: [monitorStep.id],
      parallelSteps: [
        this.createToolStep('Check pod health', 'kubernetes', 'k8s.get_pod_status', {
          namespace: this.extractParam(intent, 'namespace', 'default'),
          labelSelector: `app=${this.extractParam(intent, 'app', '')}`,
        }),
        this.createToolStep('Check endpoint health', 'kubernetes', 'k8s.check_endpoint', {
          namespace: this.extractParam(intent, 'namespace', 'default'),
          service: this.extractParam(intent, 'app', ''),
        }),
      ],
    };

    // Step 6: Annotate metrics with deploy marker
    const annotateStep: AgentStep = {
      id: uuid(),
      name: 'Annotate metrics',
      type: 'tool',
      status: 'pending',
      dependsOn: [verifyStep.id],
      toolAction: {
        integrationId: 'datadog',
        actionId: 'datadog.create_event',
        params: {
          title: `Deploy: ${this.extractParam(intent, 'app', '')}`,
          text: `Deployed ref ${this.extractParam(intent, 'ref', 'main')}`,
          tags: ['deploy', `app:${this.extractParam(intent, 'app', '')}`],
        },
      },
    };

    // Step 7: Post Slack summary
    const summaryStep: AgentStep = {
      id: uuid(),
      name: 'Post deploy summary',
      type: 'llm',
      status: 'pending',
      dependsOn: [verifyStep.id, annotateStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's DeployAgent. Summarize the deployment outcome:

1. **Deployment Status**: Success/failure, duration
2. **Pre-deploy Checks**: Security scan results, test status
3. **Rollout Health**: Pod status, endpoint health
4. **Impact Assessment**: Services affected, traffic impact
5. **Next Steps**: Any follow-up actions needed

Format as a concise Slack-friendly summary with clear status indicators.`,
        messages: [
          {
            role: 'user',
            content: `Deploy intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.2,
      },
    };

    return {
      id: planId,
      intent,
      steps: [
        preDeployStep,
        impactStep,
        triggerDeployStep,
        monitorStep,
        verifyStep,
        annotateStep,
        summaryStep,
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
