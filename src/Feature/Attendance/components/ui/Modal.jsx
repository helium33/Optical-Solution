import { useEffect, useRef } from 'react';
import { LuX } from 'react-icons/lu';

/**
 * Centred glass dialog.
 *
 * Handles the three things a hand-rolled modal usually forgets: Escape closes
 * it, focus moves inside on open and returns to the trigger on close, and the
 * page behind it cannot scroll.
 */
export default function Modal({ open, onClose, title, subtitle, children, size = 'md' }) {
  const panelRef = useRef(null);
  const restoreFocusTo = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusTo.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);

    /* Defer so the panel exists before focus moves. */
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      clearTimeout(focusTimer);
      restoreFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' }[size] ?? 'max-w-lg';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm animate-scale-in"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${width} glass-strong glass-sheen animate-fade-up rounded-t-4xl border-line/60 shadow-float outline-none sm:rounded-4xl`}
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div className="min-w-0">
            {title ? <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <LuX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
