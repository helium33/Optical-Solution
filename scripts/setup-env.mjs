#!/usr/bin/env node
/**
 * Get `.env` into a working state, and say exactly what is still missing.
 *
 * `.env` is gitignored — correctly, because this repository is public — which
 * means every fresh clone starts without it and the app reports "Firebase is
 * not configured". That is the right message but a dead end: it does not say
 * where the file goes, what belongs in it, or that the file you just made in
 * Notepad is actually called `.env.txt`.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import process from 'node:process';

const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

const parse = (text) => {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
};

console.log('');

/* The Windows trap: Notepad appends .txt unless you fight it, and Explorer
   hides the extension so the file looks correct. */
if (!existsSync('.env')) {
  const lookalikes = readdirSync('.')
    .filter((name) => /^\.?env(\.|$)/i.test(name) && name !== '.env' && name !== '.env.example');
  if (lookalikes.length) {
    console.log('  Found a file that looks like it was meant to be .env:\n');
    for (const name of lookalikes) console.log(`      ${name}`);
    console.log(
      '\n  Rename it to exactly ".env" — no .txt, no "env" without the dot.\n' +
        '  Notepad adds .txt silently and Explorer hides it. In Git Bash:\n' +
        `\n      mv "${lookalikes[0]}" .env\n`,
    );
    process.exit(1);
  }

  if (!existsSync('.env.example')) {
    console.error('  .env.example is missing — is this the project root?\n');
    process.exit(1);
  }
  writeFileSync('.env', readFileSync('.env.example', 'utf8'));
  console.log('  Created .env from .env.example.\n');
}

const env = parse(readFileSync('.env', 'utf8'));
const missing = REQUIRED.filter((key) => !env[key]);

if (!missing.length) {
  console.log(`  .env looks complete — project ${env.VITE_FIREBASE_PROJECT_ID}`);
  console.log('  Run: npm run dev\n');
  process.exit(0);
}

console.log('  .env still needs these filled in:\n');
for (const key of missing) console.log(`      ${key}=`);
console.log(
  '\n  Get them from the Firebase console:\n' +
    '      Project settings -> General -> Your apps -> SDK setup and configuration\n' +
    '\n  Open .env in VS Code and paste the values after each "=".\n',
);
process.exit(1);
