'use strict';
/* The evening review, pure: which cards it asks about, and the exact text
   it appends to the day's log. The view decides nothing about wording. */

/* Today's open to-dos and reminders, Slipped first. Not events (fixed),
   not practices (Rhythm tracks what's owed), not what's already done. */
function reviewCards(board) {
  const today = board.days.find(d => d.date === board.today);
  const open = c => !c.done && (c.source === 'tasks' || c.source === 'nudge');
  return board.slipped.filter(open).concat(today ? today.cards.filter(open) : []);
}

/* One line of prose: no newlines, nothing that could start a heading or a
   list item once written into the note. */
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();

/* { heading, done: [text], moved: [[text, where]], dropped: [text], left: n,
   reflection } → the block, ending in a newline. Kinds with nothing in
   them are left out; a day with nothing at all still says so. */
function reviewText({ heading, done, moved, dropped, left, reflection }) {
  const lines = [heading];
  if (done.length) lines.push(`- Done: ${done.length} — ${done.map(oneLine).join(', ')}`);
  if (moved.length) lines.push(`- Moved: ${moved.length} — ${moved.map(([t, w]) => `${oneLine(t)} → ${w}`).join('; ')}`);
  if (dropped.length) lines.push(`- Dropped: ${dropped.length} — ${dropped.map(oneLine).join(', ')}`);
  if (left) lines.push(`- Left open: ${left}`);
  if (lines.length === 1) lines.push('- Nothing left open.');
  const r = oneLine(reflection);
  if (r) lines.push(`- Reflection: ${r}`);
  return lines.join('\n') + '\n';
}

module.exports = { reviewCards, reviewText };
