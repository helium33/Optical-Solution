/**
 * A single indeterminate spinner for the whole app. Uses stroke-dasharray on a
 * circle rather than a spinning border so it stays crisp at any size and
 * inherits `currentColor` from whatever it is placed in.
 */
export default function Spinner({ size = 20, label = null, className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} role="status">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin text-brand-ink"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="text-sm text-ink-muted">{label}</span> : null}
      <span className="sr-only">{label ?? 'Loading'}</span>
    </div>
  );
}
