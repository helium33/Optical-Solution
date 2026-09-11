import { LuCircleCheck, LuCircleAlert, LuCircleX, LuTimer, LuClock } from 'react-icons/lu';
import { ATTENDANCE_STATUS } from '../../lib/time';

/**
 * Status is never carried by colour alone — every pill is icon + word + tint.
 * That is an accessibility requirement (red/green is the most common colour
 * deficiency) and it is also just clearer at a glance across a shop floor.
 */

const VARIANTS = {
  [ATTENDANCE_STATUS.ON_TIME]: {
    label: 'On time',
    Icon: LuCircleCheck,
    className: 'bg-ok-soft text-ok-ink ring-ok/25',
  },
  [ATTENDANCE_STATUS.LATE]: {
    label: 'Late',
    Icon: LuCircleAlert,
    className: 'bg-warn-soft text-warn-ink ring-warn/30',
  },
  [ATTENDANCE_STATUS.ABSENT]: {
    label: 'Absent',
    Icon: LuCircleX,
    className: 'bg-danger-soft text-danger-ink ring-danger/25',
  },
  [ATTENDANCE_STATUS.INCOMPLETE]: {
    label: 'On shift',
    Icon: LuClock,
    className: 'bg-brand-500/10 text-brand-ink ring-brand-500/20',
  },
  overtime: {
    label: 'Overtime',
    Icon: LuTimer,
    className: 'bg-ot-soft text-ot-ink ring-ot/30',
  },
};

export default function StatusPill({ status, label, size = 'md', className = '' }) {
  const variant = VARIANTS[status] ?? VARIANTS[ATTENDANCE_STATUS.INCOMPLETE];
  const { Icon } = variant;
  const scale =
    size === 'sm'
      ? 'px-2 py-0.5 text-[11px] gap-1'
      : 'px-2.5 py-1 text-xs gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ring-1 ${scale} ${variant.className} ${className}`}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />
      {label ?? variant.label}
    </span>
  );
}
