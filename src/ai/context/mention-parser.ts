// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Mention Parser
// Parses @mentions from chat messages to resolve context references.
// ─────────────────────────────────────────────────────────────────────────────

export type MentionType =
  | 'file'
  | 'folder'
  | 'function'
  | 'symbol'
  | 'logs'
  | 'metrics'
  | 'traces'
  | 'agent'
  | 'integration';

export interface Mention {
  type: MentionType;
  value: string;
  raw: string;
  start: number;
  end: number;
}

// ─── Typed prefix patterns ──────────────────────────────────────────────────

const TYPED_PREFIXES: { prefix: string; type: MentionType }[] = [
  { prefix: 'file:', type: 'file' },
  { prefix: 'folder:', type: 'folder' },
  { prefix: 'function:', type: 'function' },
  { prefix: 'symbol:', type: 'symbol' },
  { prefix: 'logs:', type: 'logs' },
  { prefix: 'metrics:', type: 'metrics' },
  { prefix: 'traces:', type: 'traces' },
  { prefix: 'agent:', type: 'agent' },
  { prefix: 'integration:', type: 'integration' },
];

/**
 * The mention regex matches:
 *   @type:value  — typed mention (e.g. @file:src/auth.ts)
 *   @word        — bare mention (e.g. @debug)
 *
 * Values run until whitespace. Typed values can contain
 * path characters like / . - _ and alphanumerics.
 */
const MENTION_REGEX = /@([a-zA-Z_][a-zA-Z0-9_]*(?::[^\s]+)?)/g;

// ─── Parser ─────────────────────────────────────────────────────────────────

export class MentionParser {
  /**
   * Parse all @mentions from a chat message string.
   */
  parse(input: string): Mention[] {
    const mentions: Mention[] = [];
    const regex = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(input)) !== null) {
      const raw = match[0]; // includes the @
      const body = match[1]; // everything after @
      const start = match.index;
      const end = start + raw.length;

      const resolved = this.resolveType(body);
      mentions.push({
        type: resolved.type,
        value: resolved.value,
        raw,
        start,
        end,
      });
    }

    return mentions;
  }

  /**
   * Strip all @mentions from a message, returning the cleaned text.
   */
  stripMentions(input: string): string {
    return input.replace(MENTION_REGEX, '').replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Resolve the type and value from the body of a mention.
   * e.g. "file:src/auth.ts" => { type: 'file', value: 'src/auth.ts' }
   *      "debug"            => { type: 'symbol', value: 'debug' }
   */
  private resolveType(body: string): { type: MentionType; value: string } {
    for (const { prefix, type } of TYPED_PREFIXES) {
      if (body.startsWith(prefix)) {
        return { type, value: body.slice(prefix.length) };
      }
    }

    // Bare mentions — try to infer type from well-known names
    const lowerBody = body.toLowerCase();
    if (['debug', 'deploy', 'review', 'security', 'incident', 'oncall'].includes(lowerBody)) {
      return { type: 'agent', value: body };
    }

    // Default: treat as a symbol reference
    return { type: 'symbol', value: body };
  }
}
