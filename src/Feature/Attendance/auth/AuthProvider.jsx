import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth';

import { auth, authReady, googleProvider, isFirebaseConfigured } from '../config/firebase';
import { ADMIN_EMAILS, isAllowlistedAdmin } from './admins';
import { ROLES } from '../config/roles';

/**
 * Admin authentication: Google OAuth, restricted to three addresses.
 *
 * The restriction is applied at three depths and it is worth being clear about
 * which one is load-bearing:
 *
 *   1. HERE, in the client — an account outside the allowlist is signed straight
 *      back out and told why. This is *user experience*. It stops a wrong-Google-
 *      account sign-in from landing on a dashboard that then fails every read.
 *   2. Firestore Rules — `request.auth.token.email in [...]`. This is the one
 *      that actually protects the data.
 *   3. A custom claim (`admin: true`) minted by a Cloud Function on first
 *      sign-in, so rules can check a claim instead of a string list.
 *
 * Deleting (1) would be a UX regression. Deleting (2) would be a breach.
 */

const AuthContext = createContext(null);

export const AUTH_STATUS = {
  LOADING: 'loading',
  ANONYMOUS: 'anonymous',
  /** An allowlisted administrator. */
  AUTHENTICATED: 'authenticated',
  /** A shop tablet holding a branch-scoped kiosk token — not an admin. */
  KIOSK: 'kiosk',
  /** Signed in with Google successfully, but not an administrator. */
  REJECTED: 'rejected',
  MISCONFIGURED: 'misconfigured',
};

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(
    isFirebaseConfigured ? AUTH_STATUS.LOADING : AUTH_STATUS.MISCONFIGURED,
  );
  const [user, setUser] = useState(null);
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState(null);
  /**
   * WHY the sign-in failed, not just what happened.
   *
   *   'rejected' — Google sign-in worked; this account is not an administrator.
   *   'failed'   — sign-in itself did not happen: provider disabled, popup
   *                blocked, bad key, no network.
   *
   * These were one undifferentiated string, so a Firebase project with the
   * Google provider switched off told the owner "Not an administrator" and
   * advised them to switch Google accounts. They would have tried every
   * account they own before finding the real cause.
   */
  const [errorKind, setErrorKind] = useState(null);
  const rejectedEmail = useRef(null);

  const fail = (message) => {
    setErrorKind('failed');
    setError(message);
  };

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;

    /* A redirect sign-in resolves here rather than in signIn(). */
    getRedirectResult(auth).catch((redirectError) => fail(toMessage(redirectError)));

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setClaims(null);
        setStatus(
          rejectedEmail.current ? AUTH_STATUS.REJECTED : AUTH_STATUS.ANONYMOUS,
        );
        return;
      }

      const token = await nextUser.getIdTokenResult().catch(() => null);

      /* A kiosk signs in with a custom token and has no email. It is a valid
         identity, just not an administrator — checking the allowlist first
         would sign the shop tablet straight back out. */
      if (token?.claims?.kiosk === true) {
        rejectedEmail.current = null;
        setErrorKind(null);
        setError(null);
        setClaims(token.claims);
        setUser(nextUser);
        setStatus(AUTH_STATUS.KIOSK);
        return;
      }

      /* A development kiosk: signed in anonymously because verifyBranchPin is
         not deployed to mint the branch-scoped custom token the check above
         looks for. It has no claims and no email, so the allowlist check below
         would call it a rejected admin and sign it out — which is precisely
         what happened: the tablet unlocked, navigated to the roster, and was
         signed out between the two. Every read then went out unauthenticated
         and Firestore refused it, so a correct ruleset still produced
         "Missing or insufficient permissions" and no amount of republishing
         could fix it.

         An anonymous session is a real identity and deliberately not an
         administrator, which is what KIOSK already means here. It carries no
         branchId, so `kioskBranchId` stays null and rules cannot scope it to
         one shop — the honest limitation of running without the Functions. */
      if (nextUser.isAnonymous) {
        rejectedEmail.current = null;
        setErrorKind(null);
        setError(null);
        setClaims(token?.claims ?? null);
        setUser(nextUser);
        setStatus(AUTH_STATUS.KIOSK);
        return;
      }

      if (!isAllowlistedAdmin(nextUser.email)) {
        rejectedEmail.current = nextUser.email;
        setErrorKind('rejected');
        setError(
          `${nextUser.email} is not an administrator account for Optical Solution.`,
        );
        /* Do not leave a half-authenticated session lying around. */
        await firebaseSignOut(auth).catch(() => {});
        return;
      }

      rejectedEmail.current = null;
      setErrorKind(null);
      setError(null);
      setClaims(token?.claims ?? null);

      if (token && token.claims.admin !== true) {
        /* Not fatal — rules may still allowlist by email — but it means the
           claim-minting function has not run, and rules that check the claim
           will deny. Worth saying out loud rather than debugging blind. */
        console.warn(
          '[auth] Signed in as an allowlisted admin, but the `admin` custom claim is missing. ' +
            'Run the setAdminClaims function, then sign out and back in.',
        );
      }

      setUser(nextUser);
      setStatus(AUTH_STATUS.AUTHENTICATED);
    });

    return unsubscribe;
  }, []);

  const signIn = useCallback(async () => {
    if (!isFirebaseConfigured) {
      fail('Firebase is not configured. Copy .env.example to .env and fill it in.');
      return;
    }
    setErrorKind(null);
    setError(null);
    rejectedEmail.current = null;
    try {
      await authReady;
      await signInWithPopup(auth, googleProvider);
    } catch (popupError) {
      const code = popupError?.code ?? '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/cancelled-popup-request'
      ) {
        /* Popups are blocked on a lot of in-app browsers; redirect always works. */
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      if (code === 'auth/popup-closed-by-user') return; // not an error worth showing
      fail(toMessage(popupError));
    }
  }, []);

  const signOut = useCallback(async () => {
    rejectedEmail.current = null;
    setErrorKind(null);
    setError(null);
    await firebaseSignOut(auth).catch(() => {});
  }, []);

  /** The normalised actor the RBAC layer consumes. */
  const principal = useMemo(() => {
    if (status !== AUTH_STATUS.AUTHENTICATED || !user) return null;
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? user.email,
      photoURL: user.photoURL ?? null,
      role: ROLES.ADMIN,
      branchId: null,
      isAdmin: true,
      claims,
    };
  }, [status, user, claims]);

  const value = useMemo(
    () => ({
      status,
      user,
      principal,
      claims,
      error,
      errorKind,
      signIn,
      signOut,
      allowlist: ADMIN_EMAILS,
      isLoading: status === AUTH_STATUS.LOADING,
      isAuthenticated: status === AUTH_STATUS.AUTHENTICATED,
      isKiosk: status === AUTH_STATUS.KIOSK,
      kioskBranchId: status === AUTH_STATUS.KIOSK ? (claims?.branchId ?? null) : null,
    }),
    [status, user, principal, claims, error, errorKind, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function toMessage(error) {
  const code = error?.code ?? '';
  if (code === 'auth/operation-not-allowed') {
    /* The single most likely cause on a fresh project, and the one that used
       to masquerade as "you used the wrong account". */
    return 'Google sign-in is not switched on for this Firebase project. Enable it in Authentication → Sign-in method → Google, then try again.';
  }
  if (code === 'auth/popup-blocked') {
    return 'The browser blocked the sign-in window. Allow pop-ups for this site, or try again — it will fall back to a redirect.';
  }
  if (code === 'auth/network-request-failed') return 'No connection. Check the network and try again.';
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not in the Firebase Auth authorised list. Add it in Authentication → Settings.';
  }
  if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid') {
    return 'The Firebase API key is wrong. Check VITE_FIREBASE_API_KEY.';
  }
  return error?.message ?? 'Sign-in failed.';
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
