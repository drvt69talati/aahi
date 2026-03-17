// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Global toast notification system.
// Fixed position bottom-right, stacks up to 5, auto-dismiss, dark theme.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { useToastStore } from '../store/toast-store';
import type { Toast, ToastType } from '../store/toast-store';

// ── Theme colors by type ─────────────────────────────────────────────────

const TYPE_COLORS: Record<ToastType, string> = {
  info: '#007acc',
  success: '#4ec9b0',
  warning: '#cca700',
  error: '#f44747',
};

const TYPE_ICONS: Record<ToastType, string> = {
  info: '\u2139',      // i
  success: '\u2713',   // check
  warning: '\u26A0',   // warning triangle
  error: '\u2717',     // x
};

// ── Styles ────────────────────────────────────────────────────────────────

const styles = {
  container: {
    position: 'fixed' as const,
    bottom: 24,
    right: 24,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column-reverse' as const,
    gap: 8,
    pointerEvents: 'none' as const,
    maxWidth: 380,
  } as React.CSSProperties,

  toast: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 14px',
    backgroundColor: '#2d2d2d',
    borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'auto' as const,
    minWidth: 280,
    maxWidth: 380,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    animation: 'aahi-toast-slide-in 0.25s ease-out',
  } as React.CSSProperties,

  icon: {
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    marginTop: 1,
  } as React.CSSProperties,

  content: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,

  title: {
    fontSize: 12,
    fontWeight: 600,
    color: '#cccccc',
    lineHeight: '1.4',
  } as React.CSSProperties,

  message: {
    fontSize: 11,
    color: '#858585',
    lineHeight: '1.4',
    marginTop: 2,
  } as React.CSSProperties,

  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#858585',
    fontSize: 14,
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: '1',
    flexShrink: 0,
    marginTop: 1,
  } as React.CSSProperties,

  actionBtn: {
    marginTop: 6,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 500,
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
    color: '#ffffff',
  } as React.CSSProperties,
};

// ── Single Toast Item ─────────────────────────────────────────────────────

const ToastItem: React.FC<{ toast: Toast; onClose: (id: string) => void }> = ({
  toast,
  onClose,
}) => {
  const color = TYPE_COLORS[toast.type];
  const icon = TYPE_ICONS[toast.type];

  return (
    <div
      style={{
        ...styles.toast,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div
        style={{
          ...styles.icon,
          backgroundColor: color + '22',
          color,
        }}
      >
        {icon}
      </div>

      <div style={styles.content}>
        <div style={styles.title}>{toast.title}</div>
        {toast.message && <div style={styles.message}>{toast.message}</div>}
        {toast.action && (
          <button
            style={{ ...styles.actionBtn, backgroundColor: color }}
            onClick={() => {
              toast.action!.onClick();
              onClose(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        style={styles.closeBtn}
        onClick={() => onClose(toast.id)}
        title="Dismiss"
      >
        {'\u00D7'}
      </button>
    </div>
  );
};

// ── Toast Container ───────────────────────────────────────────────────────

export const ToastNotification: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  // Inject slide-in animation
  useEffect(() => {
    const styleId = 'aahi-toast-anims';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-toast-slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={styles.container}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
      ))}
    </div>
  );
};
