// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Structured Log Parser
// Auto-detects JSON, logfmt, plaintext, and multiline stack traces.
// Parses timestamps in multiple formats (ISO, epoch, syslog, etc.).
// ─────────────────────────────────────────────────────────────────────────────

export type LogFormat = 'json' | 'logfmt' | 'plaintext' | 'multiline';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ParsedLog {
  timestamp: Date;
  level: LogLevel;
  message: string;
  fields: Record<string, unknown>;
  raw: string;
  format: LogFormat;
}

// ─── Timestamp Patterns ─────────────────────────────────────────────────────

const TIMESTAMP_PATTERNS: { regex: RegExp; parse: (match: string) => Date | null }[] = [
  // ISO 8601 (2025-01-15T10:30:00.000Z)
  {
    regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/,
    parse: (m) => { const d = new Date(m); return isNaN(d.getTime()) ? null : d; },
  },
  // Epoch seconds (1705312200) or milliseconds (1705312200000)
  {
    regex: /\b(\d{10}(?:\d{3})?)\b/,
    parse: (m) => {
      const n = Number(m);
      const ms = m.length === 13 ? n : n * 1000;
      const d = new Date(ms);
      return d.getFullYear() >= 2000 && d.getFullYear() <= 2100 ? d : null;
    },
  },
  // Syslog-style (Jan 15 10:30:00)
  {
    regex: /[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,
    parse: (m) => {
      const now = new Date();
      const d = new Date(`${m} ${now.getFullYear()}`);
      return isNaN(d.getTime()) ? null : d;
    },
  },
  // Common date format (2025-01-15 10:30:00)
  {
    regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?/,
    parse: (m) => { const d = new Date(m.replace(' ', 'T') + 'Z'); return isNaN(d.getTime()) ? null : d; },
  },
  // Date with slashes (01/15/2025 10:30:00)
  {
    regex: /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/,
    parse: (m) => { const d = new Date(m); return isNaN(d.getTime()) ? null : d; },
  },
];

// ─── Level Normalization ────────────────────────────────────────────────────

const LEVEL_MAP: Record<string, LogLevel> = {
  trace: 'debug',
  debug: 'debug',
  dbg: 'debug',
  info: 'info',
  inf: 'info',
  information: 'info',
  notice: 'info',
  warn: 'warn',
  warning: 'warn',
  wrn: 'warn',
  error: 'error',
  err: 'error',
  critical: 'fatal',
  fatal: 'fatal',
  emerg: 'fatal',
  emergency: 'fatal',
  panic: 'fatal',
};

const LEVEL_PATTERN = /\b(TRACE|DEBUG|DBG|INFO|INF|INFORMATION|NOTICE|WARN|WARNING|WRN|ERROR|ERR|CRITICAL|FATAL|EMERG|EMERGENCY|PANIC)\b/i;

// ─── Multiline Detection ───────────────────────────────────────────────────

const CONTINUATION_PATTERNS = [
  /^\s+at\s+/,                    // Java / JS stack traces
  /^\s+File\s+"/,                 // Python tracebacks
  /^\s+\.{3}\s+\d+\s+more/,      // Java "... N more"
  /^Traceback\s+\(/,              // Python traceback header
  /^Caused by:/,                  // Java chained exceptions
  /^\s+\^/,                       // Caret markers
  /^\s{2,}/,                      // Indented continuation lines
];

function isContinuationLine(line: string): boolean {
  return CONTINUATION_PATTERNS.some((p) => p.test(line));
}

// ─── Log Parser ─────────────────────────────────────────────────────────────

export class LogParser {
  /**
   * Auto-detect the log format of a single line.
   */
  detectFormat(line: string): LogFormat {
    const trimmed = line.trim();

    // JSON detection
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // Not valid JSON
      }
    }

    // Logfmt detection: key=value pairs
    const logfmtPattern = /^(?:\S+=(?:"[^"]*"|\S+)\s*){2,}/;
    if (logfmtPattern.test(trimmed)) {
      return 'logfmt';
    }

    // Multiline detection
    if (isContinuationLine(trimmed)) {
      return 'multiline';
    }

    return 'plaintext';
  }

  /**
   * Parse a single raw log line (or block) into a structured ParsedLog.
   */
  parse(raw: string): ParsedLog {
    const format = this.detectFormat(raw);

    switch (format) {
      case 'json':
        return this.parseJson(raw);
      case 'logfmt':
        return this.parseLogfmt(raw);
      case 'multiline':
        return this.parseMultiline(raw);
      default:
        return this.parsePlaintext(raw);
    }
  }

  /**
   * Parse multiple raw log lines, grouping multiline entries together.
   */
  parseMany(rawLines: string[]): ParsedLog[] {
    const results: ParsedLog[] = [];
    let buffer: string[] = [];

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const combined = buffer.join('\n');
      const format = buffer.length > 1 ? 'multiline' : this.detectFormat(buffer[0]);
      if (format === 'multiline') {
        results.push(this.parseMultiline(combined));
      } else {
        results.push(this.parse(combined));
      }
      buffer = [];
    };

    for (const line of rawLines) {
      if (line.trim() === '') continue;

      if (isContinuationLine(line) && buffer.length > 0) {
        // Continuation of previous log entry
        buffer.push(line);
      } else {
        // New log entry; flush previous buffer
        flushBuffer();
        buffer.push(line);
      }
    }

    flushBuffer();
    return results;
  }

  // ─── Private Parsers ────────────────────────────────────────────────────

  private parseJson(raw: string): ParsedLog {
    try {
      const obj = JSON.parse(raw.trim());

      const timestamp = this.extractTimestampFromObject(obj);
      const level = this.extractLevelFromObject(obj);
      const message = this.extractMessageFromObject(obj);

      // All remaining fields
      const fields: Record<string, unknown> = {};
      const knownKeys = new Set([
        'timestamp', 'time', 'ts', '@timestamp', 'date', 'datetime',
        'level', 'lvl', 'severity', 'log.level',
        'message', 'msg', 'text', 'log',
      ]);
      for (const [k, v] of Object.entries(obj)) {
        if (!knownKeys.has(k)) {
          fields[k] = v;
        }
      }

      return { timestamp, level, message, fields, raw, format: 'json' };
    } catch {
      return this.parsePlaintext(raw);
    }
  }

  private parseLogfmt(raw: string): ParsedLog {
    const fields: Record<string, unknown> = {};
    const pattern = /(\w[\w.]*?)=((?:"[^"]*")|(?:\S+))/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(raw)) !== null) {
      let value: unknown = match[2];
      if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      // Attempt numeric conversion
      const num = Number(value);
      if (!isNaN(num) && value !== '') {
        value = num;
      }
      fields[match[1]] = value;
    }

    const timestamp = this.extractTimestampFromFields(fields);
    const level = this.extractLevelFromFields(fields);
    const message = this.extractMessageFromFields(fields);

    // Remove known keys from fields
    for (const k of ['timestamp', 'time', 'ts', 'level', 'lvl', 'severity', 'msg', 'message']) {
      delete fields[k];
    }

    return { timestamp, level, message, fields, raw, format: 'logfmt' };
  }

  private parseMultiline(raw: string): ParsedLog {
    const lines = raw.split('\n');
    const firstLine = lines[0] || '';

    const timestamp = this.extractTimestampFromString(firstLine);
    const level = this.extractLevelFromString(firstLine);

    return {
      timestamp,
      level: level || 'error', // Multiline is typically an error/stack trace
      message: firstLine.trim(),
      fields: { stackTrace: lines.slice(1).join('\n') },
      raw,
      format: 'multiline',
    };
  }

  private parsePlaintext(raw: string): ParsedLog {
    const timestamp = this.extractTimestampFromString(raw);
    const level = this.extractLevelFromString(raw);

    // Strip timestamp and level from the message
    let message = raw;
    for (const tp of TIMESTAMP_PATTERNS) {
      message = message.replace(tp.regex, '').trim();
    }
    message = message.replace(LEVEL_PATTERN, '').trim();
    // Clean up separators left behind
    message = message.replace(/^[\s\-:|[\]]+/, '').trim();

    return {
      timestamp,
      level: level || 'info',
      message,
      fields: {},
      raw,
      format: 'plaintext',
    };
  }

  // ─── Extraction Helpers ─────────────────────────────────────────────────

  private extractTimestampFromObject(obj: Record<string, unknown>): Date {
    for (const key of ['timestamp', 'time', 'ts', '@timestamp', 'date', 'datetime']) {
      if (obj[key] != null) {
        const val = obj[key];
        if (val instanceof Date) return val;
        if (typeof val === 'string') {
          const d = new Date(val);
          if (!isNaN(d.getTime())) return d;
        }
        if (typeof val === 'number') {
          const ms = val > 1e12 ? val : val * 1000;
          return new Date(ms);
        }
      }
    }
    return new Date();
  }

  private extractLevelFromObject(obj: Record<string, unknown>): LogLevel {
    for (const key of ['level', 'lvl', 'severity', 'log.level']) {
      if (typeof obj[key] === 'string') {
        const normalized = LEVEL_MAP[obj[key].toLowerCase()];
        if (normalized) return normalized;
      }
    }
    return 'info';
  }

  private extractMessageFromObject(obj: Record<string, unknown>): string {
    for (const key of ['message', 'msg', 'text', 'log']) {
      if (typeof obj[key] === 'string') return obj[key];
    }
    return '';
  }

  private extractTimestampFromFields(fields: Record<string, unknown>): Date {
    for (const key of ['timestamp', 'time', 'ts']) {
      if (fields[key] != null) {
        const val = fields[key];
        if (typeof val === 'string') {
          const d = new Date(val);
          if (!isNaN(d.getTime())) return d;
        }
        if (typeof val === 'number') {
          const ms = val > 1e12 ? val : val * 1000;
          return new Date(ms);
        }
      }
    }
    return new Date();
  }

  private extractLevelFromFields(fields: Record<string, unknown>): LogLevel {
    for (const key of ['level', 'lvl', 'severity']) {
      if (typeof fields[key] === 'string') {
        const normalized = LEVEL_MAP[fields[key].toLowerCase()];
        if (normalized) return normalized;
      }
    }
    return 'info';
  }

  private extractMessageFromFields(fields: Record<string, unknown>): string {
    for (const key of ['msg', 'message']) {
      if (typeof fields[key] === 'string') return fields[key];
    }
    return '';
  }

  private extractTimestampFromString(str: string): Date {
    for (const tp of TIMESTAMP_PATTERNS) {
      const match = tp.regex.exec(str);
      if (match) {
        const d = tp.parse(match[0]);
        if (d) return d;
      }
    }
    return new Date();
  }

  private extractLevelFromString(str: string): LogLevel | null {
    const match = LEVEL_PATTERN.exec(str);
    if (match) {
      return LEVEL_MAP[match[1].toLowerCase()] ?? null;
    }
    return null;
  }
}
