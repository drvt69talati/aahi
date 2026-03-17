import { describe, it, expect, beforeEach } from 'vitest';
import { RedactionPipeline } from '../../src/ai/redaction/redaction-pipeline.js';

describe('RedactionPipeline', () => {
  let pipeline: RedactionPipeline;

  beforeEach(() => {
    pipeline = new RedactionPipeline();
  });

  it('redacts email addresses', () => {
    const result = pipeline.redact('Contact user@example.com for help');
    expect(result.sanitized).not.toContain('user@example.com');
    expect(result.sanitized).toContain('<EMAIL_');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].type).toBe('EMAIL');
  });

  it('redacts API keys with sk- prefix', () => {
    const result = pipeline.redact('API key: sk-1234567890abcdefghijklmnopqrst');
    expect(result.sanitized).not.toContain('sk-1234567890');
    expect(result.sanitized).toContain('<API_KEY_');
  });

  it('redacts AWS access key IDs', () => {
    const result = pipeline.redact('aws_key = AKIAIOSFODNN7EXAMPLE');
    expect(result.sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.sanitized).toContain('<AWS_KEY_');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = pipeline.redact(`Token: ${jwt}`);
    expect(result.sanitized).not.toContain('eyJhbGci');
    expect(result.sanitized).toContain('<JWT_');
  });

  it('redacts SSNs', () => {
    const result = pipeline.redact('SSN: 123-45-6789');
    expect(result.sanitized).not.toContain('123-45-6789');
    expect(result.sanitized).toContain('<SSN_');
  });

  it('redacts credit card numbers', () => {
    const result = pipeline.redact('Card: 4111-1111-1111-1111');
    expect(result.sanitized).not.toContain('4111-1111-1111-1111');
    expect(result.sanitized).toContain('<CREDIT_CARD_');
  });

  it('redacts connection strings', () => {
    const result = pipeline.redact('DATABASE_URL=postgres://admin:secret@db.example.com:5432/mydb');
    expect(result.sanitized).not.toContain('admin:secret');
    expect(result.sanitized).toContain('<CONNECTION_STRING_');
  });

  it('redacts private keys', () => {
    const result = pipeline.redact('-----BEGIN RSA PRIVATE KEY-----\nMIIBogI...\n-----END RSA PRIVATE KEY-----');
    expect(result.sanitized).not.toContain('MIIBogI');
    expect(result.sanitized).toContain('<PRIVATE_KEY_');
  });

  it('redacts GitHub tokens', () => {
    const result = pipeline.redact('GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij');
    expect(result.sanitized).not.toContain('ghp_ABCDEF');
    expect(result.sanitized).toContain('<GITHUB_TOKEN_');
  });

  it('supports de-redaction', () => {
    const original = 'Email: user@example.com';
    const result = pipeline.redact(original);
    const deRedacted = pipeline.deRedact(result.sanitized, result.redactionMapId);
    expect(deRedacted).toBe(original);
  });

  it('handles text with no sensitive data', () => {
    const text = 'This is a normal log message with no sensitive data';
    const result = pipeline.redact(text);
    expect(result.sanitized).toBe(text);
    expect(result.matches).toHaveLength(0);
  });

  it('handles multiple sensitive values in one text', () => {
    const text = 'User user@test.com has key sk-abcdefghijklmnopqrstuvwx and SSN 123-45-6789';
    const result = pipeline.redact(text);
    expect(result.matches.length).toBeGreaterThanOrEqual(3);
  });

  it('reports hasSensitiveData correctly', () => {
    expect(pipeline.hasSensitiveData('hello world')).toBe(false);
    expect(pipeline.hasSensitiveData('key: sk-1234567890abcdefghijklmnopqrst')).toBe(true);
  });

  it('tracks redaction stats', () => {
    pipeline.redact('email: a@b.com');
    pipeline.redact('key: sk-12345678901234567890');
    const stats = pipeline.getStats();
    expect(stats.totalRedactions).toBeGreaterThan(0);
    expect(stats.activeMaps).toBe(2);
  });

  it('prunes old redaction maps', async () => {
    pipeline.redact('test@example.com');
    expect(pipeline.getStats().activeMaps).toBe(1);
    // Wait 10ms so the map's createdAt is in the past
    await new Promise(r => setTimeout(r, 10));
    pipeline.pruneOldMaps(1); // prune anything older than 1ms
    expect(pipeline.getStats().activeMaps).toBe(0);
  });
});
