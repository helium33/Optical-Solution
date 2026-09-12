import { LuTriangleAlert } from 'react-icons/lu';
import { DEV_MODE } from '../../config/devMode';

/**
 * Permanent, unmissable notice that location checks are off.
 *
 * A console warning is not enough for this one. Developer mode makes the app
 * accept a clock-in from anywhere on earth, and the failure mode is that
 * somebody forgets it is on — so the reminder has to be in the way of using
 * the app, not somewhere you have to go looking.
 *
 * It is not dismissible on purpose.
 */
export default function DevModeBanner() {
  if (!DEV_MODE) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2.5 bg-warn px-4 py-2 text-center text-[13px] font-bold text-[rgb(46,36,16)]"
    >
      <LuTriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Developer mode — location checks are off. Attendance can be logged from anywhere, and
        these records are tagged as unverified.
      </span>
    </div>
  );
}
