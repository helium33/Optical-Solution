import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LuGlasses, LuShieldCheck, LuTriangleAlert, LuArrowRight } from 'react-icons/lu';

import Spinner from '../components/ui/Spinner';
import ThemeToggle from '../components/ui/ThemeToggle';
import { AUTH_STATUS, useAuth } from '../auth/AuthProvider';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';

/**
 * Admin sign-in. Google only, three addresses.
 *
 * When a non-allowlisted account is turned away the page says so explicitly and
 * names the address that was tried. The alternative — a generic "access denied"
 * — sends people to reset a password that was never the problem; nine times out
 * of ten they are simply signed into the wrong Google account.
 */
export default function AdminLoginPage() {
  const { status, error, errorKind, signIn, allowlist } = useAuth();
  const { setBranch } = useBranchTheme();
  const location = useLocation();
  const navigate = useNavigate();

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

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-surface bg-aurora px-4 py-10">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-brand-on shadow-glow">
            <LuGlasses className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Administrator sign-in</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Attendance reporting for Win, Pwint and Yangon
          </p>
        </div>

        <div className="glass glass-sheen rounded-4xl p-6 shadow-float sm:p-8">
          {status === AUTH_STATUS.LOADING ? (
            <div className="py-10">
              <Spinner size={26} label="Checking your session…" />
            </div>
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
                    Continue with Google
                  </span>
                  <span className="block text-xs text-ink-subtle">Use your administrator account</span>
                </span>
                <LuArrowRight
                  className="h-5 w-5 text-ink-subtle transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </button>

              {/* Two different failures, two different answers. Telling someone
                  to switch Google accounts when the real problem is a disabled
                  provider sends them round every account they own. */}
              {error ? (
                <div
                  className={`mt-4 flex items-start gap-3 rounded-2xl p-4 ${
                    errorKind === 'rejected' ? 'bg-danger-soft' : 'bg-warn-soft'
                  }`}
                  role="alert"
                >
                  <LuTriangleAlert
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      errorKind === 'rejected' ? 'text-danger-ink' : 'text-warn-ink'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    {errorKind === 'rejected' ? (
                      <>
                        <p className="text-sm font-bold text-danger-ink">Not an administrator</p>
                        <p className="mt-1 break-words text-xs leading-relaxed text-danger-ink/85">
                          {error}
                        </p>
                        <p className="mt-2 text-xs text-danger-ink/70">
                          Sign out of that Google account, or switch accounts, and try again.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-bold text-warn-ink">Could not sign in</p>
                        <p className="mt-1 break-words text-xs leading-relaxed text-warn-ink/90">
                          {error}
                        </p>
                        <p className="mt-2 text-xs text-warn-ink/75">
                          This is not about your account — sign-in did not get that far.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {misconfigured ? (
                <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-xs leading-relaxed text-warn-ink">
                  Firebase is not configured. Copy <code className="font-semibold">.env.example</code>{' '}
                  to <code className="font-semibold">.env</code>, fill in the project values and
                  restart the dev server.
                </p>
              ) : null}

              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-surface-sunken/70 p-4">
                <LuShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
                <div className="min-w-0 text-xs leading-relaxed text-ink-muted">
                  <p className="font-semibold text-ink">Restricted to {allowlist.length} accounts</p>
                  {/* Masked. This page is on the public internet, and three
                      personal addresses printed in full is a spam list waiting
                      to be scraped. Enough is shown for an owner to recognise
                      their own account, which is all the list is for. */}
                  <ul className="mt-1.5 space-y-0.5">
                    {allowlist.map((email) => (
                      <li key={email} className="truncate font-medium text-ink-subtle">
                        {maskEmail(email)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-ink-subtle">
          Shop staff do not sign in here —{' '}
          <a href="/attendance/kiosk" className="font-semibold text-brand-ink hover:underline">
            open the kiosk
          </a>
          .
        </p>
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
