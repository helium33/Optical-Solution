import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuMapPin, LuWifi, LuWifiOff, LuRefreshCw, LuChevronDown } from 'react-icons/lu';

import Spinner from '../ui/Spinner';
import { usePolicyText } from '../../i18n/policyText';
import { ACCESS, WARNING } from '../../lib/accessPolicy';
import { NETWORK } from '../../lib/network';
import { formatDistance } from '../../lib/geo';

/**
 * Live location status.
 *
 * The design intent: when everything is fine this is a quiet one-line pill that
 * nobody reads. When something is wrong it expands into an instruction — "step
 * closer to a window", not "GEOLOCATION_ERROR_2". The distance and accuracy are
 * always visible on expand, because the single most common support question is
 * "why does it say I'm not here?" and the answer is usually a number.
 */
export default function GeoStatusPill({ geo, className = '' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { policy, fence, network } = geo;
  const text = usePolicyText(policy);
  const pending = policy.access === ACCESS.PENDING;
  const allowed = policy.access === ACCESS.ALLOWED;

  const tone = pending
    ? 'bg-surface-sunken text-ink-muted ring-line'
    : allowed
      ? 'bg-ok-soft text-ok-ink ring-ok/30'
      : 'bg-danger-soft text-danger-ink ring-danger/30';

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left ring-1 transition-all duration-300 ease-expo ${tone}`}
      >
        <span className="relative grid h-5 w-5 shrink-0 place-items-center">
          {pending ? (
            <Spinner size={16} />
          ) : (
            <>
              {/* Radar sweep — only while the fence is satisfied, so motion
                  means "live and good" rather than generic decoration. */}
              {allowed ? (
                <span className="absolute inset-0 animate-ring rounded-full bg-ok/40" aria-hidden="true" />
              ) : null}
              <LuMapPin className="relative h-4 w-4" aria-hidden="true" />
            </>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {text.title}
          </span>
          {fence?.distance != null && !pending ? (
            <span className="block truncate text-[11px] font-medium opacity-70">
              {t('location.fromPin', { distance: formatDistance(fence.distance) })}
              {fence.accuracy != null ? ` · ±${Math.round(fence.accuracy)} m` : ''}
            </span>
          ) : null}
        </span>

        <LuChevronDown
          className={`h-4 w-4 shrink-0 opacity-60 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="animate-fade-up mt-2 space-y-3 rounded-2xl border border-line bg-surface-card p-4 shadow-soft">
          {text.detail ? <p className="text-sm leading-relaxed text-ink-muted">{text.detail}</p> : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Row
              label={t('location.distance')}
              value={fence?.distance != null ? formatDistance(fence.distance) : '—'}
            />
            <Row label={t('location.allowedRadius')} value={fence?.radius ? `${fence.radius} m` : '—'} />
            <Row
              label={t('location.accuracy')}
              value={fence?.accuracy != null ? `±${Math.round(fence.accuracy)} m` : '—'}
            />
            <Row label={t('location.network')} value={<NetworkValue network={network} />} />
          </dl>

          {policy.warnings?.includes(WARNING.NETWORK_UNVERIFIED) ? (
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn-ink">
              {t('location.networkUnverified')}
            </p>
          ) : null}

          {policy.warnings?.includes(WARNING.BORDERLINE_FIX) ? (
            <p className="rounded-xl bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
              {t('location.borderline')}
            </p>
          ) : null}

          <button
            type="button"
            onClick={geo.refresh}
            className="inline-flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:bg-brand-500/10 hover:text-brand-ink"
          >
            <LuRefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('location.recheck')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const Row = ({ label, value }) => (
  <div>
    <dt className="text-ink-subtle">{label}</dt>
    <dd className="font-semibold text-ink tabular">{value}</dd>
  </div>
);

function NetworkValue({ network }) {
  const { t } = useTranslation();

  if (!network || network.pending) {
    return <span className="text-ink-subtle">{t('location.checking')}</span>;
  }
  if (network.verdict === NETWORK.MATCH) {
    return (
      <span className="inline-flex items-center gap-1 text-ok-ink">
        <LuWifi className="h-3.5 w-3.5" aria-hidden="true" /> {t('location.shopWifi')}
      </span>
    );
  }
  if (network.verdict === NETWORK.MISMATCH) {
    return (
      <span className="inline-flex items-center gap-1 text-danger-ink">
        <LuWifiOff className="h-3.5 w-3.5" aria-hidden="true" /> {t('location.otherNetwork')}
      </span>
    );
  }
  if (network.verdict === NETWORK.SKIPPED) {
    return <span className="text-ink-subtle">{t('location.notRequired')}</span>;
  }
  return <span className="text-ink-subtle">{t('location.unknown')}</span>;
}
