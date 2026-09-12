# Optical Solution

A React + Vite application serving two things from one codebase:

| Route | What it is |
|---|---|
| `/` | The public storefront — sunglasses, eyeglasses, lenses |
| `/attendance` | Staff attendance for the Win, Pwint and Yangon branches |

## Quick start

```bash
npm install
npm run dev            # storefront + attendance app
npm run api            # json-server for the storefront navigation (port 3001)
```

For the attendance app, copy the environment template first:

```bash
cp .env.example .env   # fill in from the Firebase console
```

**`/` is the storefront, not the attendance app.** The dev server prints both
sets of URLs on startup; the kiosk is at `/attendance/kiosk`. On a shop tablet
set `VITE_DEFAULT_APP=attendance` in `.env` and `/` opens the kiosk directly.

Without it the attendance app still boots and renders every screen — it just
says, in plain words, that Firebase is not configured.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
| `npm run preview:dev` | The offline attendance preview, with sample data |
| `npm run lint` | ESLint |
| `npm run test:logic` | 46 assertions over the geofence, IP and overtime logic |
| `npm run check:env` | Verify the environment is safe to deploy |
| `npm run deploy:hosting` | Check env, build, deploy the site |
| `npm run deploy:indexes` | Deploy Firestore indexes (additive, safe) |
| `npm run api` | json-server for the storefront's `nav.json` |

## Deploying

The Firebase CLI ships as a dev dependency, so there is **no global install and
nothing to add to your PATH**. On Windows this also sidesteps PowerShell
refusing to run `firebase.ps1` under the default execution policy.

```bash
npm install              # brings the CLI with it
npm run firebase -- login    # once, opens a browser
npm run deploy:hosting
```

`deploy:hosting` refuses to build if the Firebase config is missing, or if a
development bypass (`VITE_DEV_MODE`, `VITE_ALLOW_CLIENT_PUNCH`) is still switched
on — either would otherwise deploy silently and only be noticed by whoever opened
the site.

**Firestore rules are not deployed by these scripts, on purpose.** This project
shares a Firebase project with the storefront, and `firebase deploy` replaces a
project's entire ruleset rather than merging. See the header of
`firestore.rules`.

## The attendance app

- **Kiosk** — `/attendance/kiosk` — shop tablet. Staff have no accounts: the
  tablet is unlocked with a branch PIN, then each person clocks in or out with
  their own PIN or fingerprint. Punches are restricted to a 50 m radius of the
  shop, cross-checked against the shop's network.
- **Admin** — `/attendance/admin` — Google sign-in, restricted to three
  addresses. Daily and monthly reporting, filterable by branch, role, date and
  overtime, with CSV export.
- **Preview** — `/attendance/preview` — the dashboard with sample data, so the
  reporting UI can be judged before there is a month of real punches in it.
  Dev builds only; it does not exist in a production bundle.

Each branch has its own colour theme (Win: deep navy + orange · Pwint: white +
fuchsia · Yangon: red + white), and every theme has a dark mode. The kiosk wears
the theme of the shop it is in; the dashboard wears the theme of the branch it
is filtered to.

**Full documentation — architecture, the Firestore schema, the security model,
the overtime rules and what still has to be built server-side — is in
[`docs/ATTENDANCE_ARCHITECTURE.md`](docs/ATTENDANCE_ARCHITECTURE.md).**

## Layout

```
src/
  Feature/
    Public/        the storefront
    Attendance/    the attendance app  (config · theme · auth · lib
                                        hooks · services · components · pages)
  routes/          router.jsx · PublicRoutes · AttendanceRoutes
docs/              ATTENDANCE_ARCHITECTURE.md
firestore.rules    security rules
firestore.indexes.json
```
