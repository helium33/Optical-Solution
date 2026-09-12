import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

/* Side-effect import: initialises i18next before any component renders, so
   the first paint is already in the right language rather than flashing
   English and then switching. */
import '../i18n';

import { BranchThemeProvider } from '../theme/BranchThemeProvider';
import { BranchesProvider } from '../config/BranchesProvider';
import { AuthProvider } from '../auth/AuthProvider';
import Spinner from '../components/ui/Spinner';
import DevModeBanner from '../components/ui/DevModeBanner';
import SecretAdminDoor from '../components/SecretAdminDoor';

/**
 * Root of the attendance app.
 *
 * `.attendance-root` is where the branch token palette is applied — the public
 * storefront shares this bundle and must not inherit it.
 *
 * Provider order matters: the theme provider sits outside auth so the login
 * screen is already themed before anyone has signed in.
 *
 * It also mounts the secret sequence that reveals the administrator sign-in —
 * here rather than on a page, so it works from any screen.
 */
export default function AttendanceLayout() {
  return (
    <BranchThemeProvider>
      <AuthProvider>
        <BranchesProvider>
        <div className="attendance-root">
          <DevModeBanner />
          <SecretAdminDoor />
          <Suspense
            fallback={
              <div className="grid min-h-dvh place-items-center">
                <Spinner size={28} label="Loading" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
        </BranchesProvider>
      </AuthProvider>
    </BranchThemeProvider>
  );
}
