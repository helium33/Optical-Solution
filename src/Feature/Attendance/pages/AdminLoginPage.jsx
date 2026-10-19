import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LuGlasses,
  LuShieldCheck,
  LuTriangleAlert,
  LuArrowRight,
  LuMailCheck,
  LuCircleCheck,
} from 'react-icons/lu';

import Spinner from '../components/ui/Spinner';
import ThemeToggle from '../components/ui/ThemeToggle';
import LanguageToggle from '../components/ui/LanguageToggle';
import { AUTH_STATUS, useAuth } from '../auth/AuthProvider';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';

/**
 * Admin sign-in: Google, or an email address and a password. Four addresses
 * either way.
 *
 * The password form exists because Google sign-in needs a hostname Firebase has
 * been told about, and getting that wrong looks identical to being locked out.
 * A password works on any address the bundle is served from, so it is the way
 * back in when the OAuth side is misconfigured.
 *
 * When a non-allowlisted account is turned away the page says so explicitly and
 * names the address that was tried. The alternative — a generic "access denied"
 * — sends people to reset a password that was never the problem; nine times out
 * of ten they are simply signed into the wrong Google account.
 */
export default function AdminLoginPage() {
  const { t } = useTranslation();
  const {
    status,
    user,
    error,
    errorKind,
    signIn,
    signInWithPassword,
    signUpWithPassword,
    resetPassword,
    resendVerification,
    recheckVerification,
    signOut,
    allowlist,
  } = useAuth();
  const { setBranch } = useBranchTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Good news, kept apart from `error`.
   *
   * "A reset link is on its way" is not a failure, and rendering it in the same
   * amber warning box as "that password is wrong" reads as though something
   * went wrong with it.
   */
  const [notice, setNotice] = useState(null);

  /* The admin shell is branch-neutral until a branch filter is chosen. */
  useEffect(() => setBranch(HOUSE_THEME), [setBranch]);

  useEffect(() => {
    if (status === AUTH_STATUS.AUTHENTICATED) {
      navigate(location.state?.from ?? '/attendance/admin', { replace: true });
    }
  }, [status, navigate, location.state]);

  if (status === AUTH_STATUS.AUTHENTICATED) {
    return <Navigate to={location.state?.from ?? '/attendance/admin'} replace />;
  }

  const misconfigured = status === AUTH_STATUS.MISCONFIGURED;
  const awaitingVerification = status === AUTH_STATUS.UNVERIFIED;
  /* The allowlist holds four strings but three mailboxes: `wpy.muse@gmail.com`
     and `wpymuse@gmail.com` are the same inbox, since Gmail ignores dots, and
     both spellings are listed so an exact match finds whichever one Firebase
     reports. Masked they are identical, so printing the raw list showed one
     address twice and a count that did not match the rows. */
  const mailboxes = [...new Set(allowlist.map(maskEmail))];

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setNotice(null);
    setBusy(true);
    const ok =
      mode === 'signup'
        ? await signUpWithPassword(email, password)
        : await signInWithPassword(email, password);
    setBusy(false);
    /* Never leave a password sitting in a form on a shared office laptop. */
    if (ok) setPassword('');
  };

  const forgot = async () => {
    if (!email.trim()) {
      setNotice({ tone: 'warn', text: t('admin.resetNeedsEmail') });
      return;
    }
    setNotice(null);
    setBusy(true);
    const ok = await resetPassword(email);
    setBusy(false);
    if (ok) setNotice({ tone: 'ok', text: t('admin.resetSent', { email: email.trim() }) });
  };

  const switchMode = (next) => {
    setMode(next);
    setPassword('');
    setNotice(null);
  };

  const recheck = async () => {
    setNotice(null);
    setBusy(true);
    const verified = await recheckVerification();
    setBusy(false);
    if (!verified) setNotice({ tone: 'warn', text: t('admin.verifyStill') });
  };

  const resend = async () => {
    setNotice(null);
    setBusy(true);
    const ok = await resendVerification();
    setBusy(false);
    if (ok) setNotice({ tone: 'ok', text: t('admin.verifyResent') });
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-surface bg-aurora px-4 py-10">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-brand-on shadow-glow">
            <LuGlasses className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t('admin.signIn')}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">{t('admin.signInSubtitle')}</p>
        </div>

        <div className="glass glass-sheen rounded-4xl p-6 shadow-float sm:p-8">
          {status === AUTH_STATUS.LOADING ? (
            <div className="py-10">
              <Spinner size={26} label={t('admin.checkingSession')} />
            </div>
          ) : awaitingVerification ? (
            /* Signed in, allowlisted, and still unable to read anything. Said
               here rather than letting the dashboard load empty. */
            <>
              <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-600/10 text-brand-ink">
                <LuMailCheck className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="text-center text-lg font-bold tracking-tight text-ink">
                {t('admin.verifyTitle')}
              </h2>
              <p className="mt-2 text-center text-sm leading-relaxed text-ink-muted">
                {t('admin.verifyBody', { email: user?.email ?? '' })}
              </p>
              <p className="mt-3 rounded-2xl bg-surface-sunken/70 px-4 py-3 text-xs leading-relaxed text-ink-subtle">
                {t('admin.verifyWhy')}
              </p>

              <button
                type="button"
                onClick={recheck}
                disabled={busy}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-3xl bg-brand-600 px-5 py-3.5 text-[15px] font-bold tracking-tight text-brand-on shadow-glow transition-all duration-300 ease-expo hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 tap-none"
              >
                {busy ? t('admin.working') : t('admin.verifyRecheck')}
              </button>

              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={resend}
                  disabled={busy}
                  className="rounded-2xl px-2 py-1.5 text-xs font-semibold text-brand-ink hover:underline disabled:opacity-50 tap-none"
                >
                  {t('admin.verifyResend')}
                </button>
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-2xl px-2 py-1.5 text-xs font-semibold text-ink-subtle hover:underline tap-none"
                >
                  {t('admin.verifyUseAnother')}
                </button>
              </div>

              <Notice notice={notice} />
              <AuthError error={error} errorKind={errorKind} t={t} />
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={signIn}
                disabled={misconfigured}
                className="group flex w-full items-center gap-4 rounded-3xl border border-line bg-surface-card p-4 text-left shadow-soft transition-all duration-300 ease-expo hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 tap-none"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-sunken">
                  <GoogleMark />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-bold tracking-tight text-ink">
                    {t('admin.continueWithGoogle')}
                  </span>
                  <span className="block text-xs text-ink-subtle">
                    {t('admin.useAdminAccount')}
                  </span>
                </span>
                <LuArrowRight
                  className="h-5 w-5 text-ink-subtle transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </button>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  {t('admin.orUseEmail')}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <form onSubmit={submit} className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
                    {t('admin.emailLabel')}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    inputMode="email"
                    required
                    disabled={misconfigured}
                    className="w-full rounded-2xl border border-line bg-surface-card px-4 py-3 text-[15px] text-ink outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25 disabled:opacity-50"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
                    {t('admin.passwordLabel')}
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    /* Firebase's own floor. Rejecting it here saves a round
                       trip and an error message. */
                    minLength={6}
                    disabled={misconfigured}
                    className="w-full rounded-2xl border border-line bg-surface-card px-4 py-3 text-[15px] text-ink outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25 disabled:opacity-50"
                  />
                </label>

                {mode === 'signup' ? (
                  <p className="text-xs leading-relaxed text-ink-subtle">
                    {t('admin.signUpAllowlistHint', { count: mailboxes.length })}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={busy || misconfigured}
                  className="flex w-full items-center justify-center gap-2 rounded-3xl bg-brand-600 px-5 py-3.5 text-[15px] font-bold tracking-tight text-brand-on shadow-glow transition-all duration-300 ease-expo hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 tap-none"
                >
                  {busy
                    ? t('admin.working')
                    : mode === 'signup'
                      ? t('admin.passwordSignUp')
                      : t('admin.passwordSignIn')}
                </button>
              </form>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
                  className="rounded-2xl px-2 py-1.5 text-xs font-semibold text-brand-ink hover:underline tap-none"
                >
                  {mode === 'signup' ? t('admin.toggleToSignIn') : t('admin.toggleToSignUp')}
                </button>
                {mode === 'signup' ? null : (
                  <button
                    type="button"
                    onClick={forgot}
                    disabled={busy}
                    className="rounded-2xl px-2 py-1.5 text-xs font-semibold text-ink-subtle hover:underline disabled:opacity-50 tap-none"
                  >
                    {t('admin.forgotPassword')}
                  </button>
                )}
              </div>

              <Notice notice={notice} />
              <AuthError error={error} errorKind={errorKind} t={t} />

              {misconfigured ? (
                <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-xs leading-relaxed text-warn-ink">
                  {t('admin.notConfigured')}
                </p>
              ) : null}

              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-surface-sunken/70 p-4">
                <LuShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
                <div className="min-w-0 text-xs leading-relaxed text-ink-muted">
                  <p className="font-semibold text-ink">
                    {t('admin.restrictedTo', { count: mailboxes.length })}
                  </p>
                  {/* Masked. This page is on the public internet, and the
                      owners' personal addresses printed in full is a spam list
                      waiting to be scraped. Enough is shown for an owner to
                      recognise their own account, which is all the list is for. */}
                  <ul className="mt-1.5 space-y-0.5">
                    {mailboxes.map((masked) => (
                      <li key={masked} className="truncate font-medium text-ink-subtle">
                        {masked}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-ink-subtle">
          {t('admin.staffDoNotSignIn')}{' '}
          <Link to="/attendance/kiosk" className="font-semibold text-brand-ink hover:underline">
            {t('admin.openTheKiosk')}
          </Link>
        </p>
      </div>
    </div>
  );
}

/** Something worked. Green, so it does not read as a failure. */
function Notice({ notice }) {
  if (!notice) return null;
  const ok = notice.tone === 'ok';
  return (
    <div
      className={`mt-4 flex items-start gap-3 rounded-2xl p-4 ${ok ? 'bg-ok-soft' : 'bg-warn-soft'}`}
      role="status"
    >
      {ok ? (
        <LuCircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-ink" aria-hidden="true" />
      ) : (
        <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" aria-hidden="true" />
      )}
      <p className={`min-w-0 break-words text-xs leading-relaxed ${ok ? 'text-ok-ink' : 'text-warn-ink'}`}>
        {notice.text}
      </p>
    </div>
  );
}

/**
 * Two different failures, two different answers. Telling someone to switch
 * Google accounts when the real problem is a disabled provider sends them round
 * every account they own.
 */
function AuthError({ error, errorKind, t }) {
  if (!error) return null;
  /* Both refusals are the same red box with the same headline. They differ
     only in what to do next, and getting that line wrong is what sends people
     round every account they own. */
  const rejectedAccount = errorKind === 'rejected';
  const rejectedAddress = errorKind === 'rejected-address';
  const rejected = rejectedAccount || rejectedAddress;
  return (
    <div
      className={`mt-4 flex items-start gap-3 rounded-2xl p-4 ${rejected ? 'bg-danger-soft' : 'bg-warn-soft'}`}
      role="alert"
    >
      <LuTriangleAlert
        className={`mt-0.5 h-4 w-4 shrink-0 ${rejected ? 'text-danger-ink' : 'text-warn-ink'}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        {rejected ? (
          <>
            <p className="text-sm font-bold text-danger-ink">{t('admin.notAdmin')}</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-danger-ink/85">{error}</p>
            <p className="mt-2 text-xs text-danger-ink/70">
              {rejectedAddress ? t('admin.useListedAddress') : t('admin.switchAccounts')}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-warn-ink">{t('admin.couldNotSignIn')}</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-warn-ink/90">{error}</p>
            <p className="mt-2 text-xs text-warn-ink/75">{t('admin.notAboutAccount')}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** `kyawwinhtun564@gmail.com` -> `kya•••••••••64@gmail.com` */
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  if (local.length <= 5) return `${local[0]}${'•'.repeat(4)}@${domain}`;
  return `${local.slice(0, 3)}${'•'.repeat(Math.max(3, local.length - 5))}${local.slice(-2)}@${domain}`;
}

/** Google's mark, inline so the page has no third-party asset dependency. */
const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
  </svg>
);
