#!/usr/bin/env node
/**
 * Refuse to build a deployable bundle with the Firebase config missing.
 *
 * `.env` is gitignored, which is correct — but it means a fresh clone, a new
 * machine or a CI runner has no config at all. Vite would build happily, and
 * the site would go live showing "Firebase is not configured" to every
 * customer and every member of staff. Nothing would appear to be wrong until
 * someone opened it.
 *
 * Vite substitutes these at build time, so this has to run BEFORE the build,
 * not inside the app.
 */
import { readFileSync, existsSync } from 'node:fs';
import process from 'node:process';

const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

/** Anything set here would disable location checks on a live site. */
const DANGEROUS = ['VITE_DEV_MODE', 'VITE_ALLOW_DEV_MODE_IN_PROD', 'VITE_ALLOW_CLIENT_PUNCH'];

/** Minimal .env reader — Vite's own loader is not available this early. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...readEnvFile('.env'), ...readEnvFile('.env.local'), ...process.env };

const missing = REQUIRED.filter((key) => !env[key]);
const enabled = DANGEROUS.filter((key) => env[key] === 'true');

if (missing.length) {
  console.error('\n  Cannot build for deployment — Firebase config is missing.\n');
  for (const key of missing) console.error(`    missing  ${key}`);
  console.error(
    '\n  Copy .env.example to .env and fill it in from the Firebase console\n' +
      '  (Project settings -> General -> Your apps -> SDK setup and configuration).\n' +
      '\n  Without these the site deploys and then tells everyone who opens it\n' +
      '  that Firebase is not configured.\n',
  );
  process.exit(1);
}

if (enabled.length) {
  console.error('\n  Refusing to build: a development bypass is switched on.\n');
  for (const key of enabled) console.error(`    ${key}=true`);
  console.error(
    '\n  VITE_DEV_MODE disables the 50 m geofence and the shop-network check —\n' +
      '  every employee could clock in from home. VITE_ALLOW_CLIENT_PUNCH lets the\n' +
      '  browser write attendance with no identity check at all.\n' +
      '\n  Remove them from .env before deploying.\n',
  );
  process.exit(1);
}

console.log(`  Environment looks deployable — project ${env.VITE_FIREBASE_PROJECT_ID}\n`);
