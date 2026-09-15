#!/usr/bin/env node
/**
 * Keep the translation files identical in shape.
 *
 * A missing key does not crash — i18next quietly falls back to English — so a
 * half-translated screen looks fine to whoever added the key and wrong to
 * everyone reading in Myanmar. The only reliable way to catch it is to compare
 * the files.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

const load = (code) =>
  JSON.parse(readFileSync(`src/Feature/Attendance/i18n/locales/${code}.json`, 'utf8'));

const flatten = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, item]) =>
    item && typeof item === 'object'
      ? flatten(item, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

const en = new Set(flatten(load('en')));
const my = new Set(flatten(load('my')));

const missing = [...en].filter((key) => !my.has(key));
const extra = [...my].filter((key) => !en.has(key));

console.log(`\n  en ${en.size} keys · my ${my.size} keys`);

if (!missing.length && !extra.length) {
  console.log('  Translations are in step.\n');
  process.exit(0);
}

if (missing.length) {
  console.error(`\n  Missing from my.json (${missing.length}):`);
  for (const key of missing) console.error(`      ${key}`);
}
if (extra.length) {
  console.error(`\n  In my.json but not en.json (${extra.length}):`);
  for (const key of extra) console.error(`      ${key}`);
}
console.error('');
process.exit(1);
