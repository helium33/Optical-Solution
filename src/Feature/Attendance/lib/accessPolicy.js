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
};

export function evaluateAccess({ fence, network, permission, geoError, branchName = 'the shop' }) {
  if (permission === 'denied') {
    return blocked(BLOCK_REASON.PERMISSION_DENIED, {
      title: 'Location is blocked',
      detail:
        'Attendance can only be logged at the shop, so the browser needs location access. Enable it in the site settings, then try again.',
    });
  }

  if (geoError) {
    return blocked(BLOCK_REASON.GEO_UNAVAILABLE, {
      title: 'Cannot read location',
      detail: geoError,
    });
  }

  if (!fence || fence.verdict === FENCE.UNKNOWN) {
    return { access: ACCESS.PENDING, reason: null, title: 'Finding you…', detail: null, warnings: [] };
  }

  if (fence.verdict === FENCE.IMPRECISE) {
    return blocked(BLOCK_REASON.IMPRECISE_FIX, {
      title: 'Signal is too weak to confirm',
      detail: `The location is only accurate to about ${Math.round(fence.accuracy)} m, and we need ${fence.requiredAccuracy} m or better. Step closer to a window or door and wait a moment.`,
    });
  }

  if (fence.verdict === FENCE.OUTSIDE) {
    return blocked(BLOCK_REASON.OUT_OF_RANGE, {
      title: `Too far from ${branchName}`,
      detail: `You need to be within ${fence.radius} m. You are about ${Math.round(fence.overshootMeters)} m outside that.`,
    });
  }

  /* Inside the fence. Now the network, which can only downgrade to a warning
     or — when the branch enforces it — a block. */
  const warnings = [];
  if (fence.borderline) warnings.push(WARNING.BORDERLINE_FIX);

  const verdict = network?.verdict ?? NETWORK.SKIPPED;

  if (verdict === NETWORK.MISMATCH) {
    if (network.enforced) {
      return blocked(BLOCK_REASON.WRONG_NETWORK, {
        title: 'Not on the shop Wi-Fi',
        detail:
          'You appear to be at the shop but on a different network. Connect to the shop Wi-Fi and try again.',
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
    warnings,
  };
}

const blocked = (reason, { title, detail }) => ({
  access: ACCESS.BLOCKED,
  reason,
  title,
  detail,
  warnings: [],
});
