#!/usr/bin/env node
/**
 * Seed branch documents and kiosk PINs.
 *
 * WHY THIS IS A SCRIPT AND NOT A CONFIG FILE
 *
 * A PIN must never exist in the repository, in a build, or in a browser. This
 * repository is public, and git history is permanent — a PIN committed once is
 * a PIN leaked forever, even if a later commit removes it. So PINs arrive here
 * as environment variables at the moment the script runs, are immediately
 * hashed with PBKDF2, and only the hash is written.
 *
 * The hash goes to `branches/{id}/secrets/kiosk`, a document firestore.rules
 * denies to every client. This script reaches it with the Admin SDK, which
 * bypasses rules — which is exactly why it runs from a terminal and not from
 * the app.
 *
 * The hashing itself is imported from the application's own lib/crypto.js, so
 * the derivation that writes a PIN and the derivation that later checks one
 * cannot drift apart.
 *
 * USAGE
 *   export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
 *   npm run seed:pins            # prompts for each PIN, input hidden
 *
 * Prompting is the default because the alternatives both leak: a PIN passed on
 * the command line lands in shell history, and a PIN written to a file is one
 * `git add -A` away from a public repository. SEED_PIN_* environment variables
 * are still honoured for unattended runs.
 *
 *   npm run seed:pins -- --dry-run     show what would change, write nothing
 *   npm run seed:pins -- --branches    (re)write the branch config documents too
 *   SEED_STAFF_PINS='{"staffId":"1234"}' npm run seed:pins -- --staff
 */
import process from 'node:process';
import readline from 'node:readline';

/* firebase-admin is imported lazily, after the dry-run exit, so `--dry-run`
   works on a machine that has not installed it — which is how you check a PIN
   before committing to touching a live database. */
import { createPinRecord } from '../src/Feature/Attendance/lib/crypto.js';
import { BRANCH_LIST, BRANCH_IDS } from '../src/Feature/Attendance/config/branches.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const withBranches = args.has('--branches');
const withStaff = args.has('--staff');

const log = (...parts) => console.log(' ', ...parts);
const fail = (message) => {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
};

/* ───────────────────────────── PIN hygiene ────────────────────────────── */

/**
 * Warn, never block. The owner knows their shop; a script does not get to
 * refuse a business decision. But a weak PIN should not pass silently.
 */
function weaknessOf(pin) {
  if (!/^\d{4,8}$/.test(pin)) return 'must be 4-8 digits';
  if (/^(\d)\1+$/.test(pin)) return 'every digit is the same — among the most-guessed PINs there are';
  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) return 'the digits run in sequence';
  if (['1234', '0000', '1111', '2580', '1212'].includes(pin)) return 'this is a top-10 most common PIN';
  return null;
}

/** Do two PINs differ only by a repeated-digit pattern? (1111 / 2222 / 3333) */
function sharePattern(pins) {
  const shapes = pins.map((pin) => (/^(\d)\1+$/.test(pin) ? 'repeated' : null));
  return shapes.filter(Boolean).length > 1;
}

/* ─────────────────────────── hidden prompt ────────────────────────────── */

/** Read a line without echoing it, so the PIN never appears on screen. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (char) => {
      /* Repaint the prompt without the typed characters. */
      if (!['\n', '\r', '\u0004'].includes(String(char))) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question);
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/* ──────────────────────────────── main ────────────────────────────────── */

console.log('\n  Optical Solution — PIN seeding');
console.log(`  ${dryRun ? 'DRY RUN — nothing will be written' : 'writing to Firestore'}\n`);

const pins = {};
for (const id of BRANCH_IDS) {
  const fromEnv = process.env[`SEED_PIN_${id.toUpperCase()}`];
  if (fromEnv) {
    pins[id] = fromEnv;
    continue;
  }
  /* Skip prompting when the run is only about branch docs or staff PINs. */
  if (withBranches && !withStaff && process.env.SEED_SKIP_PROMPT === 'true') continue;
  if (!process.stdin.isTTY) continue;
  pins[id] = await askHidden(`  ${id} kiosk PIN (leave blank to skip): `);
}

const supplied = BRANCH_IDS.filter((id) => pins[id]);
if (!supplied.length && !withBranches && !withStaff) {
  fail('No PINs supplied and nothing else to do.');
}

/* Hygiene report, before anything touches the network. */
let warned = false;
for (const id of supplied) {
  const weakness = weaknessOf(pins[id]);
  if (weakness) {
    warned = true;
    log(`⚠ ${id.padEnd(7)} ${weakness}`);
  }
}
if (sharePattern(supplied.map((id) => pins[id]))) {
  warned = true;
  log('⚠ several branches use the same shape of PIN — guessing one suggests the rest');
}
if (warned) {
  log('');
  log('  These still work. What makes them survivable is the rate limit in the');
  log('  verifyBranchPin function, and the fact that a kiosk PIN only opens the');
  log('  roster — every punch still needs a personal PIN and a GPS fix inside');
  log('  50 m. Six digits would cost nobody anything, though.');
  log('');
}

if (dryRun) {
  for (const id of supplied) log(`would write branches/${id}/secrets/kiosk`);
  if (withBranches) for (const b of BRANCH_LIST) log(`would write branches/${b.id}`);
  console.log('\n  Dry run complete — nothing written.\n');
  process.exit(0);
}

const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app').catch(
  () => fail('firebase-admin is not installed. Run: npm install'),
);
const { getFirestore } = await import('firebase-admin/firestore');

if (!getApps().length) {
  try {
    initializeApp({ credential: applicationDefault() });
  } catch {
    fail(
      'No Admin credentials. Download a service account key from\n' +
        '    Firebase console → Project settings → Service accounts, then:\n' +
        '    export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json',
    );
  }
}

const db = getFirestore();

if (withBranches) {
  for (const branch of BRANCH_LIST) {
    const { id, ...data } = branch;
    await db.collection('branches').doc(id).set(
      { ...data, active: true, updatedAt: new Date().toISOString() },
      { merge: true },
    );
    log(`✓ branches/${id}`);
  }
}

for (const id of supplied) {
  const record = await createPinRecord(pins[id]);
  await db.doc(`branches/${id}/secrets/kiosk`).set({
    ...record,
    updatedBy: 'seed-pins.mjs',
  });
  /* Never echo the PIN — this output can land in shell history or CI logs. */
  log(`✓ branches/${id}/secrets/kiosk  (PBKDF2, ${record.iterations.toLocaleString()} iterations)`);
}

if (withStaff) {
  let staffPins;
  try {
    staffPins = JSON.parse(process.env.SEED_STAFF_PINS ?? '{}');
  } catch {
    fail('SEED_STAFF_PINS is not valid JSON. Expected {"staffId":"1234", …}');
  }
  for (const [staffId, pin] of Object.entries(staffPins)) {
    const weakness = weaknessOf(pin);
    if (weakness) log(`⚠ staff ${staffId}: ${weakness}`);
    const record = await createPinRecord(pin);
    await db.doc(`staff/${staffId}/secrets/pin`).set({ ...record, updatedBy: 'seed-pins.mjs' });
    log(`✓ staff/${staffId}/secrets/pin`);
  }
}

console.log('\n  Done. The PINs themselves were never written anywhere but Firestore.\n');
process.exit(0);
