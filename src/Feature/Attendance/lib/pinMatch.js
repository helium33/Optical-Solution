/**
 * What a set of per-person PIN results means. Pure — no WebCrypto, no
 * Firestore — so the rule that decides whose screen a PIN opens can be tested
 * on its own.
 *
 * More than one match is refused, never resolved by picking one. When a PIN on
 * its own decides who someone is, two people in a shop sharing a PIN means one
 * of them lands on the other's screen and clocks in as them — and nothing on
 * the screen would look wrong. Refusing is the only safe answer; the admin
 * screens refuse to create the clash in the first place.
 *
 * @param {Array<{person:object, ok:boolean}>} checked
 * @returns {{ok:true, staff:object} | {ok:false, reason:'wrong-pin'|'pin-ambiguous', count?:number}}
 */
export function pickStaffMatch(checked) {
  const matches = checked.filter((entry) => entry.ok);
  if (matches.length === 1) return { ok: true, staff: matches[0].person };
  if (matches.length > 1) return { ok: false, reason: 'pin-ambiguous', count: matches.length };
  return { ok: false, reason: 'wrong-pin' };
}
