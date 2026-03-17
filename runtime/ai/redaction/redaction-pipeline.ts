// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Redaction Pipeline
// ALL data passes through this before reaching any LLM. Zero exceptions.
// Stages: Regex patterns → Named Entity Detection → Contextual → Transform
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';

export interface RedactionMatch {
  type: string;
  original: string;
  replacement: string;
  start: number;
  end: number;
  confidence: number;
}

export interface RedactionResult {
  sanitized: string;
  matches: RedactionMatch[];
  redactionMapId: string;
}

export interface RedactionMap {
  id: string;
  createdAt: Date;
  entries: Map<string, string>; // replacement → original (for de-redaction)
}

// ─── Built-in patterns ──────────────────────────────────────────────────────

interface PatternDef {
  type: string;
  pattern: RegExp;
  description: string;
}

const BUILTIN_PATTERNS: PatternDef[] = [
  // API Keys and tokens
  {
    type: 'API_KEY',
    pattern: /(?:api[_-]?key|apikey|api_secret)["\s:=]+["']?([a-zA-Z0-9_\-]{20,})/gi,
    description: 'API key in assignment',
  },
  {
    type: 'API_KEY',
    pattern: /(?:sk|pk|rk|ak)-[a-zA-Z0-9]{20,}/g,
    description: 'Prefixed API key (sk-, pk-, etc.)',
  },
  {
    type: 'AWS_KEY',
    pattern: /AKIA[0-9A-Z]{16}/g,
    description: 'AWS Access Key ID',
  },
  {
    type: 'AWS_SECRET',
    pattern: /(?:aws_secret_access_key|secret_key)["\s:=]+["']?([a-zA-Z0-9/+=]{40})/gi,
    description: 'AWS Secret Access Key',
  },
  // Tokens
  {
    type: 'BEARER_TOKEN',
    pattern: /Bearer\s+[a-zA-Z0-9_\-.~+/]+=*/g,
    description: 'Bearer token',
  },
  {
    type: 'JWT',
    pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_\-+/=]+/g,
    description: 'JSON Web Token',
  },
  {
    type: 'GITHUB_TOKEN',
    pattern: /gh[ps]_[a-zA-Z0-9]{36,}/g,
    description: 'GitHub personal access or secret token',
  },
  // PII
  {
    type: 'EMAIL',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    description: 'Email address',
  },
  {
    type: 'PHONE',
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    description: 'US phone number',
  },
  {
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    description: 'US Social Security Number',
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    description: 'Credit card number',
  },
  // IP addresses
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    description: 'IPv4 address',
  },
  // Passwords in config/env
  {
    type: 'PASSWORD',
    pattern: /(?:password|passwd|pwd|secret)["\s:=]+["']?([^\s"']{8,})/gi,
    description: 'Password in assignment',
  },
  // Private keys
  {
    type: 'PRIVATE_KEY',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    description: 'Private key block',
  },
  // Connection strings
  {
    type: 'CONNECTION_STRING',
    pattern: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s"']+/g,
    description: 'Database connection string',
  },
];

// ─── Pipeline ───────────────────────────────────────────────────────────────

export class RedactionPipeline {
  private patterns: PatternDef[];
  private redactionMaps = new Map<string, RedactionMap>();
  private counters = new Map<string, number>();

  constructor(customPatterns?: PatternDef[]) {
    this.patterns = [...BUILTIN_PATTERNS, ...(customPatterns ?? [])];
  }

  /**
   * Run the full redaction pipeline on input text.
   * This is the ONLY way data should reach an LLM.
   */
  redact(input: string): RedactionResult {
    const mapId = uuid();
    const redactionMap: RedactionMap = {
      id: mapId,
      createdAt: new Date(),
      entries: new Map(),
    };

    let sanitized = input;
    const allMatches: RedactionMatch[] = [];

    // Stage 1: Pattern-based detection
    for (const patternDef of this.patterns) {
      // Reset regex state
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(sanitized)) !== null) {
        const original = match[0];
        const counter = this.nextCounter(patternDef.type);
        const replacement = `<${patternDef.type}_${counter}>`;

        allMatches.push({
          type: patternDef.type,
          original,
          replacement,
          start: match.index,
          end: match.index + original.length,
          confidence: 0.95,
        });

        redactionMap.entries.set(replacement, original);
        sanitized = sanitized.slice(0, match.index) + replacement + sanitized.slice(match.index + original.length);

        // Adjust regex index for the replacement
        regex.lastIndex = match.index + replacement.length;
      }
    }

    // Stage 2: Contextual detection (lightweight heuristics)
    sanitized = this.contextualRedaction(sanitized, allMatches, redactionMap);

    this.redactionMaps.set(mapId, redactionMap);

    return {
      sanitized,
      matches: allMatches,
      redactionMapId: mapId,
    };
  }

  /**
   * De-redact text using a stored redaction map (for display in Aahi UI only).
   * NEVER send de-redacted text to an LLM.
   */
  deRedact(text: string, redactionMapId: string): string {
    const map = this.redactionMaps.get(redactionMapId);
    if (!map) return text;

    let result = text;
    for (const [replacement, original] of map.entries) {
      result = result.replaceAll(replacement, original);
    }
    return result;
  }

  /**
   * Add custom patterns at runtime (e.g., from integration-specific rules).
   */
  addPatterns(patterns: PatternDef[]): void {
    this.patterns.push(...patterns);
  }

  /**
   * Check if text contains any detectable sensitive data.
   */
  hasSensitiveData(text: string): boolean {
    for (const patternDef of this.patterns) {
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      if (regex.test(text)) return true;
    }
    return false;
  }

  /**
   * Get stats on redaction activity.
   */
  getStats(): { totalRedactions: number; byType: Record<string, number>; activeMaps: number } {
    const byType: Record<string, number> = {};
    for (const [type, count] of this.counters) {
      byType[type] = count;
    }
    return {
      totalRedactions: [...this.counters.values()].reduce((a, b) => a + b, 0),
      byType,
      activeMaps: this.redactionMaps.size,
    };
  }

  /**
   * Clean up old redaction maps to free memory.
   */
  pruneOldMaps(maxAgeMs: number = 3_600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, map] of this.redactionMaps) {
      if (map.createdAt.getTime() < cutoff) {
        this.redactionMaps.delete(id);
      }
    }
  }

  private contextualRedaction(
    text: string,
    matches: RedactionMatch[],
    map: RedactionMap,
  ): string {
    // Look for high-entropy strings near sensitive keywords
    const sensitiveContextPatterns = [
      /(?:token|secret|key|password|credential)s?\s*[=:]\s*["']([^"']{16,})["']/gi,
      /(?:authorization|x-api-key|x-auth-token)\s*:\s*(\S{16,})/gi,
    ];

    let result = text;
    for (const pattern of sensitiveContextPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(result)) !== null) {
        const captured = match[1];
        if (!captured) continue;

        // Check if already redacted
        if (captured.startsWith('<') && captured.endsWith('>')) continue;

        const counter = this.nextCounter('CONTEXTUAL_SECRET');
        const replacement = `<CONTEXTUAL_SECRET_${counter}>`;

        matches.push({
          type: 'CONTEXTUAL_SECRET',
          original: captured,
          replacement,
          start: match.index + match[0].indexOf(captured),
          end: match.index + match[0].indexOf(captured) + captured.length,
          confidence: 0.8,
        });

        map.entries.set(replacement, captured);
        result = result.replace(captured, replacement);
      }
    }

    return result;
  }

  private nextCounter(type: string): number {
    const current = this.counters.get(type) ?? 0;
    const next = current + 1;
    this.counters.set(type, next);
    return next;
  }
}
