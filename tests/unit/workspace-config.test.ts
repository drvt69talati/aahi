// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Unit Test: Workspace Configuration
// Default config, load/save round-trip, merge, validate, applyToRuntime.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorkspaceConfigManager, type WorkspaceConfig } from '../../runtime/workspace/workspace-config.js';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// ─── Mock Aahi for applyToRuntime ───────────────────────────────────────────

function createMockAahi() {
  return {
    modelRouter: {
      setRouting: vi.fn(),
      getAdapter: vi.fn().mockReturnValue({
        provider: 'mock',
        model: 'mock-1',
        capabilities: ['chat'],
        maxContextTokens: 100_000,
        supportsToolUse: true,
        call: vi.fn(),
        streamCall: vi.fn(),
        countTokens: vi.fn(),
      }),
    },
    redaction: {
      addPatterns: vi.fn(),
    },
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('WorkspaceConfigManager', () => {
  let manager: WorkspaceConfigManager;

  beforeEach(() => {
    manager = new WorkspaceConfigManager();
  });

  // ── Default config has all required fields ────────────────────────────

  describe('getDefault', () => {
    it('returns a config with all required fields', () => {
      const config = manager.getDefault('/test/workspace');

      expect(config.name).toBe('Untitled Workspace');
      expect(config.rootPath).toBe('/test/workspace');
      expect(config.defaultModel).toBeDefined();
      expect(config.modelOverrides).toBeDefined();
      expect(config.apiKeyRefs).toBeDefined();
      expect(config.integrations).toBeInstanceOf(Array);
      expect(config.agentPolicies).toBeDefined();
      expect(config.agentPolicies.autoApproveReadActions).toBe(true);
      expect(config.agentPolicies.requireTypedConfirmationForDestructive).toBe(true);
      expect(config.agentPolicies.maxConcurrentAgents).toBeGreaterThan(0);
      expect(config.agentPolicies.enabledAgents.length).toBeGreaterThan(0);
      expect(config.editor).toBeDefined();
      expect(config.editor.fontSize).toBeGreaterThan(0);
      expect(config.editor.tabSize).toBeGreaterThan(0);
      expect(config.privacy).toBeDefined();
      expect(config.privacy.redactionEnabled).toBe(true);
      expect(config.privacy.telemetryOptIn).toBe(false);
    });

    it('default config passes validation', () => {
      const config = manager.getDefault('/test/workspace');
      const errors = manager.validate(config);
      expect(errors).toHaveLength(0);
    });
  });

  // ── Load/save round-trip ──────────────────────────────────────────────

  describe('load/save', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'aahi-test-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('round-trip preserves all fields', async () => {
      const original = manager.getDefault(tempDir);
      original.name = 'My Project';
      original.defaultModel = 'openai:gpt-4o';
      original.modelOverrides = { 'fim-autocomplete': 'ollama:codellama' };
      original.apiKeyRefs = { anthropic: 'keychain:anthropic-key' };
      original.integrations = [
        { id: 'github', enabled: true, config: { org: 'myorg' } },
      ];
      original.agentPolicies.maxConcurrentAgents = 5;
      original.agentPolicies.enabledAgents = ['debug', 'deploy'];
      original.editor.fontSize = 16;
      original.editor.tabSize = 4;
      original.editor.fimDebounceMs = 500;
      original.privacy.customRedactionPatterns = ['SECRET-\\d+'];
      original.privacy.telemetryOptIn = true;
      original.team = {
        sharedRuntimeUrl: 'wss://team.aahi.dev',
        teamId: 'team-123',
        role: 'admin',
      };

      // Save
      await manager.save(original);

      // Verify file was written
      const configPath = join(tempDir, '.aahi', 'config.json');
      const raw = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.name).toBe('My Project');

      // Load
      const loaded = await manager.load(tempDir);

      expect(loaded.name).toBe('My Project');
      expect(loaded.rootPath).toBe(tempDir);
      expect(loaded.defaultModel).toBe('openai:gpt-4o');
      expect(loaded.modelOverrides['fim-autocomplete']).toBe('ollama:codellama');
      expect(loaded.apiKeyRefs.anthropic).toBe('keychain:anthropic-key');
      expect(loaded.integrations).toHaveLength(1);
      expect(loaded.integrations[0].id).toBe('github');
      expect(loaded.agentPolicies.maxConcurrentAgents).toBe(5);
      expect(loaded.agentPolicies.enabledAgents).toEqual(['debug', 'deploy']);
      expect(loaded.editor.fontSize).toBe(16);
      expect(loaded.editor.tabSize).toBe(4);
      expect(loaded.editor.fimDebounceMs).toBe(500);
      expect(loaded.privacy.customRedactionPatterns).toEqual(['SECRET-\\d+']);
      expect(loaded.privacy.telemetryOptIn).toBe(true);
      expect(loaded.team).toBeDefined();
      expect(loaded.team!.role).toBe('admin');
      expect(loaded.team!.teamId).toBe('team-123');
    });

    it('load returns defaults when config file does not exist', async () => {
      const loaded = await manager.load(tempDir);
      expect(loaded.name).toBe('Untitled Workspace');
      expect(loaded.rootPath).toBe(tempDir);
    });
  });

  // ── Merge ─────────────────────────────────────────────────────────────

  describe('merge', () => {
    it('properly combines base and override', () => {
      const base = manager.getDefault('/workspace');
      const override: Partial<WorkspaceConfig> = {
        name: 'Overridden Name',
        defaultModel: 'openai:gpt-4o',
        editor: {
          fontSize: 18,
          tabSize: 4,
          formatOnSave: false,
          fimEnabled: false,
          fimDebounceMs: 500,
        },
      };

      const merged = manager.merge(base, override);

      // Overridden values
      expect(merged.name).toBe('Overridden Name');
      expect(merged.defaultModel).toBe('openai:gpt-4o');
      expect(merged.editor.fontSize).toBe(18);
      expect(merged.editor.tabSize).toBe(4);

      // Base values preserved where not overridden
      expect(merged.rootPath).toBe('/workspace');
      expect(merged.agentPolicies.autoApproveReadActions).toBe(true);
      expect(merged.privacy.redactionEnabled).toBe(true);
    });

    it('override with partial nested objects merges at one level', () => {
      const base = manager.getDefault('/workspace');
      const override: Partial<WorkspaceConfig> = {
        agentPolicies: {
          maxConcurrentAgents: 10,
          autoApproveReadActions: false,
          requireTypedConfirmationForDestructive: true,
          enabledAgents: ['debug'],
        },
      };

      const merged = manager.merge(base, override);

      expect(merged.agentPolicies.maxConcurrentAgents).toBe(10);
      expect(merged.agentPolicies.autoApproveReadActions).toBe(false);
      expect(merged.agentPolicies.enabledAgents).toEqual(['debug']);
    });

    it('arrays in override replace base arrays', () => {
      const base = manager.getDefault('/workspace');
      const override: Partial<WorkspaceConfig> = {
        integrations: [
          { id: 'custom', enabled: true, config: {} },
        ],
      };

      const merged = manager.merge(base, override);

      expect(merged.integrations).toHaveLength(1);
      expect(merged.integrations[0].id).toBe('custom');
    });
  });

  // ── Validate ──────────────────────────────────────────────────────────

  describe('validate', () => {
    it('reports missing required fields', () => {
      const errors = manager.validate({});

      const fields = errors.map(e => e.field);
      expect(fields).toContain('name');
      expect(fields).toContain('rootPath');
      expect(fields).toContain('defaultModel');
      expect(fields).toContain('agentPolicies');
      expect(fields).toContain('editor');
      expect(fields).toContain('privacy');
    });

    it('reports invalid agentPolicies.maxConcurrentAgents', () => {
      const config = manager.getDefault('/workspace');
      config.agentPolicies.maxConcurrentAgents = 0;

      const errors = manager.validate(config);
      const fields = errors.map(e => e.field);
      expect(fields).toContain('agentPolicies.maxConcurrentAgents');
    });

    it('reports invalid editor.fontSize', () => {
      const config = manager.getDefault('/workspace');
      config.editor.fontSize = -1;

      const errors = manager.validate(config);
      const fields = errors.map(e => e.field);
      expect(fields).toContain('editor.fontSize');
    });

    it('reports invalid team.role', () => {
      const config = manager.getDefault('/workspace');
      (config as any).team = { role: 'superadmin' };

      const errors = manager.validate(config);
      const fields = errors.map(e => e.field);
      expect(fields).toContain('team.role');
    });

    it('valid config produces no errors', () => {
      const config = manager.getDefault('/workspace');
      const errors = manager.validate(config);
      expect(errors).toHaveLength(0);
    });

    it('reports empty name', () => {
      const config = manager.getDefault('/workspace');
      config.name = '';

      const errors = manager.validate(config);
      const fields = errors.map(e => e.field);
      expect(fields).toContain('name');
    });
  });

  // ── applyToRuntime ────────────────────────────────────────────────────

  describe('applyToRuntime', () => {
    it('sets model routing from config', () => {
      const aahi = createMockAahi();
      const config = manager.getDefault('/workspace');
      config.defaultModel = 'anthropic:claude-opus-4-6';
      config.modelOverrides = {
        'fim-autocomplete': 'ollama:codellama',
        'agent-planning': 'openai:gpt-4o',
      };

      manager.applyToRuntime(config, aahi);

      // Default model applied to chat task
      expect(aahi.modelRouter.setRouting).toHaveBeenCalledWith(
        'chat', 'anthropic', 'claude-opus-4-6',
      );

      // Model overrides applied
      expect(aahi.modelRouter.setRouting).toHaveBeenCalledWith(
        'fim-autocomplete', 'ollama', 'codellama',
      );
      expect(aahi.modelRouter.setRouting).toHaveBeenCalledWith(
        'agent-planning', 'openai', 'gpt-4o',
      );
    });

    it('adds custom redaction patterns when privacy.redactionEnabled is true', () => {
      const aahi = createMockAahi();
      const config = manager.getDefault('/workspace');
      config.privacy.redactionEnabled = true;
      config.privacy.customRedactionPatterns = ['INTERNAL-\\d{6}', 'PROJ-[A-Z]{4}'];

      manager.applyToRuntime(config, aahi);

      expect(aahi.redaction.addPatterns).toHaveBeenCalledTimes(1);
      const patterns = aahi.redaction.addPatterns.mock.calls[0][0];
      expect(patterns).toHaveLength(2);
      expect(patterns[0].type).toBe('CUSTOM_1');
      expect(patterns[1].type).toBe('CUSTOM_2');
    });

    it('does not add redaction patterns when privacy.redactionEnabled is false', () => {
      const aahi = createMockAahi();
      const config = manager.getDefault('/workspace');
      config.privacy.redactionEnabled = false;
      config.privacy.customRedactionPatterns = ['INTERNAL-\\d{6}'];

      manager.applyToRuntime(config, aahi);

      expect(aahi.redaction.addPatterns).not.toHaveBeenCalled();
    });

    it('does not add redaction patterns when customRedactionPatterns is empty', () => {
      const aahi = createMockAahi();
      const config = manager.getDefault('/workspace');
      config.privacy.redactionEnabled = true;
      config.privacy.customRedactionPatterns = [];

      manager.applyToRuntime(config, aahi);

      expect(aahi.redaction.addPatterns).not.toHaveBeenCalled();
    });
  });
});
