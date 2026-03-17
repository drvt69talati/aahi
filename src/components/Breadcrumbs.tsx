// ─────────────────────────────────────────────────────────────────────────────
// Aahi — File breadcrumb navigation bar (like VSCode breadcrumbs above editor).
// Shows: workspace > folder > subfolder > filename, each segment clickable.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { useRuntimeStore } from '../store/runtime-store';

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontSize: 12,
    color: '#858585',
    overflow: 'hidden',
    flexShrink: 0,
    minHeight: 24,
  } as React.CSSProperties,

  segment: {
    cursor: 'pointer',
    padding: '1px 4px',
    borderRadius: 3,
    color: '#858585',
    whiteSpace: 'nowrap' as const,
    transition: 'color 0.1s, background-color 0.1s',
  } as React.CSSProperties,

  segmentHover: {
    color: '#cccccc',
    backgroundColor: '#2d2d2d',
  } as React.CSSProperties,

  segmentActive: {
    color: '#cccccc',
    fontWeight: 500,
  } as React.CSSProperties,

  separator: {
    margin: '0 2px',
    color: '#585858',
    fontSize: 10,
    flexShrink: 0,
    userSelect: 'none' as const,
  } as React.CSSProperties,

  empty: {
    color: '#585858',
    fontStyle: 'italic' as const,
    fontSize: 11,
  } as React.CSSProperties,
};

interface BreadcrumbSegment {
  label: string;
  path: string;
  isLast: boolean;
}

export const Breadcrumbs: React.FC = () => {
  const activeFilePath = useRuntimeStore((s) => s.activeFilePath);
  const workspaceRoot = useRuntimeStore((s) => s.workspaceRoot);
  const openFile = useRuntimeStore((s) => s.openFile);

  const segments: BreadcrumbSegment[] = useMemo(() => {
    if (!activeFilePath) return [];

    // Strip workspace root prefix to get relative path
    let relativePath = activeFilePath;
    if (workspaceRoot && activeFilePath.startsWith(workspaceRoot)) {
      relativePath = activeFilePath.slice(workspaceRoot.length);
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
    }

    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length === 0) return [];

    // Build segments with cumulative paths
    const result: BreadcrumbSegment[] = [];
    let cumulativePath = workspaceRoot || '';

    // Add workspace root as first segment
    const rootLabel = workspaceRoot
      ? workspaceRoot.split('/').filter(Boolean).pop() || 'workspace'
      : 'workspace';
    result.push({
      label: rootLabel,
      path: workspaceRoot || '.',
      isLast: false,
    });

    for (let i = 0; i < parts.length; i++) {
      cumulativePath = cumulativePath
        ? `${cumulativePath}/${parts[i]}`
        : parts[i];
      result.push({
        label: parts[i],
        path: cumulativePath,
        isLast: i === parts.length - 1,
      });
    }

    return result;
  }, [activeFilePath, workspaceRoot]);

  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  const handleClick = (segment: BreadcrumbSegment) => {
    if (segment.isLast) {
      // Already viewing this file
      return;
    }
    // For directories, we could navigate the file explorer.
    // For now, if it's a file path, open it.
    openFile(segment.path);
  };

  if (!activeFilePath) {
    return (
      <div style={styles.container}>
        <span style={styles.empty}>No file open</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {segments.map((seg, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <span style={styles.separator}>{'>'}</span>}
          <span
            style={{
              ...styles.segment,
              ...(seg.isLast ? styles.segmentActive : {}),
              ...(hoveredIdx === idx && !seg.isLast ? styles.segmentHover : {}),
            }}
            onClick={() => handleClick(seg)}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            title={seg.path}
          >
            {seg.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};
