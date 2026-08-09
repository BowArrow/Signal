import { useEffect } from 'react';

export interface ToastState {
  readonly message: string;
  readonly kind: 'ok' | 'warn';
}

interface ToastProps {
  readonly state: ToastState | null;
  readonly onDone: () => void;
}

export function Toast({ state, onDone }: ToastProps): React.JSX.Element | null {
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(onDone, 3200);
    return () => clearTimeout(timer);
  }, [state, onDone]);

  if (!state) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <i
        className={`ph ${state.kind === 'warn' ? 'ph-warning-circle' : 'ph-check-circle'}`}
        style={{ fontSize: 16, color: state.kind === 'warn' ? 'var(--color-warn)' : 'var(--color-accent-400)' }}
        aria-hidden="true"
      />
      <span>{state.message}</span>
    </div>
  );
}
