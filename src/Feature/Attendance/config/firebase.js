import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
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

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

/**
 * Offline cache matters more here than in a normal web app: the kiosk tablet
 * sits on shop Wi-Fi that drops. With persistence on, a clock-in written
 * during an outage is queued locally and flushed when the link returns.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_REGION || 'asia-southeast1');

export const googleProvider = new GoogleAuthProvider();
/* Force the chooser so a shared admin laptop never silently reuses a session. */
googleProvider.setCustomParameters({ prompt: 'select_account' });

/** Admin sessions survive a refresh; the kiosk deliberately does not (see kioskSession). */
export const authReady = setPersistence(auth, browserLocalPersistence).catch(() => {});
