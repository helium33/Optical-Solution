import { useTranslation } from 'react-i18next';

/**
 * Render an access-policy verdict in the reader's language.
 *
 * `evaluateAccess` is a pure function in `lib/` — it must not import i18next,
 * so it emits keys and parameters instead of sentences. This is the one place
 * that turns them back into text, so every screen showing a verdict phrases it
 * identically.
 *
 * Falls back to the English string the policy already carries. A missing key is
 * then a wording regression, not a blank pill where the reason should be.
 */
export function usePolicyText(policy) {
  const { t } = useTranslation();
  if (!policy) return { title: '', detail: null };

  const params = policy.params ?? {};
  return {
    title: policy.titleKey
      ? t(policy.titleKey, { ...params, defaultValue: policy.title ?? '' })
      : (policy.title ?? ''),
    detail: policy.detailKey
      ? t(policy.detailKey, { ...params, defaultValue: policy.detail ?? '' })
      : (policy.detail ?? null),
  };
}
