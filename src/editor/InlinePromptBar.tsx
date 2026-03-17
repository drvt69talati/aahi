import React, { useState, useEffect, useRef, useCallback } from 'react';

interface InlinePromptBarProps {
  /** Pixel coordinates where the bar should appear */
  anchorTop: number;
  anchorLeft: number;
  /** Called when the user submits a prompt */
  onSubmit: (prompt: string) => void;
  /** Called when the prompt bar should close */
  onClose: () => void;
  /** Whether AI is currently processing */
  isLoading?: boolean;
}

const styles = {
  container: {
    position: 'absolute' as const,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#252526',
    border: '1px solid #007acc',
    borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    padding: '4px 8px',
    gap: 8,
    minWidth: 360,
  },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#007acc',
    whiteSpace: 'nowrap' as const,
    padding: '2px 6px',
    backgroundColor: '#007acc22',
    borderRadius: 3,
  },
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#cccccc',
    fontSize: 13,
    fontFamily: 'inherit',
    padding: '6px 0',
    minWidth: 200,
  },
  submitBtn: {
    padding: '4px 10px',
    backgroundColor: '#007acc',
    color: '#ffffff',
    border: 'none',
    borderRadius: 3,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },
  loadingDot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#007acc',
    animation: 'aahi-pulse 1s ease-in-out infinite',
  },
  hint: {
    fontSize: 11,
    color: '#858585',
    whiteSpace: 'nowrap' as const,
  },
};

/**
 * InlinePromptBar — Cmd+K floating prompt bar anchored near the cursor.
 * Lets the user type a natural-language instruction inline in the editor.
 */
export const InlinePromptBar: React.FC<InlinePromptBarProps> = ({
  anchorTop,
  anchorLeft,
  onSubmit,
  onClose,
  isLoading = false,
}) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Inject pulse animation keyframes
  useEffect(() => {
    const styleId = 'aahi-inline-prompt-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
        e.preventDefault();
        onSubmit(value.trim());
        setValue('');
      }
    },
    [value, onSubmit, onClose]
  );

  return (
    <div
      style={{
        ...styles.container,
        top: anchorTop,
        left: anchorLeft,
      }}
    >
      <span style={styles.badge}>AI</span>
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 0' }}>
          <span style={styles.loadingDot} />
          <span style={styles.loadingDot} />
          <span style={styles.loadingDot} />
          <span style={{ color: '#858585', fontSize: 12, marginLeft: 4 }}>Processing...</span>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            style={styles.input}
            placeholder="Describe what to do..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            style={{
              ...styles.submitBtn,
              opacity: value.trim() ? 1 : 0.4,
            }}
            onClick={() => {
              if (value.trim()) {
                onSubmit(value.trim());
                setValue('');
              }
            }}
            disabled={!value.trim()}
          >
            Submit
          </button>
          <span style={styles.hint}>Esc to close</span>
        </>
      )}
    </div>
  );
};

/**
 * useInlinePrompt — hook to manage the InlinePromptBar visibility and position.
 * Listens for the 'aahi:inline-prompt' custom event dispatched by MonacoCore.
 */
export function useInlinePrompt() {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.position) {
        // Approximate pixel position from editor position
        // In a real implementation, we'd use editor.getScrolledVisiblePosition()
        setPosition({
          top: detail.position.lineNumber * 20 + 40,
          left: Math.max(detail.position.column * 8, 60),
        });
      }
      setIsOpen(true);
    };

    window.addEventListener('aahi:inline-prompt', handler);
    return () => window.removeEventListener('aahi:inline-prompt', handler);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setIsLoading(false);
  }, []);

  const submit = useCallback((prompt: string) => {
    setIsLoading(true);
    console.log('[Aahi] Inline prompt submitted:', prompt);
    // In a real implementation, this would call the AI backend
    setTimeout(() => {
      setIsLoading(false);
      setIsOpen(false);
    }, 2000);
  }, []);

  return { isOpen, position, isLoading, close, submit };
}
