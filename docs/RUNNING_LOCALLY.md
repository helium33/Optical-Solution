# Running the attendance app on your own machine

Windows + VS Code + PowerShell, which is what you are on. Every command goes in
VS Code's own terminal: **Terminal → New Terminal**, or `` Ctrl+` ``.

---

## 1. Get the code

You already have this repository cloned. The attendance work is on a branch, so
you need to fetch it and switch to it:

```powershell
git fetch origin claude/friendly-hypatia-sm6v6h
git checkout claude/friendly-hypatia-sm6v6h
git pull origin claude/friendly-hypatia-sm6v6h
```

If `git checkout` complains that you have local changes, stash them first with
`git stash`, then run the checkout again.

If you do **not** have it cloned, or want a clean copy somewhere else:

```powershell
git clone https://github.com/helium33/Optical-Solution.git
cd Optical-Solution
git checkout claude/friendly-hypatia-sm6v6h
code .
```

`code .` opens the folder in VS Code. If PowerShell says `code` is not
recognised, open VS Code, press `Ctrl+Shift+P`, and run
**Shell Command: Install 'code' command in PATH**.

---

## 2. Install the dependencies

```powershell
npm install
```

Once, after every `git pull` that changed `package.json`.

---

## 3. Create `.env`

The app needs your Firebase keys, and `.env` is deliberately **not** in git —
this repository is public, so it must never carry project configuration.

```powershell
npm run setup:env
```

That copies `.env.example` to `.env` and then tells you exactly which values are
still blank. It also catches the Windows trap where Notepad silently saves the
file as `.env.txt`.

Fill in the six `VITE_FIREBASE_*` values from the Firebase console:
**Project settings → General → Your apps → SDK setup and configuration.**

Then check it:

```powershell
npm run check:env
```

### For running before the Cloud Functions exist

The functions that verify PINs and write punches are not deployed yet. To run
the app anyway, add these lines to the bottom of `.env`:

```ini
VITE_ALLOW_CLIENT_PUNCH=true
VITE_DEV_BRANCH_PINS=win:1111,pwint:2222,yangon:3333

# Skips the 50 m geofence, so you can test from home rather than the shop.
VITE_DEV_MODE=true

# Opens the kiosk at "/" instead of the storefront. What you want on a tablet.
VITE_DEFAULT_APP=attendance
```

Your three real PINs then work exactly as they will in production. They are safe
in `.env` because `.env` is gitignored — **never** put them in `.env.example`,
in the code, or in a commit message.

One thing to switch on in Firebase first: **Authentication → Sign-in method →
Anonymous → Enable**. Without it the kiosk shows "Missing or insufficient
permissions", because Firestore refuses every read from a browser with no
identity at all.

---

## 4. Start it

```powershell
npm run dev
```

VS Code will show a "Open in Browser" popup, or Ctrl+click the address it
prints. Three screens:

| What | URL |
|---|---|
| **Kiosk** (staff clock in/out) | http://localhost:5173/attendance/kiosk |
| **Admin dashboard** | http://localhost:5173/attendance/admin |
| Storefront (the old project) | http://localhost:5173/ |

`/` is the storefront unless you set `VITE_DEFAULT_APP=attendance`. That is by
design — this repo holds both apps.

### Getting into the admin dashboard

The admin link is hidden on purpose. On the kiosk screen, **type `7860`** — on
the keypad or the keyboard, either works — and the sign-in appears. Then sign in
with Google as `kyawwinhtun564@gmail.com`.

### Seeing it without Firebase at all

```powershell
npm run preview:dev
```

Runs everything against an in-memory fake: no Firebase, no `.env`, no network.
The branch PIN there is `1234`, any 4 digits work as a staff PIN, and the
dashboard is filled with sample data. Good for looking at the design; useless
for testing anything real.

---

## 5. Checks you can run

```powershell
npm run test:logic    # 58 assertions: geofence, overtime, monthly roll-up
npm run check:i18n    # English and Myanmar have the same keys
npm run lint          # ESLint
npm run build         # production build
```

`npm run lint` reports 9 errors in `src/Feature/Public/` and
`src/Component/NotFound.jsx`. Those are in the original storefront code and
predate the attendance app — not something you broke.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| "Firebase is not configured" | No `.env`, or it is missing keys. Run `npm run setup:env`. |
| "Missing or insufficient permissions" | Anonymous sign-in is off in Firebase, or the rules are not deployed. |
| "That is not the PIN for this branch" | `VITE_DEV_BRANCH_PINS` is not set, so it is still expecting `1234`. |
| "PIN checking is not set up on the server yet" | `VITE_ALLOW_CLIENT_PUNCH=true` is missing from `.env`. |
| Page is blank / 404 on a deep link | Restart `npm run dev`. Vite does not pick up `.env` changes while running. |
| `firebase : The term 'firebase' is not recognized` | Use `npm run firebase -- <command>`, e.g. `npm run firebase -- login`. |

**Any change to `.env` needs the dev server restarted.** Vite reads it once at
startup. Stop with `Ctrl+C`, run `npm run dev` again.

---

## Deploying the rules

The Firestore rules are **not** listed in `firebase.json`, deliberately: this
Firebase project is shared with the storefront, and
`firebase deploy --only firestore:rules` **replaces** the entire ruleset. Merge
the `match` blocks from `firestore.rules` into the project's existing file
first, then deploy that file by name.

While the Functions do not exist, `firestore.rules.development` is the weaker
ruleset that lets a signed-in browser read and write directly. It is for testing
only — it grants any signed-in user the ability to write attendance records.
