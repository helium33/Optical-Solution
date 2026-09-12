import { useRouteError, Link } from 'react-router-dom';
import { LuTriangleAlert, LuRefreshCw } from 'react-icons/lu';

/**
 * Route-level error boundary for the attendance app.
 *
 * The storefront's 404 page is the wrong thing to show here: a shop tablet that
 * fails to load needs a "try again" and, for whoever is called to fix it, the
 * actual error text. A cheerful "page not found" for a Firebase
 * misconfiguration costs someone an afternoon.
 */
export default function AttendanceError() {
  const error = useRouteError();
  const message =
    error?.statusText || error?.message || (typeof error === 'string' ? error : 'Unknown error');

  return (
    <div className="attendance-root grid place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-3xl bg-danger-soft text-danger-ink">
          <LuTriangleAlert className="h-6 w-6" aria-hidden="true" />
        </span>

        <h1 className="text-xl font-bold tracking-tight text-ink">
          The attendance app could not start
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          This is usually a missing Firebase configuration or a dropped network
          connection.
        </p>

        <pre className="mt-5 overflow-auto rounded-2xl bg-surface-sunken p-4 text-left text-xs leading-relaxed text-ink-muted">
          {message}
        </pre>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-brand-on shadow-soft"
          >
            <LuRefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            to="/attendance/kiosk"
            className="rounded-2xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-muted"
          >
            Back to the kiosk
          </Link>
        </div>
      </div>
    </div>
  );
}
