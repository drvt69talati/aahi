// ─────────────────────────────────────────────────────────────────────────────
// Aahi — ExecutionTimeline: Swimlane timeline visualization for agent steps.
// Pure CSS positioning — no D3 dependency.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import type { AgentExecution, AgentStepState } from '../../store/runtime-store';

export interface ExecutionTimelineProps {
  execution: AgentExecution;
  selectedStepId?: string | null;
  onSelectStep?: (stepId: string) => void;
}

// ── Theme ────────────────────────────────────────────────────────────────

const COLORS = {
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

const STATUS_BAR_COLORS: Record<string, string> = {
  completed: '#4ec9b0',
  running: '#007acc',
  failed: '#f44747',
  'waiting-approval': '#cca700',
  pending: '#858585',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function inferStartTime(step: AgentStepState, index: number, allSteps: AgentStepState[]): number {
  // If step has no explicit start, estimate from previous steps
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += allSteps[i].durationMs || 500;
  }
  return offset;
}

interface TimelineBar {
  stepId: string;
  name: string;
  type: string;
  status: string;
  startMs: number;
  durationMs: number;
  lane: number;
  error?: string;
  result?: unknown;
}

function buildTimelineBars(steps: AgentStepState[]): { bars: TimelineBar[]; totalMs: number; laneCount: number } {
  if (!steps || steps.length === 0) {
    return { bars: [], totalMs: 0, laneCount: 0 };
  }

  // Build bars with estimated timing
  const bars: TimelineBar[] = [];
  const laneEnds: number[] = []; // track when each lane becomes free

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const startMs = inferStartTime(step, i, steps);
    const durationMs = step.durationMs || (step.status === 'running' ? 2000 : 500);

    // Find the first lane where this bar fits (for parallel detection)
    let lane = 0;
    for (let l = 0; l < laneEnds.length; l++) {
      if (laneEnds[l] <= startMs) {
        lane = l;
        break;
      }
      lane = l + 1;
    }

    if (lane >= laneEnds.length) {
      laneEnds.push(0);
    }
    laneEnds[lane] = startMs + durationMs;

    bars.push({
      stepId: step.id,
      name: step.name,
      type: step.type,
      status: step.status,
      startMs,
      durationMs,
      lane,
      error: step.error,
      result: step.result,
    });
  }

  const totalMs = Math.max(...bars.map((b) => b.startMs + b.durationMs), 1);
  const laneCount = laneEnds.length;

  return { bars, totalMs, laneCount };
}

// ── Styles ───────────────────────────────────────────────────────────────

const ROW_HEIGHT = 36;
const LANE_PADDING = 4;
const LABEL_WIDTH = 120;
const TIME_AXIS_HEIGHT = 28;

const styles = {
  container: {
    backgroundColor: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    overflow: 'hidden',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: `1px solid ${COLORS.border}`,
    backgroundColor: COLORS.sidebar,
  } as React.CSSProperties,
  headerTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: COLORS.text,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  timelineArea: {
    position: 'relative' as const,
    overflowX: 'auto' as const,
    overflowY: 'hidden' as const,
  } as React.CSSProperties,
  timeAxis: {
    display: 'flex',
    alignItems: 'flex-end',
    height: TIME_AXIS_HEIGHT,
    borderBottom: `1px solid ${COLORS.border}`,
    position: 'relative' as const,
    marginLeft: LABEL_WIDTH,
  } as React.CSSProperties,
  timeTick: {
    position: 'absolute' as const,
    bottom: 4,
    fontSize: 9,
    color: COLORS.secondary,
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  tickLine: {
    position: 'absolute' as const,
    bottom: 0,
    width: 1,
    height: 8,
    backgroundColor: COLORS.border,
  } as React.CSSProperties,
  laneRow: {
    display: 'flex',
    alignItems: 'center',
    height: ROW_HEIGHT,
    borderBottom: `1px solid ${COLORS.border}22`,
    position: 'relative' as const,
  } as React.CSSProperties,
  laneLabel: {
    width: LABEL_WIDTH,
    paddingLeft: 12,
    fontSize: 11,
    color: COLORS.secondary,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  laneContent: {
    flex: 1,
    position: 'relative' as const,
    height: '100%',
  } as React.CSSProperties,
  bar: {
    position: 'absolute' as const,
    top: LANE_PADDING,
    height: ROW_HEIGHT - LANE_PADDING * 2,
    borderRadius: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    color: '#ffffff',
    fontWeight: 500,
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    paddingLeft: 6,
    paddingRight: 6,
    minWidth: 2,
    transition: 'opacity 0.15s, box-shadow 0.15s',
  } as React.CSSProperties,
  tooltip: {
    position: 'fixed' as const,
    zIndex: 9999,
    backgroundColor: '#1e1e1eee',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    padding: '8px 12px',
    fontSize: 11,
    color: COLORS.text,
    pointerEvents: 'none' as const,
    maxWidth: 300,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  } as React.CSSProperties,
  tooltipRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 3,
  } as React.CSSProperties,
  tooltipLabel: {
    color: COLORS.secondary,
    minWidth: 50,
  } as React.CSSProperties,
  emptyState: {
    padding: '24px 12px',
    textAlign: 'center' as const,
    color: COLORS.secondary,
    fontSize: 12,
  } as React.CSSProperties,
};

// ── Component ────────────────────────────────────────────────────────────

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({
  execution,
  selectedStepId,
  onSelectStep,
}) => {
  const [hoveredBar, setHoveredBar] = useState<TimelineBar | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [now, setNow] = useState(Date.now());

  // Animate running bars
  useEffect(() => {
    const hasRunning = execution.steps.some((s) => s.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [execution.steps]);

  const { bars, totalMs, laneCount } = useMemo(
    () => buildTimelineBars(execution.steps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [execution.steps, now],
  );

  // Time axis ticks
  const TIMELINE_WIDTH = 600; // px for the bar area
  const tickCount = Math.min(Math.max(Math.ceil(totalMs / 1000), 2), 20);

  const ticks = useMemo(() => {
    const result: { label: string; pct: number }[] = [];
    for (let i = 0; i <= tickCount; i++) {
      const ms = (totalMs / tickCount) * i;
      result.push({
        label: formatDuration(Math.round(ms)),
        pct: (ms / totalMs) * 100,
      });
    }
    return result;
  }, [totalMs, tickCount]);

  // Group bars by lane
  const lanes = useMemo(() => {
    const map: Record<number, TimelineBar[]> = {};
    for (const bar of bars) {
      if (!map[bar.lane]) map[bar.lane] = [];
      map[bar.lane].push(bar);
    }
    return map;
  }, [bars]);

  const handleBarMouseEnter = useCallback(
    (bar: TimelineBar, e: React.MouseEvent) => {
      setHoveredBar(bar);
      setTooltipPos({ x: e.clientX + 12, y: e.clientY - 10 });
    },
    [],
  );

  const handleBarMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX + 12, y: e.clientY - 10 });
  }, []);

  const handleBarMouseLeave = useCallback(() => {
    setHoveredBar(null);
  }, []);

  // Inject pulse animation
  useEffect(() => {
    const styleId = 'aahi-timeline-anims';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-bar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  if (bars.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>Execution Timeline</span>
        </div>
        <div style={styles.emptyState}>No steps to display</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Execution Timeline</span>
        <span style={{ fontSize: 10, color: COLORS.secondary }}>
          {bars.length} steps | {formatDuration(totalMs)} total
        </span>
      </div>

      <div style={styles.timelineArea}>
        {/* Time Axis */}
        <div style={{ ...styles.timeAxis, width: TIMELINE_WIDTH }}>
          {ticks.map((tick, i) => (
            <React.Fragment key={i}>
              <div style={{ ...styles.tickLine, left: `${tick.pct}%` }} />
              <span style={{ ...styles.timeTick, left: `${tick.pct}%` }}>{tick.label}</span>
            </React.Fragment>
          ))}
        </div>

        {/* Lanes */}
        {Array.from({ length: laneCount }, (_, laneIdx) => {
          const laneBars = lanes[laneIdx] || [];
          // Use the first bar's name as lane label
          const laneLabel = laneIdx === 0 ? execution.agentId : `Lane ${laneIdx + 1}`;

          return (
            <div key={laneIdx} style={styles.laneRow}>
              <div style={styles.laneLabel} title={laneLabel}>
                {laneLabel}
              </div>
              <div style={{ ...styles.laneContent, width: TIMELINE_WIDTH }}>
                {laneBars.map((bar) => {
                  const leftPct = (bar.startMs / totalMs) * 100;
                  const widthPct = Math.max((bar.durationMs / totalMs) * 100, 0.5);
                  const bgColor = STATUS_BAR_COLORS[bar.status] || COLORS.secondary;
                  const isSelected = selectedStepId === bar.stepId;
                  const isRunning = bar.status === 'running';

                  return (
                    <div
                      key={bar.stepId}
                      style={{
                        ...styles.bar,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        backgroundColor: bgColor,
                        opacity: isSelected ? 1 : 0.85,
                        boxShadow: isSelected
                          ? `0 0 0 2px ${COLORS.accent}, 0 2px 8px rgba(0,0,0,0.3)`
                          : '0 1px 3px rgba(0,0,0,0.2)',
                        animation: isRunning ? 'aahi-bar-pulse 1.5s ease-in-out infinite' : 'none',
                      }}
                      onClick={() => onSelectStep?.(bar.stepId)}
                      onMouseEnter={(e) => handleBarMouseEnter(bar, e)}
                      onMouseMove={handleBarMouseMove}
                      onMouseLeave={handleBarMouseLeave}
                    >
                      {widthPct > 8 && (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {bar.name}
                        </span>
                      )}
                      {widthPct > 15 && (
                        <span style={{ marginLeft: 4, opacity: 0.8, fontSize: 9 }}>
                          {formatDuration(bar.durationMs)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {hoveredBar && (
        <div style={{ ...styles.tooltip, left: tooltipPos.x, top: tooltipPos.y }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: COLORS.text }}>
            {hoveredBar.name}
          </div>
          <div style={styles.tooltipRow}>
            <span style={styles.tooltipLabel}>Type:</span>
            <span>{hoveredBar.type}</span>
          </div>
          <div style={styles.tooltipRow}>
            <span style={styles.tooltipLabel}>Status:</span>
            <span style={{ color: STATUS_BAR_COLORS[hoveredBar.status] || COLORS.secondary }}>
              {hoveredBar.status}
            </span>
          </div>
          <div style={styles.tooltipRow}>
            <span style={styles.tooltipLabel}>Duration:</span>
            <span>{formatDuration(hoveredBar.durationMs)}</span>
          </div>
          {hoveredBar.error && (
            <div style={{ marginTop: 4, color: COLORS.error, fontSize: 10 }}>
              {hoveredBar.error.slice(0, 120)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
