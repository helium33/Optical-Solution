import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { BRANCH_LIST, BRANCHES } from './branches';
import { subscribeBranches } from '../services/branches.service';

/**
 * Live branch configuration.
 *
 * Until now every screen read the shift, grace and geofence straight out of
 * `config/branches.js` — a file compiled into the bundle. That made the
 * settings editor pointless by construction: an owner could change the shift
 * end, save it to Firestore, and the kiosk would carry on using whatever was
 * built into the JavaScript. Anything that decides how someone is paid has to
 * come from the database.
 *
 * One subscription for the whole app rather than one per screen, and the
 * static file stays as the offline fallback: if Firestore is unreachable the
 * kiosk still knows where the shop is and when the shift ends.
 *
 * Note what this deliberately does NOT do: changing a shift does not rewrite
 * history. Every attendance record freezes the shift it was punched against in
 * `shiftSnapshot`, so tightening the grace window tomorrow cannot retroactively
 * make yesterday's arrivals late.
 */

const BranchesContext = createContext(null);

export function BranchesProvider({ children }) {
  const [branches, setBranches] = useState(BRANCH_LIST);
  const [live, setLive] = useState(false);

  useEffect(
    () =>
      subscribeBranches(
        (next) => {
          setBranches(next);
          setLive(true);
        },
        () => {
          /* Denied or offline — the fallback is already in state. The kiosk
             keeps working on the compiled-in config rather than going blank. */
          setLive(false);
        },
      ),
    [],
  );

  const value = useMemo(() => {
    const byId = Object.fromEntries(branches.map((branch) => [branch.id, branch]));
    return {
      branches,
      byId,
      /** Falls back to the static record so a caller never gets undefined. */
      get: (id) => byId[id] ?? BRANCHES[id] ?? null,
      /** False means these values came from the bundle, not the database. */
      live,
    };
  }, [branches, live]);

  return <BranchesContext.Provider value={value}>{children}</BranchesContext.Provider>;
}

export function useBranches() {
  const ctx = useContext(BranchesContext);
  /* Usable outside the provider (the preview mounts its own shell) — it just
     returns the static config, which is the same thing the fallback gives. */
  if (!ctx) {
    return {
      branches: BRANCH_LIST,
      byId: BRANCHES,
      get: (id) => BRANCHES[id] ?? null,
      live: false,
    };
  }
  return ctx;
}

export function useBranch(branchId) {
  const { get } = useBranches();
  return branchId ? get(branchId) : null;
}
