# Fortnight

Plan two weeks, live one day. Fortnight is an Obsidian board where you plan the next two weeks on a Sunday, then adjust each morning and review each evening.

It keeps no store of its own. To-dos are ordinary [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) checkbox lines, so the day a card sits on is its `⏳` scheduled date:

| Where the card sits | The line carries |
|---|---|
| A day | `⏳ YYYY-MM-DD` |
| Next week | `🛫` next Monday, no `⏳` |
| Later | neither (a to-do from another note also gets the Later tag, `#later` by default) |

A `📅` due date is never changed by moving a card.

## Usage

Open the board from the ribbon icon or the command **Fortnight: Open board**.

- **The board.** This week's seven days are columns, with Today pinned on the left. Days already gone shrink to a thin numeral. To-dos left open on a past day gather in a **Slipped** group at the top of Today, so nothing falls off silently. After the week come **Next week** (a summary, or its seven days when expanded) and **Later**.
- **A phone or a narrow pane** shows one day at a time, with a day switcher along the top.
- **Moving a card.** Drag it to another day, to Next week or to Later; or use the **⋯** button on the card (or, on a phone, tap the card) to open a sheet with Today, Tomorrow, Next week, Later, a 14-day picker, Done, Open note and Drop.
- **Ticking** a to-do marks it done; **Drop** cancels it (`[-]` and a `❌` date). Fixed events cannot be moved.
- **Add a to-do** with the field at the bottom of a day, Next week or Later. It is written to the planner note, already placed there.
- **Practices owed.** If you use Rhythm, the strip above the board lists weekly practices that still need a day. Drag one onto a day, or click it and pick a day.
- **Review today** (command, or the button above the board) takes each unfinished card of the day in turn: done, tomorrow, another day, Next week, Later, drop, or leave it. It then adds a short summary, and an optional one-line reflection, to a note for the day.
- **Daily welcome.** The first time you open the board each day it greets you, names the plan for the day ("Plan the week" or "Plan today") with a few figures, and fades into the board. Switch it off in the settings, or run **Show the welcome again**.

Commands: **Open board**, **Review today**, **Show the welcome again**.

## Requirements

- Obsidian 1.8.0 or newer, on desktop, iOS or Android.
- The other plugins are optional. Fortnight shows what it finds and works without the rest:
  - **[Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks)** — ticking goes through Tasks, so `🔁` repeats and `✅` dates follow your Tasks settings. Without it, ticking marks `[x]` and adds today's `✅` date, and nothing repeats.
  - **Nudge** (Nudge Reminders) — its reminders appear as cards, and moving one changes its date through Nudge.
  - **Rhythm** — its events appear as fixed cards on their day, its weekly practices appear in the Practices owed strip, and daily practices show as a count per day.

## What Fortnight reads and writes

Reads:

- Tasks-style checkbox lines (`- [ ] …`, with `⏳`, `🛫`, `📅`, `✅`, `❌`, `🔁` fields) in any Markdown note of the vault, except folders you list under *Excluded folders*. Dated open to-dos appear on their day. Undated ones appear in Later only from the planner note, from folders you list under *Later: also show undated to-dos from*, or when tagged with the Later tag.
- Nudge's reminders, asked of Nudge itself.
- Rhythm's area, practice, event and daily log notes, only while Rhythm is enabled, from the folder named in Rhythm's settings (log notes: from a week back to three weeks ahead). Fortnight finds both plugins through Obsidian's plugin registry and never changes their settings.

Writes, and only these:

- **One token on a Tasks line.** Moving a card edits its `⏳` (and `🛫`, and the Later tag); ticking and dropping change the status box and the `✅` or `❌` date. The rest of the line is left exactly as it was.
- **The planner note** (default `Planning/Fortnight.md`, changeable in the settings): quick-added to-dos go under its `## Inbox` heading. The note and heading are created if missing.
- **Rhythm log notes**: placing or ticking a practice patches the `plan` or `done` list in that day's log note, the same way Rhythm does.
- **Review notes**: *Review today* appends a `## Review` section to the day's note (`YYYY-MM-DD.md`) in Rhythm's log folder, or in the folder you choose in the settings, or in `Reviews/` when Rhythm isn't installed.
- **Nudge reminders**, only by asking Nudge to set their date or tick them.
- Its own settings, in the plugin's `data.json`.

Fortnight makes no network requests and sends no telemetry.

## Settings

Your name (for the greeting), colour (Fortnight's own blue, or Obsidian's accent), the daily welcome, the planner note, the review folder, folders whose undated to-dos join Later, the Later tag, and excluded folders.

## Development

```bash
./build.sh            # bundle src/ → main.js, node --check, run tests/
./scripts/deploy.sh   # copy into the vault and prove it by sha256
npm run preview       # build the browser harness, then serve on :8824
```

Root `main.js` and `styles.css` are build output. Edit `src/` only. `npm test` runs every `tests/*.test.cjs` with plain node; `tests/css-guard.test.cjs` and `tests/ios-hazards.test.cjs` keep the bundle safe for the iOS 15 engine floor and clear of Obsidian's own CSS classes.

## Licence

AGPL-3.0-only
