import { Navigate } from 'react-router-dom';

/**
 * Two entry points, deliberately separate:
 *
 *   /attendance/kiosk         shop tablet — branch PIN, no accounts
 *   /attendance/admin         owners — Google OAuth, three allowlisted emails
 *
 * They share the theme and the data model and nothing else. A staff member
 * should never see a sign-in form, and an admin should never have to unlock a
 * kiosk to read a report.
 *
 * These use React Router's route-level `lazy` rather than React.lazy on the
 * elements. The difference matters here: an `element: <Lazy />` still has to be
 * *constructed* at module scope, which drags the whole attendance module graph —
 * Firebase included, ~700 kB — into the entry chunk that the public storefront
 * also loads. Route-level lazy defers the import itself, so a customer browsing
 * sunglasses never downloads the attendance app.
 */

const page = (loader) => async () => {
  const module = await loader();
  return { Component: module.default };
};

/**
 * Dashboard preview with sample data. Present in `npm run dev`, absent from a
 * production build — Vite statically replaces import.meta.env.DEV, so the whole
 * branch (and the fixture module) is dropped at build time. It exists so the
 * reporting UI can be judged before there is a month of real punches in it.
 */
const devOnlyRoutes = import.meta.env.DEV
  ? [
      {
        path: 'preview',
        lazy: page(() => import('../Feature/Attendance/pages/DashboardPreviewPage')),
      },
    ]
  : [];

const AttendanceRoutes = [
  { index: true, element: <Navigate to="kiosk" replace /> },

  {
    path: 'kiosk',
    lazy: page(() => import('../Feature/Attendance/pages/KioskGatePage')),
  },
  {
    path: 'kiosk/:branchId',
    lazy: page(() => import('../Feature/Attendance/pages/KioskPage')),
  },
  {
    path: 'admin/login',
    lazy: page(() => import('../Feature/Attendance/pages/AdminLoginPage')),
  },
  {
    path: 'admin',
    lazy: async () => {
      const [{ default: AdminDashboardPage }, { RequireAdmin }] = await Promise.all([
        import('../Feature/Attendance/pages/AdminDashboardPage'),
        import('../Feature/Attendance/auth/guards'),
      ]);
      return {
        Component: () => (
          <RequireAdmin>
            <AdminDashboardPage />
          </RequireAdmin>
        ),
      };
    },
  },

  ...devOnlyRoutes,
];

export default AttendanceRoutes;
