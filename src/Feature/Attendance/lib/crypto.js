/**
 * PIN hashing.
 *
 * Staff PINs are short (4–6 digits), which means the entire keyspace is
 * enumerable in milliseconds against a fast hash. Two mitigations:
 *
 *   1. PBKDF2-SHA256 with a high iteration count, so each guess costs real
 *      time. 210 000 is the OWASP 2023 floor for PBKDF2-HMAC-SHA256.
 *   2. The hash is never readable by the client. Firestore rules deny reads of
 *      `staff/{id}.pin` and `branches/{id}.kioskPin` entirely; comparison
 *      happens inside a Cloud Function. Even a perfect hash is useless as a
 *      defence if the attacker can download it and grind offline.
 *
 * This module runs in both places — the browser uses it to hash a PIN the
 * admin is *setting*, the function uses it to verify one being *presented*.
 */

const PBKDF2_ITERATIONS = 210_000;
const KEY_BITS = 256;

const subtle = () => {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto unavailable — the app must be served over HTTPS or localhost.');
  }
  return cryptoObj.subtle;
};

/* ─────────────────────────── base64url helpers ────────────────────────── */

export function bytesToBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text) {
  const padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomSalt(byteLength = 16) {
  return bytesToBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));
}

/* ──────────────────────────────── PBKDF2 ──────────────────────────────── */

export async function derivePinHash(pin, salt, iterations = PBKDF2_ITERATIONS) {
  const encoder = new TextEncoder();
  const key = await subtle().importKey('raw', encoder.encode(String(pin)), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: base64UrlToBytes(salt), iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

/** Build the stored record for a new or rotated PIN. */
export async function createPinRecord(pin) {
  const salt = randomSalt();
  return {
    hash: await derivePinHash(pin, salt, PBKDF2_ITERATIONS),
    salt,
    iterations: PBKDF2_ITERATIONS,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Length-independent, branch-independent comparison.
 * `===` on secrets leaks their prefix through timing.
 */
export function timingSafeEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function verifyPin(pin, record) {
  if (!record?.hash || !record?.salt) return false;
  const candidate = await derivePinHash(pin, record.salt, record.iterations ?? PBKDF2_ITERATIONS);
  return timingSafeEqual(candidate, record.hash);
}

/** Stable per-device id, so an unfamiliar tablet shows up in the audit log. */
export function deviceFingerprint() {
  const KEY = 'optical.attendance.deviceId';
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = bytesToBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return 'unknown-device';
  }
}
