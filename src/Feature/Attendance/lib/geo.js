/**
 * Geofencing maths. No React, no Firebase — pure functions so the 50 m rule is
 * testable without a browser.
 */

/** IUGG mean Earth radius, metres. */
const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two {lat, lng} points, in metres.
 *
 * Haversine (rather than the cheaper equirectangular approximation) because at
 * a 50 m decision boundary the error of the flat-earth shortcut is the same
 * order as the thing being measured.
 */
export function haversineMeters(a, b) {
  if (!a || !b) return Number.NaN;
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.NaN;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const FENCE = {
  /** Inside the radius with a trustworthy fix. */
  INSIDE: 'inside',
  /** Outside the radius with a trustworthy fix. */
  OUTSIDE: 'outside',
  /** The fix's own error bar is too wide to prove anything either way. */
  IMPRECISE: 'imprecise',
  /** No position yet. */
  UNKNOWN: 'unknown',
};

/**
 * Decide whether a browser position satisfies a branch's fence.
 *
 * The accuracy gate comes *first*, and this is the part that is easy to get
 * wrong: a phone indoors routinely reports a position with +/-500 m accuracy.
 * Comparing that centre point to a 50 m radius produces a confident-looking
 * yes or no that is really a coin flip. So an imprecise fix is its own verdict
 * — the UI asks the person to step toward the window rather than silently
 * allowing (fraud) or denying (a staff member who cannot clock in).
 *
 * @param {{latitude:number,longitude:number,accuracy:number}} position
 * @param {{lat:number,lng:number,radiusMeters:number,maxAccuracyMeters:number}} geofence
 */
export function evaluateFence(position, geofence) {
  if (!position || !geofence) {
    return { verdict: FENCE.UNKNOWN, distance: null, accuracy: null, inside: false };
  }

  const accuracy = Number(position.accuracy);
  const distance = haversineMeters(
    { lat: position.latitude, lng: position.longitude },
    { lat: geofence.lat, lng: geofence.lng },
  );

  if (!Number.isFinite(distance)) {
    return { verdict: FENCE.UNKNOWN, distance: null, accuracy, inside: false };
  }

  const radius = Number(geofence.radiusMeters) || 50;
  const maxAccuracy = Number(geofence.maxAccuracyMeters) || 65;

  if (Number.isFinite(accuracy) && accuracy > maxAccuracy) {
    return {
      verdict: FENCE.IMPRECISE,
      distance,
      accuracy,
      radius,
      inside: false,
      /* Surfaced so the UI can say "we need it under 65 m" rather than "error". */
      requiredAccuracy: maxAccuracy,
    };
  }

  const inside = distance <= radius;

  return {
    verdict: inside ? FENCE.INSIDE : FENCE.OUTSIDE,
    distance,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    radius,
    inside,
    /* Extra nuance for the UI: a fix that is inside but whose error bar
       straddles the boundary still counts, it just isn't bragging about it. */
    borderline: Number.isFinite(accuracy)
      ? Math.abs(distance - radius) <= accuracy
      : false,
    /* How far past the line, for the "you are 12 m too far" copy. */
    overshootMeters: inside ? 0 : distance - radius,
  };
}

/** "8 m" / "142 m" / "1.4 km" — never more precision than GPS can back up. */
export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
