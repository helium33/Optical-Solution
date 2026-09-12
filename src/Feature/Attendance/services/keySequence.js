/**
 * A tiny bus for "the user entered a character".
 *
 * The secret admin sequence originally listened only for `keydown`. That works
 * at a desk and is useless on the thing this app actually runs on: tapping an
 * on-screen keypad fires pointer and click events, never a key event, so on a
 * shop tablet the sequence could not be entered at all. The four taps just went
 * into the branch PIN and came back "that is not the PIN for this branch".
 *
 * So the detector no longer listens to the keyboard directly. Both input
 * methods publish here — the window key handler and the on-screen PinPad — and
 * the detector subscribes to the bus. One source of truth for "a character was
 * entered", whichever way it arrived.
 */

const listeners = new Set();

/** Called by anything that represents a deliberate character entry. */
export function pushSequenceChar(char) {
  for (const listener of listeners) listener(char);
}

export function subscribeSequence(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
