/**
 * Initials avatar. The hue is derived from the person's id so it is stable
 * across sessions and devices — a face you learn to recognise on the roster,
 * rather than a colour that changes every render.
 */

const hueFor = (seed) => {
  const text = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
};

const initialsOf = (name) =>
  String(name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export default function Avatar({ name, seed, size = 44, className = '' }) {
  const hue = hueFor(seed ?? name);
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl font-bold tracking-tight ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: `linear-gradient(145deg, hsl(${hue} 70% 62% / 0.22), hsl(${(hue + 40) % 360} 70% 52% / 0.30))`,
        color: `hsl(${hue} 65% 32%)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 50% / 0.25)`,
      }}
      aria-hidden="true"
    >
      <span className="dark:hidden">{initialsOf(name)}</span>
      <span className="hidden dark:inline" style={{ color: `hsl(${hue} 80% 82%)` }}>
        {initialsOf(name)}
      </span>
    </span>
  );
}
