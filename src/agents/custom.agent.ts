// ─────────────────────────────────────────────────────────────────────────────
// Aahi — CustomAgentLoader
// Loads agent definitions from YAML files, converting them into AgentDefinition
// instances with DAG-based execution plans.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
  StepType,
} from './runtime/types.js';
import type { ContextChunk } from '../integrations/registry/types.js';

// ─── YAML Schema Types ──────────────────────────────────────────────────────

export interface YAMLAgentDef {
  name: string;
  description: string;
  triggers: string[];
  required_integrations: string[];
  capabilities: string[];
  default_model?: string;
  approval_policy: 'always' | 'write_only' | 'never';
  steps: YAMLStep[];
}

export interface YAMLStep {
  name: string;
  type: 'read' | 'write' | 'llm' | 'parallel' | 'conditional' | 'a2a';
  integration?: string;
  action?: string;
  params?: Record<string, unknown>;
  depends_on?: string[];
  prompt?: string;
  parallel_steps?: YAMLStep[];
  agent?: string;
  intent?: string;
}

// ─── YAML → AgentDefinition Converter ────────────────────────────────────────

class YAMLBackedAgent implements AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggers: string[];
  readonly requiredIntegrations: string[];
  readonly capabilities: string[];
  readonly defaultModel?: string;

  private readonly yamlSteps: YAMLStep[];
  private readonly approvalPolicy: 'always' | 'write_only' | 'never';

  constructor(def: YAMLAgentDef) {
    this.id = def.name;
    this.name = def.name;
    this.description = def.description;
    this.triggers = def.triggers;
    this.requiredIntegrations = def.required_integrations;
    this.capabilities = def.capabilities;
    this.defaultModel = def.default_model;
    this.yamlSteps = def.steps;
    this.approvalPolicy = def.approval_policy;
  }

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // Build a name → id map so depends_on references can be resolved
    const nameToId = new Map<string, string>();
    for (const step of this.yamlSteps) {
      nameToId.set(step.name, uuid());
    }

    const steps = this.yamlSteps.map(yamlStep =>
      this.convertStep(yamlStep, nameToId, intent, context),
    );

    return {
      id: planId,
      intent,
      steps,
      createdAt: new Date(),
      status: 'pending',
      agentId: this.id,
    };
  }

  private convertStep(
    yamlStep: YAMLStep,
    nameToId: Map<string, string>,
    intent: string,
    context: ContextChunk[],
  ): AgentStep {
    const stepId = nameToId.get(yamlStep.name) ?? uuid();
    const dependsOn = (yamlStep.depends_on ?? [])
      .map(dep => nameToId.get(dep))
      .filter((id): id is string => id !== undefined);

    const base: AgentStep = {
      id: stepId,
      name: yamlStep.name,
      type: this.mapStepType(yamlStep.type),
      status: 'pending',
      dependsOn,
    };

    // Attach approval gate based on policy
    if (this.shouldRequireApproval(yamlStep.type)) {
      base.approvalGate = {
        actionId: uuid(),
        integration: yamlStep.integration ?? 'custom',
        actionType: yamlStep.type === 'write' ? 'write' : 'read',
        description: `Executing step: ${yamlStep.name}`,
        params: yamlStep.params ?? {},
        riskLevel: yamlStep.type === 'write' ? 'medium' : 'low',
        requiresApproval: true,
        requiresTypedConfirmation: false,
        timeout: 900_000,
      };
    }

    switch (yamlStep.type) {
      case 'read':
      case 'write':
        base.toolAction = {
          integrationId: yamlStep.integration ?? '',
          actionId: yamlStep.action ?? '',
          params: yamlStep.params ?? {},
        };
        break;

      case 'llm':
        base.modelRequest = {
          systemPrompt: yamlStep.prompt ?? '',
          messages: [
            {
              role: 'user',
              content: `Intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
            },
          ],
          maxTokens: 4096,
          temperature: 0.3,
        };
        break;

      case 'parallel':
        if (yamlStep.parallel_steps) {
          base.parallelSteps = yamlStep.parallel_steps.map(sub =>
            this.convertStep(sub, nameToId, intent, context),
          );
        }
        break;

      case 'conditional':
        // Conditional steps use params.expression for the condition
        if (yamlStep.params?.expression) {
          base.condition = {
            expression: yamlStep.params.expression as string,
            thenStep: this.convertStep(
              yamlStep.params.then_step as unknown as YAMLStep,
              nameToId,
              intent,
              context,
            ),
            elseStep: yamlStep.params.else_step
              ? this.convertStep(
                  yamlStep.params.else_step as unknown as YAMLStep,
                  nameToId,
                  intent,
                  context,
                )
              : undefined,
          };
        }
        break;

      case 'a2a':
        base.a2aMessage = {
          id: uuid(),
          fromAgent: this.id,
          toAgent: yamlStep.agent ?? '',
          intent: yamlStep.intent ?? '',
          context,
          constraints: [{ type: 'max_time', value: 60_000 }],
          timestamp: new Date(),
        };
        break;
    }

    return base;
  }

  private mapStepType(yamlType: YAMLStep['type']): StepType {
    switch (yamlType) {
      case 'read':
      case 'write':
        return 'tool';
      case 'llm':
        return 'llm';
      case 'parallel':
        return 'parallel';
      case 'conditional':
        return 'conditional';
      case 'a2a':
        return 'a2a';
    }
  }

  private shouldRequireApproval(stepType: YAMLStep['type']): boolean {
    switch (this.approvalPolicy) {
      case 'always':
        return true;
      case 'write_only':
        return stepType === 'write';
      case 'never':
        return false;
    }
  }
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export class CustomAgentLoader {
  /**
   * Load a single YAML agent definition from a file path.
   */
  static loadFromFile(filePath: string): AgentDefinition {
    const content = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.parse(content) as YAMLAgentDef;
    CustomAgentLoader.validate(def, filePath);
    return new YAMLBackedAgent(def);
  }

  /**
   * Load all YAML agent definitions from a directory.
   */
  static loadFromDirectory(dirPath: string): AgentDefinition[] {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const files = fs.readdirSync(dirPath).filter(
      f => f.endsWith('.yaml') || f.endsWith('.yml'),
    );

    return files.map(file =>
      CustomAgentLoader.loadFromFile(path.join(dirPath, file)),
    );
  }

  /**
   * Parse a YAML string into an AgentDefinition without touching the filesystem.
   */
  static parseFromString(content: string): AgentDefinition {
    const def = yaml.parse(content) as YAMLAgentDef;
    CustomAgentLoader.validate(def, '<string>');
    return new YAMLBackedAgent(def);
  }

  private static validate(def: YAMLAgentDef, source: string): void {
    const required: (keyof YAMLAgentDef)[] = ['name', 'description', 'triggers', 'steps'];
    for (const field of required) {
      if (!def[field]) {
        throw new Error(`Invalid YAML agent definition in ${source}: missing required field "${field}"`);
      }
    }

    if (!Array.isArray(def.steps) || def.steps.length === 0) {
      throw new Error(`Invalid YAML agent definition in ${source}: "steps" must be a non-empty array`);
    }

    const validTypes = new Set(['read', 'write', 'llm', 'parallel', 'conditional', 'a2a']);
    for (const step of def.steps) {
      if (!step.name || !step.type) {
        throw new Error(`Invalid step in ${source}: each step must have "name" and "type"`);
      }
      if (!validTypes.has(step.type)) {
        throw new Error(`Invalid step type "${step.type}" in ${source}: must be one of ${[...validTypes].join(', ')}`);
      }
    }
  }
}
