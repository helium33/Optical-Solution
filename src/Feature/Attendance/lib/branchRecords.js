import { BRANCHES, BRANCH_LIST } from '../config/branches';

/**
 * Merge a Firestore branch record over the built-in one, field by field.
 *
 * The built-in record (config/branches.js) is complete; a stored one may hold
 * only what an admin has changed — a shift, a pin — so the nested objects are
 * merged rather than replaced, or saving a new shift end would wipe the
 * grace window.
 */
export function hydrateBranch(id, remote) {
  const local = BRANCHES[id] ?? {};
  if (!remote) return local;
  return {
    ...local,
    ...remote,
    id,
    geofence: { ...local.geofence, ...(remote.geofence ?? {}) },
    network: { ...local.network, ...(remote.network ?? {}) },
    shift: { ...local.shift, ...(remote.shift ?? {}) },
    /* Never let a PIN record reach component state, even if rules leak it. */
    kioskPin: undefined,
  };
}

/**
 * Every shop, always — each with whatever the database holds for it.
 *
 * This used to be "the built-in list if the collection is empty, otherwise
 * exactly the documents that exist". That was fine while every shop had a
 * document or none did. But this project has never had branch documents, and
 * the first time an admin saved Win's shift it would have created exactly one
 * — at which point the kiosk would have shown Win and nothing else, with Pwint
 * and Yangon gone from the shop picker until someone happened to save those
 * too. A shop's existence comes from the code; the database only adjusts it.
 *
 * @param {Array<{id:string, data:object}>} records  stored documents, any subset
 */
export function mergeBranchRecords(records = []) {
  const byId = Object.fromEntries(records.map((record) => [record.id, record.data]));
  return BRANCH_LIST.map((branch) => hydrateBranch(branch.id, byId[branch.id]));
}
