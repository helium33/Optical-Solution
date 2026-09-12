import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

/**
 * Firebase is initialised once and shared. Config comes from Vite env vars so
 * the same bundle can be pointed at a staging project without a rebuild —
 * see .env.example.
 *
 * None of these values are secret (they ship in the client bundle by design).
 * The security boundary is Firestore Rules + the callable Functions, never
 * this file.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

/**
 * When the env is missing, initialise against a clearly-fake project instead of
 * against `undefined`.
 *
 * This is not papering over the problem — it is choosing which failure the
 * operator gets. `getAuth()` throws synchronously on an undefined apiKey, at
 * module scope, which takes down the entire route tree and produces a blank
 * screen with `auth/invalid-api-key` buried in the console. With a placeholder
 * the app boots, every screen renders, and the UI can say in plain words that
 * the .env file is missing. A shop tablet showing an instruction is worth a
 * great deal more than a shop tablet showing nothing.
 */
const PLACEHOLDER_CONFIG = {
  apiKey: 'missing-firebase-config',
  authDomain: 'missing-firebase-config.firebaseapp.com',
  projectId: 'missing-firebase-config',
  storageBucket: 'missing-firebase-config.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
};

if (!isFirebaseConfigured) {
  console.error(
    '[firebase] No Firebase configuration found. Copy .env.example to .env, fill in the ' +
      'project values and restart. The app will render but cannot read or write any data.',
  );
}

export const app = getApps().length
  ? getApp()
  : initializeApp(isFirebaseConfigured ? firebaseConfig : PLACEHOLDER_CONFIG);

export const auth = getAuth(app);

/**
 * Offline cache matters more here than in a normal web app: the kiosk tablet
 * sits on shop Wi-Fi that drops. With persistence on, a clock-in written during
 * an outage is queued locally and flushed when the link returns.
 *
 * Persistence is unavailable in private browsing and in some embedded
 * webviews, where initializeFirestore throws. Falling back to the in-memory
 * cache keeps the app working (just without offline queuing) rather than
 * failing to start.
 */
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    console.warn(
      '[firebase] Offline persistence unavailable; falling back to the in-memory cache.',
      error?.message ?? error,
    );
    return getFirestore(app);
  }
})();

export const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_REGION || 'asia-southeast1');

export const googleProvider = new GoogleAuthProvider();
/* Force the chooser so a shared admin laptop never silently reuses a session. */
googleProvider.setCustomParameters({ prompt: 'select_account' });

/** Admin sessions survive a refresh; the kiosk deliberately does not. */
export const authReady = setPersistence(auth, browserLocalPersistence).catch(() => {});
