import React, { useRef, useEffect, useCallback } from 'react';
import { ChatInput } from './ChatInput';
import { useAppStore } from '../../store/app-store';
import { useRuntimeStore } from '../../store/runtime-store';
import { ApprovalGateCard } from '../../components/ApprovalGateCard';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    borderLeft: '1px solid #3e3e42',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#252526',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#cccccc',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerModel: {
    fontSize: 11,
    color: '#858585',
    backgroundColor: '#2d2d2d',
    padding: '2px 6px',
    borderRadius: 3,
  },
  connectionDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 0',
  },
  message: {
    padding: '8px 12px',
    fontSize: 13,
    lineHeight: '1.6',
  },
  userMessage: {
    color: '#cccccc',
    backgroundColor: '#2d2d2d',
    margin: '4px 8px',
    borderRadius: 6,
  },
  assistantMessage: {
    color: '#cccccc',
    margin: '4px 8px',
  },
  roleLabel: {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 4,
  },
  codeBlock: {
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    padding: 10,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 12,
    overflowX: 'auto' as const,
    margin: '6px 0',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: 24,
    color: '#858585',
    textAlign: 'center' as const,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 12,
    color: '#4ec9b0',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#cccccc',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 12,
    lineHeight: '1.6',
    maxWidth: 260,
  },
  streaming: {
    display: 'inline-block',
    width: 2,
    height: 14,
    backgroundColor: '#007acc',
    marginLeft: 2,
    verticalAlign: 'text-bottom',
    animation: 'aahi-blink 0.8s step-end infinite',
  },
  stepCard: {
    margin: '6px 8px',
    padding: '8px 12px',
    backgroundColor: '#252526',
    border: '1px solid #3e3e42',
    borderRadius: 6,
    fontSize: 12,
  },
  stepHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  stepAgent: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    backgroundColor: '#007acc22',
    color: '#569cd6',
    border: '1px solid #007acc44',
  },
  stepName: {
    flex: 1,
    color: '#cccccc',
    fontWeight: 500 as const,
  },
  stepStatus: {
    fontSize: 10,
    fontWeight: 600 as const,
  },
  stepSpinner: {
    display: 'inline-block',
    width: 10,
    height: 10,
    border: '2px solid #cca70044',
    borderTopColor: '#cca700',
    borderRadius: '50%',
    animation: 'aahi-spin 0.8s linear infinite',
  },
  errorBanner: {
    padding: '6px 12px',
    backgroundColor: '#f4474722',
    borderBottom: '1px solid #f4474744',
    fontSize: 12,
    color: '#f44747',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
};

/** Very minimal markdown-ish rendering: code blocks and inline code */
function renderMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        parts.push(
          <pre key={`code-${i}`} style={styles.codeBlock}>
            {codeBuffer.join('\n')}
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    // Inline code
    const processed = line.split(/(`[^`]+`)/).map((seg, j) => {
      if (seg.startsWith('`') && seg.endsWith('`')) {
        return (
          <code
            key={j}
            style={{
              backgroundColor: '#2d2d2d',
              padding: '1px 4px',
              borderRadius: 3,
              fontSize: 12,
              fontFamily: "'Menlo', monospace",
            }}
          >
            {seg.slice(1, -1)}
          </code>
        );
      }
      return seg;
    });

    parts.push(
      <div key={`line-${i}`}>
        {processed}
        {i < lines.length - 1 && !inCodeBlock ? <br /> : null}
      </div>
    );
  });

  // Close unclosed code block
  if (inCodeBlock && codeBuffer.length > 0) {
    parts.push(
      <pre key="code-end" style={styles.codeBlock}>
        {codeBuffer.join('\n')}
      </pre>
    );
  }

  return <>{parts}</>;
}

const statusColors: Record<string, string> = {
  running: '#cca700',
  completed: '#4ec9b0',
  failed: '#f44747',
};

export const ChatPanel: React.FC = () => {
  const listRef = useRef<HTMLDivElement>(null);
  const currentModel = useAppStore((s) => s.currentModel);

  const chatMessages = useRuntimeStore((s) => s.chatMessages);
  const chatStreaming = useRuntimeStore((s) => s.chatStreaming);
  const sendChatMessage = useRuntimeStore((s) => s.sendChatMessage);
  const runAgent = useRuntimeStore((s) => s.runAgent);
  const agentExecutions = useRuntimeStore((s) => s.agentExecutions);
  const pendingApprovals = useRuntimeStore((s) => s.pendingApprovals);
  const respondToApproval = useRuntimeStore((s) => s.respondToApproval);
  const connected = useRuntimeStore((s) => s.connected);
  const error = useRuntimeStore((s) => s.error);

  // Inject blink + spin animations
  useEffect(() => {
    const styleId = 'aahi-chat-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes aahi-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Listen for Cmd+L to focus
  useEffect(() => {
    const handler = () => {
      listRef.current?.closest('[data-chat-panel]')?.querySelector('textarea')?.focus();
    };
    window.addEventListener('aahi:focus-chat', handler);
    return () => window.removeEventListener('aahi:focus-chat', handler);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chatMessages, agentExecutions, pendingApprovals]);

  const handleSend = useCallback(
    (text: string) => {
      // Detect /commands -> route to agent
      if (text.startsWith('/')) {
        const spaceIdx = text.indexOf(' ');
        const command = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
        const intent = spaceIdx > 0 ? text.slice(spaceIdx + 1).trim() : '';
        runAgent(command, intent);
        return;
      }

      sendChatMessage(text);
    },
    [sendChatMessage, runAgent]
  );

  const lastMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;

  return (
    <div style={styles.container} data-chat-panel>
      <div style={styles.header}>
        <span style={styles.headerTitle}>AI Chat</span>
        <div style={styles.headerRight}>
          <div
            style={{
              ...styles.connectionDot,
              backgroundColor: connected ? '#4ec9b0' : '#f44747',
            }}
            title={connected ? 'Connected' : 'Disconnected'}
          />
          <span style={styles.headerModel}>{currentModel}</span>
        </div>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          <span>Error: {error}</span>
        </div>
      )}

      {chatMessages.length === 0 && agentExecutions.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>{'\u2B21'}</div>
          <div style={styles.emptyTitle}>Aahi AI Assistant</div>
          <div style={styles.emptyHint}>
            Ask questions, get code suggestions, debug issues, or manage deployments.
            Use @ to reference context and / for commands.
          </div>
        </div>
      ) : (
        <div ref={listRef} style={styles.messageList}>
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              style={{
                ...styles.message,
                ...(msg.role === 'user' ? styles.userMessage : styles.assistantMessage),
              }}
            >
              <div
                style={{
                  ...styles.roleLabel,
                  color: msg.role === 'user' ? '#569cd6' : '#4ec9b0',
                }}
              >
                {msg.role === 'user' ? 'You' : 'Aahi'}
              </div>
              {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
              {msg.role === 'assistant' &&
                chatStreaming &&
                msg === lastMessage && <span style={styles.streaming} />}
            </div>
          ))}

          {/* Inline agent execution progress */}
          {agentExecutions.map((exec) => (
            <div key={exec.planId} style={styles.stepCard}>
              <div style={styles.stepHeader}>
                <span style={styles.stepAgent}>{exec.agentId}</span>
                <span style={styles.stepName}>{exec.intent || 'Running...'}</span>
                <span
                  style={{
                    ...styles.stepStatus,
                    color: statusColors[exec.status] || '#858585',
                  }}
                >
                  {exec.status === 'running' ? (
                    <div style={styles.stepSpinner} />
                  ) : exec.status === 'completed' ? (
                    '\u2713'
                  ) : exec.status === 'failed' ? (
                    '\u2717'
                  ) : (
                    exec.status
                  )}
                </span>
              </div>
              {exec.steps &&
                exec.steps.map((step, idx) => (
                  <div
                    key={step.id || idx}
                    style={{
                      fontSize: 11,
                      color: statusColors[step.status] || '#858585',
                      paddingLeft: 8,
                      marginTop: 2,
                    }}
                  >
                    {step.status === 'running'
                      ? '\u25CB'
                      : step.status === 'completed'
                        ? '\u2713'
                        : step.status === 'failed'
                          ? '\u2717'
                          : '\u2022'}{' '}
                    {step.name}
                    {step.error && (
                      <span style={{ color: '#f44747', marginLeft: 8 }}>{step.error}</span>
                    )}
                  </div>
                ))}
            </div>
          ))}

          {/* Inline approval gates */}
          {pendingApprovals.map((gate) => (
            <div key={gate.actionId} style={{ margin: '4px 8px' }}>
              <ApprovalGateCard
                gate={{
                  requestId: gate.actionId,
                  action: gate.actionType,
                  integration: gate.integration,
                  riskLevel: gate.riskLevel as 'low' | 'medium' | 'high' | 'critical',
                  params: gate.params,
                }}
                onApprove={() => respondToApproval(gate.actionId, true)}
                onDecline={() => respondToApproval(gate.actionId, false)}
              />
            </div>
          ))}
        </div>
      )}

      <ChatInput onSend={handleSend} disabled={chatStreaming} />
    </div>
  );
};
