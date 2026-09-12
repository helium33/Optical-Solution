import { lazy, Suspense } from 'react';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LuFlaskConical, LuGlasses, LuChartColumn, LuUserRound } from 'react-icons/lu';

import { BranchThemeProvider } from '../src/Feature/Attendance/theme/BranchThemeProvider';
import { AuthProvider } from '../src/Feature/Attendance/auth/AuthProvider';
import Spinner from '../src/Feature/Attendance/components/ui/Spinner';
import ThemeToggle from '../src/Feature/Attendance/components/ui/ThemeToggle';
import SecretAdminDoor from '../src/Feature/Attendance/components/SecretAdminDoor';

const KioskGatePage = lazy(() => import('../src/Feature/Attendance/pages/KioskGatePage'));
const KioskPage = lazy(() => import('../src/Feature/Attendance/pages/KioskPage'));
const AdminLoginPage = lazy(() => import('../src/Feature/Attendance/pages/AdminLoginPage'));
const DashboardPreviewPage = lazy(() => import('../src/Feature/Attendance/pages/DashboardPreviewPage'));
const StaffDashboardPage = lazy(() => import('../src/Feature/Attendance/pages/StaffDashboardPage'));

/**
 * The preview shell.
 *
 * Everything below the chrome bar is the real application — the same pages,
 * components, hooks and services that ship. Only two modules are swapped, both
 * at the edge where the app meets hardware it cannot have here: the Firebase
 * SDK (replaced by an in-memory store) and the geolocation hook (replaced by a
 * fixed in-range fix, because an embedded frame is not granted location).
 *
 * Routing is in-memory so the build works at any URL path.
 */

const LINKS = [
  { to: '/attendance/kiosk', label: 'Kiosk', Icon: LuGlasses },
  { to: '/attendance/me', label: 'My records', Icon: LuUserRound },
  { to: '/attendance/dashboard', label: 'Dashboard', Icon: LuChartColumn },
  /* No Admin link on purpose — that door is meant to be invisible. Type 7860. */
];

function PreviewChrome() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="sticky top-0 z-40 border-b border-line bg-surface-card/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-bold text-warn-ink">
          <LuFlaskConical className="h-3 w-3" aria-hidden="true" />
          Preview
        </span>

        <nav className="flex flex-wrap gap-1.5">
          {LINKS.map(({ to, label, Icon }) => {
            const active = pathname.startsWith(to.replace('/dashboard', '/dashboard'))
              && (to !== '/attendance/kiosk' || pathname.startsWith('/attendance/kiosk'));
            return (
              <button
                key={to}
                type="button"
                onClick={() => navigate(to)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-brand-600 text-brand-on'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </nav>

        <p className="ml-auto hidden text-[11px] text-ink-subtle sm:block">
          Branch PIN <strong className="font-bold text-ink">1234</strong> · staff PIN: any 4
          digits · type <strong className="font-bold text-ink">7860</strong> for admin
        </p>

        <ThemeToggle />
      </div>
    </div>
  );
}

export default function PreviewApp() {
  return (
    <BranchThemeProvider>
      <AuthProvider>
        <div className="attendance-root">
          <MemoryRouter initialEntries={['/attendance/kiosk']}>
            <SecretAdminDoor />
            <PreviewChrome />
            <Suspense
              fallback={
                <div className="grid min-h-[60vh] place-items-center">
                  <Spinner size={28} label="Loading" />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Navigate to="/attendance/kiosk" replace />} />
                <Route path="/attendance/kiosk" element={<KioskGatePage />} />
                <Route path="/attendance/kiosk/:branchId" element={<KioskPage />} />
                <Route path="/attendance/me" element={<StaffDashboardPage />} />
                <Route path="/attendance/dashboard" element={<DashboardPreviewPage />} />
                <Route path="/attendance/admin/login" element={<AdminLoginPage />} />
                <Route path="*" element={<Navigate to="/attendance/kiosk" replace />} />
              </Routes>
            </Suspense>
          </MemoryRouter>
        </div>
      </AuthProvider>
    </BranchThemeProvider>
  );
}
