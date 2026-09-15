import { useEffect, useState } from 'react';

/**
 * A shop's own mark, with the themed swatch as the fallback.
 *
 * The fallback is the point, not a nicety. These files are meant to be
 * replaced — a shop swapping in its real artwork should be able to drop a file
 * into `public/branches/` and reload, and a typo in the filename should leave
 * the branch picker looking plain rather than showing a broken-image icon on a
 * tablet in front of customers. `onError` catches the 404 and the coloured
 * swatch takes over.
 *
 * `key` on the image resets that error state when the branch changes, or one
 * missing file would blank the mark for every branch rendered after it.
 */
export default function BranchLogo({ branch, size = 48, className = '' }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [branch?.id]);

  const box = { width: size, height: size };

  if (!branch) return null;

  if (failed || !branch.logo) {
    return (
      <span
        data-branch={branch.theme}
        style={box}
        className={`grid shrink-0 place-items-center rounded-2xl bg-brand-600 shadow-soft ${className}`}
      >
        <span className="h-1/3 w-1/3 rounded-full bg-accent-500 ring-2 ring-brand-on/30" />
      </span>
    );
  }

  return (
    <img
      key={branch.id}
      src={branch.logo}
      alt={branch.name}
      style={box}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-2xl object-contain shadow-soft ${className}`}
    />
  );
}
