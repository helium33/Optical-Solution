import { LuGlasses, LuLock } from 'react-icons/lu';

import ThemeToggle from '../ui/ThemeToggle';
import GeoStatusPill from './GeoStatusPill';
import { useNow } from '../../hooks/useNow';
import { formatClock } from '../../lib/time';

/**
 * Chrome for the kiosk screen: an aurora field tinted by the active branch, a
 * frosted header that stays put, and the live clock.
 *
 * The clock is large and always visible because it is the thing a staff member
 * checks against — a kiosk that shows a stale or hidden time is a kiosk people
 * stop trusting.
 */
export default function KioskShell({ branch, geo, onLock, children }) {
  const now = useNow(1000);

  return (
    <div className="relative min-h-dvh bg-surface bg-aurora">
      {/* Fine grain over the gradient — keeps large flat areas from banding. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <header className="sticky top-0 z-30 glass glass-sheen border-x-0 border-t-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-brand-on shadow-soft">
              <LuGlasses className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-ink">
                {branch?.name ?? 'Optical Solution'}
              </p>
              <p className="truncate text-xs font-medium text-ink-subtle">
                {branch?.city ? `${branch.city} · ` : ''}Staff attendance
              </p>
            </div>
          </div>

          <div className="order-3 w-full sm:order-none sm:w-64">
            <GeoStatusPill geo={geo} />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <time
              className="hidden text-right text-2xl font-bold leading-none tracking-tight text-ink tabular sm:block"
              dateTime={now.toISOString()}
            >
              {formatClock(now, branch?.timezone ?? 'Asia/Yangon')}
            </time>
            <ThemeToggle />
            {onLock ? (
              <button
                type="button"
                onClick={onLock}
                aria-label="Lock this kiosk"
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface-card text-ink-subtle transition-colors hover:text-danger-ink"
              >
                <LuLock className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
    </div>
  );
}
