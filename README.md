# Routine Tracker

An offline-first time-blocking app for the iPhone, installed from Safari to the Home Screen.
Block out the day, follow the blocks, log what happened, review and adjust. No account and no
server: everything lives in the phone's database, and backups are files saved to the Files app.

This repo holds the **backend** (data, scoring, now line, chimes, backup) plus the PWA and GitHub Pages
plumbing. `src/App.jsx` is only a harness that exercises the backend; the real screens (the Lilac Dusk
design) plug into the hooks in `src/react/hooks.jsx` and the API in `src/backend/index.js`.

## Stack

| Concern | Choice |
| --- | --- |
| Build / UI shell | Vite + React (JavaScript, no TypeScript) |
| On-phone database | Dexie.js (IndexedDB): tasks, overrides, logs, timers, settings |
| Install + offline | `vite-plugin-pwa`: manifest + Workbox service worker (app shell precached) |
| Scoring, now line, chimes, backup | Plain JavaScript in `src/backend`, no framework dependencies |
| Tests | Vitest + fake-indexeddb |
| Hosting | GitHub Pages via `.github/workflows/deploy.yml` |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 59 tests
npm run build      # production build + service worker in dist/
npm run icons      # regenerate the PWA icons in public/
```

**Deploying:** in the repo's *Settings → Pages*, set *Source* to **GitHub Actions**, then push to `main`.
The workflow runs the tests and builds with `BASE_PATH=/<repo>/`, so the manifest, service-worker scope
and assets work on `https://<user>.github.io/<repo>/`. To check that build locally:

```bash
BASE_PATH=/TimeBoxedOut/ npm run build && BASE_PATH=/TimeBoxedOut/ npm run preview
# then open http://localhost:4173/TimeBoxedOut/
```

Use **hash routing** (or no router) for the screens: Pages cannot rewrite unknown paths. The workflow
also copies `index.html` to `404.html` as a safety net.

## Backend map (`src/backend`)

| File | What it does |
| --- | --- |
| `db.js` | Dexie schema (version 1). Add `db.version(2)…` for future changes; never edit v1. |
| `schedule.js` | Pure. Expands tasks into a day's blocks; routine repeat rules; "this day only" overrides; validation. |
| `tasks.js` | Create / edit / delete / duplicate. Routines are **versioned**: "This and future days" closes the old row at *yesterday* and opens a new one, so past days keep their plan. Inbox → schedule. |
| `logs.js` | Done as planned, done at other times, skipped, clear (undo), bulk log for Review today, and the timer (one at a time, survives reloads). Logs store a snapshot of the plan, so history survives deleted tasks. |
| `scoring.js` | The formula and day totals (below). |
| `dayModel.js` | Pure. Rows + `now` → everything a screen needs: block states, scores, tags, NOW/NEXT, day summary. |
| `days.js` / `stats.js` | Loaders; week strip, month grid with ring numbers, Trends (weekly/monthly, coverage, most skipped). |
| `nowline.js` | Timeline geometry (72 px/hour like the design), now-line position and label, NOW/NEXT card + countdown, scroll target. |
| `clock.js` | Second-aligned ticker; pauses when hidden, ticks on return. |
| `chimes.js` | Web Audio chimes (Bamboo, Glass, Marimba, Bell, Drop, plus warning and end cues) and silence. iOS unlock and the `needs-tap` / `on` / `muted` state. |
| `engine.js` | Plays change / 5-minute warning / end sounds; quiet hours (wrap past midnight); per-task chime or silence; **catch-up** ("While you were away") when the app was asleep, including after a cold start. |
| `wakelock.js` | "Keep screen on", re-acquired when the app returns to the foreground. |
| `backup.js` / `files.js` | JSON backup → Share sheet / Files; restore **Merge** or **Replace** (transactional); logs CSV for Numbers/Excel; backup-reminder status. |
| `pwa.js` | Service worker registration, iOS/standalone detection (Add to Home Screen guide), persistent-storage request. |
| `settings.js` | Settings document, plus device-local `meta:*` rows that are not backed up. |
| `demo.js` | Sample data mirroring the mockups (dev only). |

### Scoring

* Done block = **50** + up to **25** timing + up to **25** length. Skipped = **0**. Unlogged = *unknown*, never "missed".
* Timing credit is full within `onTimeMin` (10) of the planned start, falling linearly to zero at `zeroTimingMin` (60), early or late.
* Length credit is full within ±`lengthPct` (10%) of the planned length, falling linearly to zero at 100% off.
* Day totals are weighted by planned minutes: **Followed**, **Missed**, **Unknown** (always summing to 100), the possible range *followed … followed + unknown*, **logged score** and **coverage** ("160 of 200 min").
* For today, the "so far" score counts only blocks that have ended or been logged.

The three tolerances are in Settings. The tests reproduce the design's numbers (100%, 75%, 90%, 60/20/20, 72% so far, "17:52 left").

### Conventions

Days are local `YYYY-MM-DD` strings, times are minutes since midnight, instants are epoch ms. A block key
`seriesId@date` identifies a block and keys its log, timer and per-day override. Blocks cannot cross midnight.
Task colours map to the six categories (movement, focus, admin, meetings, planning, personal) in `constants.js`.

## iPhone notes

* A web app can't play sound until a tap: the player reports `needs-tap` until `unlock()` runs from a gesture (it listens for the first tap automatically).
* Sounds, timers and the now line only run while the app is open on screen, hence "Keep screen on" and the catch-up note. Alerts on a locked phone are out of scope (they need push).
* The Silent switch can mute Web Audio; the player asks iOS for `audioSession = 'playback'` where supported.
* Data lives in IndexedDB. The app requests persistent storage, but a Home Screen install plus regular backups is the real safeguard.
