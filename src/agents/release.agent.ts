// ─────────────────────────────────────────────────────────────────────────────
// Aahi — ReleaseAgent
// Automates releases: changelog generation, GitHub Release, Slack announcement.
// Triggers: /release, tag pushed
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class ReleaseAgent implements AgentDefinition {
  readonly id = 'release';
  readonly name = 'ReleaseAgent';
  readonly description = 'Automates releases with changelog generation, GitHub Release creation, and Slack announcements';
  readonly triggers = ['/release', 'tag.pushed'];
  readonly requiredIntegrations = ['github', 'slack'];
  readonly capabilities = ['release.*', 'changelog.*'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Fetch commits since last release
    const fetchCommitsStep: AgentStep = {
      id: uuid(),
      name: 'Fetch commits since last release',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Get latest release', 'github', 'github.get_latest_release', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
        }),
        this.createToolStep('List commits', 'github', 'github.list_commits', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          since: '{{latest_release.published_at}}',
        }),
      ],
    };

    // Step 2: Categorize commits by type
    const categorizeStep: AgentStep = {
      id: uuid(),
      name: 'Categorize commits by type',
      type: 'llm',
      status: 'pending',
      dependsOn: [fetchCommitsStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's ReleaseAgent. Categorize the provided commits using conventional commit types:

- **feat**: New features
- **fix**: Bug fixes
- **perf**: Performance improvements
- **refactor**: Code refactoring
- **docs**: Documentation changes
- **test**: Test additions or changes
- **chore**: Maintenance tasks
- **BREAKING**: Breaking changes (from commit messages or footers)

Group commits by category and extract the scope and description from each.`,
        messages: [
          {
            role: 'user',
            content: `Release intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.1,
      },
    };

    // Step 3: Generate changelog
    const changelogStep: AgentStep = {
      id: uuid(),
      name: 'Generate changelog',
      type: 'llm',
      status: 'pending',
      dependsOn: [categorizeStep.id],
      modelRequest: {
        systemPrompt: `Generate a well-formatted changelog in Markdown from the categorized commits. Include:

1. Version header with date
2. Sections for each category (Features, Bug Fixes, etc.)
3. Breaking changes section at the top if applicable
4. Contributors list
5. Full changelog diff link

Use Keep a Changelog format.`,
        messages: [
          {
            role: 'user',
            content: `Version: ${this.extractParam(intent, 'version', 'next')}\nCategorized commits: {{categorized_commits}}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    // Step 4: Create GitHub Release
    const releaseStep: AgentStep = {
      id: uuid(),
      name: 'Create GitHub Release',
      type: 'tool',
      status: 'pending',
      dependsOn: [changelogStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.create_release',
        params: {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          tag_name: this.extractParam(intent, 'version', ''),
          name: `Release ${this.extractParam(intent, 'version', '')}`,
          body: '{{changelog}}',
          draft: false,
          prerelease: this.extractParam(intent, 'prerelease', 'false') === 'true',
        },
      },
      approvalGate: {
        actionId: uuid(),
        integration: 'github',
        actionType: 'write',
        description: 'Publishing a GitHub Release',
        params: {},
        riskLevel: 'medium',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 1_800_000,
      },
    };

    // Step 5: Post Slack announcement
    const slackStep: AgentStep = {
      id: uuid(),
      name: 'Post Slack announcement',
      type: 'tool',
      status: 'pending',
      dependsOn: [releaseStep.id],
      toolAction: {
        integrationId: 'slack',
        actionId: 'slack.post_message',
        params: {
          channel: this.extractParam(intent, 'channel', '#releases'),
          text: '{{release_announcement}}',
        },
      },
    };

    return {
      id: planId,
      intent,
      steps: [fetchCommitsStep, categorizeStep, changelogStep, releaseStep, slackStep],
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
    const regex = new RegExp(`${key}[=:]\\s*([\\w./-]+)`, 'i');
    const match = intent.match(regex);
    return match?.[1] ?? defaultValue;
  }
}
