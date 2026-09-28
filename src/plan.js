'use strict';
/* The board model: pure. Given today, the open tasks and the settings, say
   which week is showing and which card sits on which day. No vault, no DOM —
   tests drive it with in-memory fixtures. */

const D = require('./dates');
const L = require('./tasks-line');
/* Rhythm's own model, bundled unchanged (src/rhythm/VENDORED.md). */
const RM = require('./rhythm/model');

/* The week showing: the one today is in — except on its last day (Sunday,
   for a Monday week), when you sit down to plan the week ahead, so the board
   has already moved on to it. */
function boardWeek(today, weekStart) {
  const tomorrow = D.addDays(today, 1);
  return D.weekStart(tomorrow, weekStart) === tomorrow ? tomorrow : D.weekStart(today, weekStart);
}

/* A card's day: its ⏳ scheduled date; failing that, its 📅 due date, shown
   as a deadline so it can't hide. */
/* A done card shows on the day it was planned for (⏳, else 📅) — unless
   that day has gone, when it shows on the day it was done: a slipped card
   ticked today lands in today's Done, not on a collapsed past day. */
function doneDay(planned, doneDate, today) {
  if (planned && planned >= today) return planned;
  return doneDate || planned;
}

function cardFor(task, today) {
  if (task.source === 'nudge') return reminderCard(task, today);
  const t = L.parseTask(task.raw);
  if (!t || t.cancelled) return null;
  /* Parked: a 🛫 ("not before") still to come, no ⏳, and any 📅 already
     behind it (an overdue deadline pushed to next week). It waits in Next
     week, not in Slipped, until its week comes. */
  if (!t.done && !t.scheduled && t.start && t.start > today && (!t.due || t.due < t.start)) return null;
  const date = t.done ? doneDay(t.scheduled || t.due, t.doneDate, today) : (t.scheduled || t.due);
  if (!date) return null;
  return {
    key: `${task.path}:${task.line}`, source: 'tasks', path: task.path, line: task.line, raw: task.raw,
    text: t.text, scheduled: t.scheduled, due: t.due, time: '',
    deadlineOnly: !t.scheduled, priority: t.priority, tags: t.tags,
    done: t.done, date,
  };
}

/* A Nudge reminder arrives already read by Nudge (its ⏰ time is Nudge's
   own token, which a Tasks-style reader can't see past). Its due day IS
   its day — a reminder, not a deadline badge; one with only ⏳ sits there. */
function reminderCard(r, today) {
  const date = r.done ? doneDay(r.due || r.scheduled, r.doneDate, today) : (r.due || r.scheduled);
  if (!date) return null;
  return {
    key: `${r.path}:${r.line}`, source: 'nudge', path: r.path, line: r.line, raw: r.raw,
    text: r.text, scheduled: r.scheduled || '', due: r.due, time: r.time || '',
    deadlineOnly: false, priority: r.priority || 'normal', tags: r.tags || [], group: r.group || '',
    done: !!r.done, date,
  };
}

/* The planner note's path, tidied — ONE reading shared by the board and the
   store: one kind of slash, no "./" or leading "/", ".md" added (a path
   without it is a file Obsidian never lists as a note). */
function plannerPathOf(settings) {
  let p = String((settings && settings.plannerNote) || 'Planning/Fortnight.md').trim()
    .replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/|\/)+/, '');
  if (!p || p.endsWith('/')) p += 'Fortnight.md';
  return /\.md$/i.test(p) ? p : `${p}.md`;
}

/* An open line with no day (no ⏳, no 📅): parked in Next week if its 🛫 is
   in a week still to come; in Later if its 🛫 week has come without a day
   (never lost), or if it is undated and lives in the planner note or an
   included folder. Anything else undated stays off the board. */
function undatedCard(task, nextWeekStart, settings) {
  if (task.source === 'nudge') return null;
  const t = L.parseTask(task.raw);
  /* A 📅 only when it is behind the 🛫 (see cardFor): parked past it. */
  if (!L.isOpen(t) || t.scheduled || (t.due && !(t.start && t.due < t.start))) return null;
  const base = {
    key: `${task.path}:${task.line}`, source: 'tasks', path: task.path, line: task.line, raw: task.raw,
    text: t.text, scheduled: '', due: t.due, start: t.start, time: '',
    deadlineOnly: false, priority: t.priority, tags: t.tags, done: false, date: '', tagged: false,
  };
  if (t.start) return Object.assign(base, { slot: t.start >= nextWeekStart ? 'nextWeek' : 'later' });
  const planner = plannerPathOf(settings);
  if (task.path === planner || inFolders(task.path, settings.laterFolders)) return Object.assign(base, { slot: 'later' });
  /* Parked in Later from a note Later doesn't otherwise read (Q36). */
  if (L.hasTag(task.raw, settings.laterTag || '#later')) return Object.assign(base, { slot: 'later', tagged: true });
  return null;
}

/* A folder setting matches the whole folder: "Templates" hides
   Templates/x.md and Templates/Sub/y.md, never MyTemplates/z.md. */
function inFolders(path, folders) {
  return (folders || []).some(f => {
    const dir = String(f).replace(/^\/+|\/+$/g, '');
    return dir && path.startsWith(dir + '/');
  });
}

/* Rhythm events are fixed: locked cards, shown before anything movable. */
function eventCard(e) {
  return {
    key: `event:${e.path}`, source: 'event', path: e.path, line: 0, locked: true,
    text: e.name, area: e.area || '', scheduled: '', due: '', time: e.time || '',
    deadlineOnly: false, priority: 'normal', tags: [], date: e.date,
  };
}

/* A practice promised to a day in Rhythm's log (`plan`). */
function practiceCard(p, date) {
  return {
    key: `practice:${date}:${p.name}`, source: 'practice', path: p.path, line: 0,
    text: p.name, area: p.area || '', scheduled: '', due: '', time: p.time || '',
    deadlineOnly: false, priority: 'normal', tags: [], date,
  };
}

/* Within a day: events first, in Rhythm's own order (time then name, so an
   all-day event leads); then anything at a set time, earliest first; then
   by priority, then where the line lives. */
const byPlace = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line;

function byTimeThenPriority(a, b) {
  const ea = a.source === 'event', eb = b.source === 'event';
  if (ea !== eb) return ea ? -1 : 1;
  if (ea) return (a.time + a.text).localeCompare(b.time + b.text);
  if (a.time || b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
  }
  return (L.PRIORITY_RANK[b.priority] - L.PRIORITY_RANK[a.priority])
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    || a.line - b.line;
}

function planBoard({ today, tasks = [], settings = {}, rhythm = null }) {
  /* With Rhythm, its week is the week: otherwise a practice planned for
     Rhythm's first day could land outside the board's week and be counted
     as owed as well as placed. */
  const weekStart = rhythm && rhythm.weekStart != null ? rhythm.weekStart
    : settings.weekStart == null ? 1 : settings.weekStart;
  const start = boardWeek(today, weekStart);
  const days = [];
  /* Jumped ahead (it's the week's last day): keep today in front, so what
     is planned for today stays in sight while you plan the week ahead. */
  if (start > today) days.push({ date: today, past: false, isToday: true, cards: [], done: [], dailyCount: 0 });
  for (let i = 0; i < 7; i++) {
    const date = D.addDays(start, i);
    days.push({ date, past: date < today, isToday: date === today, cards: [], done: [], dailyCount: 0 });
  }
  const byDate = new Map(days.map(d => [d.date, d]));
  /* Next week: the seven days after the board's week, plus "any day". */
  const nwStart = D.addDays(start, 7);
  const nextWeek = { start: nwStart, days: [], anyDay: [], count: 0 };
  for (let i = 0; i < 7; i++) nextWeek.days.push({ date: D.addDays(nwStart, i), cards: [], done: [], dailyCount: 0 });
  const nwByDate = new Map(nextWeek.days.map(d => [d.date, d]));
  const later = [];
  /* Still open and its day has gone: Slipped, shown at the top of Today so
     it can't be missed. Its old day is kept as `date` for the "from" label;
     nothing is rolled forward in the note. */
  const slipped = [];
  for (const task of tasks) {
    if (inFolders(task.path, settings.excludeFolders)) continue;
    const card = cardFor(task, today);
    if (!card) {
      const parked = undatedCard(task, nwStart, settings);
      if (parked) (parked.slot === 'later' ? later : nextWeek.anyDay).push(parked);
      continue;
    }
    if (card.done) { const d = byDate.get(card.date); if (d) d.done.push(card); continue; }
    if (card.date < today) { slipped.push(card); continue; }
    const d = byDate.get(card.date);
    if (d) { d.cards.push(card); continue; }
    const n = nwByDate.get(card.date);
    if (n) n.cards.push(Object.assign(card, { slot: 'nextWeek' }));
  }
  const tray = rhythm ? placeRhythm(rhythm, days, today, start, byDate, nextWeek.days, nwByDate) : [];
  for (const d of days) { d.cards.sort(byTimeThenPriority); d.done.sort(byTimeThenPriority); }
  for (const d of nextWeek.days) d.cards.sort(byTimeThenPriority);
  nextWeek.anyDay.sort(byPlace);
  const planner = plannerPathOf(settings);
  later.sort((a, b) => ((b.path === planner) - (a.path === planner)) || byPlace(a, b));
  nextWeek.count = nextWeek.anyDay.length + nextWeek.days.reduce((n, d) => n + d.cards.length, 0);
  slipped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byTimeThenPriority(a, b)));
  return { weekStart: start, today, days, slipped, tray, nextWeek, later };
}

/* Rhythm on the board, all by Rhythm's own rules: events on their day,
   practices promised to a day on that day, a count of daily practices, and
   the tray — weekly and monthly practices with sessions still to place (its
   shelf(), as on Rhythm's own Plan board). The tray looks from the first day still ahead to the end of the
   week showing: on Sunday that is the whole week ahead. */
function placeRhythm(data, days, today, start, byDate, nwDays, nwByDate) {
  const weekStart = data.weekStart == null ? 1 : data.weekStart;
  for (const e of data.events || []) {
    const d = byDate.get(e.date);
    if (d) { d.cards.push(eventCard(e)); continue; }
    const n = nwByDate.get(e.date);
    if (n) n.cards.push(Object.assign(eventCard(e), { slot: 'nextWeek' }));
  }
  /* Practices already promised to a day next week show there too. */
  RM.boardDays(data, nwDays[0].date, 7, { weekStart, events: [] }).forEach((b, i) => {
    nwDays[i].dailyCount = b.dailyCount;
    for (const { p } of b.planned) nwDays[i].cards.push(Object.assign(practiceCard(p, b.date), { slot: 'nextWeek' }));
  });
  const per = RM.boardDays(data, days[0].date, days.length, { weekStart, events: [] });
  per.forEach((b, i) => {
    days[i].dailyCount = b.dailyCount;
    for (const { p } of b.planned) days[i].cards.push(practiceCard(p, b.date));
    /* Flexible practices ticked that day join its done list; daily ones
       are only a count. */
    for (const p of (data.practices || []).filter(RM.isFlexible)) {
      if (RM.logHas(data.log, b.date, p.name)) days[i].done.push(Object.assign(practiceCard(p, b.date), { done: true }));
    }
  });
  const from = start > today ? start : today;
  const left = D.diffDays(from, D.addDays(start, 6)) + 1;
  return RM.shelf(data, from, left, { weekStart }).map(s => ({
    name: s.p.name, area: s.p.area || '', path: s.p.path, need: s.need, target: s.pr.target,
  }));
}

/* What a card can do — ONE rule, used by the phone sheet and the desktop
   Move menu alike (the store enforces the same limits on writes). */
function actionsFor(card, board) {
  const a = { open: true, day: false, nextWeek: false, later: false, done: false, drop: false, dropWhy: '' };
  /* Finished, or fixed: nothing to move. */
  if (card.done || card.source === 'event') return a;
  a.day = true;
  a.done = !card.fromTray;
  if (card.source === 'tasks') {
    const t = L.parseTask(card.raw || '');
    const due = card.due || (t && t.due) || '';
    const dueSooner = !!due && due >= board.today && due < board.nextWeek.start;
    a.nextWeek = !dueSooner && !(card.slot === 'nextWeek' && !card.date);
    a.later = !due && card.slot !== 'later';
    /* Tasks never makes the next occurrence of a cancelled line: dropping a
       🔁 to-do would end the repeat for good. */
    if (t && t.recurrence) a.dropWhy = 'repeats';
    else a.drop = true;
  }
  return a;
}

module.exports = { planBoard, plannerPathOf, actionsFor };
