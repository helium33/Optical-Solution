/**
 * Role hierarchy and the permission matrix.
 *
 * Within a branch:  Supervisor > Sales Leader > Sales Executive > Sales Associate
 * Above all branches: Admin (Google OAuth, allowlisted — see auth/admins.js)
 *
 * Rank is used for two different questions and they must not be confused:
 *   - "may X do this?"          -> permissions (can())
 *   - "may X do this *to* Y?"   -> rank (outranks())
 * A Sales Leader has staff:manage, but only over people below their own rank.
 */

export const ROLES = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  SALES_LEADER: 'sales_leader',
  SALES_EXECUTIVE: 'sales_executive',
  SALES_ASSOCIATE: 'sales_associate',
};

/** Lowest to highest. Index order is meaningful — append, never reorder. */
export const STAFF_ROLE_ORDER = [
  ROLES.SALES_ASSOCIATE,
  ROLES.SALES_EXECUTIVE,
  ROLES.SALES_LEADER,
  ROLES.SUPERVISOR,
];

export const ROLE_RANK = {
  [ROLES.SALES_ASSOCIATE]: 1,
  [ROLES.SALES_EXECUTIVE]: 2,
  [ROLES.SALES_LEADER]: 3,
  [ROLES.SUPERVISOR]: 4,
  [ROLES.ADMIN]: 99,
};

export const ROLE_META = {
  [ROLES.SUPERVISOR]: { label: 'Supervisor', abbr: 'SV', order: 1 },
  [ROLES.SALES_LEADER]: { label: 'Sales Leader', abbr: 'SL', order: 2 },
  [ROLES.SALES_EXECUTIVE]: { label: 'Sales Executive', abbr: 'SE', order: 3 },
  [ROLES.SALES_ASSOCIATE]: { label: 'Sales Associate', abbr: 'SA', order: 4 },
  [ROLES.ADMIN]: { label: 'Administrator', abbr: 'AD', order: 0 },
};

export const PERMISSIONS = {
  /** Clock yourself in and out at the kiosk. */
  ATTENDANCE_LOG_SELF: 'attendance:log:self',
  /** See today's board for your own branch. */
  ATTENDANCE_VIEW_BRANCH: 'attendance:view:branch',
  /** Correct a mis-punch on your own branch's log. */
  ATTENDANCE_EDIT_BRANCH: 'attendance:edit:branch',
  /** See every branch. */
  ATTENDANCE_VIEW_ALL: 'attendance:view:all',
  /** Sign off a flagged overtime claim. */
  OVERTIME_APPROVE: 'overtime:approve',
  /** Add staff, reset PINs, re-enrol a fingerprint. */
  STAFF_MANAGE: 'staff:manage',
  /** Move the geofence, change the shift, rotate the kiosk PIN. */
  BRANCH_MANAGE: 'branch:manage',
  REPORT_EXPORT: 'report:export',
};

const P = PERMISSIONS;

/**
 * Permissions are cumulative by rank but written out per role rather than
 * derived, so "what can a Sales Leader do?" is answerable by reading one line
 * instead of simulating inheritance.
 */
export const ROLE_PERMISSIONS = {
  [ROLES.SALES_ASSOCIATE]: [P.ATTENDANCE_LOG_SELF],

  [ROLES.SALES_EXECUTIVE]: [P.ATTENDANCE_LOG_SELF, P.ATTENDANCE_VIEW_BRANCH],

  [ROLES.SALES_LEADER]: [
    P.ATTENDANCE_LOG_SELF,
    P.ATTENDANCE_VIEW_BRANCH,
    P.ATTENDANCE_EDIT_BRANCH,
    P.STAFF_MANAGE,
  ],

  [ROLES.SUPERVISOR]: [
    P.ATTENDANCE_LOG_SELF,
    P.ATTENDANCE_VIEW_BRANCH,
    P.ATTENDANCE_EDIT_BRANCH,
    P.OVERTIME_APPROVE,
    P.STAFF_MANAGE,
    P.BRANCH_MANAGE,
    P.REPORT_EXPORT,
  ],

  /** Admin holds everything, including the cross-branch views. */
  [ROLES.ADMIN]: Object.values(P),
};

export const isStaffRole = (role) => STAFF_ROLE_ORDER.includes(role);

export const roleLabel = (role) => ROLE_META[role]?.label ?? 'Unknown';
