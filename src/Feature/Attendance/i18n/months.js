/**
 * Month names, without trusting the browser's ICU data.
 *
 * `Intl.DateTimeFormat('my-MM')` silently resolves to en-US on any build
 * shipping small-icu — several Android WebViews, and the Chromium this project
 * is tested against — so the one heading on the monthly screen came back as
 * "September 2026" for a reader who chose Burmese. A twelve-entry table is not
 * worth arguing with: it cannot fall back to the wrong language.
 *
 * Digits stay Latin. The cards below the heading show 12 and 0 in Latin, and a
 * heading in Burmese numerals over Latin figures reads as two different
 * documents.
 */

const MY_MONTHS = [
  'ဇန်နဝါရီ', 'ဖေဖော်ဝါရီ', 'မတ်', 'ဧပြီ', 'မေ', 'ဇွန်',
  'ဇူလိုင်', 'ဩဂုတ်', 'စက်တင်ဘာ', 'အောက်တိုဘာ', 'နိုဝင်ဘာ', 'ဒီဇင်ဘာ',
];

/**
 * @param month    "2026-09"
 * @param language i18next's resolved language
 */
export function formatMonth(month, language) {
  const [year, monthNumber] = month.split('-').map(Number);

  if (String(language).startsWith('my')) {
    return `${MY_MONTHS[monthNumber - 1]} ${year}`;
  }

  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}
