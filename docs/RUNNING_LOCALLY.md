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

Two things have to be done in Firebase before any of this works. **Both** of
them, and the second is the one that is easy to miss.

---

## 3b. Two things to switch on in Firebase

### a. Anonymous sign-in

**Authentication → Sign-in method → Anonymous → Enable.**

Firestore refuses every read from a browser with no identity at all. The real
app mints a branch-scoped token from a Cloud Function; until that exists the
kiosk signs in anonymously instead.

### b. Deploy the security rules

This is the one that produces **"Missing or insufficient permissions."** on the
roster screen *after* the branch PIN is accepted. The PIN worked and the tablet
is signed in — Firestore is simply refusing to hand over `staff`, because no
rule grants it. A Firebase project denies everything it has not been told to
allow.

You cannot just deploy this repo's `firestore.rules`:
`firebase deploy --only firestore:rules` **replaces the entire ruleset**, and
this Firebase project is shared with the storefront. Deploying would delete the
storefront's rules.

So merge them:

```powershell
# 1. Firebase Console -> Firestore Database -> Rules.
#    Select everything in the editor, copy it, and save it in this folder as:
#       firestore.rules.existing

# 2. Merge this app's rules into yours:
npm run merge:rules

# 3. Read firestore.rules.merged, then paste it back into the console
#    rules editor and press Publish.
```

`merge:rules` copies your blocks through untouched, renames any helper function
whose name collides with yours (so it cannot redefine `isAdmin()` for the
storefront), warns if both rulesets claim the same collection, and refuses to
write a file that does not parse or that calls a helper nobody defines.

Neither `firestore.rules.existing` nor `firestore.rules.merged` is committed —
they are your project's access control, and this repository is public.

Once the Cloud Functions are deployed, re-run it as `npm run merge:rules -- --prod`
to switch from the development rules to the real ones.

> **What the development rules give up:** an anonymous session carries no
> claims, so they can only ask "is anyone signed in?". Anyone who can reach your
> Firebase project can read every branch's roster. That is fine for a week of
> testing with fake staff. It is not fine once real people's hours are in there.

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
npm run check:env     # .env has everything Firebase needs
npm run merge:rules   # merge this app's rules into your project's
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
| "Missing or insufficient permissions" | The rules are not deployed. See 3b — `npm run merge:rules`. |
| Unlock fails, mentioning Anonymous sign-in | Authentication → Sign-in method → Anonymous → Enable. |
| "That is not the PIN for this branch" | `VITE_DEV_BRANCH_PINS` is not set, so it is still expecting `1234`. |
| "PIN checking is not set up on the server yet" | `VITE_ALLOW_CLIENT_PUNCH=true` is missing from `.env`. |
| Page is blank / 404 on a deep link | Restart `npm run dev`. Vite does not pick up `.env` changes while running. |
| `firebase : The term 'firebase' is not recognized` | Use `npm run firebase -- <command>`, e.g. `npm run firebase -- login`. |

**Any change to `.env` needs the dev server restarted.** Vite reads it once at
startup. Stop with `Ctrl+C`, run `npm run dev` again.

---

## Deploying the rules

See **3b** above — `npm run merge:rules`.

The Firestore rules are deliberately **not** listed in `firebase.json`, so that
a stray `firebase deploy` can never replace the storefront's ruleset by
accident. Deploy the merged file by name, or paste it into the console.
