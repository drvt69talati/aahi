// ─────────────────────────────────────────────────────────────────────────────
// Aahi — React Error Boundary with dark-theme fallback UI.
// Catches render errors in children, shows recovery options.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';

interface ErrorBoundaryProps {
  name: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    padding: 24,
  } as React.CSSProperties,

  card: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #f4474744',
    borderRadius: 8,
    padding: 24,
    maxWidth: 420,
    width: '100%',
    textAlign: 'center' as const,
  } as React.CSSProperties,

  icon: {
    fontSize: 32,
    color: '#f44747',
    marginBottom: 12,
  } as React.CSSProperties,

  title: {
    fontSize: 15,
    fontWeight: 600,
    color: '#cccccc',
    marginBottom: 6,
  } as React.CSSProperties,

  panelName: {
    fontSize: 12,
    color: '#858585',
    marginBottom: 12,
  } as React.CSSProperties,

  errorMessage: {
    fontSize: 11,
    color: '#f44747',
    backgroundColor: '#f4474715',
    border: '1px solid #f4474733',
    borderRadius: 4,
    padding: '8px 12px',
    marginBottom: 16,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    textAlign: 'left' as const,
    maxHeight: 120,
    overflowY: 'auto' as const,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,

  buttonRow: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
  } as React.CSSProperties,

  reloadBtn: {
    padding: '6px 16px',
    fontSize: 12,
    fontWeight: 500,
    backgroundColor: '#007acc',
    color: '#ffffff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  } as React.CSSProperties,

  copyBtn: {
    padding: '6px 16px',
    fontSize: 12,
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#cccccc',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    cursor: 'pointer',
  } as React.CSSProperties,
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    console.error(
      `[ErrorBoundary] "${this.props.name}" crashed:`,
      error,
      errorInfo.componentStack,
    );
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleCopyError = (): void => {
    const { error, errorInfo } = this.state;
    const details = [
      `Panel: ${this.props.name}`,
      `Error: ${error?.message ?? 'Unknown error'}`,
      `Stack: ${error?.stack ?? 'No stack trace'}`,
      `Component Stack: ${errorInfo?.componentStack ?? 'N/A'}`,
    ].join('\n\n');

    navigator.clipboard.writeText(details).catch(() => {
      // Fallback: nothing we can do if clipboard fails
    });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const { error } = this.state;

      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>{'\u26A0'}</div>
            <div style={styles.title}>Panel Crashed</div>
            <div style={styles.panelName}>{this.props.name}</div>

            {error && (
              <div style={styles.errorMessage}>
                {error.message || 'An unexpected error occurred'}
              </div>
            )}

            <div style={styles.buttonRow}>
              <button style={styles.reloadBtn} onClick={this.handleReload}>
                Reload Panel
              </button>
              <button style={styles.copyBtn} onClick={this.handleCopyError}>
                Copy Error
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
