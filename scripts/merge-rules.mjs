#!/usr/bin/env node
/**
 * Merge the attendance rules into the Firebase project's existing ruleset.
 *
 * WHY THIS EXISTS
 *
 * `firebase deploy --only firestore:rules` REPLACES the entire ruleset for the
 * project. This attendance app shares Firebase project `ecommerce-f2834` with
 * the storefront, so deploying `firestore.rules` as-is would delete whatever
 * rules the storefront depends on. The documented alternative — "merge the
 * blocks by hand" — is how people end up with no rules deployed at all and a
 * kiosk that says "Missing or insufficient permissions", which is exactly
 * where this project got stuck.
 *
 * So: do the merge mechanically, and refuse to produce a file that is wrong.
 *
 * USAGE
 *
 *   1. Firebase Console -> Firestore Database -> Rules.
 *      Copy everything you see into `firestore.rules.existing`.
 *
 *   2. npm run merge:rules              # development rules (no Functions yet)
 *      npm run merge:rules -- --prod    # once the Cloud Functions are deployed
 *
 *   3. Read `firestore.rules.merged`, then deploy it:
 *      npm run firebase -- deploy --only firestore:rules
 *      (point firebase.json's firestore.rules at the merged file first)
 *
 * WHAT IT GUARANTEES
 *
 *   - Your existing blocks are copied through untouched.
 *   - Helper functions are renamed if their names collide with yours, rather
 *     than silently redefining `isAdmin()` for the storefront as well.
 *   - It refuses to write anything it cannot parse with confidence.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import process from 'node:process';

const EXISTING = 'firestore.rules.existing';
const OUTPUT = 'firestore.rules.merged';
const prod = process.argv.includes('--prod');
const SOURCE = prod ? 'firestore.rules' : 'firestore.rules.development';

const die = (...lines) => {
  console.error('');
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
};

const say = (...lines) => {
  for (const line of lines) console.log(`  ${line}`);
};

/* ── locate the documents block ──────────────────────────────────────────── */

/**
 * Find `match /databases/{database}/documents { ... }` and return its body.
 *
 * Brace counting rather than a regex, because the body is full of nested
 * `match` blocks and a non-greedy regex stops at the first `}` it meets.
 * String literals are skipped so an email address containing a brace — or a
 * comment — cannot throw the count off.
 */
function documentsBody(text, label) {
  const header = /match\s*\/databases\/\{[A-Za-z_][A-Za-z0-9_]*\}\/documents\s*\{/.exec(text);
  if (!header) {
    die(
      `${label} has no "match /databases/{database}/documents { ... }" block.`,
      '',
      'If you pasted only the inner rules, wrap them in the standard header:',
      '',
      "    rules_version = '2';",
      '    service cloud.firestore {',
      '      match /databases/{database}/documents {',
      '        ...your rules...',
      '      }',
      '    }',
    );
  }

  const open = header.index + header[0].length;
  let depth = 1;
  let i = open;
  let quote = null;

  while (i < text.length && depth > 0) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && next === '/') {
      i = text.indexOf('\n', i);
      if (i === -1) i = text.length;
      continue;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    } else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;

    i += 1;
  }

  if (depth !== 0) die(`${label} has unbalanced braces — it is not a complete ruleset.`);

  return { body: text.slice(open, i - 1), closeAt: i - 1, headerEnd: open };
}

/** Top-level `function name(...)` declarations inside a rules body. */
const functionNames = (body) =>
  [...body.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);

/** Top-level collection names a body matches, for the collision report. */
const collectionNames = (body) =>
  [...body.matchAll(/\bmatch\s+\/([A-Za-z_][A-Za-z0-9_]*)\//g)].map((m) => m[1]);

/* ── run ─────────────────────────────────────────────────────────────────── */

console.log('');

if (!existsSync(EXISTING)) {
  die(
    `${EXISTING} not found.`,
    '',
    'Open the Firebase Console -> Firestore Database -> Rules, copy everything',
    `in the editor, and save it as ${EXISTING} in this folder.`,
    '',
    'That file is gitignored — it is your project\'s configuration, not this',
    'repository\'s.',
    '',
    'If the console shows only the default "allow read, write: if false" and the',
    'storefront does not use Firestore at all, you do not need to merge:',
    `point firebase.json at ${SOURCE} and deploy that directly.`,
  );
}

const existingText = readFileSync(EXISTING, 'utf8');
const sourceText = readFileSync(SOURCE, 'utf8');

const mine = documentsBody(sourceText, SOURCE);
const theirs = documentsBody(existingText, EXISTING);

/* ── collisions ──────────────────────────────────────────────────────────── */

const theirFunctions = new Set(functionNames(theirs.body));
const myFunctions = functionNames(mine.body);
const clashingFunctions = myFunctions.filter((name) => theirFunctions.has(name));

let block = mine.body;

/* Renaming is not cosmetic. Two `function isAdmin()` in one ruleset is a
   compile error, and quietly deleting one of them would hand the storefront
   this app's definition of an administrator. */
for (const name of clashingFunctions) {
  const renamed = `att${name[0].toUpperCase()}${name.slice(1)}`;
  block = block.replace(new RegExp(`\\b${name}\\b`, 'g'), renamed);
}

const theirCollections = new Set(collectionNames(theirs.body));
const clashingCollections = collectionNames(mine.body).filter((c) => theirCollections.has(c));

/* Drop my catch-all: rules are OR-ed, so a second `if false` grants nothing
   and only makes the merged file harder to read. */
block = block.replace(
  /\n[^\n]*\/\*[^\n]*\*\/\s*\n\s*match\s*\/\{document=\*\*\}\s*\{[^}]*\}\s*/g,
  '\n',
);
block = block.replace(/\n\s*match\s*\/\{document=\*\*\}\s*\{[^}]*\}\s*/g, '\n');

const banner = `

    /* ══════════════════════════════════════════════════════════════════════
       ATTENDANCE — merged by scripts/merge-rules.mjs
       from ${SOURCE} on ${new Date().toISOString().slice(0, 10)}.

       Everything above this line is your existing ruleset, unchanged.
       Firestore ORs its allow rules, so these blocks cannot take away access
       the blocks above already grant.

       Generated — do not hand-edit. Re-run \`npm run merge:rules\` after
       changing ${SOURCE}.
       ══════════════════════════════════════════════════════════════════════ */
`;

/* The closing brace's own indentation belongs to the closing brace, not to the
   end of the body — splice it back or the merged file ends on a naked `}}`. */
const closingIndent = /[ \t]*$/.exec(existingText.slice(0, theirs.closeAt))[0];
const bodyBeforeClose = existingText.slice(0, theirs.closeAt - closingIndent.length);

const merged =
  bodyBeforeClose.replace(/\s+$/, '\n') +
  banner +
  '\n' +
  block.replace(/^\s*\n/, '').replace(/\s+$/, '') +
  '\n' +
  closingIndent +
  existingText.slice(theirs.closeAt);

/* ── prove the output before writing it ──────────────────────────────────── */

try {
  documentsBody(merged, OUTPUT);
} catch {
  die(`Refusing to write ${OUTPUT}: the merged result does not parse.`);
}

let depth = 0;
for (const ch of merged.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')) {
  if (ch === '{') depth += 1;
  else if (ch === '}') depth -= 1;
  if (depth < 0) break;
}
if (depth !== 0) {
  die(`Refusing to write ${OUTPUT}: braces do not balance (${depth}).`);
}

/* Every helper the merged attendance block calls has to be defined somewhere in
   the merged file — a rename that missed a call site is a deploy-time error
   with an unhelpful message, found in the console rather than here.
 *
 * Two things are NOT calls to a helper and must not be counted as one:
 * prose inside comments ("the Cloud Functions (...)"), and method calls on a
 * value (`request.resource.data.diff(...).affectedKeys()`). Both were false
 * positives that made this check refuse a perfectly good ruleset. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const defined = new Set(functionNames(documentsBody(merged, OUTPUT).body));
const called = new Set(
  [...stripComments(block).matchAll(/(^|[^.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(
    (m) => m[2],
  ),
);
const BUILT_IN = new Set([
  'function', 'if', 'return', 'in', 'is',
  'get', 'getAfter', 'exists', 'existsAfter', 'debug',
  'float', 'int', 'string', 'bool', 'path', 'duration', 'timestamp', 'latlng',
]);
const undefinedCalls = [...called].filter((name) => !defined.has(name) && !BUILT_IN.has(name));
if (undefinedCalls.length) {
  die(
    `Refusing to write ${OUTPUT}: it calls helpers that are not defined:`,
    ...undefinedCalls.map((n) => `  ${n}()`),
  );
}

writeFileSync(OUTPUT, merged);

/* ── report ──────────────────────────────────────────────────────────────── */

say(`Merged ${SOURCE} into ${EXISTING}`, `        -> ${OUTPUT}`, '');

if (clashingFunctions.length) {
  say(
    `Renamed ${clashingFunctions.length} colliding helper(s), so your definitions win:`,
    ...clashingFunctions.map((n) => `  ${n}()  ->  att${n[0].toUpperCase()}${n.slice(1)}()`),
    '',
  );
}

if (clashingCollections.length) {
  say(
    'WARNING — both rulesets have blocks for these collections:',
    ...clashingCollections.map((c) => `  /${c}`),
    '',
    'Firestore ORs allow rules, so the merged file grants the UNION of the two.',
    'Read those blocks before deploying. If the storefront uses a collection of',
    'the same name for something else, rename this app\'s in',
    'src/Feature/Attendance/services/paths.js — every path comes from that one',
    'file — and re-run this.',
    '',
  );
}

if (!prod) {
  say(
    'These are the DEVELOPMENT rules: any signed-in user can read every branch\'s',
    'roster and write attendance. Fine for testing with fake staff, not once real',
    'people\'s hours are in there. Re-run with --prod after deploying the Cloud',
    'Functions.',
    '',
  );
}

say(
  'Next:',
  `  1. Read ${OUTPUT}. It is going to be your live security policy.`,
  `  2. In firebase.json set  "firestore": { "rules": "${OUTPUT}", ... }`,
  '  3. npm run firebase -- deploy --only firestore:rules',
  '',
  'Or skip the CLI: paste the merged file into the Firebase Console rules editor',
  'and press Publish.',
  '',
);
