import { describe, it, expect, beforeEach } from 'vitest';
import { AuthManager } from '../../runtime/auth/auth-manager.js';
import type { KeychainAdapter, OAuth2Config, Credential } from '../../runtime/auth/auth-manager.js';

// ─── Mock Keychain ──────────────────────────────────────────────────────────

function createMockKeychain(): KeychainAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();

  return {
    store,

    async setPassword(service: string, account: string, password: string): Promise<void> {
      store.set(`${service}:${account}`, password);
    },

    async getPassword(service: string, account: string): Promise<string | null> {
      return store.get(`${service}:${account}`) ?? null;
    },

    async deletePassword(service: string, account: string): Promise<boolean> {
      return store.delete(`${service}:${account}`);
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthManager', () => {
  let manager: AuthManager;
  let keychain: ReturnType<typeof createMockKeychain>;

  beforeEach(() => {
    keychain = createMockKeychain();
    manager = new AuthManager(keychain);
  });

  // ── Credential storage/retrieval ──────────────────────────────────

  it('stores and retrieves an API key credential', async () => {
    await manager.setCredential('github', {
      method: 'apiKey',
      value: 'ghp_abc123def456',
    });

    const cred = await manager.getCredential('github');
    expect(cred).toBe('ghp_abc123def456');
  });

  it('stores and retrieves a token credential', async () => {
    await manager.setCredential('slack', {
      method: 'token',
      value: 'xoxb-my-slack-token',
    });

    const cred = await manager.getCredential('slack');
    expect(cred).toBe('xoxb-my-slack-token');
  });

  it('stores credentials in the keychain, not in plaintext', async () => {
    await manager.setCredential('aws', {
      method: 'apiKey',
      value: 'AKIAIOSFODNN7EXAMPLE',
    });

    // Verify the mock keychain received the credential
    expect(keychain.store.size).toBeGreaterThan(0);
    const stored = [...keychain.store.values()].find(v => v === 'AKIAIOSFODNN7EXAMPLE');
    expect(stored).toBeDefined();
  });

  it('returns null for unknown provider', async () => {
    const cred = await manager.getCredential('nonexistent');
    expect(cred).toBeNull();
  });

  it('returns null for expired non-OAuth2 credentials', async () => {
    await manager.setCredential('expiring-service', {
      method: 'token',
      value: 'expired-token',
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
    });

    const cred = await manager.getCredential('expiring-service');
    expect(cred).toBeNull();
  });

  // ── Credential removal ────────────────────────────────────────────

  it('removes a credential', async () => {
    await manager.setCredential('github', {
      method: 'apiKey',
      value: 'ghp_abc123',
    });

    const removed = await manager.removeCredential('github');
    expect(removed).toBe(true);

    const cred = await manager.getCredential('github');
    expect(cred).toBeNull();
  });

  it('returns false when removing non-existent provider', async () => {
    const removed = await manager.removeCredential('nonexistent');
    expect(removed).toBe(false);
  });

  // ── OAuth2 URL generation ─────────────────────────────────────────

  it('generates an OAuth2 authorization URL', () => {
    const config: OAuth2Config = {
      clientId: 'my-app-id',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'user'],
      redirectUri: 'http://localhost:3000/callback',
    };

    const url = manager.startOAuth2Flow(config);

    expect(url).toContain('https://github.com/login/oauth/authorize?');
    expect(url).toContain('client_id=my-app-id');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=repo+user');
    expect(url).toContain('state=');
  });

  // ── OAuth2 callback handling ──────────────────────────────────────

  it('handles OAuth2 callback with custom token exchanger', async () => {
    const config: OAuth2Config = {
      clientId: 'github-app',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
      redirectUri: 'http://localhost:3000/callback',
    };

    // Start the flow to register the config
    manager.startOAuth2Flow(config);

    // Simulate callback with a mock token exchanger
    const tokens = await manager.handleOAuth2Callback(
      'github-app',
      'auth-code-123',
      async (_code, _cfg) => ({
        accessToken: 'gho_newAccessToken',
        refreshToken: 'ghr_newRefreshToken',
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: ['repo'],
      }),
    );

    expect(tokens.accessToken).toBe('gho_newAccessToken');
    expect(tokens.refreshToken).toBe('ghr_newRefreshToken');

    // Access token should be stored in keychain
    const cred = await manager.getCredential('github-app');
    expect(cred).toBe('gho_newAccessToken');
  });

  it('throws on OAuth2 callback for unknown provider', async () => {
    await expect(
      manager.handleOAuth2Callback('unknown', 'code-123'),
    ).rejects.toThrow('No OAuth2 config found');
  });

  // ── Token refresh ─────────────────────────────────────────────────

  it('refreshes an expired OAuth2 token', async () => {
    const config: OAuth2Config = {
      clientId: 'my-app',
      authUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read'],
      redirectUri: 'http://localhost:3000/callback',
    };

    // Set up OAuth2 flow and initial tokens
    manager.startOAuth2Flow(config);
    await manager.handleOAuth2Callback('my-app', 'initial-code', async () => ({
      accessToken: 'old-access-token',
      refreshToken: 'the-refresh-token',
      expiresAt: new Date(Date.now() - 1000), // already expired
      scopes: ['read'],
    }));

    // Refresh with a custom refresher
    const refreshed = await manager.refreshToken('my-app', async (refreshToken, _cfg) => ({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: ['read'],
    }));

    expect(refreshed).toBe(true);

    const cred = await manager.getCredential('my-app');
    expect(cred).toBe('new-access-token');
  });

  it('returns false when refresh fails (no config)', async () => {
    const result = await manager.refreshToken('unknown-provider');
    expect(result).toBe(false);
  });

  it('returns false when no refresh token is available', async () => {
    const config: OAuth2Config = {
      clientId: 'no-refresh',
      authUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read'],
      redirectUri: 'http://localhost:3000/callback',
    };

    manager.startOAuth2Flow(config);
    // Store tokens without a refresh token
    await manager.handleOAuth2Callback('no-refresh', 'code', async () => ({
      accessToken: 'access',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: ['read'],
    }));

    const result = await manager.refreshToken('no-refresh');
    expect(result).toBe(false);
  });

  // ── Provider listing ──────────────────────────────────────────────

  it('lists all providers with stored credentials', async () => {
    await manager.setCredential('github', { method: 'apiKey', value: 'key1' });
    await manager.setCredential('slack', { method: 'token', value: 'key2' });
    await manager.setCredential('aws', { method: 'apiKey', value: 'key3' });

    const providers = manager.listProviders();
    expect(providers).toHaveLength(3);
    expect(providers).toContain('github');
    expect(providers).toContain('slack');
    expect(providers).toContain('aws');
  });

  it('reflects removals in the provider list', async () => {
    await manager.setCredential('github', { method: 'apiKey', value: 'key1' });
    await manager.setCredential('slack', { method: 'token', value: 'key2' });

    await manager.removeCredential('github');

    const providers = manager.listProviders();
    expect(providers).toHaveLength(1);
    expect(providers).toContain('slack');
  });

  // ── Authentication check ──────────────────────────────────────────

  it('reports authenticated for valid credentials', async () => {
    await manager.setCredential('github', { method: 'apiKey', value: 'key1' });

    expect(await manager.isAuthenticated('github')).toBe(true);
  });

  it('reports not authenticated for unknown provider', async () => {
    expect(await manager.isAuthenticated('unknown')).toBe(false);
  });

  it('reports not authenticated for expired credentials', async () => {
    await manager.setCredential('expiring', {
      method: 'token',
      value: 'tok',
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await manager.isAuthenticated('expiring')).toBe(false);
  });
});
