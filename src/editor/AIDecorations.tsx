import React, { useState } from 'react';

type DecorationType = 'underline' | 'badge' | 'highlight';

interface DecorationRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface AIDecoration {
  id: string;
  type: DecorationType;
  range: DecorationRange;
  message: string;
  color?: string;
}

interface AIDecorationsProps {
  decorations: AIDecoration[];
  lineHeight?: number;
  charWidth?: number;
  topOffset?: number;
  leftOffset?: number;
}

const defaultColors: Record<DecorationType, string> = {
  underline: '#007acc',
  badge: '#4ec9b0',
  highlight: '#569cd644',
};

const styles = {
  container: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none' as const,
    zIndex: 5,
  },
  underline: {
    position: 'absolute' as const,
    borderBottom: '2px wavy',
    pointerEvents: 'auto' as const,
    cursor: 'pointer',
  },
  badge: {
    position: 'absolute' as const,
    fontSize: 9,
    fontWeight: 600 as const,
    padding: '0px 5px',
    borderRadius: 3,
    pointerEvents: 'auto' as const,
    cursor: 'pointer',
    lineHeight: '16px',
    whiteSpace: 'nowrap' as const,
  },
  highlight: {
    position: 'absolute' as const,
    pointerEvents: 'auto' as const,
    cursor: 'pointer',
    borderRadius: 2,
  },
  tooltip: {
    position: 'absolute' as const,
    backgroundColor: '#252526',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 11,
    color: '#cccccc',
    zIndex: 200,
    maxWidth: 300,
    lineHeight: '1.5',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    pointerEvents: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
  },
};

export const AIDecorations: React.FC<AIDecorationsProps> = ({
  decorations,
  lineHeight = 19,
  charWidth = 7.8,
  topOffset = 0,
  leftOffset = 60,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const getPosition = (range: DecorationRange) => ({
    top: topOffset + (range.startLine - 1) * lineHeight,
    left: leftOffset + (range.startColumn - 1) * charWidth,
    width: range.startLine === range.endLine
      ? (range.endColumn - range.startColumn) * charWidth
      : undefined,
    height: (range.endLine - range.startLine + 1) * lineHeight,
  });

  return (
    <div style={styles.container}>
      {decorations.map((dec) => {
        const pos = getPosition(dec.range);
        const color = dec.color || defaultColors[dec.type];
        const isHovered = hoveredId === dec.id;

        if (dec.type === 'underline') {
          return (
            <div key={dec.id}>
              <div
                style={{
                  ...styles.underline,
                  top: pos.top,
                  left: pos.left,
                  width: pos.width || 100,
                  height: lineHeight,
                  borderBottomColor: color,
                }}
                onMouseEnter={() => setHoveredId(dec.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
              {isHovered && (
                <div
                  style={{
                    ...styles.tooltip,
                    top: pos.top + lineHeight + 4,
                    left: pos.left,
                    borderLeft: `2px solid ${color}`,
                  }}
                >
                  {dec.message}
                </div>
              )}
            </div>
          );
        }

        if (dec.type === 'badge') {
          return (
            <div key={dec.id}>
              <div
                style={{
                  ...styles.badge,
                  top: pos.top + 1,
                  left: pos.left + (pos.width || 0) + 8,
                  backgroundColor: color + '22',
                  color,
                  border: `1px solid ${color}44`,
                }}
                onMouseEnter={() => setHoveredId(dec.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                AI
              </div>
              {isHovered && (
                <div
                  style={{
                    ...styles.tooltip,
                    top: pos.top + lineHeight + 4,
                    left: pos.left,
                    borderLeft: `2px solid ${color}`,
                  }}
                >
                  {dec.message}
                </div>
              )}
            </div>
          );
        }

        // highlight
        return (
          <div key={dec.id}>
            <div
              style={{
                ...styles.highlight,
                top: pos.top,
                left: pos.left,
                width: pos.width || '80%',
                height: pos.height,
                backgroundColor: color,
              }}
              onMouseEnter={() => setHoveredId(dec.id)}
              onMouseLeave={() => setHoveredId(null)}
            />
            {isHovered && (
              <div
                style={{
                  ...styles.tooltip,
                  top: pos.top + pos.height + 4,
                  left: pos.left,
                  borderLeft: `2px solid ${dec.color || '#569cd6'}`,
                }}
              >
                {dec.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
