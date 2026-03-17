import React, { useEffect, useRef, useCallback } from 'react';
import { runtime } from '../bridge/runtime-client';

// ── Types ────────────────────────────────────────────────────────────────

interface EditorContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  filePath: string;
  line: number;
  column: number;
  onClose: () => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  dividerAfter?: boolean;
  icon?: string;
}

// ── Styles ───────────────────────────────────────────────────────────────

const s = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  menu: {
    position: 'absolute' as const,
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
    minWidth: 240,
    padding: '4px 0',
    zIndex: 10000,
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    fontSize: 12,
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 24px 6px 12px',
    color: '#cccccc',
    cursor: 'pointer',
    border: 'none',
    backgroundColor: 'transparent',
    width: '100%',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  menuItemHover: {
    backgroundColor: '#094771',
    color: '#ffffff',
  },
  menuItemLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  menuItemShortcut: {
    color: '#858585',
    fontSize: 11,
    marginLeft: 24,
  },
  divider: {
    height: 1,
    backgroundColor: '#3e3e42',
    margin: '4px 0',
  },
  iconSpan: {
    width: 16,
    textAlign: 'center' as const,
    fontSize: 13,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDot: {
    display: 'inline-block',
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: '2px solid #007acc',
    borderTopColor: 'transparent',
    animation: 'aahi-ctx-spin 0.6s linear infinite',
  },
};

// ── Spinner keyframe injection ───────────────────────────────────────────

let spinnerInjected = false;
function injectSpinner() {
  if (spinnerInjected) return;
  spinnerInjected = true;
  const style = document.createElement('style');
  style.textContent = `@keyframes aahi-ctx-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

// ── Component ────────────────────────────────────────────────────────────

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  visible,
  x,
  y,
  selectedText,
  filePath,
  line,
  column,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [loadingAction, setLoadingAction] = React.useState<string | null>(null);

  useEffect(() => {
    injectSpinner();
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  // Adjust position so menu doesn't overflow viewport
  useEffect(() => {
    if (!visible || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      menuRef.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${y - rect.height}px`;
    }
  }, [visible, x, y]);

  const uri = `file://${filePath}`;
  const position = { line: line - 1, character: column - 1 };

  const dispatchLspAction = useCallback(
    async (method: string, params: Record<string, unknown>, resultTarget: 'chat' | 'diff') => {
      setLoadingAction(method);
      try {
        const result = await runtime.request(method, params);
        // Dispatch result to the appropriate panel
        window.dispatchEvent(
          new CustomEvent('aahi:lsp-action-result', {
            detail: { method, result, target: resultTarget, filePath },
          })
        );
      } catch (err) {
        console.error(`[EditorContextMenu] ${method} failed:`, err);
        window.dispatchEvent(
          new CustomEvent('aahi:lsp-action-result', {
            detail: {
              method,
              result: { error: err instanceof Error ? err.message : 'Request failed' },
              target: 'chat',
              filePath,
            },
          })
        );
      } finally {
        setLoadingAction(null);
        onClose();
      }
    },
    [filePath, onClose]
  );

  const menuItems: MenuItem[] = [
    {
      label: loadingAction === 'lsp.explainSymbol' ? 'Explaining...' : 'Explain Symbol',
      icon: '\u{1F4A1}',
      action: () =>
        dispatchLspAction(
          'lsp.explainSymbol',
          { uri, position, selectedText },
          'chat'
        ),
    },
    {
      label: loadingAction === 'lsp.impactAnalysis' ? 'Analyzing...' : 'Impact Analysis',
      icon: '\u{1F4CA}',
      action: () =>
        dispatchLspAction(
          'lsp.impactAnalysis',
          { uri, range: { start: position, end: position }, selectedText },
          'chat'
        ),
    },
    {
      label: loadingAction === 'lsp.generateTests' ? 'Generating...' : 'Generate Tests',
      icon: '\u{1F9EA}',
      action: () =>
        dispatchLspAction(
          'lsp.generateTests',
          { uri, range: { start: position, end: position }, selectedText },
          'diff'
        ),
    },
    {
      label: loadingAction === 'lsp.inlineRefactor' ? 'Refactoring...' : 'Inline Refactor',
      icon: '\u{1F527}',
      action: () =>
        dispatchLspAction(
          'lsp.inlineRefactor',
          { uri, range: { start: position, end: position }, instruction: '', selectedText },
          'diff'
        ),
    },
    {
      label: 'Attach to Context',
      icon: '\u{1F4CE}',
      dividerAfter: true,
      action: () =>
        dispatchLspAction(
          'lsp.contextAttach',
          { uri, position, selectedText },
          'chat'
        ),
    },
    {
      label: 'Go to Definition',
      shortcut: 'F12',
      icon: '\u{2192}',
      action: () => {
        window.dispatchEvent(
          new CustomEvent('aahi:editor-action', { detail: { action: 'editor.action.revealDefinition' } })
        );
        onClose();
      },
    },
    {
      label: 'Find References',
      shortcut: 'Shift+F12',
      icon: '\u{1F50D}',
      action: () => {
        window.dispatchEvent(
          new CustomEvent('aahi:editor-action', { detail: { action: 'editor.action.goToReferences' } })
        );
        onClose();
      },
    },
    {
      label: 'Rename Symbol',
      shortcut: 'F2',
      icon: '\u{270F}\u{FE0F}',
      dividerAfter: true,
      action: () => {
        window.dispatchEvent(
          new CustomEvent('aahi:editor-action', { detail: { action: 'editor.action.rename' } })
        );
        onClose();
      },
    },
    {
      label: 'Copy',
      shortcut: '\u{2318}C',
      action: () => {
        if (selectedText) navigator.clipboard.writeText(selectedText).catch(() => {});
        onClose();
      },
    },
    {
      label: 'Cut',
      shortcut: '\u{2318}X',
      action: () => {
        if (selectedText) navigator.clipboard.writeText(selectedText).catch(() => {});
        window.dispatchEvent(
          new CustomEvent('aahi:editor-action', { detail: { action: 'editor.action.clipboardCutAction' } })
        );
        onClose();
      },
    },
    {
      label: 'Paste',
      shortcut: '\u{2318}V',
      action: () => {
        window.dispatchEvent(
          new CustomEvent('aahi:editor-action', { detail: { action: 'editor.action.clipboardPasteAction' } })
        );
        onClose();
      },
    },
  ];

  if (!visible) return null;

  return (
    <div style={s.overlay} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={menuRef}
        style={{ ...s.menu, left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        {menuItems.map((item, idx) => (
          <React.Fragment key={idx}>
            <button
              style={{
                ...s.menuItem,
                ...(hoveredIndex === idx ? s.menuItemHover : {}),
              }}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={item.action}
              disabled={loadingAction !== null}
            >
              <span style={s.menuItemLabel}>
                {item.icon && <span style={s.iconSpan}>{item.icon}</span>}
                {item.label}
                {loadingAction && item.label.includes('...') && (
                  <span style={{ marginLeft: 6 }}>
                    <span style={s.loadingDot} />
                  </span>
                )}
              </span>
              {item.shortcut && <span style={s.menuItemShortcut}>{item.shortcut}</span>}
            </button>
            {item.dividerAfter && <div style={s.divider} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
