// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Auth Manager
// Manages authentication for all integrations. Credentials are stored ONLY in
// the OS keychain — never in plaintext on disk or in memory longer than needed.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuthMethod = 'apiKey' | 'oauth2' | 'token' | 'basic';

export interface AuthConfig {
  provider: string;
  method: AuthMethod;
  credentials: EncryptedCredentials;
}

export interface EncryptedCredentials {
  keychainKey: string; // Reference to OS keychain entry
  expiresAt?: Date;
}

export interface OAuth2Config {
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

export interface Credential {
  method: AuthMethod;
  value: string; // raw credential value (API key, token, etc.)
  expiresAt?: Date;
}

/**
 * Abstraction over OS keychain (macOS Keychain, Linux Secret Service, etc.).
 * Implementations are injected to keep the AuthManager testable.
 */
export interface KeychainAdapter {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE = 'com.aahi.ide';

export class AuthManager {
  private configs = new Map<string, AuthConfig>();
  private oauth2Configs = new Map<string, OAuth2Config>();
  private keychain: KeychainAdapter;

  constructor(keychain: KeychainAdapter) {
    this.keychain = keychain;
  }

  /**
   * Store a credential for a provider in the OS keychain.
   */
  async setCredential(provider: string, credential: Credential): Promise<void> {
    const keychainKey = `${provider}-${credential.method}`;

    await this.keychain.setPassword(KEYCHAIN_SERVICE, keychainKey, credential.value);

    this.configs.set(provider, {
      provider,
      method: credential.method,
      credentials: {
        keychainKey,
        expiresAt: credential.expiresAt,
      },
    });
  }

  /**
   * Retrieve a credential from the OS keychain.
   * Auto-refreshes OAuth2 tokens if expired.
   */
  async getCredential(provider: string): Promise<string | null> {
    const config = this.configs.get(provider);
    if (!config) return null;

    // Check expiry and attempt refresh for OAuth2
    if (config.credentials.expiresAt && config.credentials.expiresAt <= new Date()) {
      if (config.method === 'oauth2') {
        const refreshed = await this.refreshToken(provider);
        if (!refreshed) return null;
      } else {
        return null; // Non-OAuth2 expired credentials cannot be refreshed
      }
    }

    return this.keychain.getPassword(KEYCHAIN_SERVICE, config.credentials.keychainKey);
  }

  /**
   * Remove all credentials for a provider.
   */
  async removeCredential(provider: string): Promise<boolean> {
    const config = this.configs.get(provider);
    if (!config) return false;

    await this.keychain.deletePassword(KEYCHAIN_SERVICE, config.credentials.keychainKey);

    // Also clean up refresh token if present
    await this.keychain.deletePassword(KEYCHAIN_SERVICE, `${provider}-refresh-token`);

    this.configs.delete(provider);
    this.oauth2Configs.delete(provider);

    return true;
  }

  /**
   * Generate an OAuth2 authorization URL for the user to visit.
   */
  startOAuth2Flow(config: OAuth2Config): string {
    const state = uuid();
    // Store the config temporarily — keyed by the state param for callback matching
    this.oauth2Configs.set(config.clientId, config);

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
    });

    return `${config.authUrl}?${params.toString()}`;
  }

  /**
   * Handle the OAuth2 callback and exchange the authorization code for tokens.
   * In production this calls the token endpoint; here we define the interface.
   */
  async handleOAuth2Callback(
    provider: string,
    code: string,
    tokenExchanger?: (code: string, config: OAuth2Config) => Promise<OAuth2Tokens>,
  ): Promise<OAuth2Tokens> {
    const config = this.oauth2Configs.get(provider);
    if (!config) throw new Error(`No OAuth2 config found for provider: ${provider}`);

    let tokens: OAuth2Tokens;

    if (tokenExchanger) {
      tokens = await tokenExchanger(code, config);
    } else {
      // Default: make an HTTP POST to the token URL
      tokens = await this.exchangeCode(code, config);
    }

    // Store access token in keychain
    await this.setCredential(provider, {
      method: 'oauth2',
      value: tokens.accessToken,
      expiresAt: tokens.expiresAt,
    });

    // Store refresh token separately if provided
    if (tokens.refreshToken) {
      await this.keychain.setPassword(
        KEYCHAIN_SERVICE,
        `${provider}-refresh-token`,
        tokens.refreshToken,
      );
    }

    return tokens;
  }

  /**
   * Refresh an expired OAuth2 token using the stored refresh token.
   */
  async refreshToken(
    provider: string,
    tokenRefresher?: (refreshToken: string, config: OAuth2Config) => Promise<OAuth2Tokens>,
  ): Promise<boolean> {
    const config = this.oauth2Configs.get(provider);
    if (!config) return false;

    const refreshToken = await this.keychain.getPassword(
      KEYCHAIN_SERVICE,
      `${provider}-refresh-token`,
    );
    if (!refreshToken) return false;

    try {
      let tokens: OAuth2Tokens;

      if (tokenRefresher) {
        tokens = await tokenRefresher(refreshToken, config);
      } else {
        tokens = await this.refreshTokenHttp(refreshToken, config);
      }

      await this.setCredential(provider, {
        method: 'oauth2',
        value: tokens.accessToken,
        expiresAt: tokens.expiresAt,
      });

      if (tokens.refreshToken) {
        await this.keychain.setPassword(
          KEYCHAIN_SERVICE,
          `${provider}-refresh-token`,
          tokens.refreshToken,
        );
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all providers with stored credentials.
   */
  listProviders(): string[] {
    return [...this.configs.keys()];
  }

  /**
   * Check whether a provider has valid (non-expired) credentials.
   */
  async isAuthenticated(provider: string): Promise<boolean> {
    const config = this.configs.get(provider);
    if (!config) return false;

    if (config.credentials.expiresAt && config.credentials.expiresAt <= new Date()) {
      return false;
    }

    const value = await this.keychain.getPassword(KEYCHAIN_SERVICE, config.credentials.keychainKey);
    return value !== null;
  }

  // ─── Internal HTTP helpers ─────────────────────────────────────────────

  private async exchangeCode(code: string, config: OAuth2Config): Promise<OAuth2Tokens> {
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      scopes: data.scope?.split(' ') ?? config.scopes,
    };
  }

  private async refreshTokenHttp(refreshToken: string, config: OAuth2Config): Promise<OAuth2Tokens> {
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      scopes: data.scope?.split(' ') ?? config.scopes,
    };
  }
}
