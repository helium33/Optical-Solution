import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

import { BranchThemeProvider } from '../theme/BranchThemeProvider';
import { AuthProvider } from '../auth/AuthProvider';
import Spinner from '../components/ui/Spinner';

/**
 * Root of the attendance app.
 *
 * `.attendance-root` is where the branch token palette is applied — the public
 * storefront shares this bundle and must not inherit it.
 *
 * Provider order matters: the theme provider sits outside auth so the login
 * screen is already themed before anyone has signed in.
 */
export default function AttendanceLayout() {
  return (
    <BranchThemeProvider>
      <AuthProvider>
        <div className="attendance-root">
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
      </AuthProvider>
    </BranchThemeProvider>
  );
}
