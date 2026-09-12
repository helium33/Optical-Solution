/**
 * Branch registry — the *seed and fallback* copy.
 *
 * At runtime these records are read from Firestore (`branches/{id}`) so an
 * owner can move a shop or re-point the Wi-Fi without a redeploy. This file is
 * what the app falls back to offline, what seeds a fresh project, and the
 * single source of truth for the three theme keys.
 *
 * Coordinates and CIDRs below are PLACEHOLDERS. Replace them by standing in
 * the shop doorway and reading the device's own lat/lng — the admin Branch
 * settings screen writes straight to Firestore.
 */

export const BRANCH_IDS = ['win', 'pwint', 'yangon'];

/**
 * All three branches currently point at the same coordinates.
 *
 * That is deliberate for now, and worth being explicit about rather than
 * leaving three identical literals looking like a copy-paste slip: until each
 * shop's real pin is surveyed, one shared location lets the fence be tested
 * end to end. The consequence is that the geofence cannot presently tell the
 * three branches apart — someone inside the radius satisfies the check for
 * every branch. Replace these per shop before this governs anyone's pay.
 */
export const SHARED_PIN = { lat: 23.995407, lng: 97.900507 };

/** 50 m, per the attendance policy. Overridable per branch. */
export const DEFAULT_RADIUS_METERS = 50;

/**
 * A GPS fix whose own error bar is wider than this is not trusted to prove a
 * 50 m claim — the UI asks the staff member to step outside rather than
 * silently allowing or denying. See useGeoFence.
 */
export const DEFAULT_MAX_ACCURACY_METERS = 65;

export const BRANCHES = {
  win: {
    id: 'win',
    name: 'Win Optical',
    shortName: 'Win',
    theme: 'win',
    city: 'Mandalay',
    timezone: 'Asia/Yangon',
    geofence: {
      lat: SHARED_PIN.lat,
      lng: SHARED_PIN.lng,
      radiusMeters: DEFAULT_RADIUS_METERS,
      maxAccuracyMeters: DEFAULT_MAX_ACCURACY_METERS,
    },
    network: {
      /** Public egress IP(s) of the shop router. CIDR or bare address. */
      allowedCidrs: ['203.81.64.0/20'],
      /** false => IP is advisory only; the GPS fence still governs. */
      enforce: true,
    },
    shift: {
      start: '09:00',
      end: '17:30',
      /** Clock-ins inside the grace window are still "on time". */
      graceMinutes: 10,
      /** Unpaid break deducted once a shift passes minBreakThresholdMinutes. */
      breakMinutes: 60,
      minBreakThresholdMinutes: 300,
      /** Ceiling on a single day's overtime; anything beyond needs admin edit. */
      maxOvertimeMinutes: 300,
      /** Overtime only starts accruing this long after the scheduled end. */
      overtimeGraceMinutes: 15,
    },
  },

  pwint: {
    id: 'pwint',
    name: 'Pwint Optical',
    shortName: 'Pwint',
    theme: 'pwint',
    city: 'Mandalay',
    timezone: 'Asia/Yangon',
    geofence: {
      lat: SHARED_PIN.lat,
      lng: SHARED_PIN.lng,
      radiusMeters: DEFAULT_RADIUS_METERS,
      maxAccuracyMeters: DEFAULT_MAX_ACCURACY_METERS,
    },
    network: { allowedCidrs: ['203.81.80.0/20'], enforce: true },
    shift: {
      start: '09:30',
      end: '18:00',
      graceMinutes: 10,
      breakMinutes: 60,
      minBreakThresholdMinutes: 300,
      maxOvertimeMinutes: 300,
      overtimeGraceMinutes: 15,
    },
  },

  yangon: {
    id: 'yangon',
    name: 'Yangon Optical',
    shortName: 'Yangon',
    theme: 'yangon',
    city: 'Yangon',
    timezone: 'Asia/Yangon',
    geofence: {
      lat: SHARED_PIN.lat,
      lng: SHARED_PIN.lng,
      radiusMeters: DEFAULT_RADIUS_METERS,
      maxAccuracyMeters: DEFAULT_MAX_ACCURACY_METERS,
    },
    network: { allowedCidrs: ['43.245.216.0/22'], enforce: true },
    shift: {
      start: '09:00',
      end: '18:00',
      graceMinutes: 10,
      breakMinutes: 60,
      minBreakThresholdMinutes: 300,
      maxOvertimeMinutes: 300,
      overtimeGraceMinutes: 15,
    },
  },
};

export const BRANCH_LIST = BRANCH_IDS.map((id) => BRANCHES[id]);

export const getBranch = (id) => BRANCHES[id] ?? null;

export const isBranchId = (id) => BRANCH_IDS.includes(id);
