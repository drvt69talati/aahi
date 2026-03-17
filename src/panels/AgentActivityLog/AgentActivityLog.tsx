// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Agent Observability Dashboard
// Full execution visibility: timeline swimlane, step trace table, performance
// metrics, replay controls, and filtering.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRuntimeStore } from '../../store/runtime-store';
import type { AgentExecution, AgentStepState } from '../../store/runtime-store';
import { ExecutionTimeline } from './ExecutionTimeline';
import { AgentStepCard } from '../../components/AgentStepCard';
import type { StepType, StepStatus } from '../../components/AgentStepCard';

// ── Theme ────────────────────────────────────────────────────────────────

const C = {
  bg: '#1e1e1e',
  panel: '#2d2d2d',
  sidebar: '#252526',
  text: '#cccccc',
  secondary: '#858585',
  accent: '#007acc',
  teal: '#4ec9b0',
  border: '#3e3e42',
  error: '#f44747',
  warning: '#cca700',
  success: '#4ec9b0',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatData(data: unknown): string {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

const STATUS_COLORS: Record<string, string> = {
  running: C.accent,
  completed: C.success,
  failed: C.error,
  pending: C.secondary,
  'waiting-approval': C.warning,
};

const EXEC_STATUS_COLORS: Record<string, string> = {
  running: C.accent,
  completed: C.success,
  failed: C.error,
};

// ── Performance metrics computation ──────────────────────────────────────

interface PerfMetrics {
  totalDurationMs: number;
  criticalPathMs: number;
  parallelEfficiency: number;
  totalTokens: number;
  mostExpensiveStep: { name: string; durationMs: number } | null;
  stepCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
}

function computeMetrics(exec: AgentExecution): PerfMetrics {
  const steps = exec.steps || [];
  const totalDurationMs = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);

  // Critical path: longest chain — simplified as max single step duration
  // since we don't have explicit dependency info
  let criticalPathMs = 0;
  let cumulativeMs = 0;
  for (const s of steps) {
    cumulativeMs += s.durationMs || 0;
  }
  criticalPathMs = cumulativeMs;

  // Parallel efficiency: if totalDuration > criticalPath, some ran in parallel
  const parallelEfficiency = criticalPathMs > 0 ? totalDurationMs / criticalPathMs : 0;

  // Token count from result metadata
  let totalTokens = 0;
  for (const s of steps) {
    const r = s.result as Record<string, unknown> | undefined;
    if (r && typeof r === 'object' && 'tokenCount' in r) {
      totalTokens += (r.tokenCount as number) || 0;
    }
  }

  // Most expensive step
  let mostExpensiveStep: { name: string; durationMs: number } | null = null;
  for (const s of steps) {
    if (s.durationMs && (!mostExpensiveStep || s.durationMs > mostExpensiveStep.durationMs)) {
      mostExpensiveStep = { name: s.name, durationMs: s.durationMs };
    }
  }

  return {
    totalDurationMs,
    criticalPathMs,
    parallelEfficiency: Math.min(parallelEfficiency, 1),
    totalTokens,
    mostExpensiveStep,
    stepCount: steps.length,
    completedCount: steps.filter((s) => s.status === 'completed').length,
    failedCount: steps.filter((s) => s.status === 'failed').length,
    runningCount: steps.filter((s) => s.status === 'running').length,
  };
}

// ── Styles ───────────────────────────────────────────────────────────────

const s = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: C.bg,
    color: C.text,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  } as React.CSSProperties,

  // ── Replay Controls (top bar) ──────────────────────────────────────
  topBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    backgroundColor: C.sidebar,
    borderBottom: `1px solid ${C.border}`,
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  topBarTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.text,
  } as React.CSSProperties,
  badge: {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 3,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  } as React.CSSProperties,
  topBarInfo: {
    fontSize: 11,
    color: C.secondary,
  } as React.CSSProperties,
  topBarSpacer: { flex: 1 } as React.CSSProperties,
  btn: {
    padding: '4px 10px',
    backgroundColor: 'transparent',
    border: `1px solid ${C.border}`,
    borderRadius: 3,
    color: C.text,
    fontSize: 11,
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  } as React.CSSProperties,
  btnPrimary: {
    padding: '4px 10px',
    backgroundColor: C.accent,
    border: `1px solid ${C.accent}`,
    borderRadius: 3,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  } as React.CSSProperties,

  // ── Filter bar ─────────────────────────────────────────────────────
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderBottom: `1px solid ${C.border}`,
    backgroundColor: C.sidebar,
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  filterLabel: {
    fontSize: 10,
    color: C.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  } as React.CSSProperties,
  filterSelect: {
    padding: '3px 8px',
    backgroundColor: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 3,
    color: C.text,
    fontSize: 11,
    fontFamily: 'inherit',
    outline: 'none',
  } as React.CSSProperties,
  searchInput: {
    padding: '3px 8px',
    backgroundColor: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 3,
    color: C.text,
    fontSize: 11,
    fontFamily: 'inherit',
    outline: 'none',
    width: 160,
  } as React.CSSProperties,

  // ── Main layout ────────────────────────────────────────────────────
  mainLayout: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  } as React.CSSProperties,
  contentArea: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  } as React.CSSProperties,

  // ── Side panel (performance metrics) ───────────────────────────────
  sidePanel: {
    width: 240,
    backgroundColor: C.sidebar,
    borderLeft: `1px solid ${C.border}`,
    overflowY: 'auto' as const,
    flexShrink: 0,
    padding: '12px 10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  } as React.CSSProperties,
  metricCard: {
    backgroundColor: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    padding: 10,
  } as React.CSSProperties,
  metricLabel: {
    fontSize: 9,
    fontWeight: 600,
    color: C.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  } as React.CSSProperties,
  metricValue: {
    fontSize: 18,
    fontWeight: 600,
    color: C.text,
    lineHeight: '1.2',
  } as React.CSSProperties,
  metricSub: {
    fontSize: 10,
    color: C.secondary,
    marginTop: 2,
  } as React.CSSProperties,

  // ── Section headers ────────────────────────────────────────────────
  sectionHeader: {
    fontSize: 11,
    fontWeight: 600,
    color: C.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  } as React.CSSProperties,

  // ── Trace table ────────────────────────────────────────────────────
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 11,
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    fontWeight: 600,
    fontSize: 10,
    color: C.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    borderBottom: `1px solid ${C.border}`,
    backgroundColor: C.sidebar,
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  } as React.CSSProperties,
  td: {
    padding: '6px 8px',
    borderBottom: `1px solid ${C.border}22`,
    color: C.text,
    verticalAlign: 'top' as const,
  } as React.CSSProperties,
  trClickable: {
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  } as React.CSSProperties,
  statusBadge: {
    display: 'inline-block',
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 3,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  } as React.CSSProperties,
  expandedRow: {
    backgroundColor: C.panel,
  } as React.CSSProperties,
  expandedCell: {
    padding: '8px 12px',
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 11,
    color: C.text,
    whiteSpace: 'pre-wrap' as const,
    maxHeight: 200,
    overflowY: 'auto' as const,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,

  // ── Empty state ────────────────────────────────────────────────────
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: C.secondary,
    fontSize: 13,
    gap: 8,
    padding: 40,
  } as React.CSSProperties,

  // ── Execution selector ─────────────────────────────────────────────
  execList: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
    marginBottom: 8,
  } as React.CSSProperties,
  execChip: {
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    border: `1px solid ${C.border}`,
    backgroundColor: C.panel,
    color: C.text,
    transition: 'border-color 0.15s, background-color 0.15s',
  } as React.CSSProperties,
  execChipActive: {
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    border: `1px solid ${C.accent}`,
    backgroundColor: C.accent + '22',
    color: C.accent,
    fontWeight: 500,
  } as React.CSSProperties,
};

// ── Sub-components ───────────────────────────────────────────────────────

/** Metric card for the side panel */
const MetricCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  color?: string;
}> = ({ label, value, sub, color }) => (
  <div style={s.metricCard}>
    <div style={s.metricLabel}>{label}</div>
    <div style={{ ...s.metricValue, color: color || C.text }}>{value}</div>
    {sub && <div style={s.metricSub}>{sub}</div>}
  </div>
);

/** Status badge pill */
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const color = STATUS_COLORS[status] || C.secondary;
  return (
    <span
      style={{
        ...s.statusBadge,
        backgroundColor: color + '22',
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {status}
    </span>
  );
};

// ── Main Component ───────────────────────────────────────────────────────

export const AgentActivityLog: React.FC = () => {
  const agentExecutions = useRuntimeStore((st) => st.agentExecutions);
  const runAgent = useRuntimeStore((st) => st.runAgent);

  // ── Local state ────────────────────────────────────────────────────
  const [selectedExecIdx, setSelectedExecIdx] = useState<number>(0);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [exportCopied, setExportCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Inject animations
  useEffect(() => {
    const styleId = 'aahi-dashboard-anims';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes aahi-pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const executions = agentExecutions || [];

  // ── Filtering ──────────────────────────────────────────────────────
  const agents = useMemo(
    () => Array.from(new Set(executions.map((e) => e.agentId))),
    [executions],
  );

  const filtered = useMemo(() => {
    let list = executions;
    if (filterAgent !== 'all') {
      list = list.filter((e) => e.agentId === filterAgent);
    }
    if (filterStatus !== 'all') {
      list = list.filter((e) => e.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.intent.toLowerCase().includes(q) ||
          e.agentId.toLowerCase().includes(q) ||
          e.planId.toLowerCase().includes(q) ||
          e.steps.some((st) => st.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [executions, filterAgent, filterStatus, searchQuery]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedExecIdx >= filtered.length) {
      setSelectedExecIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedExecIdx]);

  const selectedExec = filtered[selectedExecIdx] || null;
  const metrics = selectedExec ? computeMetrics(selectedExec) : null;

  // ── Handlers ───────────────────────────────────────────────────────
  const handleReRun = useCallback(() => {
    if (!selectedExec) return;
    runAgent(selectedExec.agentId, selectedExec.intent);
  }, [selectedExec, runAgent]);

  const handleExport = useCallback(() => {
    if (!selectedExec) return;
    const json = JSON.stringify(selectedExec, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 1500);
    });
  }, [selectedExec]);

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
    setExpandedRowId((prev) => (prev === stepId ? null : stepId));
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────
  const runningCount = executions.filter((e) => e.status === 'running').length;

  // ── Render ─────────────────────────────────────────────────────────

  if (executions.length === 0) {
    return (
      <div style={s.container}>
        <div style={s.topBar}>
          <span style={s.topBarTitle}>Agent Observability Dashboard</span>
        </div>
        <div style={s.emptyState}>
          <span style={{ fontSize: 28, color: C.accent }}>{'\u2699'}</span>
          <span>No agent executions recorded</span>
          <span style={{ fontSize: 11, color: C.secondary }}>
            Run an agent to see execution traces here
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      {/* ════════════════════════════════════════════════════════════════ */}
      {/* REPLAY CONTROLS (TOP BAR)                                      */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div style={s.topBar}>
        <span style={s.topBarTitle}>Agent Observability Dashboard</span>

        {selectedExec && (
          <>
            <span style={s.topBarInfo}>
              Plan: <strong style={{ color: C.text }}>{selectedExec.planId}</strong>
            </span>
            <span style={s.topBarInfo}>
              Agent: <strong style={{ color: C.text }}>{selectedExec.agentId}</strong>
            </span>
            <span
              style={{
                ...s.badge,
                backgroundColor: (EXEC_STATUS_COLORS[selectedExec.status] || C.secondary) + '22',
                color: EXEC_STATUS_COLORS[selectedExec.status] || C.secondary,
                border: `1px solid ${(EXEC_STATUS_COLORS[selectedExec.status] || C.secondary)}44`,
              }}
            >
              {selectedExec.status === 'running' && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: C.accent,
                    marginRight: 4,
                    animation: 'aahi-pulse-dot 1s ease-in-out infinite',
                    verticalAlign: 'middle',
                  }}
                />
              )}
              {selectedExec.status}
            </span>
          </>
        )}

        <span style={s.topBarSpacer} />

        <span style={{ fontSize: 10, color: C.secondary }}>
          {runningCount} running
        </span>

        {selectedExec && (
          <>
            <button style={s.btnPrimary} onClick={handleReRun} title="Re-execute same intent">
              Re-run
            </button>
            <button style={s.btn} onClick={handleExport} title="Copy execution trace as JSON">
              {exportCopied ? 'Copied!' : 'Export'}
            </button>
          </>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* FILTER / SEARCH BAR                                            */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div style={s.filterBar}>
        <span style={s.filterLabel}>Agent:</span>
        <select
          style={s.filterSelect}
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
        >
          <option value="all">All Agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <span style={s.filterLabel}>Status:</span>
        <select
          style={s.filterSelect}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>

        <input
          style={s.searchInput}
          type="text"
          placeholder="Search steps, intents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: C.secondary }}>
          {filtered.length} execution{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* MAIN LAYOUT: Content + Side Panel                              */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div style={s.mainLayout}>
        {/* ── Content area ────────────────────────────────────────────── */}
        <div ref={contentRef} style={s.contentArea}>
          {/* Execution selector chips */}
          {filtered.length > 1 && (
            <div style={s.execList}>
              {filtered.map((exec, idx) => (
                <div
                  key={exec.planId}
                  style={idx === selectedExecIdx ? s.execChipActive : s.execChip}
                  onClick={() => {
                    setSelectedExecIdx(idx);
                    setSelectedStepId(null);
                    setExpandedRowId(null);
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: EXEC_STATUS_COLORS[exec.status] || C.secondary,
                      marginRight: 6,
                    }}
                  />
                  {truncate(exec.intent || exec.planId, 30)}
                </div>
              ))}
            </div>
          )}

          {selectedExec && (
            <>
              {/* ── Execution Timeline (swimlane) ─────────────────────── */}
              <div>
                <div style={s.sectionHeader}>Execution Timeline</div>
                <ExecutionTimeline
                  execution={selectedExec}
                  selectedStepId={selectedStepId}
                  onSelectStep={handleSelectStep}
                />
              </div>

              {/* ── Step Trace Table ───────────────────────────────────── */}
              <div>
                <div style={s.sectionHeader}>
                  Step Trace ({selectedExec.steps.length} steps)
                </div>
                <div
                  style={{
                    backgroundColor: C.panel,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ overflowX: 'auto' }}>
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={s.th}>Step Name</th>
                          <th style={s.th}>Type</th>
                          <th style={s.th}>Status</th>
                          <th style={s.th}>Duration</th>
                          <th style={s.th}>Input Summary</th>
                          <th style={s.th}>Output Summary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedExec.steps.map((step, idx) => {
                          const isExpanded = expandedRowId === step.id;
                          const isSelected = selectedStepId === step.id;
                          const isFailed = step.status === 'failed';
                          const inputSummary = formatData(
                            (step as Record<string, unknown>).input ?? '',
                          );
                          const outputSummary = formatData(step.result);

                          return (
                            <React.Fragment key={step.id || idx}>
                              <tr
                                style={{
                                  ...s.trClickable,
                                  backgroundColor: isFailed
                                    ? '#f4474710'
                                    : isSelected
                                      ? C.accent + '15'
                                      : 'transparent',
                                }}
                                onClick={() => handleSelectStep(step.id)}
                              >
                                <td style={s.td}>
                                  <span style={{ fontWeight: 500 }}>{step.name}</span>
                                </td>
                                <td style={s.td}>
                                  <span
                                    style={{
                                      ...s.statusBadge,
                                      backgroundColor:
                                        (step.type === 'llm'
                                          ? '#569cd6'
                                          : step.type === 'tool'
                                            ? C.teal
                                            : step.type === 'a2a'
                                              ? '#c586c0'
                                              : C.secondary) + '22',
                                      color:
                                        step.type === 'llm'
                                          ? '#569cd6'
                                          : step.type === 'tool'
                                            ? C.teal
                                            : step.type === 'a2a'
                                              ? '#c586c0'
                                              : C.secondary,
                                    }}
                                  >
                                    {step.type}
                                  </span>
                                </td>
                                <td style={s.td}>
                                  <StatusBadge status={step.status} />
                                </td>
                                <td style={s.td}>
                                  {step.durationMs != null ? (
                                    <span>{formatDuration(step.durationMs)}</span>
                                  ) : step.status === 'running' ? (
                                    <span
                                      style={{
                                        display: 'inline-block',
                                        width: 8,
                                        height: 8,
                                        border: `2px solid ${C.accent}44`,
                                        borderTopColor: C.accent,
                                        borderRadius: '50%',
                                        animation: 'aahi-spin 0.8s linear infinite',
                                      }}
                                    />
                                  ) : (
                                    <span style={{ color: C.secondary }}>--</span>
                                  )}
                                </td>
                                <td style={{ ...s.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <span style={{ color: C.secondary, fontSize: 10 }}>
                                    {truncate(inputSummary, 60) || '--'}
                                  </span>
                                </td>
                                <td style={{ ...s.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <span style={{ color: C.secondary, fontSize: 10 }}>
                                    {truncate(outputSummary, 60) || '--'}
                                  </span>
                                </td>
                              </tr>

                              {/* Expanded row */}
                              {isExpanded && (
                                <tr style={s.expandedRow}>
                                  <td colSpan={6} style={{ padding: 0 }}>
                                    <div style={{ padding: 12 }}>
                                      <AgentStepCard
                                        id={step.id}
                                        name={step.name}
                                        type={(step.type as StepType) || 'tool'}
                                        status={(step.status as StepStatus) || 'pending'}
                                        duration={step.durationMs}
                                        result={step.result}
                                        error={step.error}
                                        input={(step as Record<string, unknown>).input}
                                        model={
                                          (step.result as Record<string, unknown>)?.model as
                                            | string
                                            | undefined
                                        }
                                        tokenCount={
                                          (step.result as Record<string, unknown>)
                                            ?.tokenCount as number | undefined
                                        }
                                        latencyMs={step.durationMs}
                                        totalSteps={selectedExec.steps.length}
                                        stepIndex={idx}
                                      />

                                      {/* Error stack trace */}
                                      {isFailed && step.error && (
                                        <div
                                          style={{
                                            ...s.expandedCell,
                                            backgroundColor: '#f4474710',
                                            border: `1px solid ${C.error}44`,
                                            borderRadius: 4,
                                            marginTop: 8,
                                            color: C.error,
                                          }}
                                        >
                                          {step.error}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Performance Metrics Side Panel ──────────────────────────── */}
        {selectedExec && metrics && (
          <div style={s.sidePanel}>
            <div style={s.sectionHeader}>Performance Metrics</div>

            <MetricCard
              label="Total Execution Time"
              value={formatDuration(metrics.totalDurationMs)}
              sub={`${metrics.stepCount} total steps`}
            />

            <MetricCard
              label="Critical Path"
              value={formatDuration(metrics.criticalPathMs)}
              sub="Longest sequential chain"
            />

            <MetricCard
              label="Parallel Efficiency"
              value={`${Math.round(metrics.parallelEfficiency * 100)}%`}
              sub="Concurrent step utilization"
              color={
                metrics.parallelEfficiency > 0.7
                  ? C.success
                  : metrics.parallelEfficiency > 0.4
                    ? C.warning
                    : C.error
              }
            />

            {metrics.totalTokens > 0 && (
              <MetricCard
                label="Token Usage"
                value={metrics.totalTokens.toLocaleString()}
                sub="Across all LLM steps"
              />
            )}

            {metrics.mostExpensiveStep && (
              <MetricCard
                label="Most Expensive Step"
                value={formatDuration(metrics.mostExpensiveStep.durationMs)}
                sub={metrics.mostExpensiveStep.name}
                color={C.warning}
              />
            )}

            {/* Step breakdown */}
            <div style={s.metricCard}>
              <div style={s.metricLabel}>Step Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {metrics.completedCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: C.success,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: C.text }}>{metrics.completedCount} completed</span>
                  </div>
                )}
                {metrics.runningCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: C.accent,
                        flexShrink: 0,
                        animation: 'aahi-pulse-dot 1s ease-in-out infinite',
                      }}
                    />
                    <span style={{ color: C.text }}>{metrics.runningCount} running</span>
                  </div>
                )}
                {metrics.failedCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: C.error,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: C.text }}>{metrics.failedCount} failed</span>
                  </div>
                )}
                {metrics.stepCount -
                  metrics.completedCount -
                  metrics.runningCount -
                  metrics.failedCount >
                  0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: C.secondary,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: C.text }}>
                      {metrics.stepCount -
                        metrics.completedCount -
                        metrics.runningCount -
                        metrics.failedCount}{' '}
                      pending
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Execution intent */}
            <div style={s.metricCard}>
              <div style={s.metricLabel}>Intent</div>
              <div style={{ fontSize: 11, color: C.text, lineHeight: '1.4' }}>
                {selectedExec.intent || 'No intent provided'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
