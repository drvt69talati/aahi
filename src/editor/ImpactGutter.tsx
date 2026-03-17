import React, { useState } from 'react';

type RiskLevel = 'low' | 'medium' | 'high';

interface ImpactIndicator {
  line: number;
  riskLevel: RiskLevel;
  description: string;
  services: string[];
}

interface ImpactGutterProps {
  indicators: ImpactIndicator[];
  lineHeight?: number;
  topOffset?: number;
}

const riskColors: Record<RiskLevel, string> = {
  low: '#4ec9b0',
  medium: '#cca700',
  high: '#f44747',
};

const riskLabels: Record<RiskLevel, string> = {
  low: 'Low Impact',
  medium: 'Medium Impact',
  high: 'High Impact',
};

const styles = {
  container: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: 16,
    height: '100%',
    zIndex: 10,
    pointerEvents: 'auto' as const,
  },
  dot: {
    position: 'absolute' as const,
    left: 4,
    width: 8,
    height: 8,
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'transform 0.15s ease',
  },
  tooltip: {
    position: 'absolute' as const,
    left: 22,
    backgroundColor: '#252526',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    padding: '8px 12px',
    zIndex: 100,
    minWidth: 200,
    maxWidth: 300,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  tooltipTitle: {
    fontSize: 12,
    fontWeight: 600 as const,
    marginBottom: 4,
  },
  tooltipDesc: {
    fontSize: 11,
    color: '#cccccc',
    marginBottom: 6,
    lineHeight: '1.5',
  },
  tooltipServices: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  serviceBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    backgroundColor: '#2d2d2d',
    color: '#858585',
    border: '1px solid #3e3e42',
  },
};

export const ImpactGutter: React.FC<ImpactGutterProps> = ({
  indicators,
  lineHeight = 19,
  topOffset = 0,
}) => {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  return (
    <div style={styles.container}>
      {indicators.map((indicator) => {
        const top = topOffset + (indicator.line - 1) * lineHeight + (lineHeight - 8) / 2;
        const isHovered = hoveredLine === indicator.line;

        return (
          <div key={indicator.line}>
            <div
              style={{
                ...styles.dot,
                top,
                backgroundColor: riskColors[indicator.riskLevel],
                transform: isHovered ? 'scale(1.4)' : 'scale(1)',
                boxShadow: isHovered
                  ? `0 0 6px ${riskColors[indicator.riskLevel]}88`
                  : 'none',
              }}
              onMouseEnter={() => setHoveredLine(indicator.line)}
              onMouseLeave={() => setHoveredLine(null)}
            />
            {isHovered && (
              <div
                style={{
                  ...styles.tooltip,
                  top: top - 10,
                }}
              >
                <div style={{ ...styles.tooltipTitle, color: riskColors[indicator.riskLevel] }}>
                  {riskLabels[indicator.riskLevel]} — Line {indicator.line}
                </div>
                <div style={styles.tooltipDesc}>{indicator.description}</div>
                {indicator.services.length > 0 && (
                  <div style={styles.tooltipServices}>
                    <span style={{ fontSize: 10, color: '#858585', marginRight: 2 }}>
                      Affected:
                    </span>
                    {indicator.services.map((svc) => (
                      <span key={svc} style={styles.serviceBadge}>
                        {svc}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
