// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Workspace Configuration
// Per-workspace config stored in .aahi/config.json at workspace root.
// Manages model preferences, agent policies, editor settings, privacy, and
// team mode configuration.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Aahi } from '../aahi.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  name: string;
  rootPath: string;

  // Model preferences
  defaultModel: string;
  modelOverrides: Record<string, string>; // taskType → model

  // API keys (references to keychain entries, not actual keys)
  apiKeyRefs: Record<string, string>; // provider → keychain key

  // Integration config
  integrations: Array<{
    id: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }>;

  // Agent policies
  agentPolicies: {
    autoApproveReadActions: boolean;
    requireTypedConfirmationForDestructive: boolean;
    maxConcurrentAgents: number;
    enabledAgents: string[];
  };

  // Editor preferences
  editor: {
    fontSize: number;
    tabSize: number;
    formatOnSave: boolean;
    fimEnabled: boolean;
    fimDebounceMs: number;
  };

  // Privacy
  privacy: {
    redactionEnabled: boolean;
    customRedactionPatterns: string[];
    telemetryOptIn: boolean;
    focusModeDefault: boolean;
  };

  // Team mode
  team?: {
    sharedRuntimeUrl?: string;
    teamId?: string;
    role: 'admin' | 'developer' | 'viewer';
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

// ─── Config Manager ─────────────────────────────────────────────────────────

const CONFIG_DIR = '.aahi';
const CONFIG_FILE = 'config.json';

export class WorkspaceConfigManager {
  /**
   * Return sensible defaults for a new workspace.
   */
  getDefault(rootPath: string = '.'): WorkspaceConfig {
    return {
      name: 'Untitled Workspace',
      rootPath,
      defaultModel: 'anthropic:claude-sonnet-4-6',
      modelOverrides: {},
      apiKeyRefs: {},
      integrations: [],
      agentPolicies: {
        autoApproveReadActions: true,
        requireTypedConfirmationForDestructive: true,
        maxConcurrentAgents: 3,
        enabledAgents: [
          'debug',
          'deploy',
          'review',
          'security',
          'incident',
          'impact',
          'temporal',
          'cost',
          'query',
          'scaffold',
          'release',
          'oncall',
          'featureflag',
        ],
      },
      editor: {
        fontSize: 14,
        tabSize: 2,
        formatOnSave: true,
        fimEnabled: true,
        fimDebounceMs: 300,
      },
      privacy: {
        redactionEnabled: true,
        customRedactionPatterns: [],
        telemetryOptIn: false,
        focusModeDefault: false,
      },
    };
  }

  /**
   * Load workspace config from `.aahi/config.json` at the given root path.
   * Returns default config merged with any existing file.
   */
  async load(rootPath: string): Promise<WorkspaceConfig> {
    const configPath = join(rootPath, CONFIG_DIR, CONFIG_FILE);
    try {
      const raw = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>;
      return this.merge(this.getDefault(rootPath), parsed);
    } catch {
      // File does not exist or is invalid — return defaults
      return this.getDefault(rootPath);
    }
  }

  /**
   * Save workspace config to `.aahi/config.json`.
   */
  async save(config: WorkspaceConfig): Promise<void> {
    const configPath = join(config.rootPath, CONFIG_DIR, CONFIG_FILE);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Deep merge a base config with an override partial config.
   * Override values take precedence. Arrays are replaced, not concatenated.
   */
  merge(base: WorkspaceConfig, override: Partial<WorkspaceConfig>): WorkspaceConfig {
    const result = { ...base };

    for (const key of Object.keys(override) as Array<keyof WorkspaceConfig>) {
      const overrideValue = override[key];
      if (overrideValue === undefined) continue;

      const baseValue = base[key];
      if (
        baseValue !== null &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue) &&
        overrideValue !== null &&
        typeof overrideValue === 'object' &&
        !Array.isArray(overrideValue)
      ) {
        // Deep merge nested objects (one level)
        (result as any)[key] = { ...baseValue, ...overrideValue };
      } else {
        (result as any)[key] = overrideValue;
      }
    }

    return result;
  }

  /**
   * Validate a workspace config. Returns an array of validation errors
   * (empty if valid).
   */
  validate(config: Partial<WorkspaceConfig>): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
      errors.push({ field: 'name', message: 'name is required and must be a non-empty string' });
    }

    if (!config.rootPath || typeof config.rootPath !== 'string') {
      errors.push({ field: 'rootPath', message: 'rootPath is required and must be a string' });
    }

    if (!config.defaultModel || typeof config.defaultModel !== 'string') {
      errors.push({ field: 'defaultModel', message: 'defaultModel is required and must be a string' });
    }

    if (config.agentPolicies) {
      if (typeof config.agentPolicies.maxConcurrentAgents !== 'number' || config.agentPolicies.maxConcurrentAgents < 1) {
        errors.push({ field: 'agentPolicies.maxConcurrentAgents', message: 'maxConcurrentAgents must be a positive number' });
      }
      if (!Array.isArray(config.agentPolicies.enabledAgents)) {
        errors.push({ field: 'agentPolicies.enabledAgents', message: 'enabledAgents must be an array' });
      }
    } else {
      errors.push({ field: 'agentPolicies', message: 'agentPolicies is required' });
    }

    if (config.editor) {
      if (typeof config.editor.fontSize !== 'number' || config.editor.fontSize < 1) {
        errors.push({ field: 'editor.fontSize', message: 'fontSize must be a positive number' });
      }
      if (typeof config.editor.tabSize !== 'number' || config.editor.tabSize < 1) {
        errors.push({ field: 'editor.tabSize', message: 'tabSize must be a positive number' });
      }
    } else {
      errors.push({ field: 'editor', message: 'editor is required' });
    }

    if (config.privacy) {
      if (typeof config.privacy.redactionEnabled !== 'boolean') {
        errors.push({ field: 'privacy.redactionEnabled', message: 'redactionEnabled must be a boolean' });
      }
    } else {
      errors.push({ field: 'privacy', message: 'privacy is required' });
    }

    if (config.team) {
      const validRoles = ['admin', 'developer', 'viewer'];
      if (!validRoles.includes(config.team.role)) {
        errors.push({ field: 'team.role', message: `team.role must be one of: ${validRoles.join(', ')}` });
      }
    }

    return errors;
  }

  /**
   * Apply a workspace config to a running Aahi runtime instance.
   * Sets model routing, enables/disables agents, configures redaction patterns.
   */
  applyToRuntime(config: WorkspaceConfig, aahi: Aahi): void {
    // Apply model overrides to the router
    for (const [taskType, modelRef] of Object.entries(config.modelOverrides)) {
      const [provider, model] = modelRef.split(':');
      if (provider && model) {
        aahi.modelRouter.setRouting(taskType as any, provider, model);
      }
    }

    // Apply default model
    if (config.defaultModel) {
      const [provider, model] = config.defaultModel.split(':');
      if (provider && model) {
        aahi.modelRouter.setRouting('chat', provider, model);
      }
    }

    // Apply custom redaction patterns
    if (config.privacy.redactionEnabled && config.privacy.customRedactionPatterns.length > 0) {
      const patterns = config.privacy.customRedactionPatterns.map((p, i) => ({
        type: `CUSTOM_${i + 1}`,
        pattern: new RegExp(p, 'g'),
        description: `Custom workspace pattern: ${p}`,
      }));
      aahi.redaction.addPatterns(patterns);
    }
  }
}
