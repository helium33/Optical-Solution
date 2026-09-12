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
 * Two deliberate behaviours:
 *  - `verifyBranchPin` accepts 1234 and returns no custom token, so the
 *    preview never tries to sign in.
 *  - `submitPunch` and the WebAuthn callables report `functions/not-found`,
 *    which is exactly what an undeployed project reports. That drives the app
 *    down its real fallback paths: punches go through the client-side writer
 *    (tagged `client-unverified`, as designed) and biometrics correctly report
 *    themselves unavailable.
 */
import { STAFF, BRANCH_DOCS, buildAttendance } from './fixtures';

/* ────────────────────────────── the store ─────────────────────────────── */

const collections = {
  branches: new Map(BRANCH_DOCS.map((b) => [b.id, { ...b }])),
  staff: new Map(STAFF.map((s) => [s.id, { ...s }])),
  attendance: new Map(buildAttendance().map((row) => [row.id, { ...row }])),
  attendanceDaily: new Map(),
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

export const signOut = async () => {
  currentUser = null;
  emitAuth();
};

/* ────────────────────────── firebase/firestore ────────────────────────── */

export const getFirestore = () => ({ __preview: true });
export const initializeFirestore = () => ({ __preview: true });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});

export const collection = (db, name) => ({ __kind: 'collection', name, constraints: [] });
export const doc = (db, name, id) => ({ __kind: 'doc', name, id });

export const where = (field, op, value) => ({ type: 'where', field, op, value });
export const orderBy = (field, direction = 'asc') => ({ type: 'orderBy', field, direction });
export const documentId = () => '__name__';
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
  const data = collections[ref.name]?.get(ref.id);
  return {
    id: ref.id,
    exists: () => Boolean(data),
    data: () => (data ? { ...data } : undefined),
  };
};

export const setDoc = async (ref, data, options = {}) => {
  const target = collections[ref.name];
  if (!target) return;
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
 * Demo PINs for the preview only.
 *
 * These are NOT the shops' real PINs and must never be. The preview gets built
 * into a bundle that is published at a URL, and this repository is public — a
 * real PIN placed here would be readable by anyone who found either. Real PINs
 * live only as PBKDF2 hashes in Firestore, put there by scripts/seed-pins.mjs.
 *
 * To rehearse with the real ones on your own machine, without committing them:
 *   PREVIEW_PIN_WIN=… PREVIEW_PIN_PWINT=… npm run preview:dev
 */
const PREVIEW_PINS = JSON.parse(__PREVIEW_PINS__);

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

export const httpsCallable = (fns, name) => async (payload) => {
  await likeANetwork();
  if (name === 'verifyBranchPin') {
    const expected = PREVIEW_PINS[payload?.branchId] ?? '1234';
    return payload?.pin === expected
      ? { data: { ok: true, ttlMinutes: 840 } }   // no token -> no sign-in attempt
      : { data: { ok: false, reason: 'wrong-pin' } };
  }
  /* Everything else behaves like an undeployed project, which is what drives
     the app down the fallback paths this preview is meant to show. */
  throw notDeployed(name);
};
