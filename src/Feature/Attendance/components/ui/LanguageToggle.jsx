import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';

/**
 * English / Myanmar switch.
 *
 * A segmented pair rather than a dropdown: there are exactly two options, both
 * fit, and on a shop tablet a control you can hit without reading is worth more
 * than one that scales to twenty languages it will never have.
 *
 * Each label is written in its own script — "မြန်မာ", not "Burmese" — so it is
 * legible to the person who needs it regardless of the language currently set.
 */
export default function LanguageToggle({ className = '' }) {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <div
      role="radiogroup"
      aria-label={t('common.language')}
      className={`inline-flex rounded-2xl border border-line bg-surface-sunken p-0.5 ${className}`}
    >
      {LANGUAGES.map((language) => {
        const active = language.code === current;
        return (
          <button
            key={language.code}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => i18n.changeLanguage(language.code)}
            className={`rounded-[0.85rem] px-2.5 py-1.5 text-xs font-bold transition-colors ${
              active ? 'bg-surface-card text-ink shadow-soft' : 'text-ink-subtle hover:text-ink-muted'
            }`}
          >
            {language.short}
          </button>
        );
      })}
    </div>
  );
}
