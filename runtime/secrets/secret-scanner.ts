// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Secret Scanner
// Scans files and directories for accidentally committed secrets. Uses the
// same pattern library as RedactionPipeline but oriented toward file-level
// analysis with severity ratings and actionable recommendations.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SecretFinding {
  file: string;
  line: number;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  snippet: string; // redacted snippet
  recommendation: string;
}

export interface SecretPattern {
  type: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendation: string;
}

// ─── Built-in patterns ──────────────────────────────────────────────────────

const BUILTIN_PATTERNS: SecretPattern[] = [
  // Critical — immediate credential exposure
  {
    type: 'PRIVATE_KEY',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
    recommendation: 'Remove private key from source. Store in a secrets manager or SSH agent.',
  },
  {
    type: 'AWS_ACCESS_KEY',
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'critical',
    recommendation: 'Rotate this AWS key immediately. Use IAM roles or environment variables.',
  },
  {
    type: 'AWS_SECRET_KEY',
    pattern: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*["']?([a-zA-Z0-9/+=]{40})/i,
    severity: 'critical',
    recommendation: 'Rotate this AWS secret key. Use IAM roles or a secrets manager.',
  },

  // High — common tokens and keys
  {
    type: 'GITHUB_TOKEN',
    pattern: /gh[ps]_[a-zA-Z0-9]{36,}/,
    severity: 'high',
    recommendation: 'Revoke and regenerate this GitHub token. Use environment variables.',
  },
  {
    type: 'GENERIC_API_KEY',
    pattern: /(?:api[_-]?key|apikey|api_secret)\s*[=:]\s*["']?([a-zA-Z0-9_\-]{20,})/i,
    severity: 'high',
    recommendation: 'Move API key to environment variable or secrets manager.',
  },
  {
    type: 'BEARER_TOKEN',
    pattern: /Bearer\s+[a-zA-Z0-9_\-.~+/]+=*/,
    severity: 'high',
    recommendation: 'Remove hardcoded bearer token. Use dynamic token retrieval.',
  },
  {
    type: 'JWT',
    pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_\-+/=]+/,
    severity: 'high',
    recommendation: 'Remove hardcoded JWT. Tokens should be retrieved at runtime.',
  },
  {
    type: 'PREFIXED_KEY',
    pattern: /(?:sk|pk|rk|ak)-[a-zA-Z0-9]{20,}/,
    severity: 'high',
    recommendation: 'Rotate this API key and move to environment variable.',
  },

  // Medium — passwords and connection strings
  {
    type: 'PASSWORD',
    pattern: /(?:password|passwd|pwd|secret)\s*[=:]\s*["']?([^\s"']{8,})/i,
    severity: 'medium',
    recommendation: 'Remove hardcoded password. Use a secrets manager.',
  },
  {
    type: 'CONNECTION_STRING',
    pattern: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s"']+/,
    severity: 'medium',
    recommendation: 'Move connection string to environment variable or secrets manager.',
  },

  // Low — potentially sensitive
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    severity: 'low',
    recommendation: 'Consider whether this IP address should be in source code.',
  },
];

// ─── Default exclusions ─────────────────────────────────────────────────────

const DEFAULT_EXCLUSIONS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'vendor',
  '*.min.js',
  '*.map',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

// ─── Scanner ─────────────────────────────────────────────────────────────────

export class SecretScanner {
  private patterns: SecretPattern[];
  private exclusions: string[];
  private findings: SecretFinding[] = [];

  constructor(options?: { customPatterns?: SecretPattern[]; exclusions?: string[] }) {
    this.patterns = [...BUILTIN_PATTERNS, ...(options?.customPatterns ?? [])];
    this.exclusions = [...DEFAULT_EXCLUSIONS, ...(options?.exclusions ?? [])];
  }

  /**
   * Scan a single file's content for secrets.
   */
  scanFile(path: string, content: string): SecretFinding[] {
    const fileFindings: SecretFinding[] = [];
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      for (const patternDef of this.patterns) {
        const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags || 'g');
        if (regex.test(line)) {
          const finding: SecretFinding = {
            file: path,
            line: lineIndex + 1,
            type: patternDef.type,
            severity: patternDef.severity,
            snippet: this.redactLine(line),
            recommendation: patternDef.recommendation,
          };
          fileFindings.push(finding);
        }
      }
    }

    this.findings.push(...fileFindings);
    return fileFindings;
  }

  /**
   * Recursively scan a directory for secrets.
   */
  scanDirectory(dirPath: string): SecretFinding[] {
    const dirFindings: SecretFinding[] = [];
    this.walkDir(dirPath, dirPath, dirFindings);
    this.findings.push(...dirFindings);
    return dirFindings;
  }

  /**
   * Add a custom detection pattern at runtime.
   */
  addPattern(pattern: SecretPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Return all findings accumulated across all scans.
   */
  getFindings(): SecretFinding[] {
    return [...this.findings];
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private walkDir(dir: string, rootDir: string, findings: SecretFinding[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      if (this.isExcluded(entry, relative(rootDir, fullPath))) {
        continue;
      }

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.walkDir(fullPath, rootDir, findings);
      } else if (stat.isFile() && stat.size < 1_000_000) {
        // Skip files larger than 1MB (likely binary)
        try {
          const content = readFileSync(fullPath, 'utf-8');
          // Quick binary check — skip if null bytes present
          if (content.includes('\0')) continue;
          const fileFindings = this.scanFile(relative(rootDir, fullPath), content);
          findings.push(...fileFindings);
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  private isExcluded(name: string, relativePath: string): boolean {
    for (const exclusion of this.exclusions) {
      if (exclusion.startsWith('*')) {
        // Glob-style extension match
        const ext = exclusion.slice(1);
        if (name.endsWith(ext)) return true;
      } else if (name === exclusion || relativePath.includes(exclusion)) {
        return true;
      }
    }
    return false;
  }

  private redactLine(line: string): string {
    const trimmed = line.trim();
    if (trimmed.length <= 20) return trimmed;

    // Show first 10 chars and last 5, redact the middle
    return `${trimmed.slice(0, 10)}${'*'.repeat(Math.min(trimmed.length - 15, 20))}${trimmed.slice(-5)}`;
  }
}
