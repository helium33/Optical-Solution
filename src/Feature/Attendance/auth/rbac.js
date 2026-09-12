import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, ROLE_RANK } from '../config/roles';

/**
 * Role-Based Access Control.
 *
 * A *principal* is the normalised actor, from either login path:
 *   admin  -> { uid, email, role: 'admin',      branchId: null,   isAdmin: true }
 *   staff  -> { uid, name,  role: 'supervisor', branchId: 'win',  isAdmin: false }
 *
 * Two distinct questions, deliberately answered by two functions:
 *   can(...)      — is this *verb* available to them, in this *branch*?
 *   outranks(...) — are they senior enough to act on this *person*?
 * A Sales Leader holds staff:manage but must not be able to reset their
 * Supervisor's PIN, and only the second check catches that.
 */

const P = PERMISSIONS;

/** Permissions that only apply within the principal's own branch. */
const BRANCH_SCOPED = new Set([
  P.ATTENDANCE_VIEW_BRANCH,
  P.ATTENDANCE_EDIT_BRANCH,
  P.OVERTIME_APPROVE,
  P.STAFF_MANAGE,
  P.BRANCH_MANAGE,
]);

/** Permissions that additionally require seniority over the target person. */
const RANK_SCOPED = new Set([P.STAFF_MANAGE, P.ATTENDANCE_EDIT_BRANCH, P.OVERTIME_APPROVE]);

export function permissionsFor(principal) {
  if (!principal?.role) return new Set();
  return new Set(ROLE_PERMISSIONS[principal.role] ?? []);
}

export function rankOf(principalOrRole) {
  const role =
    typeof principalOrRole === 'string' ? principalOrRole : principalOrRole?.role;
  return ROLE_RANK[role] ?? 0;
}

/** Strictly greater — peers may not edit each other. */
export function outranks(actor, target) {
  if (!actor || !target) return false;
  if (actor.role === ROLES.ADMIN) return true;
  if (actor.uid && actor.uid === target.uid) return true; // acting on yourself
  return rankOf(actor) > rankOf(target);
}

/**
 * @param principal  the actor
 * @param permission one of PERMISSIONS
 * @param resource   optional target: { branchId, uid, role }
 */
export function can(principal, permission, resource = {}) {
  if (!principal || !permission) return false;

  if (!permissionsFor(principal).has(permission)) return false;

  /* Admin is cross-branch by definition; no scoping applies. */
  if (principal.role === ROLES.ADMIN) return true;

  /* Self-service actions are only ever about yourself. */
  if (permission === P.ATTENDANCE_LOG_SELF && resource.uid && resource.uid !== principal.uid) {
    return false;
  }

  if (BRANCH_SCOPED.has(permission) && resource.branchId && resource.branchId !== principal.branchId) {
    return false;
  }

  if (RANK_SCOPED.has(permission) && resource.role && !outranks(principal, resource)) {
    return false;
  }

  return true;
}

/** Throwing variant, for service-layer guards where a silent false would hide a bug. */
export function assertCan(principal, permission, resource) {
  if (!can(principal, permission, resource)) {
    const error = new Error(`Not permitted: ${permission}`);
    error.code = 'permission-denied';
    throw error;
  }
}

/** Which branches this principal's queries may span. `null` means all of them. */
export function visibleBranchIds(principal) {
  if (can(principal, P.ATTENDANCE_VIEW_ALL)) return null;
  return principal?.branchId ? [principal.branchId] : [];
}

/** Roles this principal is allowed to assign — never at or above their own. */
export function assignableRoles(principal) {
  if (principal?.role === ROLES.ADMIN) {
    return Object.values(ROLES).filter((r) => r !== ROLES.ADMIN);
  }
  const ceiling = rankOf(principal);
  return Object.entries(ROLE_RANK)
    .filter(([role, rank]) => rank < ceiling && role !== ROLES.ADMIN)
    .map(([role]) => role);
}
