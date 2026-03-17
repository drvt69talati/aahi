// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Native Keychain Implementations
// Uses the Tauri keychain commands when running in Tauri,
// falls back to an encrypted file store for Node.js standalone mode.
// ─────────────────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { KeychainAdapter } from './auth-manager.js';

/**
 * File-based encrypted keychain for Node.js standalone mode.
 * Uses AES-256-GCM with a machine-derived key.
 * Credentials stored in ~/.aahi/credentials.enc
 */
export class EncryptedFileKeychain implements KeychainAdapter {
  private filePath: string;
  private encryptionKey: Buffer;
  private store: Map<string, string>;
  private loaded = false;

  constructor(customPath?: string) {
    const aahiDir = customPath ?? path.join(os.homedir(), '.aahi');
    if (!fs.existsSync(aahiDir)) {
      fs.mkdirSync(aahiDir, { recursive: true, mode: 0o700 });
    }
    this.filePath = path.join(aahiDir, 'credentials.enc');
    // Derive key from machine ID + username (not perfect but better than plaintext)
    const machineId = `${os.hostname()}-${os.userInfo().username}-aahi-keychain`;
    this.encryptionKey = crypto.scryptSync(machineId, 'aahi-salt-v1', 32);
    this.store = new Map();
  }

  async setPassword(service: string, account: string, password: string): Promise<void> {
    await this.ensureLoaded();
    this.store.set(`${service}:${account}`, password);
    await this.persist();
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    await this.ensureLoaded();
    return this.store.get(`${service}:${account}`) ?? null;
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    await this.ensureLoaded();
    const deleted = this.store.delete(`${service}:${account}`);
    if (deleted) {
      await this.persist();
    }
    return deleted;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (fs.existsSync(this.filePath)) {
      const encrypted = fs.readFileSync(this.filePath);
      const iv = encrypted.subarray(0, 12);
      const authTag = encrypted.subarray(12, 28);
      const ciphertext = encrypted.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const data = JSON.parse(decrypted.toString('utf-8'));
      this.store = new Map(Object.entries(data));
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const data = JSON.stringify(Object.fromEntries(this.store));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    fs.writeFileSync(this.filePath, Buffer.concat([iv, authTag, encrypted]), { mode: 0o600 });
  }
}

/**
 * In-memory keychain for testing.
 */
export class InMemoryKeychain implements KeychainAdapter {
  private store = new Map<string, string>();

  async setPassword(service: string, account: string, password: string): Promise<void> {
    this.store.set(`${service}:${account}`, password);
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    return this.store.get(`${service}:${account}`) ?? null;
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    return this.store.delete(`${service}:${account}`);
  }
}
