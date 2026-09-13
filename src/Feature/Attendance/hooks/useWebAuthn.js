import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../config/firebase';
import { base64UrlToBytes, bytesToBase64Url } from '../lib/crypto';
import { isCallableUnavailable } from '../lib/callableErrors';

/**
 * Fingerprint / Face unlock at the kiosk, via WebAuthn.
 *
 * WHAT THIS HOOK IS AND IS NOT
 *
 * WebAuthn is a challenge–response protocol between a server and an
 * authenticator. The browser is only the courier. Everything that makes it
 * secure happens on the two ends this hook does not control:
 *
 *   - the CHALLENGE must be freshly generated and stored server-side. A
 *     challenge invented in the browser can be replayed, which reduces the
 *     whole ceremony to "the device said yes", and a tampered client always
 *     says yes.
 *   - the ASSERTION must be verified server-side: signature against the stored
 *     public key, origin, rpId, and a signature counter that only goes up.
 *
 * So this hook talks to two callables and does no verification of its own. If
 * they are not deployed, biometrics are reported as unavailable and the kiosk
 * falls back to PIN — which is the correct failure direction. There is
 * deliberately no "client-side only" development mode here, because a fake
 * fingerprint check that always passes is worse than no fingerprint check.
 *
 * Note also that the biometric never leaves the device: the authenticator
 * releases a signature, not a fingerprint. Nothing biometric is ever stored in
 * Firestore.
 */

const beginRegistration = httpsCallable(functions, 'beginWebAuthnRegistration');
const finishRegistration = httpsCallable(functions, 'finishWebAuthnRegistration');
const beginAuthentication = httpsCallable(functions, 'beginWebAuthnAuthentication');

export function useWebAuthn() {
  const [supported] = useState(
    () => typeof window !== 'undefined' && Boolean(window.PublicKeyCredential),
  );
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* "Supported" means the API exists; "available" means this device actually
     has a built-in authenticator (a fingerprint reader, Face ID). A desktop
     without one supports the API and can do nothing useful with it. */
  useEffect(() => {
    if (!supported) return;
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, [supported]);

  /** Enrol a new fingerprint for a staff member. Admin/supervisor action. */
  const enroll = useCallback(
    async (staff) => {
      setBusy(true);
      setError(null);
      try {
        const { data: options } = await beginRegistration({ staffId: staff.id });

        const credential = await navigator.credentials.create({
          publicKey: {
            ...options,
            challenge: base64UrlToBytes(options.challenge),
            user: {
              ...options.user,
              id: base64UrlToBytes(options.user.id),
            },
            excludeCredentials: (options.excludeCredentials ?? []).map((entry) => ({
              ...entry,
              id: base64UrlToBytes(entry.id),
            })),
            authenticatorSelection: {
              /* Built-in sensor only — a roaming USB key defeats the point of
                 tying the punch to the shop's own tablet. */
              authenticatorAttachment: 'platform',
              userVerification: 'required',
              residentKey: 'preferred',
            },
          },
        });

        if (!credential) throw new Error('Enrolment was cancelled.');

        const result = await finishRegistration({
          staffId: staff.id,
          credential: serialiseAttestation(credential),
          deviceLabel: navigator.userAgent.slice(0, 120),
        });
        return result.data;
      } catch (enrolError) {
        const message = toMessage(enrolError);
        setError(message);
        throw Object.assign(new Error(message), { cause: enrolError });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /**
   * Prove a staff member's identity. Returns the assertion for submitPunch to
   * forward — this hook never decides whether it was valid.
   */
  const verify = useCallback(async (staff) => {
    setBusy(true);
    setError(null);
    try {
      const { data: options } = await beginAuthentication({ staffId: staff.id });

      const assertion = await navigator.credentials.get({
        publicKey: {
          ...options,
          challenge: base64UrlToBytes(options.challenge),
          allowCredentials: (options.allowCredentials ?? []).map((entry) => ({
            ...entry,
            id: base64UrlToBytes(entry.id),
          })),
          userVerification: 'required',
          timeout: 60_000,
        },
      });

      if (!assertion) throw new Error('No fingerprint was provided.');
      return serialiseAssertion(assertion);
    } catch (verifyError) {
      const message = toMessage(verifyError);
      setError(message);
      throw Object.assign(new Error(message), { cause: verifyError });
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, available, busy, error, enroll, verify, clearError: () => setError(null) };
}

/* ─────────────── ArrayBuffer <-> base64url at the JSON boundary ───────── */

const serialiseAttestation = (credential) => ({
  id: credential.id,
  rawId: bytesToBase64Url(credential.rawId),
  type: credential.type,
  response: {
    clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
    attestationObject: bytesToBase64Url(credential.response.attestationObject),
    transports: credential.response.getTransports?.() ?? [],
  },
});

const serialiseAssertion = (assertion) => ({
  id: assertion.id,
  rawId: bytesToBase64Url(assertion.rawId),
  type: assertion.type,
  response: {
    clientDataJSON: bytesToBase64Url(assertion.response.clientDataJSON),
    authenticatorData: bytesToBase64Url(assertion.response.authenticatorData),
    signature: bytesToBase64Url(assertion.response.signature),
    userHandle: assertion.response.userHandle
      ? bytesToBase64Url(assertion.response.userHandle)
      : null,
  },
});

function toMessage(error) {
  const name = error?.name ?? error?.cause?.name ?? '';
  if (name === 'NotAllowedError') return 'Fingerprint not recognised, or the prompt was dismissed.';
  if (name === 'InvalidStateError') return 'This device is already enrolled for that person.';
  if (name === 'SecurityError') return 'Biometrics need a secure (HTTPS) connection.';
  /* Same "not deployed" family as every other callable in this app — not-
     found/internal/unavailable, prefixed or bare. Matched the module intent
     ("biometrics are reported as unavailable") but the narrower check that
     only caught `functions/not-found` let this project's actual failure
     shape (`functions/internal`) reach the kiosk as a raw, untranslated
     message instead. */
  if (isCallableUnavailable(error)) {
    return 'Biometric sign-in is not set up on the server yet. Use a PIN.';
  }
  return error?.message ?? 'Fingerprint check failed.';
}
