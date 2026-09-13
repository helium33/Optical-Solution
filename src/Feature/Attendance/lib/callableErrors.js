/**
 * Whether a callable Cloud Function failure means "this function does not
 * exist on the server" rather than a rejection *from* a function that does.
 *
 * A project with at least one callable deployed reports a missing one as a
 * clean `functions/not-found` — an HTTP 404 the SDK maps precisely. This
 * project has none of its callables deployed at all, and Cloud Functions has
 * never been provisioned on the underlying GCP project either, which does not
 * reliably produce that clean 404: with nothing ever deployed there, the
 * request can fail before it ever reaches a real callable-protocol response.
 * Seen in practice, all for the exact same underlying cause: `internal`,
 * `unavailable`, and — because a request that fails at the transport layer,
 * before the callable wrapper gets to attach one, has no `functions/` prefix
 * to attach it to — the bare, unprefixed form of any of these. This module's
 * own `unlockKiosk` already has one bare code for the same reason
 * (`error.code = 'deadline-exceeded'` on its own timeout race, checked
 * alongside `functions/deadline-exceeded`); this generalises that.
 *
 * All of these mean the same thing here: the function is not there yet, not
 * that a deployed function rejected the call. Two narrower versions of this
 * check each let one real case slip through as a raw, unhandled error instead
 * of the "not deployed" message every other undeployed-callable path shows:
 * first `internal`, then the bare (unprefixed) `unavailable` that surfaced as
 * "Cannot reach the server" — accurate as far as it went, but not the
 * specific, actionable message this project's other undeployed-callable
 * failures already get.
 */
export function isCallableUnavailable(error) {
  // Firebase's own FunctionsError always prefixes with 'functions/'; a
  // transport-layer failure that never reached that wrapper does not. Strip
  // an optional prefix once rather than listing both forms of every code.
  const code = String(error?.code ?? '').replace(/^functions\//, '');
  return code === 'not-found' || code === 'internal' || code === 'unavailable';
}
