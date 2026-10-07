# Design files

Source files for the Routine Tracker screens, exported from the design canvas:
<https://claude.ai/artifact/7df1c33a-80d1-4c6a-9205-19ebd5f4e6bc> (version `1791330357-8efe`).
The files are an unmodified copy of the canvas's `project/` folder, so they can be re-imported or diffed against it.

The chosen look is **Lilac Dusk with black event titles** (`OptionB` / `OptionW`): lilac ground, one plum accent
(`#4B2E83`), every event title in near-black, colour only in soft block fills. The screens use Bricolage Grotesque
(headings) and Plus Jakarta Sans (body) from Google Fonts.

## Screens (390 px wide, iPhone)

| File | Screen |
| --- | --- |
| `Main.dc.html` | Today: timeline, now line, Now/Next card, timers |
| `Calendar.dc.html` | Month view with score rings, selected-day summary |
| `Day.dc.html` | A past day: week strip, planned vs actual bars |
| `Tasks.dc.html` | Inbox, routines, one-offs |
| `AddTask.dc.html` | Add / edit task sheet (repeat, colour, chime, "this day only / this and future days") |
| `LogTime.dc.html` | Log time sheet (timer, done as planned, skipped, manual times, note) |
| `DayReview.dc.html` | Day review: logged score, day score, planned vs actual |
| `Trends.dc.html` | Weekly / monthly charts, coverage, most skipped |
| `Settings.dc.html` | Sounds, day hours, scoring tolerances, backup and restore |
| `FirstRun.dc.html`, `Install.dc.html` | Empty day; Add to Home Screen guide |
| `WelcomeBack.dc.html`, `TodayMuted.dc.html` | Reopened after a break ("while you were away"); muted sounds + backup reminder |
| `ReviewFlow.dc.html`, `Restore.dc.html` | Review today (log later); Merge or Replace restore |
| `States.dc.html` | Block states and score colours (reference sheet) |

`Option*.dc.html` are the 41 palette and typography explorations the theme was chosen from.
`canvas.json` is the canvas index (artboard positions and titles).

## Using these files

* A `.dc.html` file is plain markup with inline styles, so it works as a visual and copy reference as-is.
* They load `./support.js`, the design canvas's renderer, which is not part of the design and is not included.
  To see them rendered, open the canvas link above.
* Behaviour for each screen is implemented by `src/backend` (see the root README); the screens themselves are
  not yet ported to React.
