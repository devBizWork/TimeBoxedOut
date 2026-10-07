# Routine Tracker: design handoff

Final direction: **Lilac Dusk (Option W)**, with black event titles throughout. The other design system options were left out on purpose.

## What's in this folder

| Path | What it is |
|---|---|
| `feature-spec.pdf` | The product spec: features, scoring formulas, data model, platform limits |
| `design-tokens.css` | Every color, font, radius and spacing value as CSS variables |
| `screens/*.html` | 16 static mockups at iPhone size (390 px wide). Open in a browser; tab bar and main buttons link between screens |
| `index.html` | List of all screens |

## Screens

**Core:** `today`, `calendar`, `day-timeline` (past day + week strip), `tasks`, `edit-task-sheet`, `log-time-sheet`, `day-review`, `trends`, `settings`
**States & flows:** `state-first-run`, `state-add-to-home-screen`, `state-reopened-catch-up` (While you were away + tap to enable sounds), `state-muted-backup-due`, `state-review-today`, `state-restore-backup`
**Reference:** `reference-block-states` (all six block states and the sound-button states)

## Design rules to keep

- **One text color for events.** Every event title is `--color-ink`, on every block color and inside the Now card. Color lives in block fills only.
- **Now card** is a light tint (`--color-now-bg` + `--color-now-border`) with black text; plum only on the progress fill.
- **Stop button**: plum circle, white square. On a plum surface it inverts (white circle, plum square). Never yellow.
- **Actual time** is a 6 px bar left of each block: plum when on plan, `--color-missed` when off plan.
- **Unknown** (past and not logged) = striped fill + dashed outline. Never styled as "missed".
- Block states: upcoming, in progress (2 px plum ring, live timer), done as planned (plum check), done off plan (outlined clay check + "+15 min" tag), skipped (grey, struck through), unknown.
- Scores: Followed = plum, Missed = orange, Unknown = stripes.
- Touch targets ≥ 44 px. No fake iOS status bar; leave the top 47 px for the system.

## Using this with Claude Code

1. Put this folder in your project, e.g. `design/`.
2. Ask Claude Code something like:
   > Build the Routine Tracker PWA described in `design/feature-spec.pdf`. Match the screens in `design/screens/` and use the variables in `design/design-tokens.css`. Follow the rules in `design/HANDOFF.md`. Start with milestone 1: tasks and routines plus the Today timeline.
3. Suggested stack: Vite + React (or Svelte) + TypeScript, Dexie for IndexedDB, `vite-plugin-pwa` for offline/install. Write unit tests for the scoring engine using the spec's worked example (Logged 75%; Day 60% followed / 20% missed / 20% unknown).

## Not designed yet

Add-task variant of the sheet (same as edit, without "This day only / This and future days"), Monthly view in Trends, the "Done at other times" step in Review today, app icon, dark mode.
