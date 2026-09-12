import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSecretSequence } from '../hooks/useSecretSequence';
import { ADMIN_SEQUENCE, revealAdmin } from '../services/adminReveal';

/**
 * Renders nothing. Listens for the sequence that reveals the administrator
 * sign-in, and navigates there when it hears it.
 *
 * It listens on EVERY screen, including the ones with a PIN pad open.
 *
 * An earlier version switched itself off whenever a pad was on screen, to stop
 * a staff member whose personal PIN happened to be 7860 from revealing the
 * admin door by clocking in. That solved a narrow problem by breaking the
 * common case: the unlock screen is the first thing on the tablet and the most
 * natural place for an owner to type the sequence, and there it did nothing at
 * all.
 *
 * The collision is now closed where it actually belongs — at PIN assignment.
 * The admin sequence is refused as a staff or branch PIN (see AddStaffDialog
 * and scripts/seed-pins.mjs), so no real PIN can ever collide with it, and the
 * shortcut works from anywhere.
 *
 * Keystrokes typed into a real field — a name, a reason, a search box — are
 * still ignored, so entering "7860" as data does not trip it.
 */
export default function SecretAdminDoor() {
  const navigate = useNavigate();

  const open = useCallback(() => {
    revealAdmin();
    navigate('/attendance/admin/login');
  }, [navigate]);

  useSecretSequence(ADMIN_SEQUENCE, open);
  return null;
}
