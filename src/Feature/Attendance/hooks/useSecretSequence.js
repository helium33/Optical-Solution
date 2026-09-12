import { useEffect, useRef } from 'react';

/**
 * Listen for a sequence of characters typed anywhere on the page.
 *
 * Used to reveal the administrator sign-in, which is otherwise absent from the
 * interface entirely.
 *
 * WHAT THIS IS: a way to keep an owner-only door off a screen that faces the
 * shop floor. Staff never need it, customers can see the tablet, and an
 * "Admin" button invites poking.
 *
 * WHAT THIS IS NOT: a security control. The sequence is in the JavaScript
 * bundle, the reveal flag is in sessionStorage, and anyone who opens devtools
 * can set it. Nothing is protected by typing 7860 — the protection is Google
 * OAuth, the three-address allowlist, and the Firestore rules behind it. This
 * hides a door; it does not lock one.
 *
 * Two behaviours that matter more than they look:
 *
 *  - It is INERT while a PIN pad is open (`enabled: false`). The kiosk keypad
 *    already listens for digits, and a staff member whose personal PIN happens
 *    to be 7860 would otherwise reveal the admin door by clocking in.
 *  - It never stores, logs or transmits anything. The buffer holds at most
 *    `sequence.length` characters, is cleared the moment it matches, and is
 *    cleared again after a pause. It is not a keylogger and must not become
 *    one: do not be tempted to "debug" it by logging the buffer.
 */
export function useSecretSequence(sequence, onMatch, { enabled = true, resetMs = 3000 } = {}) {
  const buffer = useRef('');
  const timer = useRef(null);
  /* Held in a ref so a changing callback does not re-bind the listener. */
  const handler = useRef(onMatch);
  handler.current = onMatch;

  useEffect(() => {
    if (!enabled || !sequence) return undefined;

    const onKeyDown = (event) => {
      /* Ignore anything typed into a real field — a search box, a note, a
         form. The sequence is for the bare page, not for text the user is
         deliberately entering somewhere. */
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }

      /* Single printable characters only: no modifiers, no F-keys, no Enter. */
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;

      buffer.current = (buffer.current + event.key).slice(-sequence.length);

      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        buffer.current = '';
      }, resetMs);

      if (buffer.current === sequence) {
        buffer.current = '';
        clearTimeout(timer.current);
        handler.current?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer.current);
      buffer.current = '';
    };
  }, [sequence, enabled, resetMs]);
}
