// ─────────────────────────────────────────────────────────────────────────────
// Aahi — ReviewAgent
// Automated code review: static analysis, coverage, security, conventions.
// Triggers: /review, PR opened
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class ReviewAgent implements AgentDefinition {
  readonly id = 'review';
  readonly name = 'ReviewAgent';
  readonly description = 'Reviews pull requests with static analysis, coverage gap detection, security scanning, and convention checks';
  readonly triggers = ['/review', 'github.pr_opened'];
  readonly requiredIntegrations = ['github'];
  readonly capabilities = ['review.static-analysis', 'review.coverage', 'review.security', 'review.conventions'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();
    const owner = this.extractParam(intent, 'owner', '');
    const repo = this.extractParam(intent, 'repo', '');
    const pr = this.extractParam(intent, 'pr', '');

    // Step 1: Fetch PR diff and metadata
    const fetchStep: AgentStep = {
      id: uuid(),
      name: 'Fetch PR diff and metadata',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Fetch PR diff', 'github', 'github.get_pr_diff', {
          owner, repo, pullNumber: pr,
        }),
        this.createToolStep('Fetch PR metadata', 'github', 'github.get_pull_request', {
          owner, repo, pullNumber: pr,
        }),
        this.createToolStep('Fetch PR files', 'github', 'github.list_pr_files', {
          owner, repo, pullNumber: pr,
        }),
      ],
    };

    // Step 2: RAG context retrieval — find related code patterns
    const ragStep: AgentStep = {
      id: uuid(),
      name: 'Retrieve related code context',
      type: 'llm',
      status: 'pending',
      dependsOn: [fetchStep.id],
      modelRequest: {
        systemPrompt: `Analyze the PR diff and identify the key functions, types, and modules being modified. Generate search queries to find related code that might be affected by these changes.`,
        messages: [
          {
            role: 'user',
            content: `PR diff context:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 1024,
        temperature: 0.1,
      },
    };

    // Step 3: Run analysis checks in parallel
    const analysisStep: AgentStep = {
      id: uuid(),
      name: 'Run analysis checks',
      type: 'parallel',
      status: 'pending',
      dependsOn: [ragStep.id],
      parallelSteps: [
        {
          id: uuid(),
          name: 'Static analysis',
          type: 'llm',
          status: 'pending',
          dependsOn: [],
          modelRequest: {
            systemPrompt: `You are a static analysis expert. Review the code diff for bugs, logic errors, race conditions, null pointer risks, resource leaks, and performance issues. Output structured findings with severity, file, line, and description.`,
            messages: [
              { role: 'user', content: `Analyze this diff:\n${intent}` },
            ],
            maxTokens: 2048,
            temperature: 0.1,
          },
        },
        {
          id: uuid(),
          name: 'Coverage gap analysis',
          type: 'llm',
          status: 'pending',
          dependsOn: [],
          modelRequest: {
            systemPrompt: `Analyze the code changes and identify test coverage gaps. For each changed function or branch, determine if adequate tests exist. Flag untested edge cases and suggest specific test cases.`,
            messages: [
              { role: 'user', content: `Analyze test coverage for:\n${intent}` },
            ],
            maxTokens: 2048,
            temperature: 0.1,
          },
        },
        {
          id: uuid(),
          name: 'Security review',
          type: 'llm',
          status: 'pending',
          dependsOn: [],
          modelRequest: {
            systemPrompt: `You are a security reviewer. Scan the diff for OWASP Top 10 vulnerabilities, hardcoded secrets, injection risks, authentication/authorization issues, and insecure configurations. Rate each finding by severity.`,
            messages: [
              { role: 'user', content: `Security review:\n${intent}` },
            ],
            maxTokens: 2048,
            temperature: 0.1,
          },
        },
        {
          id: uuid(),
          name: 'Convention check',
          type: 'llm',
          status: 'pending',
          dependsOn: [],
          modelRequest: {
            systemPrompt: `Check the code diff against project conventions: naming, file structure, error handling patterns, logging standards, and API design. Reference existing patterns in the codebase context.`,
            messages: [
              { role: 'user', content: `Convention check:\n${intent}` },
            ],
            maxTokens: 1024,
            temperature: 0.1,
          },
        },
      ],
    };

    // Step 4: Synthesize and post structured review
    const synthesizeStep: AgentStep = {
      id: uuid(),
      name: 'Synthesize review',
      type: 'llm',
      status: 'pending',
      dependsOn: [analysisStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's ReviewAgent. Compile all analysis results into a structured PR review:

1. **Summary**: Overall assessment (approve / request changes / comment)
2. **Critical Issues**: Bugs, security vulnerabilities (must fix)
3. **Suggestions**: Improvements, refactoring opportunities
4. **Coverage Gaps**: Missing tests with specific suggestions
5. **Convention Notes**: Style and pattern deviations
6. **Praise**: Well-written code worth highlighting

Format as GitHub-compatible markdown with inline code references (file:line).`,
        messages: [
          {
            role: 'user',
            content: `Compile review for PR: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    // Step 5: Post review to GitHub
    const postStep: AgentStep = {
      id: uuid(),
      name: 'Post review to GitHub',
      type: 'tool',
      status: 'pending',
      dependsOn: [synthesizeStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.create_review',
        params: { owner, repo, pullNumber: pr },
      },
      approvalGate: {
        actionId: 'github.create_review',
        integration: 'github',
        actionType: 'write',
        description: 'Post structured code review to the pull request',
        params: {},
        riskLevel: 'medium',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 300_000,
      },
    };

    return {
      id: planId,
      intent,
      steps: [fetchStep, ragStep, analysisStep, synthesizeStep, postStep],
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
