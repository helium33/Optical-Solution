import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import my from './locales/my.json';

/**
 * English and Myanmar.
 *
 * Two decisions worth recording:
 *
 * 1. NO PLURAL KEYS. i18next's plural suffixes follow each language's CLDR
 *    categories — English has two, Burmese has one — so a translated file
 *    never has the same key set as the source and the two drift silently.
 *    Counts are formatted in the component and passed in as a value instead.
 *    `npm run check:i18n` enforces that the two files stay identical in shape.
 *
 * 2. NO NAMESPACE SPLIT. One dictionary per language, grouped by area
 *    (kiosk, punch, overtime, admin…). Namespaces buy lazy loading, and the
 *    whole dictionary here is a few kilobytes — smaller than the round trip
 *    that would fetch it.
 *
 * The detector remembers a choice in localStorage, so a tablet set to Myanmar
 * stays in Myanmar across restarts.
 */

/**
 * `short` is what the toggle shows, and each one is written in its own script.
 * "MY" would be an ISO code, not a word: the person who needs the Burmese
 * option is the least likely to recognise the two Latin letters that name it.
 */
export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'my', label: 'မြန်မာ', short: 'မြန်မာ' },
];

export const STORAGE_KEY = 'optical.attendance.lang';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      my: { translation: my },
    },
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((language) => language.code),
    /* Burmese is written mm/my-MM in some browsers; treat every variant as my. */
    load: 'languageOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      /* React escapes for us; double-escaping mangles Burmese punctuation. */
      escapeValue: false,
    },
    returnNull: false,
  });

/**
 * Keep <html lang> honest.
 *
 * Not cosmetic: it is what tells the browser to pick a Myanmar font for this
 * text, and what a screen reader uses to choose a voice. Without it Burmese is
 * read out — or rendered — as though it were English.
 */
const applyLang = (code) => {
  document.documentElement.lang = code;
};
applyLang(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', applyLang);

export default i18n;
