import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { evaluateFence, FENCE } from '../lib/geo';
import { evaluateNetwork, fetchPublicIp, NETWORK } from '../lib/network';
import { evaluateAccess, ACCESS, INTENT } from '../lib/accessPolicy';
import { DEV_MODE } from '../config/devMode';

/**
 * Location gate for the kiosk: HTML5 Geolocation measured against the branch
 * pin with the Haversine formula, combined with an egress-IP check.
 *
 * Uses watchPosition rather than a one-shot getCurrentPosition. The first fix a
 * device returns is usually the coarse network-derived one (hundreds of metres
 * of error); the GPS fix lands a second or two later. Watching means the UI
 * shows the accuracy tightening in real time and a staff member standing in
 * the doorway is let in as soon as the radio catches up, instead of being told
 * "too far" based on the first bad sample.
 *
 * When DEV_MODE is on the radios are never touched at all — there is no point
 * spinning up a GPS watch whose answer is going to be ignored, and asking for a
 * location permission you do not intend to honour trains people to grant it
 * without reading.
 *
 * @param {object|null} branch          branch record (geofence + network)
 * @param {boolean}     options.enabled false parks the hook (no radio use)
 * @param {number}      options.ipRefreshMs how often to re-read the public IP
 * @param {string}      options.intent  one of INTENT — overtime skips the IP check
 */
export function useGeoFence(
  branch,
  { enabled = true, ipRefreshMs = 5 * 60_000, intent = INTENT.CHECK_IN } = {},
) {
  const [position, setPosition] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [permission, setPermission] = useState('prompt');
  const [ip, setIp] = useState(null);
  const [ipChecked, setIpChecked] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const watchId = useRef(null);

  /* ---- permission state, where the browser exposes it ---- */
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((result) => {
        if (cancelled) return;
        setPermission(result.state);
        result.addEventListener('change', () => setPermission(result.state));
      })
      .catch(() => {
        /* Safari <16 has no Permissions API for geolocation; the error
           callback below is the fallback signal. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- position watch ---- */
  useEffect(() => {
    if (!enabled || !branch || DEV_MODE) return undefined;

    if (!navigator.geolocation) {
      setGeoError('This browser cannot report a location.');
      return undefined;
    }

    setGeoError(null);

    watchId.current = navigator.geolocation.watchPosition(
      (fix) => {
        setGeoError(null);
        setPermission('granted');
        setPosition({
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracy: fix.coords.accuracy,
          at: fix.timestamp,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setPermission('denied');
          setGeoError(null); // the policy has a better message for this case
          return;
        }
        setGeoError(
          error.code === error.TIMEOUT
            ? 'Timed out waiting for a location. Move somewhere with a clearer view of the sky.'
            : 'Location is unavailable on this device right now.',
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 20_000,
        /* Accept a fix up to 15 s old — long enough to avoid re-waking the GPS
           on every render, short enough that it is still "now". */
        maximumAge: 15_000,
      },
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled, branch, refreshNonce]);

  /* ---- public IP, polled slowly ---- */
  useEffect(() => {
    if (!enabled || DEV_MODE || !branch?.network?.allowedCidrs?.length) {
      setIpChecked(true);
      return undefined;
    }

    let cancelled = false;
    const read = async () => {
      const value = await fetchPublicIp();
      if (cancelled) return;
      setIp(value);
      setIpChecked(true);
    };

    read();
    const timer = setInterval(read, ipRefreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, branch, ipRefreshMs, refreshNonce]);

  const fence = useMemo(
    () => (branch ? evaluateFence(position, branch.geofence) : null),
    [position, branch],
  );

  const network = useMemo(() => {
    if (!branch) return null;
    if (!ipChecked) return { verdict: NETWORK.UNKNOWN, ip: null, enforced: Boolean(branch.network?.enforce), pending: true };
    return evaluateNetwork(ip, branch.network);
  }, [ip, ipChecked, branch]);

  const policy = useMemo(
    () =>
      evaluateAccess({
        fence,
        network,
        permission,
        geoError,
        branchName: branch?.shortName ?? branch?.name ?? 'the shop',
        devMode: DEV_MODE,
        intent,
      }),
    [fence, network, permission, geoError, branch, intent],
  );

  /**
   * Re-run the same policy for a different intent.
   *
   * The overtime carve-out is decided in the clock-out dialog, not here — the
   * switch is flipped after the fence has already been evaluated. Rather than
   * pushing that state back up into the page, the dialog asks for the verdict
   * it needs against the fix already in hand. Same inputs, same function, one
   * policy.
   */
  const evaluateFor = useCallback(
    (nextIntent) =>
      evaluateAccess({
        fence,
        network,
        permission,
        geoError,
        branchName: branch?.shortName ?? branch?.name ?? 'the shop',
        devMode: DEV_MODE,
        intent: nextIntent,
      }),
    [fence, network, permission, geoError, branch],
  );

  /** Drop the current fix and re-acquire — the "Try again" button. */
  const refresh = useCallback(() => {
    setPosition(null);
    setIpChecked(false);
    setRefreshNonce((n) => n + 1);
  }, []);

  return {
    /* raw */
    position,
    ip,
    permission,
    geoError,
    /* derived */
    fence,
    network,
    /* verdict */
    policy,
    allowed: policy.access === ACCESS.ALLOWED,
    pending: policy.access === ACCESS.PENDING,
    blocked: policy.access === ACCESS.BLOCKED,
    /* Was this punch allowed only because the checks were skipped? The punch
       payload carries it so the record can be tagged. */
    bypassed: Boolean(policy.bypassed),
    devMode: DEV_MODE,
    /* actions */
    evaluateFor,
    refresh,
  };
}

export { FENCE, NETWORK, ACCESS, INTENT };
