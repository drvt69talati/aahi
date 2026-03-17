import { describe, it, expect, beforeEach } from 'vitest';
import { IntegrationRegistry } from '../../src/integrations/registry/integration-registry.js';
import { GitHubIntegration } from '../../src/integrations/devops/github-integration.js';
import { KubernetesIntegration } from '../../src/integrations/devops/kubernetes-integration.js';

describe('IntegrationRegistry', () => {
  let registry: IntegrationRegistry;

  beforeEach(() => {
    registry = new IntegrationRegistry();
  });

  it('registers integrations', () => {
    registry.register(new GitHubIntegration());
    registry.register(new KubernetesIntegration());

    const all = registry.list();
    expect(all).toHaveLength(2);
  });

  it('prevents duplicate registration', () => {
    registry.register(new GitHubIntegration());
    expect(() => registry.register(new GitHubIntegration())).toThrow();
  });

  it('gets integration by ID', () => {
    registry.register(new GitHubIntegration());
    const gh = registry.get('github');
    expect(gh).toBeDefined();
    expect(gh!.name).toBe('GitHub');
  });

  it('filters by category', () => {
    registry.register(new GitHubIntegration());
    registry.register(new KubernetesIntegration());

    const devops = registry.list({ category: 'devops' });
    expect(devops).toHaveLength(2);
  });

  it('filters by connected status', () => {
    registry.register(new GitHubIntegration());

    const connected = registry.list({ connected: true });
    expect(connected).toHaveLength(0);

    const disconnected = registry.list({ connected: false });
    expect(disconnected).toHaveLength(1);
  });

  it('GitHub integration has correct read/write actions', () => {
    const gh = new GitHubIntegration();
    expect(gh.readActions.length).toBeGreaterThan(0);
    expect(gh.writeActions.length).toBeGreaterThan(0);
    expect(gh.readActions.every(a => a.category === 'read')).toBe(true);
    expect(gh.writeActions.every(a => a.requiresApproval)).toBe(true);
  });

  it('Kubernetes integration has correct actions', () => {
    const k8s = new KubernetesIntegration();
    expect(k8s.readActions.length).toBeGreaterThan(0);
    expect(k8s.writeActions.length).toBeGreaterThan(0);
    expect(k8s.writeActions.every(a => a.requiresApproval)).toBe(true);
    // Destructive actions exist
    expect(k8s.writeActions.some(a => a.category === 'destructive')).toBe(true);
  });

  it('lists connected integrations', () => {
    registry.register(new GitHubIntegration());
    const connected = registry.getConnected();
    expect(connected).toHaveLength(0);
  });

  it('shuts down cleanly', async () => {
    registry.register(new GitHubIntegration());
    await registry.shutdown();
    expect(registry.list()).toHaveLength(0);
  });
});
