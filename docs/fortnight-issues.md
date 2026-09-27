# Fortnight — issue breakdown

Source: [prd-fortnight.html](prd-fortnight.html) (27 Sep 2026). Vertical slices: each issue lets you do one more
thing in the real vault, and brings its own model rule, store code, screen and tests. Build each with `/tdd`,
and close it with `/code-review`.

Test seams (PRD §8): **`planBoard()`** (pure) and **`store` over a stand-in Obsidian app** (vault + Tasks `apiV1`
+ Nudge `store`). Screens are verified in the `_preview` harness on :8824, then in the vault. The iOS 15 floor applies
to every issue.

**Design (chosen 27 Sep 2026):** variant **A “Grouped”** from `design/mockups.html`, plus two ideas from B: the review's log-note preview and the action sheet's inline 14-day picker. Obsidian theme variables with Rhythm's values as fallbacks, and the view sets its own background. The big title shows on phone only.

## Frontier (start here)

- [x] **#1 Fortnight view opens in the vault** — built, tested and deployed 27 Sep 2026; still to confirm it opens in Obsidian
  - AC:
    - `./build.sh` is green (esbuild, then `node --check`, then tests).
    - `ios-hazards.test.cjs` is copied from the siblings and green.
    - `scripts/deploy.sh` copies into `.obsidian/plugins/fortnight-planner/` with sha256 proof.
    - The `fortnight-repo` launch entry serves `_preview` on :8824.
    - A command and ribbon icon open an empty "Fortnight" view. The icon is checked with `obsidian-lucide-icons`.
  - In: manifest (`fortnight-planner`, AGPL-3.0-only), LICENSE (verbatim FSF text), README stub, `.gitignore` (with `design/`), `git init`.
  - Out: any board logic; the GitHub remote (only on Ruan's say-so).
  - Blocked by: none

## Order change (27 Sep 2026)

Ruan's own plugins come first. Nudge and Rhythm cards now appear straight after the first board (#3b, #3c). #6 (Slipped) moves up to straight after #3b, because most of the dated to-dos in the target vault are overdue and would otherwise not show at all. Drag and tick (#4, #5) cover them too. A small Vista card joins v1 (#5b). #10, #11 and #12 keep only what's left of them.

## Blocked

- [x] **#2 Tasks lines round-trip exactly** *(prefactor)* — done 27 Sep 2026; reads fields from the line's end exactly as Tasks does
  - AC:
    - The parser reads the status (`[ ]`, `[x]`, `[-]`), text, ⏳ 📅 🛫 ✅ 🔁 🆔 and priority emoji.
    - Serialising an unchanged line reproduces it byte-for-byte, including unknown emoji and trailing tags.
    - Setting or clearing ⏳ or 🛫 changes only that token.
  - In: `tasks-line.js` + tests, mirroring `nudge-vault/tests/tasks.test.cjs`.
  - Out: vault I/O.
  - Blocked by: #1

- [x] **#3 Dated to-dos appear on this week's days** — done 27 Sep 2026; on Sunday a Today column stays in front of the week ahead (Q31)
  - AC:
    - `planBoard` puts a ⏳ line on its day.
    - A line with 📅 and no ⏳ shows on its due day with a deadline badge.
    - Mon–Sun window; on Sunday it jumps to next Monday.
    - Lines in excluded folders are ignored.
    - Nudge's own note is skipped (Nudge reminders come through Nudge in #3b, so nothing appears twice).
    - Undated lines are ignored for now.
    - Each card shows its source note, and clicking it opens the line.
    - The view refreshes when files change.
  - In: `planBoard` (seam 1 tests), `store.load` over the stand-in vault (seam 2), read-only desktop day columns in variant A, and a settings tab with excluded folders.
  - Out: dragging, Next week and Later, events, Nudge, practices.
  - Blocked by: #2

- [x] **#3b Nudge reminders appear on the board** — done 27 Sep 2026
  - AC:
    - Reminders are read through `app.plugins.plugins['nudge-reminders'].store`, never by parsing `Reminders.md` directly.
    - An open reminder shows on its due day with a bell hint, and its ⏰ time if it has one.
    - A reminder added in Nudge appears on the board without a manual reload.
    - Without Nudge installed, the board simply has no reminder cards. If Nudge is installed but can't be read, a quiet line above the board says so.
    - A reminder with only ⏳ (no 📅) sits on its ⏳ day.
  - In: Nudge adapter (read), bell hint, seam 2 tests with a stubbed Nudge store.
  - Out: moving and ticking (#4, #5); Next week and Later for Nudge (#11).
  - Blocked by: #3

- [x] **#3c Rhythm events and practices appear on the board** — done 27 Sep 2026
  - AC:
    - Rhythm Event notes (`date`, `time`) show as locked cards on their day, sorted by time.
    - The Practices owed tray lists weekly and monthly practices (as Rhythm's own Plan board does) with a count of sessions not yet placed on a day.
    - The board's week follows Rhythm's week start. Rhythm is read only when the Rhythm plugin is enabled.
    - Each day shows a count of its daily practices.
    - Read-only: nothing is written to Rhythm yet.
  - In: a copy of Rhythm's `model.js`/`dates.js` bundled into the plugin (as in Vista), events and tray UI.
  - Out: placing and ticking practices (#4, #5); creating events (#10).
  - Blocked by: #3

- [ ] **#4 Drag a to-do to another day**
  - AC:
    - Dropping a card on a day sets ⏳ to that date. 📅 is untouched.
    - If the line changed on disk since loading, the move is refused and the board reloads.
    - Seam 2 asserts the resulting file text.
  - In: `store.move(card, {day})`, desktop drag and drop. Nudge cards move through Nudge's `setDue`, keeping the ⏰ time. Dragging a practice from the tray onto a day writes Rhythm Log `plan`.
  - Out: reordering within a day (#8), Next week and Later (#7).
  - Blocked by: #3, #3b, #3c

- [ ] **#5 Tick a to-do done**
  - AC:
    - With Tasks installed, ticking calls `apiV1.executeToggleTaskDoneCommand`, so a 🔁 line produces its next occurrence exactly as Tasks would.
    - Without Tasks, it does a plain `[x]` tick and shows a one-time notice.
    - Done cards appear dimmed in a collapsed group at the bottom of their day.
  - In: `store.tick`, Done group UI, seam 2 tests with a stubbed `apiV1`. Nudge cards tick through Nudge's `toggle`; practice cards write Rhythm Log `done`.
  - Blocked by: #3, #3b, #3c

- [ ] **#5b Vista shows this week's plan**
  - AC:
    - Vista gets a small read-only "This week" card: today's cards and a count per remaining day, read from Fortnight.
    - Tapping it opens Fortnight.
    - Without Fortnight installed, the card is hidden.
  - In: a small read API on the Fortnight plugin (`plugin.board()`), the card in ~/Github/vista-vault.
  - Out: editing from Vista.
  - Blocked by: #5

- [x] **#6 Slipped cards show at the top of Today; past days collapse** — done 27 Sep 2026
  - AC:
    - Open cards with ⏳ before today appear in a Slipped group at the top of Today.
    - Past days this week render as thin columns.
    - Nothing ever rolls over automatically. A seam 1 test pins this.
  - In: `planBoard` slipped rule, UI.
  - Out: sorting slipped cards (#13, #14).
  - Blocked by: #3

- [ ] **#7 Next week bucket and Later pile**
  - AC:
    - Dropping a card on Next week sets 🛫 to next Monday and removes ⏳.
    - Dropping on Later removes both.
    - Expanding Next week shows its 7 days, and dropping there sets ⏳.
    - Later lists undated lines only from the planner note and the included folders (none by default).
    - A 🛫 line with no ⏳ in a later week also lands in Next week.
  - In: `planBoard` slots, `store.move` for the `nextWeek` and `later` slots, settings (planner note path, included folders).
  - Out: a third week.
  - Blocked by: #4

- [ ] **#8 Reorder to-dos within a day**
  - AC:
    - Events come first, by time.
    - Then to-dos in manual order. Reordering adds a 🆔 only to the lines that were moved.
    - Order is kept in plugin data under that 🆔 and survives edits to the line's text.
    - Lines without a 🆔 sort by priority.
  - In: `store.reorder`, plugin data, drag within a column.
  - Out: phone long-press reorder (#13).
  - Blocked by: #4

- [ ] **#9 Quick-add a to-do to any column**
  - AC:
    - Typing into a column's quick-add appends `- [ ] text` with that column's slot under `## Inbox` in the planner note.
    - The planner note and its heading are created if missing.
    - The new card appears straight away.
  - In: `store.add`, the quick-add field with a To-do/Event switch (only To-do works yet).
  - Out: events (#10).
  - Blocked by: #7

- [ ] **#10 "14:00 dentist" creates an event**
  - AC:
    - A quick-add with a leading `HH:MM`, or with the Event switch on, creates `Rhythm/Events/<name>.md` with that frontmatter.
    - Tapping an event opens a sheet to change its date or time (open question 6).
  - In: event write (frontmatter only).
  - Out: calendar feeds (only the settings slot).
  - Blocked by: #9

- [ ] **#11 Nudge reminders in Next week and Later**
  - AC:
    - Moving to Next week sets the due date to next Monday.
    - Moving to Later asks "stop reminding?" before clearing the due date.
    - `Reminders.md` is never written directly; seam 2 asserts this.
  - In: Nudge adapter (writes).
  - Out: creating Nudge reminders from Fortnight.
  - Blocked by: #5, #7

- [ ] **#12 Practices tray behaves fully**
  - AC:
    - Placing a practice lowers its count, and a fully placed practice leaves the tray.
    - Un-placing (dragging back to the tray) removes it from Rhythm Log `plan`.
    - Rhythm's Today view agrees, checked in the vault.
    - Log bodies are never rewritten (guard test).
  - In: tray behaviour on top of #3c and #4.
  - Out: sorting practices in the review (open question 4: no).
  - Blocked by: #4, #5

- [ ] **#13 Phone day view with the action sheet**
  - AC:
    - Below the phone breakpoint, the view is a single day with a day switcher.
    - Tapping a card opens a sheet: Today · Tomorrow · Pick a day (an inline 14-day picker) · Next week · Later · Done · Drop.
    - Drop marks the line `- [-]` (cancelled).
    - Long-press drag reorders within the day.
    - At 375px there is no horizontal scroll and all touch targets are ≥44px.
  - In: phone layout, action sheet, `store.drop`.
  - Out: swipe gestures.
  - Blocked by: #6, #7

- [ ] **#14 Review today**
  - AC:
    - Steps through each unfinished card for today with tomorrow / pick a day / Later / drop.
    - Offers an optional one-line reflection.
    - The summary screen previews the exact text that will be written to the log note.
    - Appends `## Review` (done / moved / dropped, plus the reflection) to the day note in the configured folder (default `Rhythm/Log`), creating the note if missing.
    - The body is only appended to. Seam 2 asserts the exact text.
    - If you skip the review, the cards show in Slipped the next day.
  - In: `store.writeReview`, review flow UI, the review-folder setting.
  - Out: sorting practices.
  - Blocked by: #6, #7

- [ ] **#15 Plan today**
  - AC:
    - The morning mode shows Today, Slipped, today's due deadlines and the top 5 Later items (planner note first).
    - Each has a "pull in" button, and each Today card can be pushed out.
  - In: mode UI over the existing store.
  - Out: suggestions ranked by Rhythm urgency.
  - Blocked by: #6, #7

- [ ] **#16 Plan the fortnight**
  - AC:
    - The guided flow runs look back (sort last week's slipped cards), then clear Later, then place, with Skip on each step.
    - Opened from a command and the ribbon.
    - At the end it appends `## Fortnight plan` (count slipped, count placed) to that day's log note.
  - In: flow UI, reusing the review's sorting and the board.
  - Out: a third week.
  - Blocked by: #12, #14

- [ ] **#17 v1 release-ready**
  - AC:
    - `obsidian-mobile-safety-reviewer` finds nothing blocking.
    - `obsidian-plugin-auditor` returns RELEASE.
    - Checked on an actual iPhone.
    - A full Sunday session is completed over real vault data.
    - All suites are green.
  - In: fixes those reviews raise, README.
  - Out: publishing the GitHub release and submitting to the community store (only on Ruan's say-so).
  - Blocked by: #1–#16
