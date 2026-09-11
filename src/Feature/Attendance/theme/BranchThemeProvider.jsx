import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BRANCHES, isBranchId } from '../config/branches';

/**
 * Owns the two theme axes and writes them onto <html>:
 *
 *   data-branch="win" | "pwint" | "yangon" | "house"   ->  which palette
 *   class="dark"                                        ->  which mode
 *
 * Nothing else in the app touches the DOM for theming. Components just use
 * `bg-brand-600`, `text-accent-ink`, `border-line` and get the right pixels.
 *
 * `mode` is tri-state: 'light' | 'dark' | 'system'. 'system' is the default and
 * keeps tracking the OS after mount, so a shop tablet that flips to dark at
 * dusk follows without anyone touching a toggle.
 */

const ThemeContext = createContext(null);

const STORAGE_BRANCH = 'optical.attendance.branch';
const STORAGE_MODE = 'optical.attendance.mode';

/** The neutral palette used by the admin shell before a branch is chosen. */
export const HOUSE_THEME = 'house';

const readStored = (key, fallback) => {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    /* Private mode / blocked storage — theming must never be the thing that
       breaks the kiosk, so fall through to the default. */
    return fallback;
  }
};

const writeStored = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* no-op */
  }
};

const prefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function BranchThemeProvider({ children, defaultBranch = HOUSE_THEME }) {
  const [branch, setBranchState] = useState(() => {
    const stored = readStored(STORAGE_BRANCH, defaultBranch);
    return isBranchId(stored) || stored === HOUSE_THEME ? stored : defaultBranch;
  });

  const [mode, setModeState] = useState(() => {
    const stored = readStored(STORAGE_MODE, 'system');
    return ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
  });

  const [systemDark, setSystemDark] = useState(prefersDark);

  /* Keep following the OS while mode === 'system'. */
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = mode === 'system' ? systemDark : mode === 'dark';

  /* The one place the DOM is mutated for theming. */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.branch = branch;
    root.classList.toggle('dark', isDark);

    /* Paint the mobile browser chrome to match — the kiosk runs full-screen on
       a tablet and a mismatched status bar is the first thing you notice. */
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const surface = getComputedStyle(root).getPropertyValue('--surface').trim();
      if (surface) meta.setAttribute('content', `rgb(${surface})`);
    }
  }, [branch, isDark]);

  const setBranch = useCallback((next) => {
    const value = isBranchId(next) || next === HOUSE_THEME ? next : HOUSE_THEME;
    setBranchState(value);
    writeStored(STORAGE_BRANCH, value);
  }, []);

  const setMode = useCallback((next) => {
    setModeState(next);
    writeStored(STORAGE_MODE, next);
  }, []);

  const toggleMode = useCallback(() => {
    /* A toggle press is an explicit choice, so it leaves 'system' behind
       rather than flipping back to it on the next OS change. */
    setMode(isDark ? 'light' : 'dark');
  }, [isDark, setMode]);

  const value = useMemo(
    () => ({
      branch,
      branchConfig: BRANCHES[branch] ?? null,
      setBranch,
      mode,
      setMode,
      toggleMode,
      isDark,
      isHouse: branch === HOUSE_THEME,
    }),
    [branch, setBranch, mode, setMode, toggleMode, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useBranchTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useBranchTheme must be used inside <BranchThemeProvider>');
  return ctx;
}
