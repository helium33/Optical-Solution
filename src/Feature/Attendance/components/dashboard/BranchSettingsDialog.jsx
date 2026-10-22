import { useEffect, useMemo, useState } from 'react';
import { LuSettings, LuCircleCheck, LuInfo, LuMapPin, LuCrosshair } from 'react-icons/lu';

import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import { updateBranchShift, updateBranchGeofence } from '../../services/branches.service';
import { shiftWindow, formatDuration } from '../../lib/time';
import { haversineMeters, formatDistance } from '../../lib/geo';
import { parseLocationInput } from '../../lib/plusCode';

/**
 * Edit a branch's shift, grace windows and geofence.
 *
 * These are the numbers that decide whether someone was late and whether they
 * are owed overtime, so the form shows what each one *means* in plain words
 * next to the field — "arrive by 09:10 and you are still on time" beats a bare
 * input labelled graceMinutes, and it is read by whoever is about to change it.
 *
 * Changing these does NOT rewrite history. Every attendance record freezes the
 * shift it was punched against in `shiftSnapshot`, so tightening the grace
 * window tomorrow cannot retroactively make yesterday's arrivals late. The
 * dialog says so, because the opposite is exactly what someone would fear.
 */

const addMinutes = (hhmm, minutes) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '—';
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export default function BranchSettingsDialog({ open, onClose, branch, actor, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  /** One field for the shop pin: a Plus Code or a pair of decimals. */
  const [pinText, setPinText] = useState('');
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!open || !branch) return;
    setForm({
      start: branch.shift.start,
      end: branch.shift.end,
      graceMinutes: branch.shift.graceMinutes ?? 0,
      breakMinutes: branch.shift.breakMinutes ?? 0,
      minBreakThresholdMinutes: branch.shift.minBreakThresholdMinutes ?? 300,
      overtimeGraceMinutes: branch.shift.overtimeGraceMinutes ?? 0,
      maxOvertimeMinutes: branch.shift.maxOvertimeMinutes ?? 300,
      radiusMeters: branch.geofence.radiusMeters ?? 50,
    });
    /* Pre-filled with the pin already in force, so the field shows what is
       true rather than an empty box that looks like nothing is set. */
    setPinText(branch.geofence.plusCode || `${branch.geofence.lat}, ${branch.geofence.lng}`);
    setLocating(false);
    setError(null);
    setSaved(false);
  }, [open, branch]);

  const set = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  /* The branch's existing pin is the reference a short Plus Code is expanded
     against — "XWW2+45W" names a cell in every 1-degree block on Earth, and
     the nearest sensible one is the shop we are already editing. */
  const parsedPin = useMemo(
    () => parseLocationInput(pinText, branch?.geofence ?? null),
    [pinText, branch],
  );

  /** How far this edit would move the shop. The number people actually need. */
  const pinMoveMeters = useMemo(() => {
    if (!parsedPin || !branch) return null;
    return haversineMeters(
      { lat: branch.geofence.lat, lng: branch.geofence.lng },
      { lat: parsedPin.lat, lng: parsedPin.lng },
    );
  }, [parsedPin, branch]);

  /**
   * Read the pin off this device.
   *
   * The intended use is standing in the shop doorway with the admin screen
   * open, which is the only way to get a pin that is right rather than
   * approximately right. The accuracy is shown rather than hidden, because a
   * +/-800 m fix taken indoors would otherwise be saved looking authoritative.
   */
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('This browser cannot report a location.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        setPinText(`${fix.coords.latitude.toFixed(7)}, ${fix.coords.longitude.toFixed(7)}`);
        setLocating(false);
        setSaved(false);
        if (fix.coords.accuracy > 30) {
          setError(
            `That fix is only accurate to about ${Math.round(fix.coords.accuracy)} m. ` +
              'Step outside the shop door and try again before saving it as the pin.',
          );
        }
      },
      (geoError) => {
        setLocating(false);
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location access is blocked for this site. Allow it in the browser settings, then try again.'
            : 'Could not read a location from this device right now.',
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  /* What the settings add up to, recomputed live against the real function the
     kiosk uses — so the preview cannot drift from the behaviour. */
  const window = useMemo(() => {
    if (!form || !branch) return null;
    return shiftWindow('2026-01-01', form, branch.timezone);
  }, [form, branch]);

  const problems = useMemo(() => {
    if (!form) return [];
    const list = [];
    const num = (v) => Number(v);
    if (!/^\d{2}:\d{2}$/.test(form.start) || !/^\d{2}:\d{2}$/.test(form.end)) {
      list.push('Shift start and end are required.');
    }
    if (num(form.graceMinutes) < 0 || num(form.graceMinutes) > 120) {
      list.push('Late grace must be between 0 and 120 minutes.');
    }
    if (num(form.overtimeGraceMinutes) < 0 || num(form.overtimeGraceMinutes) > 120) {
      list.push('Overtime grace must be between 0 and 120 minutes.');
    }
    if (num(form.maxOvertimeMinutes) < 0 || num(form.maxOvertimeMinutes) > 720) {
      list.push('The overtime cap must be between 0 and 720 minutes.');
    }
    if (num(form.radiusMeters) < 20 || num(form.radiusMeters) > 500) {
      /* Under 20 m is inside ordinary GPS error; over 500 m stops being a
         shop and starts being a neighbourhood. */
      list.push('The radius must be between 20 and 500 metres.');
    }
    if (pinText.trim() && !parsedPin) {
      list.push('That is not a Plus Code or a pair of coordinates.');
    }
    return list;
  }, [form, pinText, parsedPin]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateBranchShift(
        branch.id,
        {
          start: form.start,
          end: form.end,
          graceMinutes: Number(form.graceMinutes),
          breakMinutes: Number(form.breakMinutes),
          minBreakThresholdMinutes: Number(form.minBreakThresholdMinutes),
          overtimeGraceMinutes: Number(form.overtimeGraceMinutes),
          maxOvertimeMinutes: Number(form.maxOvertimeMinutes),
        },
        actor?.uid,
      );
      await updateBranchGeofence(
        branch.id,
        {
          ...branch.geofence,
          /* An unparseable field is caught by `problems` before save is
             reachable, so falling back here means the field was left empty. */
          lat: parsedPin ? parsedPin.lat : branch.geofence.lat,
          lng: parsedPin ? parsedPin.lng : branch.geofence.lng,
          /* Only meaningful while the pin came from a code. Clearing it stops
             the screen showing a code that no longer names this spot. */
          plusCode: parsedPin?.source === 'plus-code' ? pinText.trim() : null,
          radiusMeters: Number(form.radiusMeters),
        },
        actor?.uid,
      );
      setSaved(true);
      onSaved?.();
    } catch (saveError) {
      setError(
        saveError?.code === 'permission-denied'
          ? 'Only an administrator can change branch settings.'
          : (saveError?.message ?? 'Could not save those settings.'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!branch || !form) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${branch.name} settings`}
      subtitle="Shift, grace windows and where the shop is"
      size="md"
    >
      <div className="space-y-5">
        {/* ---- shift ---- */}
        <Section title="Shift" icon={LuSettings}>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              id="shift-start" label="Starts" type="time"
              value={form.start} onChange={(v) => set({ start: v })}
            />
            <NumberField
              id="shift-end" label="Ends" type="time"
              value={form.end} onChange={(v) => set({ end: v })}
            />
          </div>
          {window ? (
            <Explain>
              A full day is <strong>{formatDuration(window.spanMinutes)}</strong>
              {window.expectedMinutes !== window.spanMinutes ? (
                <> , or <strong>{formatDuration(window.expectedMinutes)}</strong> paid once the
                  unpaid break comes off</>
              ) : null}
              {window.overnight ? ' — this shift runs past midnight.' : '.'}
            </Explain>
          ) : null}
        </Section>

        {/* ---- lateness ---- */}
        <Section title="Lateness">
          <NumberField
            id="grace" label="Grace after the start" suffix="min"
            value={form.graceMinutes} onChange={(v) => set({ graceMinutes: v })}
          />
          <Explain>
            Arrive by <strong>{addMinutes(form.start, Number(form.graceMinutes) || 0)}</strong> and
            it still counts as on time. After that, lateness is counted from{' '}
            <strong>{form.start}</strong> — not from the end of the grace window.
          </Explain>
        </Section>

        {/* ---- overtime ---- */}
        <Section title="Overtime">
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              id="ot-grace" label="Absorbed after the end" suffix="min"
              value={form.overtimeGraceMinutes} onChange={(v) => set({ overtimeGraceMinutes: v })}
            />
            <NumberField
              id="ot-cap" label="Daily cap" suffix="min"
              value={form.maxOvertimeMinutes} onChange={(v) => set({ maxOvertimeMinutes: v })}
            />
          </div>
          <Explain>
            Staying until <strong>{addMinutes(form.end, Number(form.overtimeGraceMinutes) || 0)}</strong>{' '}
            earns nothing. One minute later earns a <strong>full hour</strong> — overtime is paid
            in whole hours, always rounded up. Past{' '}
            <strong>{formatDuration(Number(form.maxOvertimeMinutes) || 0)}</strong> a day is
            flagged for review instead of paid automatically.
          </Explain>
        </Section>

        {/* ---- break ---- */}
        <Section title="Unpaid break">
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              id="break" label="Deducted" suffix="min"
              value={form.breakMinutes} onChange={(v) => set({ breakMinutes: v })}
            />
            <NumberField
              id="break-threshold" label="On shifts longer than" suffix="min"
              value={form.minBreakThresholdMinutes}
              onChange={(v) => set({ minBreakThresholdMinutes: v })}
            />
          </div>
          <Explain>
            A shift shorter than{' '}
            <strong>{formatDuration(Number(form.minBreakThresholdMinutes) || 0)}</strong> has
            nothing deducted.
          </Explain>
        </Section>

        {/* ---- geofence ---- */}
        <Section title="Shop location" icon={LuMapPin}>
          <label htmlFor="pin" className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
              Plus Code or coordinates
            </span>
            <div className="flex gap-2">
              <input
                id="pin"
                value={pinText}
                onChange={(event) => {
                  setPinText(event.target.value);
                  setSaved(false);
                }}
                placeholder="XWW2+45W, Muse"
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-2xl border border-line bg-surface-card px-4 py-3 text-[15px] text-ink outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25"
              />
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                title="Read the pin from this device"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-line px-3 py-3 text-xs font-semibold text-ink-muted transition hover:bg-surface-sunken disabled:opacity-50 tap-none"
              >
                <LuCrosshair className="h-4 w-4" aria-hidden="true" />
                {locating ? 'Reading…' : 'Here'}
              </button>
            </div>
          </label>

          {/* What was understood, and what it would change. A pin that silently
              reinterprets a typo as somewhere else entirely is the failure this
              read-out exists to prevent. */}
          {parsedPin ? (
            <Explain>
              Read as {parsedPin.source === 'plus-code' ? 'a Plus Code' : 'coordinates'} →{' '}
              <strong>{parsedPin.lat.toFixed(7)}, {parsedPin.lng.toFixed(7)}</strong>.{' '}
              {pinMoveMeters !== null && pinMoveMeters >= 1 ? (
                <>Saving moves the shop <strong>{formatDistance(pinMoveMeters)}</strong> from where
                  it is pinned now.</>
              ) : (
                <>This is where the shop is pinned now.</>
              )}
            </Explain>
          ) : (
            <Explain>
              Paste the code straight from Google Maps, or stand in the doorway and press
              <strong> Here</strong>. Pinned now at{' '}
              <strong>{branch.geofence.lat.toFixed(6)}, {branch.geofence.lng.toFixed(6)}</strong>.
            </Explain>
          )}

          <div className="mt-3">
            <NumberField
              id="radius" label="Staff must be within" suffix="m"
              value={form.radiusMeters} onChange={(v) => set({ radiusMeters: v })}
            />
            <Explain>
              Measured from the pin above. Below about 20 m you are inside ordinary GPS error and
              staff will be refused at the door.{' '}
              {branch.network?.allowedCidrs?.length
                ? 'This branch also requires the shop Wi-Fi.'
                : 'Any network is fine — mobile data included. Location is the only check.'}
            </Explain>
          </div>
        </Section>

        {/* ---- the reassurance that matters ---- */}
        <p className="flex items-start gap-2.5 rounded-2xl bg-surface-sunken px-4 py-3 text-xs leading-relaxed text-ink-muted">
          <LuInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            These take effect from the next punch. Attendance already recorded keeps the shift it
            was measured against, so changing the grace window cannot make last week’s arrivals
            late.
          </span>
        </p>

        {problems.length ? (
          <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">
            {problems[0]}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ok-ink">
            <LuCircleCheck className="h-4 w-4" aria-hidden="true" /> Saved — the kiosk picks this up
            straight away.
          </p>
        ) : null}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-ink-muted"
          >
            Close
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || problems.length > 0}
            className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-brand-on shadow-soft disabled:opacity-40"
          >
            {busy ? <Spinner size={16} className="text-current" /> : null}
            Save settings
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="rounded-3xl border border-line bg-surface-card p-4">
      <h3 className="mb-3 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const Explain = ({ children }) => (
  <p className="text-xs leading-relaxed text-ink-muted">{children}</p>
);

function NumberField({ id, label, value, onChange, suffix, type = 'number' }) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[11px] font-semibold text-ink-subtle">{label}</span>
      <span className="relative block">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-2xl border border-line bg-surface-card px-3.5 py-2.5 text-sm font-semibold text-ink shadow-soft tabular"
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-subtle">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}
