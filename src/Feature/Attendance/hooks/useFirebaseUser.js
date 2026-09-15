import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '../config/firebase';

/**
 * Whether Firebase has finished restoring a session, and whose it is.
 *
 * This exists because of a failure that is invisible in every test and obvious
 * only on a shop tablet: a Firestore listener attached before the session has
 * been restored goes out UNAUTHENTICATED. Rules that require `signedIn()` then
 * refuse it, and `onSnapshot` reports `permission-denied` — which is terminal.
 * The SDK does not re-issue that listen when the token arrives a moment later,
 * so the screen keeps showing a permission error against rules that are
 * perfectly correct, and the only thing that fixes it is luck on the next load.
 *
 * It only shows up on a RELOAD. Unlocking the kiosk awaits sign-in before it
 * navigates, so the happy path never races. But the kiosk session lives in
 * localStorage and outlives the page: reopen the tablet on the roster URL and
 * the guard lets it straight through while Firebase is still reading its own
 * session out of IndexedDB.
 *
 * `ready` is false until the first auth callback, so a caller can hold its
 * subscriptions rather than spending them on a request that cannot succeed.
 * `uid` changes when the session does, which re-runs any effect that depends
 * on it — that is what re-subscribes once the identity is real.
 */
export function useFirebaseUser() {
  const [state, setState] = useState({ ready: false, uid: null, isAnonymous: false });

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) =>
        setState({
          ready: true,
          uid: user?.uid ?? null,
          isAnonymous: user?.isAnonymous ?? false,
        }),
      ),
    [],
  );

  return state;
}
