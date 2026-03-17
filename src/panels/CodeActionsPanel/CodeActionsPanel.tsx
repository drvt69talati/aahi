import React, { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────

interface ExplainResult {
  type: 'explain';
  method: string;
  filePath: string;
  explanation: string;
  relatedSymbols?: Array<{ name: string; uri: string }>;
}

interface ImpactResult {
  type: 'impact';
  method: string;
  filePath: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedFiles: string[];
  warnings: Array<{ message: string; severity: 'info' | 'warning' | 'error' }>;
  suggestedTests: string[];
}

interface TestResult {
  type: 'tests';
  method: string;
  filePath: string;
  testCode: string;
  testFile: string;
  framework: string;
}

interface RefactorResult {
  type: 'refactor';
  method: string;
  filePath: string;
  preview: string;
  explanation: string;
  original?: string;
}

interface ErrorResult {
  type: 'error';
  method: string;
  filePath: string;
  error: string;
}

type ActionResult = ExplainResult | ImpactResult | TestResult | RefactorResult | ErrorResult;

// ── Styles ───────────────────────────────────────────────────────────────

const s = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 600 as const,
    color: '#cccccc',
  },
  clearBtn: {
    marginLeft: 'auto',
    padding: '2px 8px',
    fontSize: 11,
    border: '1px solid #3e3e42',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
    color: '#858585',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: 12,
  },
  resultCard: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    marginBottom: 12,
    overflow: 'hidden' as const,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#252526',
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: 600 as const,
    color: '#cccccc',
  },
  cardFilePath: {
    fontSize: 11,
    color: '#858585',
    marginLeft: 'auto',
  },
  cardBody: {
    padding: 12,
  },
  // Explain
  explanation: {
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const,
    color: '#cccccc',
    fontSize: 12,
  },
  // Impact
  riskBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600 as const,
  },
  affectedList: {
    listStyle: 'none',
    padding: 0,
    margin: '8px 0',
  },
  affectedItem: {
    padding: '3px 0',
    color: '#cccccc',
    fontSize: 12,
  },
  warningItem: {
    padding: '4px 8px',
    margin: '4px 0',
    borderRadius: 3,
    fontSize: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600 as const,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  // Tests
  codeBlock: {
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    padding: 12,
    overflow: 'auto' as const,
    whiteSpace: 'pre' as const,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#d4d4d4',
    maxHeight: 300,
  },
  codeActions: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  },
  insertBtn: {
    padding: '4px 12px',
    fontSize: 11,
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: '#4ec9b0',
    color: '#1e1e1e',
    fontWeight: 600 as const,
  },
  copyBtn: {
    padding: '4px 12px',
    fontSize: 11,
    border: '1px solid #3e3e42',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
    color: '#cccccc',
  },
  applyBtn: {
    padding: '4px 12px',
    fontSize: 11,
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: '#007acc',
    color: '#ffffff',
    fontWeight: 600 as const,
  },
  modifyBtn: {
    padding: '4px 12px',
    fontSize: 11,
    border: '1px solid #007acc',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
    color: '#007acc',
  },
  // Refactor diff
  diffLine: {
    display: 'flex',
    minHeight: 20,
    lineHeight: '20px',
    fontFamily: "'Menlo', monospace",
    fontSize: 12,
  },
  diffPrefix: {
    width: 20,
    minWidth: 20,
    textAlign: 'center' as const,
    color: '#858585',
    userSelect: 'none' as const,
  },
  diffContent: {
    flex: 1,
    whiteSpace: 'pre' as const,
    padding: '0 4px',
  },
  // Error
  errorText: {
    color: '#f44747',
    padding: 12,
    fontSize: 12,
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#858585',
    fontSize: 13,
  },
};

const riskColors: Record<string, { bg: string; color: string }> = {
  low: { bg: '#2ea04333', color: '#4ec9b0' },
  medium: { bg: '#dcdcaa33', color: '#dcdcaa' },
  high: { bg: '#f4474733', color: '#f44747' },
  critical: { bg: '#f4474766', color: '#f44747' },
};

const warningSeverityColors: Record<string, { bg: string; border: string }> = {
  info: { bg: '#007acc22', border: '#007acc' },
  warning: { bg: '#dcdcaa22', border: '#dcdcaa' },
  error: { bg: '#f4474722', border: '#f44747' },
};

// ── Subcomponents ────────────────────────────────────────────────────────

const ExplainCard: React.FC<{ result: ExplainResult }> = ({ result }) => (
  <div style={s.resultCard}>
    <div style={s.cardHeader}>
      <span style={s.cardTitle}>Explanation</span>
      <span style={s.cardFilePath as React.CSSProperties}>{result.filePath.split('/').pop()}</span>
    </div>
    <div style={s.cardBody}>
      <div style={s.explanation}>{result.explanation}</div>
      {result.relatedSymbols && result.relatedSymbols.length > 0 && (
        <>
          <div style={s.sectionLabel}>Related Symbols</div>
          <ul style={s.affectedList}>
            {result.relatedSymbols.map((sym, i) => (
              <li key={i} style={s.affectedItem}>
                <span style={{ color: '#4ec9b0' }}>{sym.name}</span>
                <span style={{ color: '#858585', marginLeft: 8 }}>{sym.uri}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  </div>
);

const ImpactCard: React.FC<{ result: ImpactResult }> = ({ result }) => {
  const risk = riskColors[result.riskLevel] ?? riskColors.low;
  return (
    <div style={s.resultCard}>
      <div style={s.cardHeader}>
        <span style={s.cardTitle}>Impact Analysis</span>
        <span
          style={{
            ...s.riskBadge,
            backgroundColor: risk.bg,
            color: risk.color,
            border: `1px solid ${risk.color}`,
          }}
        >
          {result.riskLevel.toUpperCase()}
        </span>
        <span style={s.cardFilePath as React.CSSProperties}>{result.filePath.split('/').pop()}</span>
      </div>
      <div style={s.cardBody}>
        {result.affectedFiles.length > 0 && (
          <>
            <div style={s.sectionLabel}>Affected Files</div>
            <ul style={s.affectedList}>
              {result.affectedFiles.map((f, i) => (
                <li key={i} style={s.affectedItem}>
                  {f}
                </li>
              ))}
            </ul>
          </>
        )}
        {result.warnings.length > 0 && (
          <>
            <div style={s.sectionLabel}>Warnings</div>
            {result.warnings.map((w, i) => {
              const wc = warningSeverityColors[w.severity] ?? warningSeverityColors.info;
              return (
                <div
                  key={i}
                  style={{
                    ...s.warningItem,
                    backgroundColor: wc.bg,
                    borderLeft: `3px solid ${wc.border}`,
                  }}
                >
                  {w.message}
                </div>
              );
            })}
          </>
        )}
        {result.suggestedTests.length > 0 && (
          <>
            <div style={s.sectionLabel}>Suggested Tests</div>
            <ul style={s.affectedList}>
              {result.suggestedTests.map((t, i) => (
                <li key={i} style={s.affectedItem}>
                  <span style={{ color: '#569cd6' }}>{t}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};

const TestCard: React.FC<{ result: TestResult }> = ({ result }) => {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(result.testCode).catch(() => {});
  }, [result.testCode]);

  const handleInsert = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('aahi:insert-code', {
        detail: { code: result.testCode, filePath: result.testFile },
      })
    );
  }, [result.testCode, result.testFile]);

  return (
    <div style={s.resultCard}>
      <div style={s.cardHeader}>
        <span style={s.cardTitle}>Generated Tests</span>
        <span style={{ fontSize: 11, color: '#4ec9b0' }}>{result.framework}</span>
        <span style={s.cardFilePath as React.CSSProperties}>{result.testFile.split('/').pop()}</span>
      </div>
      <div style={s.cardBody}>
        <div style={s.codeBlock}>{result.testCode}</div>
        <div style={s.codeActions}>
          <button style={s.insertBtn} onClick={handleInsert}>
            Insert into file
          </button>
          <button style={s.copyBtn} onClick={handleCopy}>
            Copy
          </button>
        </div>
      </div>
    </div>
  );
};

const RefactorCard: React.FC<{ result: RefactorResult }> = ({ result }) => {
  const handleApply = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('aahi:apply-refactor', {
        detail: { preview: result.preview, filePath: result.filePath },
      })
    );
  }, [result.preview, result.filePath]);

  const handleModify = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('aahi:modify-refactor', {
        detail: { preview: result.preview, filePath: result.filePath },
      })
    );
  }, [result.preview, result.filePath]);

  // Simple before/after rendering
  const previewLines = result.preview.split('\n');
  const originalLines = (result.original ?? '').split('\n');

  return (
    <div style={s.resultCard}>
      <div style={s.cardHeader}>
        <span style={s.cardTitle}>Refactor Preview</span>
        <span style={s.cardFilePath as React.CSSProperties}>{result.filePath.split('/').pop()}</span>
      </div>
      <div style={s.cardBody}>
        <div style={s.sectionLabel}>Explanation</div>
        <div style={{ ...s.explanation, marginBottom: 12 }}>{result.explanation}</div>

        {result.original && (
          <>
            <div style={s.sectionLabel}>Before</div>
            <div style={{ ...s.codeBlock, marginBottom: 8, maxHeight: 150 }}>
              {originalLines.map((line, i) => (
                <div key={i} style={{ ...s.diffLine, backgroundColor: '#f4474711' }}>
                  <div style={s.diffPrefix}>-</div>
                  <div style={s.diffContent}>{line}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={s.sectionLabel}>After</div>
        <div style={{ ...s.codeBlock, marginBottom: 8, maxHeight: 150 }}>
          {previewLines.map((line, i) => (
            <div key={i} style={{ ...s.diffLine, backgroundColor: '#2ea04311' }}>
              <div style={s.diffPrefix}>+</div>
              <div style={s.diffContent}>{line}</div>
            </div>
          ))}
        </div>

        <div style={s.codeActions}>
          <button style={s.applyBtn} onClick={handleApply}>
            Apply
          </button>
          <button style={s.modifyBtn} onClick={handleModify}>
            Modify and Apply
          </button>
        </div>
      </div>
    </div>
  );
};

const ErrorCard: React.FC<{ result: ErrorResult }> = ({ result }) => (
  <div style={s.resultCard}>
    <div style={s.cardHeader}>
      <span style={s.cardTitle}>Error</span>
      <span style={s.cardFilePath as React.CSSProperties}>{result.method}</span>
    </div>
    <div style={s.errorText}>{result.error}</div>
  </div>
);

// ── Main Component ───────────────────────────────────────────────────────

export const CodeActionsPanel: React.FC = () => {
  const [results, setResults] = useState<ActionResult[]>([]);

  // Listen for LSP action results
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      const { method, result, filePath } = detail;

      let actionResult: ActionResult;

      if (result?.error) {
        actionResult = {
          type: 'error',
          method,
          filePath: filePath ?? '',
          error: result.error,
        };
      } else if (method === 'lsp.explainSymbol') {
        actionResult = {
          type: 'explain',
          method,
          filePath: filePath ?? '',
          explanation: result?.explanation ?? 'No explanation available.',
          relatedSymbols: result?.relatedSymbols,
        };
      } else if (method === 'lsp.impactAnalysis') {
        actionResult = {
          type: 'impact',
          method,
          filePath: filePath ?? '',
          riskLevel: result?.riskLevel ?? 'low',
          affectedFiles: result?.affectedFiles ?? [],
          warnings: result?.warnings ?? [],
          suggestedTests: result?.suggestedTests ?? [],
        };
      } else if (method === 'lsp.generateTests') {
        actionResult = {
          type: 'tests',
          method,
          filePath: filePath ?? '',
          testCode: result?.testCode ?? '',
          testFile: result?.testFile ?? '',
          framework: result?.framework ?? 'unknown',
        };
      } else if (method === 'lsp.inlineRefactor') {
        actionResult = {
          type: 'refactor',
          method,
          filePath: filePath ?? '',
          preview: result?.preview ?? '',
          explanation: result?.explanation ?? '',
          original: result?.original,
        };
      } else {
        // Generic/unknown result, show as explanation
        actionResult = {
          type: 'explain',
          method,
          filePath: filePath ?? '',
          explanation: JSON.stringify(result, null, 2),
        };
      }

      setResults((prev) => [actionResult, ...prev]);
    };

    window.addEventListener('aahi:lsp-action-result', handler);
    return () => window.removeEventListener('aahi:lsp-action-result', handler);
  }, []);

  const handleClear = useCallback(() => {
    setResults([]);
  }, []);

  if (results.length === 0) {
    return (
      <div style={s.container}>
        <div style={s.emptyState}>
          No code action results yet. Right-click in the editor to use AI-powered actions.
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.headerTitle}>Code Actions</span>
        <span style={{ fontSize: 11, color: '#858585' }}>
          {results.length} result{results.length !== 1 ? 's' : ''}
        </span>
        <button style={s.clearBtn} onClick={handleClear}>
          Clear
        </button>
      </div>
      <div style={s.body}>
        {results.map((result, idx) => {
          switch (result.type) {
            case 'explain':
              return <ExplainCard key={idx} result={result} />;
            case 'impact':
              return <ImpactCard key={idx} result={result} />;
            case 'tests':
              return <TestCard key={idx} result={result} />;
            case 'refactor':
              return <RefactorCard key={idx} result={result} />;
            case 'error':
              return <ErrorCard key={idx} result={result} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
};
