// ─────────────────────────────────────────────────────────────────────────────
// Aahi — TeamBrainAgent (AAHI EXCLUSIVE)
// Knowledge graph-powered team intelligence: ownership, expertise, onboarding.
// Triggers: /who-owns, /onboard, service questions
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

/** Simple knowledge graph node for team/service relationships */
export interface KnowledgeNode {
  id: string;
  type: 'person' | 'team' | 'service' | 'repository' | 'document';
  name: string;
  metadata: Record<string, unknown>;
  edges: Array<{ relation: string; targetId: string }>;
}

export class TeamBrainAgent implements AgentDefinition {
  readonly id = 'teambrain';
  readonly name = 'TeamBrainAgent';
  readonly description = 'Answers ownership, expertise, and onboarding questions using a knowledge graph of team structures, code ownership, and institutional knowledge';
  readonly triggers = ['/who-owns', '/onboard', 'question.service', 'question.ownership'];
  readonly requiredIntegrations = ['github'];
  readonly capabilities = ['teambrain.ownership', 'teambrain.expertise', 'teambrain.onboard', 'teambrain.context'];

  private knowledgeGraph: Map<string, KnowledgeNode>;

  constructor(knowledgeGraph?: Map<string, KnowledgeNode>) {
    this.knowledgeGraph = knowledgeGraph ?? new Map();
  }

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Query the knowledge graph for relevant nodes
    const kgQueryStep: AgentStep = {
      id: uuid(),
      name: 'Query knowledge graph',
      type: 'tool',
      status: 'pending',
      dependsOn: [],
      toolAction: {
        integrationId: 'aahi-internal',
        actionId: 'knowledge_graph.query',
        params: {
          query: intent,
          nodeTypes: this.inferNodeTypes(intent),
          maxDepth: 3,
          graphSnapshot: Array.from(this.knowledgeGraph.entries()),
        },
      },
    };

    // Step 2: Build expertise index from Git history
    const expertiseStep: AgentStep = {
      id: uuid(),
      name: 'Build expertise index',
      type: 'parallel',
      status: 'pending',
      dependsOn: [],
      parallelSteps: [
        this.createToolStep('Fetch CODEOWNERS', 'github', 'github.get_file_content', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          path: 'CODEOWNERS',
        }),
        this.createToolStep('Fetch commit authors for path', 'github', 'github.list_commits', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          path: this.extractParam(intent, 'path', ''),
          perPage: 100,
        }),
        this.createToolStep('Fetch PR reviewers for path', 'github', 'github.list_pr_reviews', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          path: this.extractParam(intent, 'path', ''),
        }),
      ],
    };

    // Step 3: Synthesize answer
    const synthesizeStep: AgentStep = {
      id: uuid(),
      name: 'Synthesize team knowledge answer',
      type: 'llm',
      status: 'pending',
      dependsOn: [kgQueryStep.id, expertiseStep.id],
      modelRequest: {
        systemPrompt: `You are Aahi's TeamBrainAgent. You have access to a knowledge graph of team structures, code ownership data (CODEOWNERS, commit history, PR reviews), and institutional context. Answer questions about:

1. **Ownership**: Who owns a service/file/module? Include primary owner, team, and backup contacts.
2. **Expertise**: Who are the top experts for a given area? Rank by recent commit frequency, review activity, and knowledge graph connections.
3. **Onboarding**: For new team members — provide a structured onboarding guide: key repos, services they'll work with, people to meet, docs to read, common workflows.
4. **Context**: Why was something built this way? Link to relevant PRs, design docs, and ADRs.
5. **Dependencies**: Who should be consulted before changing a given area?

Always provide specific names, links, and actionable next steps. If information is incomplete, say so and suggest how to fill the gap.`,
        messages: [
          {
            role: 'user',
            content: `Question: ${intent}\n\nKnowledge graph nodes: ${this.knowledgeGraph.size} loaded\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.3,
      },
    };

    return {
      id: planId,
      intent,
      steps: [kgQueryStep, expertiseStep, synthesizeStep],
      createdAt: new Date(),
      status: 'pending',
      agentId: this.id,
    };
  }

  /** Infer which knowledge graph node types are relevant based on intent keywords */
  private inferNodeTypes(intent: string): string[] {
    const types: string[] = [];
    const lower = intent.toLowerCase();
    if (lower.includes('who') || lower.includes('owner') || lower.includes('expert')) {
      types.push('person', 'team');
    }
    if (lower.includes('service') || lower.includes('api') || lower.includes('deploy')) {
      types.push('service');
    }
    if (lower.includes('repo') || lower.includes('code') || lower.includes('file')) {
      types.push('repository');
    }
    if (lower.includes('onboard') || lower.includes('doc') || lower.includes('guide')) {
      types.push('document');
    }
    return types.length > 0 ? types : ['person', 'team', 'service', 'repository'];
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
