import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSecretSequence } from '../hooks/useSecretSequence';
import { usePinEntryOpen } from '../services/pinEntryLock';
import { ADMIN_SEQUENCE, revealAdmin } from '../services/adminReveal';

/**
 * Renders nothing. Listens for the sequence that reveals the administrator
 * sign-in, and navigates there when it hears it.
 *
 * Its own component rather than a few lines inside the layout, because the
 * preview harness mounts its own provider stack and would otherwise silently
 * not have it — which is exactly how a feature ends up looking broken in the
 * one place anyone is looking at it.
 *
 * Inert while a PIN pad is open: the kiosk keypad also listens for digits, and
 * a staff member whose personal PIN happens to be 7860 must not reveal the
 * admin door by clocking in.
 */
export default function SecretAdminDoor() {
  const navigate = useNavigate();
  const pinEntryOpen = usePinEntryOpen();

  const open = useCallback(() => {
    revealAdmin();
    navigate('/attendance/admin/login');
  }, [navigate]);

  useSecretSequence(ADMIN_SEQUENCE, open, { enabled: !pinEntryOpen });
  return null;
}
