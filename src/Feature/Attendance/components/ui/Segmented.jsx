import { useId } from 'react';

/**
 * Segmented control used for every "pick one of a few" filter.
 *
 * The selected background is a single sliding element rather than a class on
 * the active button — one moving object instead of two cross-fading ones, which
 * is both cheaper and reads better.
 */
export default function Segmented({ options, value, onChange, size = 'md', className = '', label }) {
  const name = useId();
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const pad = size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-3.5 py-2';

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative inline-flex rounded-2xl border border-line bg-surface-sunken p-1 ${className}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 rounded-xl bg-surface-card shadow-soft transition-all duration-300 ease-expo"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(calc(${index} * 100%))`,
          left: '0.25rem',
        }}
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            name={name}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex-1 whitespace-nowrap rounded-xl font-semibold transition-colors duration-200 ${pad} ${
              active ? 'text-ink' : 'text-ink-subtle hover:text-ink-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
