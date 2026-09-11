# Optical Solution — Attendance System

Staff attendance for three optical shops (Win, Pwint, Yangon), built inside the
existing Vite + React + Tailwind storefront as a self-contained feature module
under `src/Feature/Attendance/`.

- **Kiosk** — `/attendance/kiosk` — a shared shop tablet. No staff accounts.
- **Admin** — `/attendance/admin` — Google OAuth, three allowlisted addresses.
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
  "active": true,                    // never deleted — history must resolve
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
               "regular": 450, "overtime": 90,
               "late": 0, "earlyLeave": 0 },

  "overtime": { "claimed": true, "eligibleMinutes": 90, "grantedMinutes": 90,
                "capped": false, "reason": null,
                "approvedBy": null, "approvedAt": null },

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

`lib/crypto.js` and `lib/time.js` are dependency-free and are meant to be
imported by the Functions package, so the PIN derivation and the overtime rule
exist in exactly one implementation.

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

Firebase project:

1. **Authentication** → enable Google; add your domain to the authorised list.
2. **Firestore** → `firebase deploy --only firestore:rules,firestore:indexes`.
3. **Seed** → `seedBranches()` in `services/branches.service.js` writes the three
   branch documents from `config/branches.js`.
4. **Replace the placeholder coordinates.** The lat/lng and CIDRs in
   `config/branches.js` are placeholders — stand in each shop doorway, read the
   device's own position, and write the real values.
5. Set the kiosk and staff PINs through the Admin SDK (they must land in the
   `secrets` subcollections, which no client can write).

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
