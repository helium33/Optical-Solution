import { LuMoon, LuSun } from 'react-icons/lu';
import { useBranchTheme } from '../../theme/BranchThemeProvider';

/**
 * Dark-mode switch. The knob slides and the icons cross-fade, which reads as a
 * physical object rather than a state change — worth the extra markup on a
 * control this visible.
 */
export default function ThemeToggle({ className = '' }) {
  const { isDark, toggleMode } = useBranchTheme();

  return (
    <button
      type="button"
      onClick={toggleMode}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`group relative h-9 w-16 rounded-full border border-line bg-surface-sunken transition-colors duration-300 tap-none ${className}`}
    >
      <span
        className="absolute top-1 left-1 grid h-7 w-7 place-items-center rounded-full bg-surface-card shadow-soft transition-transform duration-400 ease-expo"
        style={{ transform: isDark ? 'translateX(28px)' : 'translateX(0)' }}
      >
        <LuSun
          className={`absolute h-4 w-4 text-accent-ink transition-all duration-300 ${
            isDark ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
          }`}
          aria-hidden="true"
        />
        <LuMoon
          className={`absolute h-4 w-4 text-brand-ink transition-all duration-300 ${
            isDark ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
          }`}
          aria-hidden="true"
        />
      </span>
    </button>
  );
}
