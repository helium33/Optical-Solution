import { FENCE } from './geo';
import { NETWORK } from './network';

/**
 * The single place that decides "may this person punch right now?".
 *
 * Kept as a pure function rather than being spread through the hook so the
 * policy can be read, argued with and tested in one sitting — and so the same
 * rules can be re-run server-side by the Cloud Function.
 *
 * The ordering matters. GPS is the primary gate and the IP check is a
 * secondary signal, because the failure modes are not symmetrical:
 *
 *   - A wrong GPS position means the person is not at the shop. Block.
 *   - A missing IP reading usually means an echo service timed out, not fraud.
 *     Blocking the whole shop because api.ipify.org is down would be a worse
 *     outcome than letting a verified-in-range punch through with a warning —
 *     and the *server* still checks the real request IP, so this leniency is
 *     client-side only.
 */

export const ACCESS = {
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
  /** Still acquiring a fix — show a spinner, not an error. */
  PENDING: 'pending',
};

export const BLOCK_REASON = {
  PERMISSION_DENIED: 'permission-denied',
  GEO_UNAVAILABLE: 'geo-unavailable',
  IMPRECISE_FIX: 'imprecise-fix',
  OUT_OF_RANGE: 'out-of-range',
  WRONG_NETWORK: 'wrong-network',
};

export const WARNING = {
  NETWORK_UNVERIFIED: 'network-unverified',
  NETWORK_MISMATCH_ADVISORY: 'network-mismatch-advisory',
  BORDERLINE_FIX: 'borderline-fix',
  /** Location checks were skipped entirely. Never quiet about this one. */
  DEV_MODE_BYPASS: 'dev-mode-bypass',
  /** Overtime clock-out: the network check does not apply. */
  OVERTIME_NETWORK_EXEMPT: 'overtime-network-exempt',
};

/** What the person is trying to do — it changes which checks apply. */
export const INTENT = {
  CHECK_IN: 'check_in',
  CHECK_OUT: 'check_out',
  /**
   * A clock-out with an overtime claim.
   *
   * This one is exempt from the network check, and the reasoning is worth
   * recording: the shop router is often off by the time someone finishes a
   * late shift, so a staff member owed overtime would be the person most
   * likely to be blocked by an IP rule. The geofence still applies in full —
   * they must still physically be at the shop — so the thing the check exists
   * to prove is still proved, just by the stronger of the two signals.
   */
  OVERTIME_CHECK_OUT: 'overtime_check_out',
};

/**
 * @param fence      result of evaluateFence()
 * @param network    result of evaluateNetwork()
 * @param permission browser geolocation permission state
 * @param geoError   human-readable geolocation failure, if any
 * @param devMode    when true, every location check is skipped
 * @param intent     one of INTENT
 *
 * Every verdict carries an English `title`/`detail` **and** a `titleKey` /
 * `detailKey` with the parameters they interpolate. The English pair keeps this
 * module usable from tests and non-React callers; the keys let the UI re-render
 * the same verdict in the reader's language without this module importing
 * i18next — a pure function that reaches for a global translator is neither
 * pure nor testable.
 */
export function evaluateAccess({
  fence,
  network,
  permission,
  geoError,
  branchName = 'the shop',
  devMode = false,
  intent = INTENT.CHECK_IN,
}) {
  /* ---- developer bypass -------------------------------------------------
     Deliberately the very first thing checked, so a developer testing from
     another country is not blocked by a permission prompt they will never be
     able to satisfy. The warning rides along so the UI can say so loudly. */
  if (devMode) {
    return {
      access: ACCESS.ALLOWED,
      reason: null,
      title: 'Location checks bypassed',
      detail: 'Developer mode is on. Geofencing and the network check are disabled.',
      titleKey: 'location.devBypass',
      detailKey: 'location.devBypassDetail',
      params: {},
      warnings: [WARNING.DEV_MODE_BYPASS],
      bypassed: true,
    };
  }

  if (permission === 'denied') {
    return blocked(BLOCK_REASON.PERMISSION_DENIED, {
      title: 'Location is blocked',
      detail:
        'Attendance can only be logged at the shop, so the browser needs location access. Enable it in the site settings, then try again.',
      titleKey: 'location.blocked',
      detailKey: 'location.blockedDetail',
    });
  }

  if (geoError) {
    /* `geoError` is the browser's own sentence and is not translatable — it is
       passed through as the detail rather than dropped, because it is often the
       only clue to what the device is actually refusing. */
    return blocked(BLOCK_REASON.GEO_UNAVAILABLE, {
      title: 'Cannot read location',
      detail: geoError,
      titleKey: 'location.cannotRead',
      detailKey: null,
    });
  }

  if (!fence || fence.verdict === FENCE.UNKNOWN) {
    return {
      access: ACCESS.PENDING,
      reason: null,
      title: 'Finding you…',
      detail: null,
      titleKey: 'location.finding',
      detailKey: null,
      params: {},
      warnings: [],
    };
  }

  if (fence.verdict === FENCE.IMPRECISE) {
    return blocked(BLOCK_REASON.IMPRECISE_FIX, {
      title: 'Signal is too weak to confirm',
      detail: `The location is only accurate to about ${Math.round(fence.accuracy)} m, and we need ${fence.requiredAccuracy} m or better. Step closer to a window or door and wait a moment.`,
      titleKey: 'location.imprecise',
      detailKey: 'location.impreciseDetail',
      params: { accuracy: Math.round(fence.accuracy), required: fence.requiredAccuracy },
    });
  }

  if (fence.verdict === FENCE.OUTSIDE) {
    return blocked(BLOCK_REASON.OUT_OF_RANGE, {
      title: `Too far from ${branchName}`,
      detail: `You need to be within ${fence.radius} m. You are about ${Math.round(fence.overshootMeters)} m outside that.`,
      titleKey: 'location.tooFar',
      detailKey: 'location.tooFarDetail',
      params: {
        branch: branchName,
        radius: fence.radius,
        over: Math.round(fence.overshootMeters),
      },
    });
  }

  /* Inside the fence. Now the network, which can only downgrade to a warning
     or — when the branch enforces it — a block. */
  const warnings = [];
  if (fence.borderline) warnings.push(WARNING.BORDERLINE_FIX);

  /* ---- overtime carve-out ---- */
  if (intent === INTENT.OVERTIME_CHECK_OUT) {
    return {
      access: ACCESS.ALLOWED,
      reason: null,
      title: `At ${branchName}`,
      detail: null,
      titleKey: 'location.at',
      detailKey: null,
      params: { branch: branchName },
      warnings: [...warnings, WARNING.OVERTIME_NETWORK_EXEMPT],
    };
  }

  const verdict = network?.verdict ?? NETWORK.SKIPPED;

  if (verdict === NETWORK.MISMATCH) {
    if (network.enforced) {
      return blocked(BLOCK_REASON.WRONG_NETWORK, {
        title: 'Not on the shop Wi-Fi',
        detail:
          'You appear to be at the shop but on a different network. Connect to the shop Wi-Fi and try again.',
        titleKey: 'location.wrongNetwork',
        detailKey: 'location.wrongNetworkDetail',
      });
    }
    warnings.push(WARNING.NETWORK_MISMATCH_ADVISORY);
  }

  if (verdict === NETWORK.UNKNOWN) {
    /* Cannot read our own address. Allow, warn, and let the server decide. */
    warnings.push(WARNING.NETWORK_UNVERIFIED);
  }

  return {
    access: ACCESS.ALLOWED,
    reason: null,
    title: `At ${branchName}`,
    detail: null,
    titleKey: 'location.at',
    detailKey: null,
    params: { branch: branchName },
    warnings,
  };
}

const blocked = (reason, { title, detail, titleKey = null, detailKey = null, params = {} }) => ({
  access: ACCESS.BLOCKED,
  reason,
  titleKey,
  detailKey,
  params,
  title,
  detail,
  warnings: [],
  bypassed: false,
});
