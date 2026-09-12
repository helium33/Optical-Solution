/**
 * Geofence stand-in for the preview.
 *
 * The real hook asks for the browser's location. Inside an embedded preview
 * frame that request is usually refused outright, which would park every
 * screen on "Location is blocked" and hide everything the preview exists to
 * show. So this reports a plausible in-range fix instead.
 *
 * It returns the same shape as the real hook, including the `policy` object,
 * so GeoStatusPill and PunchDialog are the genuine components reading genuine
 * state — only the sensor is simulated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { evaluateFence } from '../src/Feature/Attendance/lib/geo';
import { evaluateNetwork } from '../src/Feature/Attendance/lib/network';
import { evaluateAccess, ACCESS, INTENT } from '../src/Feature/Attendance/lib/accessPolicy';
import { FENCE } from '../src/Feature/Attendance/lib/geo';
import { NETWORK } from '../src/Feature/Attendance/lib/network';

/** ~7 m from the pin with an 11 m error bar: comfortably inside 50 m. */
const simulatedFix = (branch) =>
  branch
    ? {
        latitude: branch.geofence.lat + 0.00006,
        longitude: branch.geofence.lng + 0.00002,
        accuracy: 11,
        at: Date.now(),
      }
    : null;

export function useGeoFence(branch) {
  const [position, setPosition] = useState(() => simulatedFix(branch));

  useEffect(() => setPosition(simulatedFix(branch)), [branch]);

  const ip = branch?.network?.allowedCidrs?.[0]?.split('/')[0]?.replace(/\.0$/, '.17') ?? null;

  const fence = useMemo(
    () => (branch ? evaluateFence(position, branch.geofence) : null),
    [position, branch],
  );
  const network = useMemo(
    () => (branch ? evaluateNetwork(ip, branch.network) : null),
    [ip, branch],
  );
  const policy = useMemo(
    () =>
      evaluateAccess({
        fence,
        network,
        permission: 'granted',
        geoError: null,
        branchName: branch?.shortName ?? 'the shop',
      }),
    [fence, network, branch],
  );

  const evaluateFor = useCallback(
    (intent) =>
      evaluateAccess({
        fence,
        network,
        permission: 'granted',
        geoError: null,
        branchName: branch?.shortName ?? 'the shop',
        intent,
      }),
    [fence, network, branch],
  );

  const refresh = useCallback(() => setPosition(simulatedFix(branch)), [branch]);

  return {
    position,
    ip,
    permission: 'granted',
    geoError: null,
    fence,
    network,
    policy,
    allowed: policy.access === ACCESS.ALLOWED,
    pending: policy.access === ACCESS.PENDING,
    blocked: policy.access === ACCESS.BLOCKED,
    bypassed: false,
    devMode: false,
    evaluateFor,
    refresh,
  };
}

export { FENCE, NETWORK, ACCESS, INTENT };
