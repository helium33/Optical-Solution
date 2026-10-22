/**
 * Branch registry — the *seed and fallback* copy.
 *
 * At runtime these records are read from Firestore (`branches/{id}`) so an
 * owner can move a shop or re-point the Wi-Fi without a redeploy. This file is
 * what the app falls back to offline, what seeds a fresh project, and the
 * single source of truth for the three theme keys.
 *
 * The coordinates below are the three surveyed shop pins, given as Plus Codes
 * and decoded with lib/plusCode.js (checked against Google's own 439 test
 * vectors). Each is recorded next to its branch so the number can be traced
 * back to something a human can paste into Google Maps and look at.
 *
 * To move a shop, use the admin Branch settings screen — it takes a Plus Code
 * or the device's own position and writes straight to Firestore, which
 * overrides this file at runtime.
 */

export const BRANCH_IDS = ['win', 'pwint', 'yangon'];

/**
 * The surveyed shop pins. All three shops are in Muse, Shan State.
 *
 * Each entry carries the Plus Code it was derived from, because a bare pair of
 * decimals is unverifiable six months from now — the code pastes into Google
 * Maps and can be checked against the shop front in seconds.
 *
 * The three fences no longer overlap: Win to Pwint is 190 m, Pwint to Yangon
 * 206 m, Win to Yangon 394 m. At a 50 m radius the closest pair still leaves a
 * 90 m gap, so a fix that satisfies one shop cannot satisfy another — which
 * was not true while all three shared a pin.
 */
export const BRANCH_PINS = {
  /* XVVX+GW3, Muse */
  win: { lat: 23.9937625, lng: 97.8997969, plusCode: '7MMVXVVX+GW3' },
  /* XWW2+45W, Muse */
  pwint: { lat: 23.9953625, lng: 97.9004531, plusCode: '7MMVXWW2+45W' },
  /* XWW2+QJC, Muse */
  yangon: { lat: 23.9969375, lng: 97.9015156, plusCode: '7MMVXWW2+QJC' },
};

/** 50 m, per the attendance policy. Overridable per branch. */
export const DEFAULT_RADIUS_METERS = 50;

/**
 * A GPS fix whose own error bar is wider than this is not trusted to prove a
 * 50 m claim — the UI asks the staff member to step outside rather than
 * silently allowing or denying. See useGeoFence.
 */
export const DEFAULT_MAX_ACCURACY_METERS = 65;

/**
 * No Wi-Fi restriction: the 50 m GPS fence is the whole rule.
 *
 * An empty allowlist is the configured "not applicable" state rather than a
 * disabled check left sitting there — useGeoFence skips the public-IP lookup
 * entirely when there is nothing to compare against, and evaluateNetwork
 * returns SKIPPED, so no warning is raised either. Staff can clock in on shop
 * Wi-Fi, on mobile data or on a neighbour's hotspot: what is being proved is
 * that they are physically at the shop, and GPS proves it.
 *
 * Why drop it at all: the egress IP a browser reports is self-reported and
 * spoofable, so it never carried much weight, while a shop router that reboots
 * onto a new address silently locks out everybody genuinely standing in the
 * shop. To bring it back for one branch, give that branch its own
 * `{ allowedCidrs: ['x.x.x.x/nn'], enforce: true }`.
 */
const NO_NETWORK_RESTRICTION = Object.freeze({ allowedCidrs: [], enforce: false });

export const BRANCHES = {
  win: {
    id: 'win',
    /* Swap the shop's real artwork in at this path — the picker falls
       back to the themed swatch if the file is missing. */
    logo: '/branches/win.svg',
    name: 'Win Vision',
    shortName: 'Win',
    theme: 'win',
    city: 'Muse',
    timezone: 'Asia/Yangon',
    geofence: {
      lat: BRANCH_PINS.win.lat,
      lng: BRANCH_PINS.win.lng,
      /* Recorded so the admin screen can show where the pin came from. */
      plusCode: BRANCH_PINS.win.plusCode,
      radiusMeters: DEFAULT_RADIUS_METERS,
      maxAccuracyMeters: DEFAULT_MAX_ACCURACY_METERS,
    },
    network: NO_NETWORK_RESTRICTION,
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
    /* Swap the shop's real artwork in at this path — the picker falls
       back to the themed swatch if the file is missing. */
    logo: '/branches/pwint.svg',
    name: 'Pwint Eyewear',
    shortName: 'Pwint',
    theme: 'pwint',
    city: 'Muse',
    timezone: 'Asia/Yangon',
    geofence: {
      lat: BRANCH_PINS.pwint.lat,
      lng: BRANCH_PINS.pwint.lng,
      /* Recorded so the admin screen can show where the pin came from. */
      plusCode: BRANCH_PINS.pwint.plusCode,
      radiusMeters: DEFAULT_RADIUS_METERS,
      maxAccuracyMeters: DEFAULT_MAX_ACCURACY_METERS,
    },
    network: NO_NETWORK_RESTRICTION,
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
    /* Swap the shop's real artwork in at this path — the picker falls
       back to the themed swatch if the file is missing. */
    logo: '/branches/yangon.svg',
    name: 'Yangon Eyewear',
    shortName: 'Yangon',
    theme: 'yangon',
    city: 'Muse',
    timezone: 'Asia/Yangon',
    geofence: {
      lat: BRANCH_PINS.yangon.lat,
      lng: BRANCH_PINS.yangon.lng,
      /* Recorded so the admin screen can show where the pin came from. */
      plusCode: BRANCH_PINS.yangon.plusCode,
      radiusMeters: DEFAULT_RADIUS_METERS,
      maxAccuracyMeters: DEFAULT_MAX_ACCURACY_METERS,
    },
    network: NO_NETWORK_RESTRICTION,
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
