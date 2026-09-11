import { Navigate, useLocation } from 'react-router-dom';
import { AUTH_STATUS, useAuth } from './AuthProvider';
import { can } from './rbac';
import Spinner from '../components/ui/Spinner';

/**
 * Route guards.
 *
 * These decide what is *rendered*. They are not a security boundary — a guard
 * can be stepped around with devtools, and every one of them has a matching
 * Firestore rule that cannot. Their job is to keep a user from staring at an
 * empty dashboard wondering why nothing loaded.
 */

export function RequireAdmin({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === AUTH_STATUS.LOADING) return <Spinner label="Checking your account" />;

  if (status !== AUTH_STATUS.AUTHENTICATED) {
    /* Remember where they were headed so sign-in can return them there. */
    return <Navigate to="/attendance/admin/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export function RequirePermission({ permission, resource, children, fallback = null }) {
  const { principal } = useAuth();
  if (!can(principal, permission, resource)) return fallback;
  return children;
}
