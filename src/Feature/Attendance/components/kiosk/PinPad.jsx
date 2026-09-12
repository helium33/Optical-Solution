import { useCallback, useEffect } from 'react';
import { LuDelete } from 'react-icons/lu';

import { acquirePinEntry } from '../../services/pinEntryLock';

/**
 * Numeric keypad.
 *
 * Sized for a thumb on a shop tablet, not a mouse: 64 px minimum targets, wide
 * gaps, and no hover-only affordances. A hardware keyboard still works, because
 * some branches will run this on a laptop.
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export default function PinPad({ value, onChange, length = 6, disabled = false, error = false }) {
  const press = useCallback(
    (key) => {
      if (disabled) return;
      if (key === 'back') return onChange(value.slice(0, -1));
      if (key === 'clear') return onChange('');
      if (value.length >= length) return undefined;
      return onChange(value + key);
    },
    [disabled, length, onChange, value],
  );

  /* Announce that a pad is open, so the secret admin sequence stops listening
     for digits while someone is entering a PIN. */
  useEffect(() => acquirePinEntry(), []);

  /* Physical keyboard parity. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (disabled) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('back');
      else if (event.key === 'Escape') press('clear');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, press]);

  return (
    <div>
      {/* Filled-dot readout. Deliberately not a text input — an input invites
          an on-screen keyboard to open on top of the pad. */}
      <div
        className={`mb-6 flex items-center justify-center gap-3 ${error ? 'animate-shake' : ''}`}
        role="status"
        aria-label={`${value.length} of ${length} digits entered`}
      >
        {Array.from({ length }).map((unused, index) => {
          const filled = index < value.length;
          /* Filled is SOLID, empty is HOLLOW. Two shades of the same fill
             looked identical on the navy dark theme, where brand-600 and
             line-strong are a few percent apart — and "how many digits have I
             typed?" is the one question this readout exists to answer. */
          return (
            <span
              key={index}
              className={`h-3.5 w-3.5 rounded-full border-2 transition-all duration-200 ease-spring ${
                error
                  ? 'scale-110 border-danger bg-danger'
                  : filled
                    ? 'scale-110 border-brand-ink bg-brand-ink'
                    : 'border-line-strong bg-transparent'
              }`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => {
          if (key === 'clear') {
            return (
              <button
                key={key}
                type="button"
                onClick={() => press('clear')}
                disabled={disabled}
                className="h-16 rounded-2xl text-sm font-semibold text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40 tap-none"
              >
                Clear
              </button>
            );
          }
          if (key === 'back') {
            return (
              <button
                key={key}
                type="button"
                onClick={() => press('back')}
                disabled={disabled}
                aria-label="Delete last digit"
                className="grid h-16 place-items-center rounded-2xl text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40 tap-none"
              >
                <LuDelete className="h-5 w-5" aria-hidden="true" />
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              disabled={disabled}
              className="h-16 rounded-2xl border border-line bg-surface-card text-xl font-semibold text-ink shadow-soft transition-all duration-150 hover:border-brand-500/40 hover:bg-brand-500/5 active:scale-[0.96] disabled:opacity-40 tap-none"
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
