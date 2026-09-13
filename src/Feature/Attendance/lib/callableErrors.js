/**
 * Whether a callable Cloud Function failure means "this function does not
 * exist on the server" rather than a rejection *from* a function that does.
 *
 * A project with at least one callable deployed reports a missing one as a
 * clean `functions/not-found` — an HTTP 404 the SDK maps precisely. This
 * project has none of its callables deployed at all, and Cloud Functions has
 * never been provisioned on the underlying GCP project either, which does not
 * reliably produce that clean 404: with nothing ever deployed there, the
 * request can fail before it ever reaches a real callable-protocol response,
 * and the client SDK falls back to a generic `internal` — or, depending on
 * exactly which piece of the path failed, `unavailable` — instead of the
 * cleaner `not-found`. All three mean the same thing here: the function is
 * not there yet, not that a deployed function rejected the call.
 *
 * A narrower check that only matched `functions/not-found` is what let this
 * exact case fall through to a raw, unhandled `internal` error reaching the
 * UI instead of the "not deployed" message every other undeployed-callable
 * path already shows.
 */
export function isCallableUnavailable(error) {
  const code = error?.code;
  return (
    code === 'functions/not-found' ||
    code === 'functions/internal' ||
    code === 'functions/unavailable'
  );
}
