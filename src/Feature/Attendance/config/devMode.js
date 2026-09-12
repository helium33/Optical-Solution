/**
 * Developer bypass.
 *
 * When on, the 50 m geofence and the shop-network check are both skipped, so
 * the app can be exercised from anywhere. This is genuinely useful — you cannot
 * test a clock-in by standing outside a shop in Mandalay every time — and it is
 * also the single most dangerous switch in the codebase: left on in production,
 * every employee can clock in from bed.
 *
 * So it is built to be hard to ship by accident:
 *
 *   1. Off by default. Enabling it takes a deliberate act.
 *   2. A production build refuses it unless a SECOND variable also says yes,
 *      so one stray `VITE_DEV_MODE=true` in a deploy config cannot do it.
 *   3. While it is on, a banner sits across the top of every screen. Not a
 *      console note — a thing you cannot look at the app without seeing.
 *   4. Every attendance record written while bypassing is tagged
 *      `locationBypass: 'dev-mode'`, so unverified rows stay greppable in the
 *      database long after the flag is switched back off.
 */

/**
 * Flip this to `true` for a quick local bypass without touching .env.
 * Leave it `false` in anything you commit.
 */
const DEV_MODE_OVERRIDE = false;

const requested = DEV_MODE_OVERRIDE || import.meta.env.VITE_DEV_MODE === 'true';

/* A production bundle needs the second key turned as well. */
const permittedHere =
  !import.meta.env.PROD || import.meta.env.VITE_ALLOW_DEV_MODE_IN_PROD === 'true';

export const DEV_MODE = requested && permittedHere;

/** Why the flag ended up where it did — surfaced in the banner and the docs. */
export const DEV_MODE_STATE = !requested
  ? 'off'
  : permittedHere
    ? 'on'
    : 'blocked-in-production';

if (requested && !permittedHere) {
  console.error(
    '[devMode] VITE_DEV_MODE=true was ignored because this is a production build. ' +
      'Location checks remain enforced. Set VITE_ALLOW_DEV_MODE_IN_PROD=true as well if ' +
      'you genuinely meant to disable them on a deployed site.',
  );
}

if (DEV_MODE) {
  console.warn(
    '[devMode] LOCATION CHECKS ARE DISABLED. Geofencing and the shop-network check are ' +
      'bypassed; attendance can be logged from anywhere. Records created now are tagged ' +
      'locationBypass: "dev-mode".',
  );
}

/** Tag written onto any punch made while the bypass was active. */
export const BYPASS_TAG = 'dev-mode';
