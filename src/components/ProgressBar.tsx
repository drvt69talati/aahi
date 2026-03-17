// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Global progress bar (thin bar at the very top of the app).
// Supports indeterminate (animated stripe) and determinate (percentage) modes.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';

interface ProgressBarProps {
  /** Whether the bar is visible */
  active: boolean;
  /** 0-100 for determinate mode; omit or undefined for indeterminate */
  percent?: number;
  /** Bar color — defaults to #007acc */
  color?: string;
}

const ACCENT = '#007acc';
const BAR_HEIGHT = 3;

const styles = {
  container: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    zIndex: 10000,
    overflow: 'hidden',
    pointerEvents: 'none' as const,
  } as React.CSSProperties,

  barDeterminate: {
    height: '100%',
    transition: 'width 0.3s ease',
  } as React.CSSProperties,

  barIndeterminate: {
    height: '100%',
    width: '40%',
    position: 'absolute' as const,
    animation: 'aahi-progress-slide 1.4s ease-in-out infinite',
  } as React.CSSProperties,
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  active,
  percent,
  color = ACCENT,
}) => {
  // Inject animation keyframes
  useEffect(() => {
    const styleId = 'aahi-progress-anims';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-progress-slide {
          0% {
            left: -40%;
          }
          100% {
            left: 100%;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  if (!active) return null;

  const isDeterminate = percent !== undefined && percent >= 0;

  return (
    <div style={styles.container}>
      {isDeterminate ? (
        <div
          style={{
            ...styles.barDeterminate,
            width: `${Math.min(100, Math.max(0, percent))}%`,
            backgroundColor: color,
          }}
        />
      ) : (
        <div
          style={{
            ...styles.barIndeterminate,
            backgroundColor: color,
          }}
        />
      )}
    </div>
  );
};
