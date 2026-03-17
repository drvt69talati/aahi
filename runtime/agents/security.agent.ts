// ─────────────────────────────────────────────────────────────────────────────
// Aahi — SecurityAgent
// Comprehensive security scanning: deps, images, IaC, SAST, prioritization.
// Triggers: /security, new dependency added, PR opened
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class SecurityAgent implements AgentDefinition {
  readonly id = 'security';
  readonly name = 'SecurityAgent';
  readonly description = 'Scans dependencies, container images, IaC, and source code for security vulnerabilities and creates prioritized remediation tickets';
  readonly triggers = ['/security', 'github.dependency_added', 'github.pr_opened'];
  readonly requiredIntegrations = ['github', 'snyk'];
  readonly capabilities = ['security.dep-scan', 'security.image-scan', 'security.iac-scan', 'security.sast', 'security.prioritize'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();
    const repo = this.extractParam(intent, 'repo', '');
    const ref = this.extractParam(intent, 'ref', 'main');

    // Step 1: Run all scans in parallel
    const scanStep: AgentStep = {
      id: uuid(),
      name: 'Run security scans',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Dependency scan', 'snyk', 'snyk.test_dependencies', {
          repo, ref, manifestFiles: ['package.json', 'go.mod', 'requirements.txt'],
        }),
        this.createToolStep('Container image scan', 'snyk', 'snyk.test_container', {
          image: this.extractParam(intent, 'image', ''),
          dockerfile: this.extractParam(intent, 'dockerfile', 'Dockerfile'),
        }),
        this.createToolStep('IaC scan', 'snyk', 'snyk.test_iac', {
          repo, ref, paths: ['terraform/', 'k8s/', 'helm/'],
        }),
        this.createToolStep('SAST scan', 'github', 'github.code_scanning_analysis', {
          owner: this.extractParam(intent, 'owner', ''),
          repo, ref,
        }),
      ],
    };

    // Step 2: Prioritize findings with LLM
    const prioritizeStep: AgentStep = {
      id: uuid(),
      name: 'Prioritize vulnerabilities',
      type: 'llm',
      status: 'pending',
      dependsOn: [scanStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's SecurityAgent. Analyze all scan results and prioritize vulnerabilities:

1. **Critical/Exploitable**: Vulnerabilities with known exploits, publicly reachable, or in authentication paths
2. **High**: Significant risk but limited exposure
3. **Medium**: Needs attention but not urgent
4. **Low/Informational**: Best-practice improvements

For each finding provide:
- CVE/CWE identifier
- Affected component and version
- CVSS score and exploitability
- Recommended fix (specific version upgrade or code change)
- Whether it's reachable in the dependency graph

Deduplicate findings across scan types.`,
        messages: [
          {
            role: 'user',
            content: `Security scan results for ${repo}@${ref}:\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.1,
      },
    };

    // Step 3: Create tickets for critical/high findings
    const ticketStep: AgentStep = {
      id: uuid(),
      name: 'Create remediation tickets',
      type: 'tool',
      status: 'pending',
      dependsOn: [prioritizeStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.create_issues_batch',
        params: {
          owner: this.extractParam(intent, 'owner', ''),
          repo,
          labels: ['security', 'automated'],
        },
      },
      approvalGate: {
        actionId: 'github.create_issues_batch',
        integration: 'github',
        actionType: 'write',
        description: 'Create GitHub issues for critical and high security findings',
        params: {},
        riskLevel: 'low',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 300_000,
      },
    };

    // Step 4: Generate security summary report
    const summaryStep: AgentStep = {
      id: uuid(),
      name: 'Generate security report',
      type: 'llm',
      status: 'pending',
      dependsOn: [prioritizeStep.id, ticketStep.id],
      modelRequest: {
        systemPrompt: `Generate a concise security posture summary:

1. **Risk Score**: Overall risk rating (Critical/High/Medium/Low)
2. **Findings Overview**: Count by severity and scan type
3. **Top 5 Actions**: Most impactful fixes to prioritize
4. **Dependency Health**: Outdated deps, license risks
5. **Compliance Notes**: Any compliance implications (SOC2, PCI, HIPAA)
6. **Trend**: Comparison with previous scan if available

Format for both Slack posting and dashboard display.`,
        messages: [
          {
            role: 'user',
            content: `Security analysis for ${repo}:\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.2,
      },
    };

    return {
      id: planId,
      intent,
      steps: [scanStep, prioritizeStep, ticketStep, summaryStep],
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
