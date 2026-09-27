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
  const t = L.parseTask(task.raw);
  if (!L.isOpen(t)) return null;
  const date = t.scheduled || t.due;
  if (!date) return null;
  return {
    key: `${task.path}:${task.line}`, path: task.path, line: task.line,
    text: t.text, scheduled: t.scheduled, due: t.due,
    deadlineOnly: !t.scheduled, priority: t.priority, tags: t.tags,
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

function byPriorityThenPlace(a, b) {
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
  for (const task of tasks) {
    if (inFolders(task.path, settings.excludeFolders)) continue;
    const card = cardFor(task);
    const d = card && byDate.get(card.date);
    if (d) d.cards.push(card);
  }
  for (const d of days) d.cards.sort(byPriorityThenPlace);
  return { weekStart: start, today, days };
}

module.exports = { planBoard };
