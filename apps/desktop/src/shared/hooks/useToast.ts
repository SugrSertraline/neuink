import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export type ToastTone = 'default' | 'success' | 'danger';

export type ToastMessage = {
  action?: ReactNode;
  id: string;
  durationMs: number;
  onExpire?: () => void;
  showProgress?: boolean;
  tone: ToastTone;
  title: string;
  description?: string;
};

export type ToastInput = {
  action?: ReactNode;
  durationMs?: number;
  onExpire?: () => void;
  showProgress?: boolean;
  tone?: ToastTone;
  title: string;
  description?: string;
};

export type ToastContextValue = {
  dismiss: (toastId: string) => void;
  notify: (toast: ToastInput) => string;
};

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return context;
}
