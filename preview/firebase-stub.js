/**
 * An in-memory stand-in for the Firebase SDK, used only by the preview build
 * (aliased in vite.preview.config.js).
 *
 * The point is that the *application* code is not modified at all. Every
 * component, hook and service in the preview is the real one — they just talk
 * to this store instead of Google's. So a clock-out in the preview runs the
 * genuine `computeWorkSession` overtime calculator and writes a genuine
 * attendance document; it is the network that is fake, not the logic.
 *
 * One deliberate behaviour: every callable reports `functions/not-found`,
 * which is exactly what an undeployed project reports. The preview build sets
 * VITE_ALLOW_CLIENT_PUNCH, so the app does not call them on the punch or PIN
 * paths at all; this only matters to the biometric button and diagnostics.
 */
import { STAFF, BRANCH_DOCS, buildAttendance } from './fixtures';
import { createPinRecord } from '../src/Feature/Attendance/lib/crypto';

/**
 * Each preview employee's demo PIN: 1234 for every shop's supervisor (their
 * code ends -001), otherwise 1 followed by the number in their employee code —
 * WIN-004 is 1004.
 *
 * Distinct on purpose. The kiosk identifies a person by PIN alone and refuses
 * a PIN that matches two people, so a preview where everybody shared 1234
 * would refuse every PIN it advertised. Demo values only — real PINs never
 * appear in this repository.
 */
const previewPinFor = (staffId) => {
  const code = collections.staff?.get(staffId)?.employeeCode ?? '';
  const number = /-(\d{3})$/.exec(code)?.[1];
  if (!number) return null;
  return number === '001' ? '1234' : `1${number}`;
};
/* Real PBKDF2, derived on first use and kept, as the shop's would be. */
const previewPinRecords = new Map();

/* ────────────────────────────── the store ─────────────────────────────── */

const collections = {
  branches: new Map(BRANCH_DOCS.map((b) => [b.id, { ...b }])),
  staff: new Map(STAFF.map((s) => [s.id, { ...s }])),
  attendance: new Map(buildAttendance().map((row) => [row.id, { ...row }])),
  attendanceDaily: new Map(),
  /* Empty on purpose. The roll-ups are written by a Cloud Function that does
     not exist yet, so the preview exercises the same fall-back the live app
     takes today: derive the month from the raw attendance rows. */
  attendanceMonthly: new Map(),
  auditLogs: new Map(),
};

const watchers = new Set();

const notify = (name) => {
  for (const watcher of watchers) {
    if (watcher.name === name) watcher.fire();
  }
};

const snapshotOf = (name, constraints) => {
  const source = collections[name] ?? new Map();
  let docs = [...source.entries()].map(([id, data]) => ({ id, data }));

  for (const constraint of constraints) {
    if (constraint.type !== 'where') continue;
    const { field, op, value } = constraint;
    docs = docs.filter(({ id, data }) => {
      const actual = field === '__name__' ? id : data[field];
      if (op === '==') return actual === value;
      if (op === '!=') return actual !== value;
      if (op === 'in') return value.includes(actual);
      if (op === '>=') return actual >= value;
      if (op === '<=') return actual <= value;
      if (op === '>') return actual > value;
      if (op === '<') return actual < value;
      return true;
    });
  }

  const order = constraints.find((c) => c.type === 'orderBy');
  if (order) {
    docs.sort((a, b) => {
      const left = a.data[order.field];
      const right = b.data[order.field];
      const result = left < right ? -1 : left > right ? 1 : 0;
      return order.direction === 'desc' ? -result : result;
    });
  }

  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map(({ id, data }) => ({ id, exists: () => true, data: () => ({ ...data }) })),
  };
};

/* ───────────────────────────── firebase/app ───────────────────────────── */

export const initializeApp = (config) => ({ name: '[PREVIEW]', options: config });
export const getApps = () => [];
export const getApp = () => ({ name: '[PREVIEW]' });

/* ──────────────────────────── firebase/auth ───────────────────────────── */

/**
 * A simulated administrator session.
 *
 * Real Google OAuth cannot complete inside a sandboxed preview frame, and the
 * previous stub simply threw — which dropped the viewer on "Not an
 * administrator" with advice to switch Google accounts, for a failure that had
 * nothing to do with their account. The whole point of revealing the admin door
 * is to see what is behind it.
 *
 * So the button signs in as an allowlisted address and the real
 * AdminDashboardPage renders, against the same fixture data as everything else
 * in the preview. The "Preview" chrome above is what says this is not a real
 * session; the email has to be a real allowlisted one or the app's own
 * allowlist check would reject it, which is the behaviour being demonstrated.
 */
let currentUser = null;
const authListeners = new Set();
const emitAuth = () => {
  for (const listener of authListeners) listener(currentUser);
};

const PREVIEW_ADMIN = {
  uid: 'preview-admin',
  email: 'kyawwinhtun564@gmail.com',
  displayName: 'Preview admin',
  photoURL: null,
  isAnonymous: false,
  emailVerified: true,
  reload: async () => {},
  getIdToken: async () => 'preview-token',
  getIdTokenResult: async () => ({
    claims: { admin: true, email: 'kyawwinhtun564@gmail.com', email_verified: true },
  }),
};

export const getAuth = () => ({
  __preview: true,
  get currentUser() {
    return currentUser;
  },
});

export class GoogleAuthProvider {
  setCustomParameters() {}
}
export const browserLocalPersistence = 'local';
export const setPersistence = async () => {};

export const onAuthStateChanged = (auth, next) => {
  authListeners.add(next);
  setTimeout(() => next(currentUser), 0);
  return () => authListeners.delete(next);
};

export const getRedirectResult = async () => null;

export const signInWithPopup = async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  currentUser = PREVIEW_ADMIN;
  emitAuth();
  return { user: currentUser };
};
export const signInWithRedirect = signInWithPopup;

export const signInWithCustomToken = async () => ({ user: null });

/**
 * The kiosk signs in anonymously before reading the roster, because Firestore
 * rules deny an unauthenticated read. Here the store is open, so this only has
 * to resolve — but it must NOT overwrite `currentUser` when an admin is
 * already signed in, or opening the kiosk from the preview chrome would
 * silently sign the admin out of the dashboard behind it.
 */
export const signInAnonymously = async () => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (!currentUser) {
    currentUser = { uid: 'preview-anon', isAnonymous: true, getIdTokenResult: async () => ({ claims: {} }) };
    emitAuth();
  }
  return { user: currentUser };
};

export const signOut = async () => {
  currentUser = null;
  emitAuth();
};

/* ───────────────────────── email and password ──────────────────────────── *
 * Enough of a password provider to walk both screens: signing in as an
 * existing admin, and creating an account that is not yet confirmed.
 *
 * Accounts live in a Map for the life of the tab. Nothing is persisted, which
 * is the point — a published preview bundle must not accumulate credentials.  */

const passwordAccounts = new Map();

const asPasswordUser = (email) => ({
  uid: `preview-${email}`,
  email,
  displayName: email,
  photoURL: null,
  isAnonymous: false,
  get emailVerified() {
    return passwordAccounts.get(email)?.emailVerified === true;
  },
  /* The preview has no mailbox, so the link cannot really be clicked. Rather
     than dead-ending on the verification screen, a reload after the mail was
     "sent" confirms the address and says so in the console. The real SDK
     reports whatever Firebase actually knows. */
  reload: async () => {
    const account = passwordAccounts.get(email);
    if (account?.verificationSent && !account.emailVerified) {
      account.emailVerified = true;
      console.info(
        '[preview] No mailbox here, so the confirmation link is treated as clicked. ' +
          'Against a real Firebase project the address stays unconfirmed until it is opened.',
      );
    }
  },
  getIdToken: async () => 'preview-token',
  getIdTokenResult: async () => ({
    claims: { email, email_verified: passwordAccounts.get(email)?.emailVerified === true },
  }),
});

const authError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

export const createUserWithEmailAndPassword = async (auth, email, password) => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (passwordAccounts.has(email)) throw authError('auth/email-already-in-use');
  if (!password || password.length < 6) throw authError('auth/weak-password');
  passwordAccounts.set(email, { password, emailVerified: false, verificationSent: false });
  currentUser = asPasswordUser(email);
  emitAuth();
  return { user: currentUser };
};

export const signInWithEmailAndPassword = async (auth, email, password) => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const account = passwordAccounts.get(email);
  if (!account || account.password !== password) throw authError('auth/invalid-credential');
  currentUser = asPasswordUser(email);
  emitAuth();
  return { user: currentUser };
};

export const sendEmailVerification = async (user) => {
  const account = passwordAccounts.get(user?.email);
  if (account) account.verificationSent = true;
};

export const sendPasswordResetEmail = async (auth, email) => {
  if (!email || !email.includes('@')) throw authError('auth/invalid-email');
};

/* ────────────────────────── firebase/firestore ────────────────────────── */

export const getFirestore = () => ({ __preview: true });
export const initializeFirestore = () => ({ __preview: true });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});

export const collection = (db, name) => ({ __kind: 'collection', name, constraints: [] });

/**
 * Accepts a full path, not just `(collection, id)`.
 *
 * A staff PIN lives at `staff/{id}/secrets/pin`, five segments deep. The old
 * three-argument version dropped everything after the id, so that read
 * silently returned the STAFF document instead — the preview would have shown
 * a PIN check that could never match while the real SDK worked fine.
 */
export const doc = (db, ...segments) => {
  const parts = segments.flatMap((segment) => String(segment).split('/')).filter(Boolean);
  const id = parts.pop();
  return { __kind: 'doc', name: parts.join('/'), id };
};

/** Subcollections are created on demand, the way Firestore creates them. */
const mapFor = (name) => {
  if (!collections[name]) collections[name] = new Map();
  return collections[name];
};

export const where = (field, op, value) => ({ type: 'where', field, op, value });
export const orderBy = (field, direction = 'asc') => ({ type: 'orderBy', field, direction });
export const documentId = () => '__name__';
export const limit = (n) => ({ type: 'limit', n });
export const serverTimestamp = () => new Date().toISOString();

export const query = (ref, ...constraints) => ({
  __kind: 'query',
  name: ref.name,
  constraints: [...(ref.constraints ?? []), ...constraints],
});

export const onSnapshot = (ref, onNext, onError) => {
  const name = ref.name;
  const constraints = ref.constraints ?? [];
  const fire = () => {
    try {
      onNext(snapshotOf(name, constraints));
    } catch (error) {
      onError?.(error);
    }
  };
  const watcher = { name, fire };
  watchers.add(watcher);
  setTimeout(fire, 0);
  return () => watchers.delete(watcher);
};

export const getDocs = async (ref) => snapshotOf(ref.name, ref.constraints ?? []);

export const getDoc = async (ref) => {
  let data = collections[ref.name]?.get(ref.id);

  /* Serve each preview employee their demo PIN, so the kiosk sign-in and the
     admin PIN column can both be rehearsed. Mirrors the real split: `verifier`
     holds the PBKDF2 record the kiosk checks against, `pin` holds the PIN only
     an admin may read. A PIN set through the admin screen is a real document
     in the store and wins over this, exactly as it would in Firestore. */
  if (!data && /^staff\/.+\/secrets$/.test(ref.name)) {
    const staffId = ref.name.split('/')[1];
    const pin = previewPinFor(staffId);
    if (pin && ref.id === 'verifier') {
      if (!previewPinRecords.has(staffId)) {
        previewPinRecords.set(staffId, await createPinRecord(pin));
      }
      data = previewPinRecords.get(staffId);
    } else if (pin && ref.id === 'pin') {
      data = { pin };
    }
  }

  return {
    id: ref.id,
    exists: () => Boolean(data),
    data: () => (data ? { ...data } : undefined),
  };
};

export const setDoc = async (ref, data, options = {}) => {
  const target = mapFor(ref.name);
  const existing = options.merge ? (target.get(ref.id) ?? {}) : {};
  target.set(ref.id, { ...existing, ...data, id: ref.id });
  notify(ref.name);
};

export const updateDoc = async (ref, patch) => {
  const target = collections[ref.name];
  const existing = target?.get(ref.id);
  if (!existing) throw Object.assign(new Error('No document to update'), { code: 'not-found' });

  const next = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes('.')) {
      next[key] = value;
      continue;
    }
    /* Dotted field paths, e.g. 'overtime.approvedBy'. */
    const segments = key.split('.');
    let cursor = next;
    for (let i = 0; i < segments.length - 1; i += 1) {
      cursor[segments[i]] = { ...(cursor[segments[i]] ?? {}) };
      cursor = cursor[segments[i]];
    }
    cursor[segments[segments.length - 1]] = value;
  }
  target.set(ref.id, next);
  notify(ref.name);
};

export const deleteDoc = async (ref) => {
  collections[ref.name]?.delete(ref.id);
  notify(ref.name);
};

export const addDoc = async (ref, data) => {
  const id = `gen-${Math.random().toString(36).slice(2, 10)}`;
  collections[ref.name]?.set(id, { ...data, id });
  notify(ref.name);
  return { id };
};

/* ───────────────────────── firebase/functions ─────────────────────────── */

export const getFunctions = () => ({ __preview: true });

const notDeployed = (name) => {
  const error = new Error(`Preview: the ${name} function is not deployed.`);
  error.code = 'functions/not-found';
  return error;
};

/**
 * Callables answer after a short delay rather than instantly.
 *
 * This is not cosmetic. An instant in-memory stub resolves in a microtask —
 * before React has re-rendered — which hid a real bug where a submit effect's
 * own cleanup cancelled the request it had just started, stranding the kiosk on
 * "Unlocking…" forever against a real backend. The preview passed every time.
 *
 * A latency that resembles a network is what makes the preview able to fail the
 * way production fails.
 */
const NETWORK_LATENCY_MS = 350;

const likeANetwork = (value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), NETWORK_LATENCY_MS));

export const httpsCallable = (fns, name) => async () => {
  await likeANetwork();
  /* Every callable behaves like an undeployed project's. */
  throw notDeployed(name);
};
