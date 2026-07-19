import { useCallback, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Bell, CircleAlert, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';

import {
  ToastContext,
  type ToastContextValue,
  type ToastInput
} from '../hooks/useToast';

const TOAST_DURATION_MS = 3600;

export function ToastProvider({ children }: { children: ReactNode }) {
  const dismiss = useCallback((toastId: string) => {
    toast.dismiss(toastId);
  }, []);

  const notify = useCallback(
    ({
      action,
      description,
      durationMs = TOAST_DURATION_MS,
      onExpire,
      showProgress = false,
      title,
      tone = 'default'
    }: ToastInput) => {
      const id = crypto.randomUUID();
      const toneStyles =
        tone === 'success'
          ? {
              cardClassName: 'border-success-border bg-success-surface shadow-lg',
              iconClassName: 'text-success',
              progressClassName: 'bg-success',
              Icon: CheckCircle2
            }
          : tone === 'danger'
            ? {
              cardClassName: 'border-destructive/30 bg-destructive/5 shadow-lg',
                iconClassName: 'text-destructive',
                progressClassName: 'bg-destructive/85',
                Icon: CircleAlert
              }
            : {
                cardClassName: 'border-info-border bg-info-surface shadow-lg',
                iconClassName: 'text-info',
                progressClassName: 'bg-info',
                Icon: Bell
              };

      toast.custom(
        (toastId) => (
          <div
            className={[
              'relative grid min-w-[18rem] max-w-[24rem] gap-2 rounded-lg border px-3 py-3 pr-10',
              toneStyles.cardClassName
            ].join(' ')}
          >
            <Button
              aria-label="关闭通知"
              className="absolute right-2 top-2"
              size="icon-xs"
              type="button"
              variant="outline"
              onClick={() => toast.dismiss(toastId)}
            >
              <X size={14} aria-hidden="true" />
            </Button>

            <div className="flex items-start gap-2.5">
              <div
                className={[
                  'mt-0.5 grid size-5 shrink-0 place-items-center',
                  toneStyles.iconClassName
                ].join(' ')}
              >
                <toneStyles.Icon size={18} strokeWidth={2.2} aria-hidden="true" />
              </div>

              <div className="grid min-w-0 flex-1 gap-1">
                <div className="text-[15px] font-bold leading-5 tracking-[0.01em] text-foreground">
                  {title}
                </div>
                {description ? (
                  <div className="line-clamp-3 text-[12px] leading-5 text-muted-foreground">
                    {description}
                  </div>
                ) : null}
              </div>
            </div>

            {action ? (
              <div className="flex justify-end gap-2 [&_button]:h-7 [&_button]:border-border [&_button]:bg-background [&_button]:px-2.5 [&_button]:text-[12px] [&_button]:font-medium [&_button]:text-foreground [&_button]:transition-colors hover:[&_button]:bg-accent">
                {action}
              </div>
            ) : null}

            {showProgress ? (
              <div className="-mx-3 -mb-3 mt-0.5 px-3">
                <ToastCountdown
                  durationMs={durationMs}
                  indicatorClassName={toneStyles.progressClassName}
                />
              </div>
            ) : null}
          </div>
        ),
        {
          duration: durationMs,
          id,
          className: 'overflow-hidden border-0 bg-transparent p-0 shadow-none',
          onAutoClose: onExpire,
          unstyled: false
        }
      );

      return id;
    },
    []
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      dismiss,
      notify
    }),
    [dismiss, notify]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        closeButton
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              'rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
            closeButton:
              'right-2.5 top-2.5 size-6 border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
          }
        }}
      />
    </ToastContext.Provider>
  );
}

function ToastCountdown({
  durationMs,
  indicatorClassName
}: {
  durationMs: number;
  indicatorClassName?: string;
}) {
  return (
    <div className="h-1 w-full overflow-hidden bg-muted">
      <div
        className={[
          'h-full w-full origin-left animate-[neuink-toast-countdown_var(--toast-duration)_linear_forwards]',
          indicatorClassName ?? ''
        ].join(' ')}
        style={{
          '--toast-duration': `${durationMs}ms`
        } as CSSProperties}
      />
    </div>
  );
}
