// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Zustand store for global toast notification management.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, default 5000
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 10000;

// Track active timers so we can clean up
const timers = new Map<string, ReturnType<typeof setTimeout>>();

let toastCounter = 0;
function nextToastId(): string {
  return `toast_${Date.now()}_${++toastCounter}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = nextToastId();
    const duration =
      toast.duration ?? (toast.type === 'error' ? ERROR_DURATION : DEFAULT_DURATION);

    const newToast: Toast = { ...toast, id, duration };

    set((s) => {
      // Keep only the most recent MAX_TOASTS - 1 to make room
      const existing = s.toasts.length >= MAX_TOASTS
        ? s.toasts.slice(s.toasts.length - MAX_TOASTS + 1)
        : s.toasts;

      // Clear timers for any removed toasts
      for (const t of s.toasts) {
        if (!existing.includes(t)) {
          const timer = timers.get(t.id);
          if (timer) {
            clearTimeout(timer);
            timers.delete(t.id);
          }
        }
      }

      return { toasts: [...existing, newToast] };
    });

    // Auto-dismiss after duration
    if (duration > 0) {
      const timer = setTimeout(() => {
        get().removeToast(id);
        timers.delete(id);
      }, duration);
      timers.set(id, timer);
    }
  },

  removeToast: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }

    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    // Clear all timers
    for (const [, timer] of timers) {
      clearTimeout(timer);
    }
    timers.clear();

    set({ toasts: [] });
  },
}));
