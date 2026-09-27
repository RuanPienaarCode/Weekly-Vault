'use strict';
/* The board model: pure. Given today, the open tasks and the settings, say
   which week is showing and which card sits on which day. No vault, no DOM —
   tests drive it with in-memory fixtures. */

const D = require('./dates');
const L = require('./tasks-line');

/* The week showing: the one today is in — except on its last day (Sunday,
   for a Monday week), when you sit down to plan the week ahead, so the board
   has already moved on to it. */
function boardWeek(today, weekStart) {
  const tomorrow = D.addDays(today, 1);
  return D.weekStart(tomorrow, weekStart) === tomorrow ? tomorrow : D.weekStart(today, weekStart);
}

/* A card's day: its ⏳ scheduled date; failing that, its 📅 due date, shown
   as a deadline so it can't hide. */
function cardFor(task) {
  if (task.source === 'nudge') return reminderCard(task);
  const t = L.parseTask(task.raw);
  if (!L.isOpen(t)) return null;
  const date = t.scheduled || t.due;
  if (!date) return null;
  return {
    key: `${task.path}:${task.line}`, source: 'tasks', path: task.path, line: task.line,
    text: t.text, scheduled: t.scheduled, due: t.due, time: '',
    deadlineOnly: !t.scheduled, priority: t.priority, tags: t.tags,
    date,
  };
}

/* A Nudge reminder arrives already read by Nudge (its ⏰ time is Nudge's
   own token, which a Tasks-style reader can't see past). Its due day IS
   its day — a reminder, not a deadline badge; one with only ⏳ sits there. */
function reminderCard(r) {
  const date = r.due || r.scheduled;
  if (r.done || !date) return null;
  return {
    key: `${r.path}:${r.line}`, source: 'nudge', path: r.path, line: r.line,
    text: r.text, scheduled: r.scheduled || '', due: r.due, time: r.time || '',
    deadlineOnly: false, priority: r.priority || 'normal', tags: r.tags || [],
    date,
  };
}

/* A folder setting matches the whole folder: "Templates" hides
   Templates/x.md and Templates/Sub/y.md, never MyTemplates/z.md. */
function inFolders(path, folders) {
  return (folders || []).some(f => {
    const dir = String(f).replace(/^\/+|\/+$/g, '');
    return dir && path.startsWith(dir + '/');
  });
}

/* Within a day: anything at a set time first, earliest first; then by
   priority, then where the line lives. */
function byTimeThenPriority(a, b) {
  if (a.time || b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
  }
  return (L.PRIORITY_RANK[b.priority] - L.PRIORITY_RANK[a.priority])
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    || a.line - b.line;
}

function planBoard({ today, tasks = [], settings = {} }) {
  const start = boardWeek(today, settings.weekStart == null ? 1 : settings.weekStart);
  const days = [];
  /* Jumped ahead (it's the week's last day): keep today in front, so what
     is planned for today stays in sight while you plan the week ahead. */
  if (start > today) days.push({ date: today, past: false, isToday: true, cards: [] });
  for (let i = 0; i < 7; i++) {
    const date = D.addDays(start, i);
    days.push({ date, past: date < today, isToday: date === today, cards: [] });
  }
  const byDate = new Map(days.map(d => [d.date, d]));
  /* Still open and its day has gone: Slipped, shown at the top of Today so
     it can't be missed. Its old day is kept as `date` for the "from" label;
     nothing is rolled forward in the note. */
  const slipped = [];
  for (const task of tasks) {
    if (inFolders(task.path, settings.excludeFolders)) continue;
    const card = cardFor(task);
    if (!card) continue;
    if (card.date < today) { slipped.push(card); continue; }
    const d = byDate.get(card.date);
    if (d) d.cards.push(card);
  }
  for (const d of days) d.cards.sort(byTimeThenPriority);
  slipped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byTimeThenPriority(a, b)));
  return { weekStart: start, today, days, slipped };
}

module.exports = { planBoard };
