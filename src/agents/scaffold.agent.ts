// ─────────────────────────────────────────────────────────────────────────────
// Aahi — ScaffoldAgent
// Creates new services by analyzing codebase conventions and generating files.
// Triggers: /scaffold, new service creation
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

export class ScaffoldAgent implements AgentDefinition {
  readonly id = 'scaffold';
  readonly name = 'ScaffoldAgent';
  readonly description = 'Creates new services by analyzing codebase conventions and generating files, tests, and CI config';
  readonly triggers = ['/scaffold', 'service.create'];
  readonly requiredIntegrations = ['github'];
  readonly capabilities = ['scaffold.*', 'generate.*'];

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Step 1: Analyze codebase conventions
    const analyzeStep: AgentStep = {
      id: uuid(),
      name: 'Analyze codebase conventions',
      type: 'llm',
      status: 'pending',
      dependsOn: [],
      modelRequest: {
        systemPrompt: `You are Aahi's ScaffoldAgent. Analyze the provided codebase context to identify:

1. **Project structure**: Directory layout, naming conventions, module patterns
2. **Language & framework**: Primary language, framework, build tools
3. **Code style**: Linting rules, formatting conventions, import patterns
4. **Test patterns**: Test framework, test file locations, naming conventions
5. **CI/CD patterns**: Pipeline configuration, deployment patterns

Output a structured analysis that will guide file generation.`,
        messages: [
          {
            role: 'user',
            content: `Scaffold intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    // Step 2: Generate file plan
    const filePlanStep: AgentStep = {
      id: uuid(),
      name: 'Generate file plan',
      type: 'llm',
      status: 'pending',
      dependsOn: [analyzeStep.id],
      modelRequest: {
        systemPrompt: `Based on the codebase analysis, generate a detailed file plan for the new service. For each file, specify:

1. **Path**: Where the file should be created
2. **Purpose**: What the file does
3. **Template**: The content template to use
4. **Dependencies**: Any packages or modules it depends on

Follow the existing codebase conventions exactly.`,
        messages: [
          {
            role: 'user',
            content: `Scaffold intent: ${intent}`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.3,
      },
    };

    // Step 3: Scaffold files (parallel writes)
    const scaffoldStep: AgentStep = {
      id: uuid(),
      name: 'Scaffold files',
      type: 'parallel',
      status: 'pending',
      dependsOn: [filePlanStep.id],
      parallelSteps: [
        this.createToolStep('Write source files', 'github', 'github.create_or_update_files', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          branch: this.extractParam(intent, 'branch', 'scaffold/${this.extractParam(intent, "name", "new-service")}'),
          files: '{{file_plan.source_files}}',
        }),
        this.createToolStep('Write config files', 'github', 'github.create_or_update_files', {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          branch: this.extractParam(intent, 'branch', 'scaffold/${this.extractParam(intent, "name", "new-service")}'),
          files: '{{file_plan.config_files}}',
        }),
      ],
    };

    // Step 4: Write tests
    const testStep: AgentStep = {
      id: uuid(),
      name: 'Write tests',
      type: 'tool',
      status: 'pending',
      dependsOn: [scaffoldStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.create_or_update_files',
        params: {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          branch: this.extractParam(intent, 'branch', ''),
          files: '{{file_plan.test_files}}',
        },
      },
    };

    // Step 5: Set up CI
    const ciStep: AgentStep = {
      id: uuid(),
      name: 'Set up CI',
      type: 'tool',
      status: 'pending',
      dependsOn: [testStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.create_or_update_files',
        params: {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          branch: this.extractParam(intent, 'branch', ''),
          files: '{{file_plan.ci_files}}',
        },
      },
    };

    // Step 6: Create PR draft
    const prStep: AgentStep = {
      id: uuid(),
      name: 'Create PR draft',
      type: 'tool',
      status: 'pending',
      dependsOn: [ciStep.id],
      toolAction: {
        integrationId: 'github',
        actionId: 'github.create_pull_request',
        params: {
          owner: this.extractParam(intent, 'owner', ''),
          repo: this.extractParam(intent, 'repo', ''),
          title: `feat: scaffold ${this.extractParam(intent, 'name', 'new-service')}`,
          body: '{{scaffold_summary}}',
          head: this.extractParam(intent, 'branch', ''),
          base: 'main',
          draft: true,
        },
      },
      approvalGate: {
        actionId: uuid(),
        integration: 'github',
        actionType: 'write',
        description: 'Creating a draft PR with scaffolded files',
        params: {},
        riskLevel: 'low',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 900_000,
      },
    };

    return {
      id: planId,
      intent,
      steps: [analyzeStep, filePlanStep, scaffoldStep, testStep, ciStep, prStep],
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
