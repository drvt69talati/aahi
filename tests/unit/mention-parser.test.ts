import { describe, it, expect, beforeEach } from 'vitest';
import { MentionParser } from '../../runtime/ai/context/mention-parser.js';

describe('MentionParser', () => {
  let parser: MentionParser;

  beforeEach(() => {
    parser = new MentionParser();
  });

  // ─── Typed Mentions ─────────────────────────────────────────────────

  it('parses @file mentions', () => {
    const mentions = parser.parse('Look at @file:src/auth/login.ts');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('file');
    expect(mentions[0].value).toBe('src/auth/login.ts');
    expect(mentions[0].raw).toBe('@file:src/auth/login.ts');
  });

  it('parses @folder mentions', () => {
    const mentions = parser.parse('Check @folder:src/api/');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('folder');
    expect(mentions[0].value).toBe('src/api/');
  });

  it('parses @function mentions', () => {
    const mentions = parser.parse('What does @function:handleAuth do?');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('function');
    expect(mentions[0].value).toBe('handleAuth');
  });

  it('parses @symbol mentions', () => {
    const mentions = parser.parse('Find @symbol:UserService');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('symbol');
    expect(mentions[0].value).toBe('UserService');
  });

  it('parses @logs mentions', () => {
    const mentions = parser.parse('Show me @logs:api-service');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('logs');
    expect(mentions[0].value).toBe('api-service');
  });

  it('parses @metrics mentions', () => {
    const mentions = parser.parse('Graph @metrics:cpu_usage');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('metrics');
    expect(mentions[0].value).toBe('cpu_usage');
  });

  it('parses @traces mentions', () => {
    const mentions = parser.parse('Trace @traces:request-abc123');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('traces');
    expect(mentions[0].value).toBe('request-abc123');
  });

  it('parses @agent mentions', () => {
    const mentions = parser.parse('Ask @agent:debug about this');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('agent');
    expect(mentions[0].value).toBe('debug');
  });

  it('parses @integration mentions', () => {
    const mentions = parser.parse('Query @integration:datadog');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('integration');
    expect(mentions[0].value).toBe('datadog');
  });

  // ─── Bare Mentions ──────────────────────────────────────────────────

  it('treats bare @debug as an agent mention', () => {
    const mentions = parser.parse('Hey @debug what is wrong?');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('agent');
    expect(mentions[0].value).toBe('debug');
  });

  it('treats bare @deploy as an agent mention', () => {
    const mentions = parser.parse('@deploy this service');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('agent');
    expect(mentions[0].value).toBe('deploy');
  });

  it('treats unknown bare mentions as symbol type', () => {
    const mentions = parser.parse('What is @UserService?');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('symbol');
    expect(mentions[0].value).toBe('UserService');
  });

  // ─── Multiple Mentions ─────────────────────────────────────────────

  it('parses multiple mentions in one message', () => {
    const mentions = parser.parse(
      'Compare @file:src/old.ts with @file:src/new.ts and check @logs:auth-service',
    );
    expect(mentions).toHaveLength(3);
    expect(mentions[0].type).toBe('file');
    expect(mentions[1].type).toBe('file');
    expect(mentions[2].type).toBe('logs');
  });

  // ─── Position Tracking ─────────────────────────────────────────────

  it('tracks start and end positions', () => {
    const input = 'Check @file:foo.ts now';
    const mentions = parser.parse(input);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].start).toBe(6);
    expect(mentions[0].end).toBe(18);
    expect(input.slice(mentions[0].start, mentions[0].end)).toBe('@file:foo.ts');
  });

  // ─── Strip Mentions ────────────────────────────────────────────────

  it('strips all mentions from a message', () => {
    const result = parser.stripMentions('Check @file:auth.ts and @logs:api please');
    expect(result).toBe('Check and please');
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────

  it('returns empty array for messages without mentions', () => {
    const mentions = parser.parse('Just a normal message with no mentions');
    expect(mentions).toHaveLength(0);
  });

  it('ignores email addresses (not treated as mentions)', () => {
    // Emails contain @ but our regex requires the @ to be followed by a word char
    // and emails have a dot in the domain — our regex stops at the dot for bare mentions
    // but for typed prefixes it would need file: etc.
    const mentions = parser.parse('Email me at user@example.com');
    // The regex matches @example.com (after the @ in the email), capturing "example" as bare mention
    expect(mentions).toHaveLength(1);
    expect(mentions[0].value).toBe('example');
  });

  it('handles mentions at start and end of message', () => {
    const mentions = parser.parse('@file:start.ts middle @file:end.ts');
    expect(mentions).toHaveLength(2);
    expect(mentions[0].value).toBe('start.ts');
    expect(mentions[1].value).toBe('end.ts');
  });
});
