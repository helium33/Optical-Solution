# Optical Solution — Attendance System

Staff attendance for three optical shops (Win, Pwint, Yangon), built inside the
existing Vite + React + Tailwind storefront as a self-contained feature module
under `src/Feature/Attendance/`.

- **Kiosk** — `/attendance/kiosk` — a shared shop tablet. No staff accounts.
- **My records** — `/attendance/me` — a staff member's own figures, opened with their PIN.
- **Admin** — `/attendance/admin` — Google OAuth, three allowlisted addresses.
  The sign-in is **hidden**: type `7860` anywhere to reveal it.
- **Preview** — `/attendance/preview` — the dashboard with sample data. Dev builds only.

---

## 1. Shape of the system

```
                          ┌──────────────────────────┐
  shop tablet  ─────────▶ │  Kiosk (branch PIN)      │
  (no account)            │  roster · punch · OT     │
                          └────────────┬─────────────┘
                                       │ custom token
                                       │ { kiosk: true, branchId }
                                       ▼
  owner laptop ─────────▶ ┌──────────────────────────┐
  (Google OAuth)          │  Firebase Auth           │
                          └────────────┬─────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
     ┌─────────────────┐    ┌────────────────────┐   ┌──────────────────┐
     │ Firestore Rules │    │ Callable Functions │   │  Firestore data  │
     │ read scoping    │    │ the only writer of │──▶│  attendance/     │
     │ secret denial   │    │ attendance records │   │  staff/ branches/│
     └─────────────────┘    └────────────────────┘   └──────────────────┘
```

The load-bearing idea: **the client proposes, the server records.** A browser
cannot be trusted about the time (system clock is user-settable), its own IP
(self-reported), or whether a PIN was correct (checking it client-side means
shipping the hash). So the kiosk gathers evidence — a GPS fix, a PIN, a WebAuthn
assertion — and a Cloud Function re-derives every verdict before writing.

### Module layout

| Path | Holds |
|---|---|
| `config/` | `branches.js` (seed + offline fallback), `roles.js`, `firebase.js` |
| `theme/` | `BranchThemeProvider` — the only thing that touches `<html>` for theming |
| `auth/` | Google OAuth provider, admin allowlist, RBAC matrix, route guards |
| `lib/` | Pure functions: `geo`, `network`, `time`, `accessPolicy`, `crypto` |
| `hooks/` | `useGeoFence`, `useWebAuthn`, `useAttendanceReport`, `useNow` |
| `services/` | Firestore reads, callable wrappers, kiosk session, path registry |
| `components/` | `ui/` primitives, `kiosk/`, `dashboard/` |
| `pages/` | Four screens + the layout + the route error boundary |
| `__tests__/` | 41 assertions over geo, network and overtime — `npm run test:logic` |

---

## 2. Branch theming and dark mode

### The strategy

Every colour in the app is a **CSS custom property holding a bare RGB triplet**,
never a finished colour string:

```css
[data-branch='win'] { --brand-900: 33 28 81; }   /*  #211c51  */
```

```js
// tailwind.config.js
const channel = (token) => `rgb(var(${token}) / <alpha-value>)`;
colors: { brand: { 900: channel('--brand-900') } }
```

That one decision buys three things:

1. **One class, many palettes.** `bg-brand-600` is a single static utility that
   Tailwind emits once, but the pixels resolve at runtime from whatever
   `data-branch` is on `<html>`. No `win:` / `pwint:` variant explosion, no
   conditional class strings, no CSS weight for branches nobody is looking at.
2. **`<alpha-value>` keeps working.** Because the triplet is bare,
   `bg-brand-600/10`, `ring-accent/40` and `shadow-glow` all behave like stock
   Tailwind colours. A finished `rgb(...)` string would break every opacity
   modifier in the app.
3. **Themes are data.** Adding a fourth shop is one CSS block, not a code change.

### The two axes

Both attributes sit on `<html>` and multiply — 4 branches x 2 modes = 8 palettes:

```
:root                      house light    (admin, "All branches")
[data-branch="win"]        win light
.dark                      house dark
.dark[data-branch="win"]   win dark       (specificity 0,2,0 — beats both singles)
```

Each block re-declares the **complete** token set. Verbose on purpose: a
partially-declared branch inherits a neighbour's surface, and that bug only
shows up in one mode, at one branch, in one shop.

| Branch | Brand | Accent | Notes |
|---|---|---|---|
| Win | Deep navy `#211c51` at step 900 | Orange | Shadows are tinted navy, not grey |
| Pwint | Fuchsia | Magenta/pink | Paper-white surfaces; colour only where it works |
| Yangon | Red | White | See below |
| House | Indigo | Cyan | Neutral admin default |

**Yangon's white accent** needs a word. A white accent cannot be read as *text*
on a white page, so the token set splits the job:

- `--accent-*` — the literal ivory ramp, used on red-filled panels where it belongs.
- `--accent-ink` — the accent stepped to stay legible **as text on the page
  surface**. For Yangon in light mode that falls back to brand red; in dark mode
  it finally gets to be literally white.
- `--accent-on` — what sits **on top of** an accent fill (dark red on ivory).

The same three-token pattern applies to every branch, so components use
`text-accent-ink` and `bg-accent-500 text-accent-on` without knowing which shop
they are in.

### Deliberately *not* themed

Status colours (`ok` / `warn` / `danger`) and **overtime** (`ot`) are fixed.
"Late" must not turn fuchsia at Pwint — a status colour that changes hue per
branch stops being readable as a status. Overtime is orange everywhere.

### Dark mode

`darkMode: 'class'`, toggled by `BranchThemeProvider`. Mode is tri-state:
`light | dark | system`, defaulting to `system` and *continuing to track the OS*
after mount, so a shop tablet follows the room at dusk without anyone touching a
control. Pressing the toggle is an explicit choice and leaves `system` behind.

Dark is **selected, not inverted**: each ramp is re-stepped for a near-black
surface, and dark surfaces carry the branch hue (navy-black for Win, plum-black
for Pwint) so the shell still reads as the right shop with the lights off.

### Modern-UI primitives

Three composable pieces rather than utilities repeated at call sites:

- `.glass` / `.glass-strong` — backdrop blur + saturation, reading the branch's
  own glass tokens so the frost picks up a navy / fuchsia / red cast.
- `.glass-sheen` — the 1px top-edge highlight that stops a frosted panel looking
  like flat translucent grey.
- `.bg-aurora` — branch-tinted radial wash, with a noise overlay so large flat
  gradients do not band.

Plus soft layered shadows (`soft` / `lift` / `float` / `glow`), an `expo` easing
curve, and `prefers-reduced-motion` honoured globally.

> **Theme scoping:** the palette is applied to `.attendance-root`, **not** to
> `<body>`. This project also serves a public storefront that knows nothing
> about branch themes, and painting the body would drag it into dark mode the
> moment someone toggled the kiosk.

---

## 3. Firestore schema

Timestamps are stored as UTC instants. `dayKey` is the **business day in the
branch's timezone** (`Asia/Yangon`) — so "which day was this?" gives the same
answer to a tablet in the shop and an owner reviewing from abroad.

### `branches/{branchId}` — `win` · `pwint` · `yangon`

```jsonc
{
  "name": "Win Optical", "shortName": "Win", "theme": "win",
  "city": "Mandalay", "timezone": "Asia/Yangon", "active": true,

  "geofence": { "lat": 21.9588, "lng": 96.0891,
                "radiusMeters": 50, "maxAccuracyMeters": 65 },

  "network":  { "allowedCidrs": ["203.81.64.0/20"], "enforce": true },

  "shift": { "start": "09:00", "end": "17:30",
             "graceMinutes": 10,
             "breakMinutes": 60, "minBreakThresholdMinutes": 300,
             "maxOvertimeMinutes": 300, "overtimeGraceMinutes": 15 },

  "updatedAt": "<timestamp>", "updatedBy": "<uid>"
}
```

`branches/{branchId}/secrets/kiosk` — **server-only**
```jsonc
{ "hash": "<pbkdf2-base64url>", "salt": "<base64url>", "iterations": 210000,
  "updatedAt": "<iso>", "updatedBy": "<uid>" }
```

### `staff/{staffId}`

```jsonc
{
  "branchId": "win",
  "name": "Aye Aye Mon",
  "role": "supervisor",              // supervisor | sales_leader
                                     // sales_executive | sales_associate
  "employeeCode": "WIN-014",
  "phone": "+95…",
  "active": true,                    // false = removed; history still resolves
  "deactivatedAt": "<timestamp>",    // present only once removed
  "webauthnCredentialCount": 1,      // presence is public, the key is not
  "joinedAt": "<timestamp>",
  "createdAt": "<timestamp>", "createdBy": "<uid>"
}
```

`staff/{staffId}/secrets/pin` — **server-only** (same PBKDF2 shape as above)

`staff/{staffId}/credentials/{credentialId}` — **server-only**
```jsonc
{ "publicKey": "<base64url COSE>", "counter": 7, "transports": ["internal"],
  "deviceLabel": "iPad · Safari", "createdAt": "<iso>", "lastUsedAt": "<iso>" }
```

### `attendance/{logId}` — id is `{branchId}_{dayKey}_{staffId}`

The deterministic id is load-bearing, not a convenience: **one document per
person per business day** makes a double check-in structurally impossible rather
than something a transaction has to catch, and turns "is Aye already in?" into a
single `get()` instead of a query.

```jsonc
{
  "branchId": "win", "staffId": "abc123",
  "staffName": "Aye Aye Mon",        // denormalised: reports must survive a rename
  "role": "supervisor",              // denormalised: role at the time of the shift
  "dayKey": "2026-09-11", "timezone": "Asia/Yangon",

  "checkIn": {
    "at": "<timestamp>",             // the SERVER's clock, never the client's
    "method": "biometric",           // biometric | pin
    "location": { "lat": 21.9588, "lng": 96.0891,
                  "accuracy": 12, "distance": 8.4 },
    "ip": "203.81.64.17",            // the IP the FUNCTION saw
    "deviceId": "kiosk-a7f…",
    "verifiedBy": "fn:submitPunch"
  },
  "checkOut": { /* same shape, or null while the shift is open */ },

  "status": "on_time",               // on_time | late | incomplete
  "minutes": { "gross": 600, "break": 60, "worked": 540,
               "regular": 450,
               "overtime": 90,        // minutes ACTUALLY worked past the shift
               "overtimeHours": 2,    // whole hours PAID, rounded up
               "late": 0, "earlyLeave": 0 },

  "overtime": { "claimed": true, "eligibleMinutes": 90, "grantedMinutes": 90,
                "billedHours": 2,
                "capped": false, "reason": null,
                "approvedBy": null, "approvedAt": null },

  // Present only when the punch was made with location checks switched off.
  // Kept so records created during testing stay identifiable forever.
  "locationBypass": "dev-mode",

  // Frozen so a later policy change cannot silently rewrite history.
  "shiftSnapshot": { "start": "09:00", "end": "17:30", "…": "…" },

  // Present only if corrected. Previous values are kept, never overwritten —
  // an attendance log that can be silently rewritten is not evidence.
  "edited": { "by": "<uid>", "byName": "…", "at": "<iso>",
              "reason": "Forgot to clock out",
              "previous": { "checkOut": null, "minutes": {}, "overtime": {} } },

  "createdAt": "<timestamp>", "updatedAt": "<timestamp>"
}
```

### `attendanceDaily/{branchId}_{dayKey}` — roll-up, written by a trigger

```jsonc
{ "branchId": "win", "dayKey": "2026-09-11",
  "headcount": 14, "present": 12, "late": 2, "absent": 2,
  "workedMinutes": 5460, "overtimeMinutes": 180,
  "byRole": { "supervisor": { "present": 1, "late": 0 }, "…": {} } }
```

Not yet required — the dashboard aggregates client-side, which is fine at three
shops. Add this when a month query stops being instant.

### `auditLogs/{entryId}` — append-only, server-written

```jsonc
{ "actorUid": "…", "actorRole": "admin", "action": "overtime.approve",
  "targetType": "attendance", "targetId": "win_2026-09-11_abc123",
  "branchId": "win", "at": "<timestamp>", "meta": {} }
```

### Indexes

`firestore.indexes.json` carries four composites — see the file. The key one is
`attendance(branchId ASC, dayKey DESC)`, which serves the dashboard's
`branchId IN [...] + dayKey range + orderBy dayKey`.

Role and overtime filters are applied **in memory**, on purpose: Firestore would
need a separate composite per filter combination, and a three-shop month is a
few thousand documents — cheaper to over-fetch once than to index six ways.

---

## 4. Authentication

### Admin — Google OAuth, three addresses

Restriction is applied at three depths, and it matters which one is load-bearing:

| Layer | File | What it is |
|---|---|---|
| 1. Client allowlist | `auth/admins.js` | **UX.** A wrong-account sign-in gets "that address isn't an administrator" instead of a dashboard that then fails every read. |
| 2. Firestore Rules | `firestore.rules` | **The security boundary.** `request.auth.token.email` against the same three addresses. |
| 3. Custom claim | Cloud Function | `admin: true`, so rules can check a claim instead of a string list. |

Deleting (1) is a UX regression. Deleting (2) is a breach. A non-allowlisted
account is signed straight back out rather than left half-authenticated, and
`AuthProvider` warns to the console when the custom claim is missing — otherwise
you debug permission-denied blind.

Popup sign-in with an automatic redirect fallback, because popups are blocked in
a lot of in-app browsers.

### Kiosk — branch PIN → custom token

Staff never log in. The **tablet** is unlocked once in the morning, and identity
is proved **per punch**, not per session.

```
branch PIN  →  verifyBranchPin()  →  custom token { kiosk: true, branchId }
            →  signInWithCustomToken()
            →  Firestore rules can now scope every read to one branch
```

Without that token the kiosk would need either an open database or a shared
credential in the bundle. The token is short-lived, re-minted on the next
unlock, and **dropped** when the kiosk locks — locking the UI without dropping
the identity would leave a "locked" tablet with live read access.

On top of it, `services/kioskSession.js` keeps a `sessionStorage` session with a
hard TTL (14 h) and an idle timeout (45 min). `sessionStorage` rather than
`localStorage` deliberately: closing the tab must end the shift session.

---

## 4b. Developer bypass (`DEV_MODE`)

`config/devMode.js`. When on, the 50 m geofence and the network check are both
skipped, so the app can be exercised from anywhere.

This is the most dangerous switch in the codebase — left on in production, every
employee can clock in from bed — so it is built to be hard to ship by accident:

1. **Off by default.** Enabling it is a deliberate act.
2. **A production build refuses it** unless a second variable also says yes, so
   one stray `VITE_DEV_MODE=true` in a deploy config cannot do it:
   ```env
   VITE_DEV_MODE=true
   VITE_ALLOW_DEV_MODE_IN_PROD=true   # only then does a prod build honour it
   ```
   A refused request logs an error saying so rather than silently doing nothing.
3. **A banner sits across every screen** while it is on. Not dismissible, not a
   console note — a thing you cannot use the app without seeing.
4. **Every punch made while bypassing is tagged** `locationBypass: "dev-mode"`,
   so test records stay greppable in the database long after the flag is off.

The sensors are not merely ignored under the bypass — they are never started.
There is no point spinning up a GPS watch whose answer will be discarded, and
asking for a location permission you do not intend to honour trains people to
grant permissions without reading them.

For a quick local bypass without touching `.env`, flip `DEV_MODE_OVERRIDE` at
the top of the file. Leave it `false` in anything you commit.

---

## 4c. The hidden administrator door

The admin sign-in is absent from the interface. Typing **`7860`** anywhere
reveals it and navigates there.

`hooks/useSecretSequence.js` does the listening; `services/adminReveal.js` holds
the flag; `RequireSecretReveal` in `auth/guards.jsx` keeps the route itself
unreachable, so bookmarking or guessing the URL reveals nothing either.

**What this is:** a way to keep an owner-only door off a screen that faces the
shop floor. Staff never need it, customers can see the tablet, and an "Admin"
button invites poking.

**What this is not:** a security control. The sequence is in the JavaScript
bundle and the reveal flag is in sessionStorage, where anyone can set it. Typing
7860 protects nothing — the protection is Google OAuth, the three-address
allowlist, and the Firestore rules behind it. **This hides a door; it does not
lock one.** The reveal expires after 10 minutes so a shared tablet is not left
standing open.

It listens on **every screen**, including the ones with a PIN pad open — the
unlock screen is the first thing on the tablet and the most natural place for an
owner to type the sequence.

There is an obvious collision to worry about: the kiosk keypad also listens for
digits, so a staff member whose personal PIN happened to be `7860` would open the
admin door every time they clocked in. That is closed **at PIN assignment**, not
by switching the listener off — `7860` is refused as a staff or branch PIN by
both `AddStaffDialog` and `scripts/seed-pins.mjs`, so no real PIN can collide
with it.

(An earlier version disabled the listener whenever a pad was on screen. It
solved the narrow problem by breaking the common case: on the unlock screen, the
shortcut did nothing at all. Fixing the collision at its source is what let the
shortcut work everywhere.)

Keystrokes typed into a real field — an employee name, a correction reason, a
search box — are still ignored, so entering "7860" as *data* does not trip it.

It never stores, logs or transmits anything. The buffer holds at most four
characters, clears on match and clears again after a pause. It is not a
keylogger and must not be turned into one by "debugging" it with a log line.

---

## 4d. Branch settings are live, not compiled in

Shift times, grace windows and the geofence radius are editable from the admin
dashboard (Team → the gear on a branch card).

For that to mean anything, the app had to stop reading them out of
`config/branches.js`. Every screen used to take the shift from a file compiled
into the bundle, which made a settings editor pointless by construction: an
owner could change the shift end, save it, and the kiosk would carry on using
whatever was built into the JavaScript.

`config/BranchesProvider.jsx` now holds one Firestore subscription for the whole
app and hands live records to the kiosk, the punch dialog, the personal
dashboard and the correction form. The static file remains as the **offline
fallback** — if Firestore is unreachable the kiosk still knows where the shop is
and when the shift ends, rather than going blank.

Verified end to end: editing Win's shift end in the dashboard changes what the
kiosk gate displays, with no reload and no redeploy.

### Editing settings does not rewrite history

Every attendance record freezes the shift it was punched against in
`shiftSnapshot`. Tightening the grace window tomorrow cannot retroactively make
yesterday's arrivals late, and a correction made in March uses March's shift,
not today's. The settings dialog says so on screen, because the opposite is
exactly what an owner would fear before pressing Save.

### One limitation in development

Reading `branches/{id}` requires either an admin session or a kiosk custom
token. On the `VITE_ALLOW_CLIENT_PUNCH` fallback path the kiosk never
authenticates, so branch reads are denied and it stays on the compiled-in
config. An admin editing settings will see their own change; the kiosk will not
pick it up until the `verifyBranchPin` function is deployed and the tablet holds
a real token.

---

## 5. Role-Based Access Control

`Supervisor > Sales Leader > Sales Executive > Sales Associate`, with Admin
above all branches.

Two questions, answered by two functions — conflating them is the classic RBAC bug:

- `can(principal, permission, resource)` — is this **verb** available, in this **branch**?
- `outranks(actor, target)` — are they senior enough to act on this **person**?

A Sales Leader holds `staff:manage` but must not be able to reset their
Supervisor's PIN. Only the second check catches that.

| Permission | Associate | Executive | Leader | Supervisor | Admin |
|---|:--:|:--:|:--:|:--:|:--:|
| `attendance:log:self` | ● | ● | ● | ● | ● |
| `attendance:view:branch` | | ● | ● | ● | ● |
| `attendance:edit:branch` | | | ● | ● | ● |
| `staff:manage` | | | ●¹ | ●¹ | ● |
| `overtime:approve` | | | | ●¹ | ● |
| `branch:manage` | | | | ● | ● |
| `report:export` | | | | ● | ● |
| `attendance:view:all` | | | | | ● |

¹ also requires outranking the target.

Scoping is automatic: branch-scoped permissions fail against another branch's
resource, `attendance:log:self` fails against another person's uid, and
`visibleBranchIds()` returns `null` (all) only for principals holding
`attendance:view:all`.

**Verified by 19 assertions** in the RBAC suite, including the cases that
matter: a Leader cannot manage a peer, a Pwint Supervisor cannot touch Win staff,
and an Associate cannot clock in a colleague.

---

## 6. Location restriction — 50 m geofence + IP

### Geofence

`lib/geo.js` computes **Haversine** great-circle distance from the branch pin.
Haversine rather than the cheaper equirectangular approximation because at a
50 m decision boundary the flat-earth error is the same order as the thing being
measured.

`useGeoFence` uses `watchPosition`, not a one-shot `getCurrentPosition`. The
first fix a device returns is usually the coarse network-derived one — hundreds
of metres of error — with the GPS fix landing a second or two later. Watching
means a staff member in the doorway is let in as soon as the radio catches up,
instead of being told "too far" based on the first bad sample.

**Four verdicts, not two.** An imprecise fix is its own state:

| Verdict | When | What the UI does |
|---|---|---|
| `INSIDE` | `distance <= 50 m`, accuracy trustworthy | Allow |
| `OUTSIDE` | `distance > 50 m` | Block, *and say how many metres over* |
| `IMPRECISE` | `accuracy > 65 m` | "Step closer to a window" — never a silent pass or fail |
| `UNKNOWN` | no fix yet | Spinner, not an error |

That third state is the one usually missed. A phone indoors routinely reports
±500 m; comparing that centre point to a 50 m radius produces a
confident-looking answer that is really a coin flip — silently allowing it is
fraud, silently denying it is a staff member who cannot clock in.

### IP

`lib/network.js` does IPv4 and IPv6 CIDR matching (including `::ffff:` mapped
addresses) against the branch's allowlist.

**Stated plainly:** a browser cannot read the LAN address of the router it is
talking to. What it *can* observe is the shop's public egress IP — shared by
every device on the shop router, and different at home. That is what "matching
the shop's Wi-Fi" means in practice.

**Also stated plainly:** the client's view of its own IP is a claim, and is
spoofable. The binding check is the Cloud Function comparing
`request.rawRequest.ip` — the address the *server* saw.

### Combined policy — `lib/accessPolicy.js`

Ordering matters, because the failure modes are not symmetrical:

1. Permission denied → block, with instructions to re-enable it.
2. Geolocation error → block.
3. No fix yet → **pending** (spinner).
4. Imprecise fix → block with the accuracy numbers.
5. Outside the radius → block with the overshoot in metres.
6. Inside → then the network:
   - match, or no allowlist → **allow**
   - mismatch + `enforce: true` → **block** ("not on the shop Wi-Fi")
   - mismatch + `enforce: false` → allow with a warning
   - **unknown** (echo service timed out) → **allow with a warning**

That last row is the deliberate one. Blocking an entire shop because
`api.ipify.org` is down is a worse outcome than letting a GPS-verified,
in-range punch through with a warning — and the server still checks the real
request IP, so the leniency is client-side only.

---

## 7. Time tracking and overtime

`lib/time.js` is timezone-explicit throughout, using `Intl.DateTimeFormat` for
the zone work (no date library — `Intl` is the only thing that actually knows
the tz database). `zonedTimeToUtc` does a two-pass offset correction so it stays
correct across a DST boundary; Myanmar has none, but the branch table is data.

### The overtime rule, in one place so it can be argued with

1. **Overtime is opt-in.** Calculated only when the employee flips the switch at
   clock-out. Staying late by accident is not overtime.
2. **Only time past `shift.end` counts.** Arriving early is not overtime —
   conflating them lets someone bank an hour by turning up at 08:00 and leaving
   on time.
3. **A grace window is absorbed** (`overtimeGraceMinutes`, default 15), so a
   17:34 clock-out on a 17:30 shift is not a 4-minute claim.
4. **Capped** at `maxOvertimeMinutes` (default 5 h). Past the cap the record is
   flagged `capped: true` and needs an admin edit — almost always a forgotten
   clock-out rather than a 14-hour day.
5. **`regular = worked - overtime`**, so the two never double-count.
6. **Paid in whole hours, rounded up.** 30 minutes past the shift is an hour;
   61 minutes is two.

### Why both numbers are stored

`minutes.overtime` is what was worked. `minutes.overtimeHours` is what gets
paid. Keeping only the rounded figure would make a 65-minute evening
indistinguishable from a 119-minute one, and the first person to query a payslip
would have nothing to check it against.

The rounding is applied **per day, then summed** — never the other way round.
Two evenings of 30 minutes are two paid hours, not one. Summing the minutes
first and rounding at the end would quietly shorten the payslip, and it is an
easy mistake to make in a monthly report; `summariseRows` in
`staffSummary.service.js` is where the correct order lives.

Note the interaction with the grace window: under `overtimeGraceMinutes` nothing
is owed at all, and one minute over it is owed a full hour. That step is
intentional and generous by design — widen the grace, not the rounding, if it is
too generous.

### Overtime and the network check

A clock-out **with an overtime claim is exempt from the shop-network check**
(`INTENT.OVERTIME_CHECK_OUT`). The reasoning: the shop router is often off by
the time a late shift ends, so the person owed overtime is exactly the one an IP
rule would strand. **The geofence still applies in full** — they must still
physically be at the shop — so the thing the check exists to prove is still
proved, by the stronger of the two signals.

A claim that survives none of these still records `claimed: true` with
`grantedMinutes: 0` **and a reason**, so the employee sees why it was refused and
the admin sees that it was asked for.

Related: lateness is counted from `shift.start` **after** `graceMinutes`; the
unpaid break is deducted only once a shift passes
`minBreakThresholdMinutes`; a clock-out before the clock-in is rejected as
corrupt rather than recorded as a negative shift; and overnight shifts
(`end <= start`) roll to the next day.

**22 assertions** pin this behaviour — including the capped forgotten clock-out,
the refused in-grace claim, and the early-arrival case.

### In the UI

The Overtime switch is built so it cannot be flipped by accident: a large
deliberate target, its own fixed orange, positioned away from the confirm
button. It shows the **exact minutes that will be claimed**, recalculated live,
before the punch — and when a claim is not available, the switch is disabled
with the reason spelled out rather than accepting something the server will
silently zero.

---

## 8. Dashboard and data visualisation

One filter row — date range first, then branch, role, and an overtime switch —
scoping **everything** below it. Never per-chart: if two charts can disagree
about the date range, every read costs a check of which one you are looking at.

Selecting a branch **re-themes the whole dashboard**. With three shops in one
table, ambient colour is a constant peripheral answer to "whose numbers are
these?" — the question people get wrong when they screenshot a dashboard and
send it to the wrong supervisor.

### Palette — validated, not eyeballed

| Series | Light | Dark | Why |
|---|---|---|---|
| On time / Regular hours | `#2a78d6` | `#3987e5` | Categorical slot 1 |
| Late / Overtime | `#eb6834` | `#d95926` | Categorical slot 2 |
| No punch | `#898781` | `#898781` | **Neutral, not a third hue** |

The blue/orange pair clears every check in both modes (worst-case
colour-deficient separation dE 24.7 light / 26.8 dark against a >=8 target;
normal-vision 33.6 / 31.8 against a >=15 floor).

"No punch" is deliberately a receding grey. Semantically it is the "nothing
happened" category. Practically, the obvious third choice — red — **fails**:
orange-vs-red measures dE 7.1 for normal vision, which even full-colour readers
cannot split. Branch-brand hues were tested for series identity too
(navy/magenta/red) and rejected for the same reason (magenta-vs-red dE 13.2).

Other rules the charts follow: bars capped at 24 px with a 4 px rounded
data-end and a square baseline; a 2 px surface gap doing the separating rather
than strokes; hairline solid gridlines; a legend always present for >=2 series;
values leading labels in tooltips; and **a table view on every chart**, so no
number is gated behind hovering. A single-day range gets a proportion bar
instead of a one-column chart.

CSV export carries both `8h 15m` and `8.25` — payroll software wants one, a
person wants the other, and shipping only one guarantees somebody retypes it.

---

## 9. What the server still has to provide

The frontend is complete. These callables are its contract — none are
implemented here, and the app degrades honestly without them (biometrics report
unavailable; punches fail with a readable message; the dev fallback below lets
the UI run).

| Callable | Input | Must do |
|---|---|---|
| `verifyBranchPin` | `{ branchId, pin }` | PBKDF2-compare against `branches/{id}/secrets/kiosk`; rate-limit per branch+IP; on success mint a custom token with `{ kiosk: true, branchId }` and return `{ ok, token, ttlMinutes }` |
| `submitPunch` | `{ kind, branchId, staffId, auth, position, ip, deviceId, overtimeRequested }` | Verify PIN or WebAuthn assertion; re-check the geofence server-side; check `rawRequest.ip` against the branch allowlist; use **its own clock**; recompute minutes with `lib/time.js`; write `attendance/{branchId}_{dayKey}_{staffId}` |
| `beginWebAuthnRegistration` | `{ staffId }` | Generate and **store** a challenge; return `PublicKeyCredentialCreationOptions` |
| `finishWebAuthnRegistration` | `{ staffId, credential }` | Verify attestation, origin and rpId; store the public key in `staff/{id}/credentials/{credId}`; bump `webauthnCredentialCount` |
| `beginWebAuthnAuthentication` | `{ staffId }` | Fresh stored challenge + `allowCredentials` |
| `setAdminClaims` | auth trigger | Mint `admin: true` for the three allowlisted addresses only |
| `setStaffPin` | `{ staffId, pin }` | Admin only. Hash with `lib/crypto.js` and write `staff/{id}/secrets/pin`. Used by the Add-employee form |
| `verifyStaffPin` | `{ branchId, staffId, pin }` | Compare against the stored hash; rate-limit per staff member. Opens the personal dashboard |
| `getStaffSummary` | `{ branchId, staffId, fromKey, toKey }` | Verify the caller may see this person, then return **only their** tallies using `summariseRows` — the other rows must not reach the device |

`lib/crypto.js` and `lib/time.js` are dependency-free and are meant to be
imported by the Functions package, so the PIN derivation and the overtime rule
exist in exactly one implementation.

`getStaffSummary` deserves a note. The kiosk token can read its whole branch —
it has to, or the roster would not render — so a client-side "filter to my own
rows" is a display convention, not a boundary: anyone with devtools on the shop
tablet could read a colleague's hours. The callable is what makes the personal
dashboard actually personal.

**Two things the functions must not delegate to the client:** the challenge in a
WebAuthn ceremony (a browser-invented challenge is replayable, which reduces the
whole ceremony to "the device said yes"), and the assertion verification
(signature against the stored key, origin, rpId, and a counter that only
increases).

---

## 10. Setup

```bash
npm install
cp .env.example .env          # fill in from the Firebase console
npm run dev                   # /attendance/kiosk · /attendance/preview
npm run test:logic            # 41 assertions
npm run build
```

Firebase project — currently pointed at **`ecommerce-f2834`**, shared with the
storefront.

1. **Authentication** → enable the Google provider. Add your deployed domain
   under Authentication → Settings → Authorised domains (`localhost` is already
   there).
2. **Rules — do not blind-deploy.** `firebase deploy --only firestore:rules`
   *replaces* the whole ruleset; it does not merge. That project already has
   rules (an anonymous read is refused today), so deploying `firestore.rules`
   as-is would discard them. Either merge this file's `match` blocks into the
   project's existing rules, or give attendance its own Firebase project. The
   header comment in `firestore.rules` spells out both routes.
   Check for collection-name collisions first — this app writes `branches/`,
   `staff/`, `attendance/`, `attendanceDaily/`, `auditLogs/`, and `branches` is
   the one plausibly already taken by an ecommerce schema. Every path in the app
   comes from `services/paths.js`, so renaming is a one-file change.
3. **Indexes** → `firebase deploy --only firestore:indexes` (additive, safe).
4. **Seed** → `seedBranches()` in `services/branches.service.js` writes the three
   branch documents from `config/branches.js`.
5. **Replace the placeholder coordinates.** The lat/lng and CIDRs in
   `config/branches.js` are placeholders — stand in each shop doorway, read the
   device's own position, and write the real values.
6. **Set the PINs** — `npm run seed:pins`. It prompts for each branch PIN with
   the input hidden, hashes it with PBKDF2 (210 000 iterations, unique salt),
   and writes only the hash to `branches/{id}/secrets/kiosk`. Add `--branches`
   to (re)write the branch config documents in the same run, `--dry-run` to see
   what would change without touching anything, and `--staff` with
   `SEED_STAFF_PINS='{"staffId":"1234"}'` for personal PINs.

   Needs Admin credentials, because `secrets/` is denied to every client:
   `export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`

### Where a PIN may and may not live

**This repository is public, and git history is permanent.** A PIN committed
once is a PIN leaked forever, whatever a later commit does. The same goes for
anything compiled into the preview bundle, which is published at a URL.

So there is exactly one home for a PIN: a PBKDF2 hash in a `secrets`
subcollection, put there by `scripts/seed-pins.mjs`. Not a config file, not an
`.env`, not a constant in `branches.js`, not the preview fixtures.

The script prompts rather than reading a file or a command-line argument,
because both of those leak: an argument lands in shell history, and a file is
one `git add -A` away from the public internet. `SEED_PIN_*` environment
variables are honoured for unattended runs.

The preview's branch PIN defaults to `1234` — a demo value for demo data. To
rehearse with the real ones locally without committing them:

```bash
PREVIEW_PIN_WIN=… PREVIEW_PIN_PWINT=… PREVIEW_PIN_YANGON=… npm run preview:dev
```

### How much a weak PIN actually costs

The script warns on repeated digits (`1111`), running sequences, and the case
where several branches share a shape — learn one, guess the rest. It warns and
proceeds; the shop owner knows their shop.

What keeps a weak branch PIN survivable is worth stating, because it decides
how much the warning matters:

- The hash is never readable by a client, so there is nothing to grind offline.
- Each derivation costs ~110 ms, so even *with* the hash, 10 000 four-digit
  candidates is ~18 minutes of compute.
- `verifyBranchPin` must rate-limit per branch and per IP. This is the real
  control, and it is the one thing on this list that is not already built —
  see §9.
- A branch PIN only opens the roster. Every punch still needs a personal PIN or
  fingerprint **and** a GPS fix inside 50 m.

So the exposure from a guessed branch PIN is: someone sees that shop's staff
list and today's attendance. Not nothing — it is employee data — but not a
route to logging false hours. Six digits would close most of it for free.

### On the web API key

Firebase web config — API key included — is a public identifier, not a secret;
it ships in every client bundle by design, and Google documents it as such. The
security boundary is the rules and the callables, not the key.

It is still worth restricting it: in Google Cloud Console → APIs & Services →
Credentials, add an HTTP-referrer restriction for your domains. That stops the
key being used to run up quota from someone else's site. It does not, and
cannot, protect data — that is the rules' job.

The values live in `.env`, which is gitignored. Nothing in this repository
contains them, so a fresh clone (or a CI build, or a new machine) needs the file
recreated or the variables set in the hosting provider's environment.

### Development without Cloud Functions

```env
VITE_ALLOW_CLIENT_PUNCH=true
VITE_DEV_BRANCH_PIN=1234
```

Punches are then written straight from the browser and the branch PIN is
compared locally. **There is no identity verification on this path.** Every
record it writes is tagged `verifiedBy: 'client-unverified'` so unverified rows
are greppable rather than indistinguishable from real ones, and the matching
Firestore rule has to be relaxed by hand (see the comment in `firestore.rules`).
Never enable it anywhere real people use.

---

## 11. Known limitations

- **"Absent" over-counts.** Without a roster/schedule collection, absent means
  "active on this branch and no punch that day", which counts a day off as an
  absence. The fix is a `schedules` collection; the chart labels the series
  "No punch" rather than "Absent" so it does not overstate what it knows.
- **One punch pair per day.** The schema has no split shifts. Extend
  `attendance/{logId}` with a `segments[]` array rather than allowing a second
  document, or the deterministic-id guarantee is lost.
- **Supervisor web access is not built.** The RBAC matrix supports it and
  `can()` is already branch- and rank-scoped, but `firestore.rules` currently
  grants dashboard writes to admins only. A supervisor view would need a
  `staff` claim on the kiosk token carrying role and branch.
- **No offline punch queue beyond Firestore's own.** Persistence is enabled, so
  a write during a Wi-Fi drop is queued and flushed — but a punch whose
  server-side verification fails on flush surfaces late.
