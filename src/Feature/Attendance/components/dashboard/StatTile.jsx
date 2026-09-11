/**
 * Stat tile.
 *
 * Contract: label (sentence case, no colon) · value · optional caption.
 * `hero` promotes exactly one tile per view to the headline figure.
 *
 * Values use the font's proportional figures, not tabular-nums — at 48px a
 * tabular `1` carries the width of a `0` and the number looks gappy. Tabular is
 * reserved for columns that must align, which is the table below, not this.
 */
export default function StatTile({ label, value, caption, tone = 'default', hero = false, icon: Icon }) {
  const tones = {
    default: 'text-ink',
    ok: 'text-ok-ink',
    warn: 'text-warn-ink',
    danger: 'text-danger-ink',
    ot: 'text-ot-ink',
    brand: 'text-brand-ink',
  };

  return (
    <div
      className={`card card-pad relative overflow-hidden ${hero ? 'sm:col-span-2' : ''}`}
    >
      {hero ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-brand-500/10 blur-2xl"
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" /> : null}
      </div>

      <p
        className={`relative mt-3 font-bold leading-none tracking-tight ${tones[tone]} ${
          hero ? 'text-5xl' : 'text-3xl'
        }`}
      >
        {value}
      </p>

      {caption ? <p className="relative mt-2 text-xs text-ink-muted">{caption}</p> : null}
    </div>
  );
}
