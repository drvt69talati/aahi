// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Context Inspector Panel
// Full context window inspector: token budget, sources, attached files,
// active integrations, and redaction summary.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import { runtime } from '../../bridge/runtime-client';
import { useRuntimeStore } from '../../store/runtime-store';

// ── Types ────────────────────────────────────────────────────────────────────

type SourceType = 'file' | 'logs' | 'metrics' | 'integration';

interface ContextSource {
  id: string;
  name: string;
  type: SourceType;
  tokenCount: number;
  priority: number; // 1-100
  redactedCount: number;
  content?: string;
}

interface AttachedFile {
  id: string;
  path: string;
  language: string;
  tokenCount: number;
  preview: string; // first 10 lines
}

interface IntegrationContext {
  id: string;
  name: string;
  connected: boolean;
  dataTypes: string[];
  tokenAllocation: number;
  lastFetch: string;
}

interface RedactionBreakdown {
  type: string;
  count: number;
}

interface ContextStats {
  totalTokenBudget: number;
  usedTokens: number;
  sources: ContextSource[];
  attachedFiles: AttachedFile[];
  integrations: IntegrationContext[];
  redactionTotal: number;
  redactionBreakdown: RedactionBreakdown[];
}

// ── Source type icons and colors ─────────────────────────────────────────────

const sourceTypeConfig: Record<SourceType, { icon: string; color: string }> = {
  file: { icon: '\u{1F4C4}', color: '#569cd6' },
  logs: { icon: '\u{1F4CB}', color: '#4ec9b0' },
  metrics: { icon: '\u{1F4CA}', color: '#c586c0' },
  integration: { icon: '\u{1F517}', color: '#4ec9b0' },
};

const languageIcons: Record<string, string> = {
  typescript: 'TS',
  typescriptreact: 'TSX',
  javascript: 'JS',
  javascriptreact: 'JSX',
  python: 'PY',
  rust: 'RS',
  go: 'GO',
  java: 'JV',
  ruby: 'RB',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  yaml: 'YML',
  markdown: 'MD',
};

// ── Mock data for when runtime endpoint is unavailable ───────────────────────

function getMockStats(): ContextStats {
  return {
    totalTokenBudget: 128000,
    usedTokens: 12450,
    sources: [
      { id: 's1', name: 'src/auth/login.ts', type: 'file', tokenCount: 3200, priority: 95, redactedCount: 1, content: 'import { AuthProvider } from "./provider";\nimport { hashPassword } from "./crypto";\n\nexport async function login(email: string, password: string) {\n  const user = await findUser(email);\n  if (!user) throw new AuthError("User not found");\n  const valid = await verifyPassword(password, user.hash);\n  return { token: generateJWT(user), user };\n}' },
      { id: 's2', name: 'Application Logs (last 5m)', type: 'logs', tokenCount: 1800, priority: 72, redactedCount: 2, content: '[2026-03-16T10:23:45Z] INFO  auth.login: successful login user=<EMAIL_1>\n[2026-03-16T10:23:46Z] WARN  rate-limiter: approaching threshold ip=192.168.1.1\n[2026-03-16T10:23:50Z] ERROR auth.login: failed attempt user=<EMAIL_2>' },
      { id: 's3', name: 'CPU / Memory Metrics', type: 'metrics', tokenCount: 950, priority: 45, redactedCount: 0, content: 'auth-service:\n  cpu: 23% (avg 5m)\n  memory: 412MB / 1024MB (40.2%)\n  p99_latency: 145ms\n  error_rate: 0.3%' },
      { id: 's4', name: 'GitHub PR Context', type: 'integration', tokenCount: 2100, priority: 60, redactedCount: 0, content: 'PR #1842: Refactor auth middleware\nStatus: Open | Reviews: 1 approved\nChanged files: 4 | +120 -45 lines' },
      { id: 's5', name: 'Kubernetes Pod Status', type: 'integration', tokenCount: 780, priority: 55, redactedCount: 0, content: 'auth-service-v2-abc12: Running (3 replicas)\nRestart count: 0\nLast deployed: 2h ago' },
      { id: 's6', name: 'src/middleware/rateLimit.ts', type: 'file', tokenCount: 1450, priority: 80, redactedCount: 0, content: 'export function createRateLimiter(opts: RateLimitOptions) {\n  const store = new TokenBucket(opts.maxTokens, opts.refillRate);\n  return async (req: Request, res: Response, next: Next) => {\n    const key = opts.keyExtractor(req);\n    if (!store.consume(key)) {\n      res.status(429).json({ error: "Rate limited" });\n      return;\n    }\n    next();\n  };\n}' },
    ],
    attachedFiles: [
      { id: 'af1', path: 'src/auth/login.ts', language: 'typescript', tokenCount: 3200, preview: 'import { AuthProvider } from "./provider";\nimport { hashPassword } from "./crypto";\nimport { generateJWT } from "./jwt";\nimport { findUser } from "../db/users";\nimport { verifyPassword } from "./crypto";\nimport { AuthError } from "./errors";\n\nexport async function login(email: string, password: string) {\n  const user = await findUser(email);\n  if (!user) throw new AuthError("User not found");' },
      { id: 'af2', path: 'src/middleware/rateLimit.ts', language: 'typescript', tokenCount: 1450, preview: 'import { TokenBucket } from "../utils/token-bucket";\nimport type { Request, Response, Next } from "express";\n\ninterface RateLimitOptions {\n  maxTokens: number;\n  refillRate: number;\n  keyExtractor: (req: Request) => string;\n}\n\nexport function createRateLimiter(opts: RateLimitOptions) {\n  const store = new TokenBucket(opts.maxTokens, opts.refillRate);' },
    ],
    integrations: [
      { id: 'ig1', name: 'GitHub', connected: true, dataTypes: ['PRs', 'Issues', 'Reviews'], tokenAllocation: 2100, lastFetch: '2026-03-16T10:20:00Z' },
      { id: 'ig2', name: 'Kubernetes', connected: true, dataTypes: ['Pods', 'Events', 'Logs'], tokenAllocation: 780, lastFetch: '2026-03-16T10:22:30Z' },
      { id: 'ig3', name: 'Datadog', connected: false, dataTypes: ['Metrics', 'Monitors'], tokenAllocation: 0, lastFetch: '' },
    ],
    redactionTotal: 3,
    redactionBreakdown: [
      { type: 'emails', count: 2 },
      { type: 'API keys', count: 1 },
    ],
  };
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600 as const,
    color: '#cccccc',
  },
  headerMeta: {
    fontSize: 11,
    color: '#858585',
  },
  scrollBody: {
    flex: 1,
    overflowY: 'auto' as const,
  },

  // Token Budget Bar
  budgetSection: {
    padding: '14px',
    borderBottom: '1px solid #3e3e42',
  },
  budgetLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#cccccc',
    marginBottom: 8,
  },
  budgetBarTrack: {
    height: 10,
    backgroundColor: '#3e3e42',
    borderRadius: 5,
    overflow: 'hidden' as const,
  },
  budgetBarFill: {
    height: '100%',
    borderRadius: 5,
    transition: 'width 0.4s ease, background-color 0.4s ease',
  },

  // Section header
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px 6px',
    fontSize: 11,
    fontWeight: 600 as const,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
  sectionCount: {
    fontSize: 10,
    color: '#585858',
    fontWeight: 400 as const,
    textTransform: 'none' as const,
    letterSpacing: 0,
  },

  // Context Sources
  sourceItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '8px 14px',
    borderBottom: '1px solid #2d2d2d',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  sourceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sourceIcon: {
    fontSize: 14,
    width: 20,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  sourceName: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#cccccc',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  priorityBadge: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 3,
    fontWeight: 600 as const,
    color: '#1e1e1e',
    flexShrink: 0,
  },
  tokenCount: {
    fontSize: 10,
    color: '#858585',
    flexShrink: 0,
  },
  removeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#585858',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
    flexShrink: 0,
    transition: 'color 0.15s, background-color 0.15s',
  },
  sourceMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginLeft: 28,
    fontSize: 10,
    color: '#585858',
  },
  miniBar: {
    height: 3,
    backgroundColor: '#3e3e42',
    borderRadius: 2,
    overflow: 'hidden' as const,
    marginTop: 6,
    marginLeft: 28,
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#569cd6',
  },
  expandedPreview: {
    marginTop: 8,
    marginLeft: 28,
    padding: 8,
    backgroundColor: '#2d2d2d',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    fontSize: 11,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: '#cccccc',
    maxHeight: 150,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: '1.5',
  },

  // Attached files
  fileItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '8px 14px',
    borderBottom: '1px solid #2d2d2d',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  langBadge: {
    fontSize: 9,
    fontWeight: 700 as const,
    padding: '1px 4px',
    borderRadius: 2,
    backgroundColor: '#007acc33',
    color: '#569cd6',
    flexShrink: 0,
  },
  filePath: {
    flex: 1,
    fontSize: 12,
    color: '#cccccc',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  previewToggle: {
    fontSize: 10,
    color: '#007acc',
    cursor: 'pointer',
    flexShrink: 0,
    background: 'none',
    border: 'none',
    fontFamily: 'inherit',
  },

  // Integration context
  integrationItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '8px 14px',
    borderBottom: '1px solid #2d2d2d',
  },
  integrationRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  connectedBadge: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 3,
    fontWeight: 500 as const,
  },
  integrationMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    fontSize: 10,
    color: '#585858',
  },
  dataTypeTags: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
  },
  dataTypeTag: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 2,
    backgroundColor: '#3e3e42',
    color: '#858585',
  },

  // Redaction summary
  redactionSection: {
    padding: '12px 14px',
    borderTop: '1px solid #3e3e42',
    backgroundColor: '#252526',
    flexShrink: 0,
  },
  redactionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  redactionTitle: {
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#cca700',
  },
  redactionToggle: {
    fontSize: 10,
    color: '#007acc',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    fontFamily: 'inherit',
  },
  redactionBreakdown: {
    display: 'flex',
    gap: 12,
    fontSize: 11,
    color: '#858585',
    flexWrap: 'wrap' as const,
  },
  redactionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  redactionCount: {
    fontSize: 10,
    fontWeight: 600 as const,
    color: '#cca700',
    backgroundColor: '#cca70022',
    padding: '0 4px',
    borderRadius: 2,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return `${count}`;
}

function getBudgetColor(percent: number): string {
  if (percent <= 50) return '#4ec9b0';
  if (percent <= 80) return '#cca700';
  return '#f44747';
}

function getPriorityColor(priority: number): string {
  if (priority >= 80) return '#f44747';
  if (priority >= 50) return '#cca700';
  return '#4ec9b0';
}

function formatTimestamp(isoString: string): string {
  if (!isoString) return 'Never';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  } catch {
    return isoString;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export const ContextInspector: React.FC = () => {
  const [stats, setStats] = useState<ContextStats | null>(null);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [showRedacted, setShowRedacted] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [hoveredRemove, setHoveredRemove] = useState<string | null>(null);

  const integrations = useRuntimeStore((s) => s.integrations);

  // Fetch context stats from runtime or fall back to mock data
  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const result = await runtime.request<ContextStats>('context.stats');
        if (!cancelled && result) {
          setStats(result);
        }
      } catch {
        // Runtime endpoint not available yet — use mock data
        if (!cancelled) {
          setStats(getMockStats());
        }
      }
    }

    fetchStats();
    return () => { cancelled = true; };
  }, []);

  const handleRemoveSource = useCallback((id: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(`file-${id}`);
      return next;
    });
  }, []);

  if (!stats) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>Context Inspector</span>
        </div>
        <div style={{ padding: 20, color: '#858585', fontSize: 12, textAlign: 'center' }}>
          Loading context stats...
        </div>
      </div>
    );
  }

  const activeSources = stats.sources.filter((s) => !removedIds.has(s.id));
  const activeFiles = stats.attachedFiles.filter((f) => !removedIds.has(`file-${f.id}`));
  const activeTokens = activeSources.reduce((sum, s) => sum + s.tokenCount, 0);
  const usagePercent = Math.min((activeTokens / stats.totalTokenBudget) * 100, 100);
  const budgetColor = getBudgetColor(usagePercent);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Context Inspector</span>
        <span style={styles.headerMeta}>{activeSources.length} sources</span>
      </div>

      <div style={styles.scrollBody}>
        {/* Token Budget Bar */}
        <div style={styles.budgetSection}>
          <div style={styles.budgetLabelRow}>
            <span style={{ fontWeight: 500 }}>Token Budget</span>
            <span>
              {formatTokens(activeTokens)} / {formatTokens(stats.totalTokenBudget)} (
              {usagePercent.toFixed(1)}%)
            </span>
          </div>
          <div style={styles.budgetBarTrack}>
            <div
              style={{
                ...styles.budgetBarFill,
                width: `${usagePercent}%`,
                backgroundColor: budgetColor,
              }}
            />
          </div>
        </div>

        {/* Context Sources */}
        <div style={styles.sectionHeader}>
          <span>Context Sources</span>
          <span style={styles.sectionCount}>{activeSources.length} active</span>
        </div>
        {activeSources
          .sort((a, b) => b.priority - a.priority)
          .map((source) => {
            const config = sourceTypeConfig[source.type] || sourceTypeConfig.integration;
            const tokenPercent = (source.tokenCount / stats.totalTokenBudget) * 100;
            const isExpanded = expandedSourceId === source.id;

            return (
              <div
                key={source.id}
                style={{
                  ...styles.sourceItem,
                  backgroundColor: isExpanded ? '#252526' : 'transparent',
                }}
                onClick={() => setExpandedSourceId(isExpanded ? null : source.id)}
              >
                <div style={styles.sourceRow}>
                  <span style={styles.sourceIcon}>{config.icon}</span>
                  <span style={styles.sourceName}>{source.name}</span>
                  <span
                    style={{
                      ...styles.priorityBadge,
                      backgroundColor: getPriorityColor(source.priority),
                    }}
                  >
                    {source.priority}
                  </span>
                  <span style={styles.tokenCount}>{formatTokens(source.tokenCount)}</span>
                  <button
                    style={{
                      ...styles.removeBtn,
                      color: hoveredRemove === source.id ? '#f44747' : '#585858',
                      backgroundColor: hoveredRemove === source.id ? '#f4474722' : 'transparent',
                    }}
                    title="Remove from context"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveSource(source.id);
                    }}
                    onMouseEnter={() => setHoveredRemove(source.id)}
                    onMouseLeave={() => setHoveredRemove(null)}
                  >
                    X
                  </button>
                </div>
                <div style={styles.sourceMeta}>
                  <span style={{ color: config.color }}>{source.type}</span>
                  {source.redactedCount > 0 && (
                    <span style={{ color: '#cca700' }}>
                      {source.redactedCount} entities redacted
                    </span>
                  )}
                </div>
                <div style={styles.miniBar}>
                  <div
                    style={{ ...styles.miniBarFill, width: `${tokenPercent}%`, backgroundColor: config.color }}
                  />
                </div>

                {isExpanded && source.content && (
                  <div style={styles.expandedPreview}>{source.content}</div>
                )}
              </div>
            );
          })}

        {/* Attached Files */}
        {activeFiles.length > 0 && (
          <>
            <div style={styles.sectionHeader}>
              <span>Attached Files</span>
              <span style={styles.sectionCount}>{activeFiles.length} files</span>
            </div>
            {activeFiles.map((file) => {
              const showPreview = previewFileId === file.id;
              const langLabel = languageIcons[file.language] || file.language.toUpperCase().slice(0, 3);

              return (
                <div key={file.id} style={styles.fileItem}>
                  <div style={styles.fileRow}>
                    <span style={styles.langBadge}>{langLabel}</span>
                    <span style={styles.filePath}>{file.path}</span>
                    <span style={styles.tokenCount}>{formatTokens(file.tokenCount)}</span>
                    <button
                      style={styles.previewToggle}
                      onClick={() => setPreviewFileId(showPreview ? null : file.id)}
                    >
                      {showPreview ? 'Hide' : 'Preview'}
                    </button>
                    <button
                      style={{
                        ...styles.removeBtn,
                        color: hoveredRemove === `file-${file.id}` ? '#f44747' : '#585858',
                        backgroundColor: hoveredRemove === `file-${file.id}` ? '#f4474722' : 'transparent',
                      }}
                      title="Remove file"
                      onClick={() => handleRemoveFile(file.id)}
                      onMouseEnter={() => setHoveredRemove(`file-${file.id}`)}
                      onMouseLeave={() => setHoveredRemove(null)}
                    >
                      X
                    </button>
                  </div>
                  {showPreview && (
                    <div style={{ ...styles.expandedPreview, marginLeft: 0, marginTop: 6 }}>
                      {file.preview}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Active Integrations Context */}
        <div style={styles.sectionHeader}>
          <span>Active Integrations</span>
          <span style={styles.sectionCount}>
            {stats.integrations.filter((i) => i.connected).length} connected
          </span>
        </div>
        {stats.integrations.map((integration) => (
          <div key={integration.id} style={styles.integrationItem}>
            <div style={styles.integrationRow}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#cccccc', flex: 1 }}>
                {integration.name}
              </span>
              <span
                style={{
                  ...styles.connectedBadge,
                  backgroundColor: integration.connected ? '#4ec9b022' : '#3e3e42',
                  color: integration.connected ? '#4ec9b0' : '#585858',
                  border: `1px solid ${integration.connected ? '#4ec9b044' : '#3e3e42'}`,
                }}
              >
                {integration.connected ? 'Connected' : 'Offline'}
              </span>
              {integration.tokenAllocation > 0 && (
                <span style={styles.tokenCount}>{formatTokens(integration.tokenAllocation)}</span>
              )}
            </div>
            <div style={styles.dataTypeTags}>
              {integration.dataTypes.map((dt) => (
                <span key={dt} style={styles.dataTypeTag}>
                  {dt}
                </span>
              ))}
            </div>
            {integration.lastFetch && (
              <div style={styles.integrationMeta}>
                <span>Last fetch: {formatTimestamp(integration.lastFetch)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Redaction Summary (pinned to bottom) */}
      {stats.redactionTotal > 0 && (
        <div style={styles.redactionSection}>
          <div style={styles.redactionHeader}>
            <span style={styles.redactionTitle}>
              {stats.redactionTotal} entities redacted in this context window
            </span>
            <button
              style={styles.redactionToggle}
              onClick={() => setShowRedacted(!showRedacted)}
            >
              {showRedacted ? 'Hide placeholders' : 'View redacted'}
            </button>
          </div>
          <div style={styles.redactionBreakdown}>
            {stats.redactionBreakdown.map((item) => (
              <div key={item.type} style={styles.redactionItem}>
                <span style={styles.redactionCount}>{item.count}</span>
                <span>{item.type}</span>
              </div>
            ))}
          </div>
          {showRedacted && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                backgroundColor: '#1e1e1e',
                borderRadius: 4,
                border: '1px solid #3e3e42',
                fontSize: 11,
                fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                color: '#cca700',
                lineHeight: '1.6',
              }}
            >
              {stats.redactionBreakdown.map((item) =>
                Array.from({ length: item.count }, (_, i) => (
                  <div key={`${item.type}-${i}`}>
                    {'<'}{item.type.toUpperCase().replace(/S$/, '')}_{i + 1}{'>'}
                  </div>
                )),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
