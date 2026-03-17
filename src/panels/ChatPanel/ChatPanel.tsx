import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatInput } from './ChatInput';
import { useAppStore } from '../../store/app-store';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

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
  headerModel: {
    fontSize: 11,
    color: '#858585',
    backgroundColor: '#2d2d2d',
    padding: '2px 6px',
    borderRadius: 3,
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

export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const currentModel = useAppStore((s) => s.currentModel);

  // Inject blink animation
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
  }, [messages]);

  const simulateStreaming = useCallback(
    (text: string) => {
      const id = crypto.randomUUID();
      setIsStreaming(true);

      // Add empty assistant message
      setMessages((prev) => [
        ...prev,
        { id, role: 'assistant', content: '', timestamp: Date.now() },
      ]);

      // Stream character by character
      let charIndex = 0;
      const interval = setInterval(() => {
        charIndex++;
        if (charIndex <= text.length) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: text.slice(0, charIndex) } : m
            )
          );
        } else {
          clearInterval(interval);
          setIsStreaming(false);
        }
      }, 15);
    },
    []
  );

  const handleSend = useCallback(
    (text: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Simulate an AI response
      const responses: Record<string, string> = {
        default: `I understand your request. As the Aahi AI assistant, I can help with code editing, debugging, deployments, and understanding your system's runtime behavior.\n\nHere's what I can do:\n- Analyze code with \`@file\` and \`@selection\` context\n- Debug issues using \`@logs\` and \`@traces\`\n- Monitor system health via \`@metrics\`\n- Execute operations through integrated tools\n\nWhat would you like to explore?`,
      };

      setTimeout(() => {
        simulateStreaming(responses.default);
      }, 300);
    },
    [simulateStreaming]
  );

  return (
    <div style={styles.container} data-chat-panel>
      <div style={styles.header}>
        <span style={styles.headerTitle}>AI Chat</span>
        <span style={styles.headerModel}>{currentModel}</span>
      </div>

      {messages.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>⬡</div>
          <div style={styles.emptyTitle}>Aahi AI Assistant</div>
          <div style={styles.emptyHint}>
            Ask questions, get code suggestions, debug issues, or manage deployments.
            Use @ to reference context and / for commands.
          </div>
        </div>
      ) : (
        <div ref={listRef} style={styles.messageList}>
          {messages.map((msg) => (
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
              {msg.role === 'assistant' && isStreaming && msg === messages[messages.length - 1] && (
                <span style={styles.streaming} />
              )}
            </div>
          ))}
        </div>
      )}

      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
};
