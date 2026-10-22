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

/* Reading a line is the hot path (every task, every refresh), and a refresh
   mostly sees the same lines as the last one. So a parse is kept by its raw
   text across boards: two generations, so only lines that are still on the
   board stay held. Parsed tasks are SHARED — read, never written; a card
   gets its own copy of anything it could be handed to change (tags). */
let parsedNow = new Map(), parsedBefore = new Map();
function parse(raw) {
  let t = parsedNow.get(raw);
  if (t !== undefined) return t;
  t = parsedBefore.get(raw);
  if (t === undefined) t = L.parseTask(raw);
  parsedNow.set(raw, t);
  return t;
}
function startParseGeneration() { parsedBefore = parsedNow; parsedNow = new Map(); }

/* What to call a card whose description is empty — a line that is only tags
   ("- [ ] #errand ⏳ …") is named by them, not shown blank. */
const nameOf = (text, tags) => text || (tags || []).join(' ');

/* A card's day: its ⏳ scheduled date; failing that, its 📅 due date, shown
   as a deadline so it can't hide. */
/* A done card shows on the day it was planned for (⏳, else 📅) — unless
   that day has gone, when it shows on the day it was done: a slipped card
   ticked today lands in today's Done, not on a collapsed past day. A planned
   day that isn't on the calendar counts as gone. */
function doneDay(planned, doneDate, today) {
  if (planned && D.isDate(planned) && planned >= today) return planned;
  return doneDate || planned;
}

/* Parked is exactly what Fortnight's Next week writes: a deadline that has
   already passed, pushed behind a 🛫 on a later week's Monday (nwStart and
   beyond), with no ⏳. It waits in Next week, not in Slipped, until its week
   comes. A deadline still ahead is never hidden behind its 🛫 — it sits on
   its day. */
function isParked(t, today, nwStart) {
  return !t.done && !t.scheduled && !!t.start && t.start >= nwStart && !!t.due && t.due < today;
}

function cardFor(task, today, nwStart) {
  if (task.source === 'nudge') return reminderCard(task, today);
  const t = parse(task.raw);
  if (!t || t.cancelled) return null;
  if (isParked(t, today, nwStart)) return null;
  const date = t.done ? doneDay(t.scheduled || t.due, t.doneDate, today) : (t.scheduled || t.due);
  if (!date) return null;
  return {
    key: `${task.path}:${task.line}`, source: 'tasks', path: task.path, line: task.line, raw: task.raw,
    text: nameOf(t.text, t.tags), scheduled: t.scheduled, due: t.due, time: '',
    deadlineOnly: !t.scheduled, priority: t.priority, tags: t.tags.slice(),
    done: t.done, doneDate: t.done ? t.doneDate : '', date, unique: task.unique === true,
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
    text: nameOf(r.text, r.tags), scheduled: r.scheduled || '', due: r.due, time: r.time || '',
    deadlineOnly: false, priority: r.priority || 'normal', tags: (r.tags || []).slice(), group: r.group || '',
    done: !!r.done, doneDate: r.done ? (r.doneDate || '') : '', date,
  };
}

/* The planner note's path, tidied — ONE reading shared by the board and the
   store: one kind of slash, no "./" or leading "/", ".md" added (a path
   without it is a file Obsidian never lists as a note). */
let plannerKey, plannerVal;
function plannerPathOf(settings) {
  /* Read once per setting VALUE: the board asks per undated card. */
  const setting = settings && settings.plannerNote;
  if (plannerVal !== undefined && setting === plannerKey) return plannerVal;
  let p = String(setting || 'Planning/Fortnight.md').trim()
    .replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/|\/)+/, '');
  if (!p || p.endsWith('/')) p += 'Fortnight.md';
  plannerKey = setting;
  plannerVal = /\.md$/i.test(p) ? p : `${p}.md`;
  return plannerVal;
}

/* An open line with no day (no ⏳, no 📅): parked in Next week if its 🛫 is
   in a week still to come; in Later if its 🛫 week has come without a day
   (never lost), or if it is undated and lives in the planner note or an
   included folder. Anything else undated stays off the board. */
function undatedCard(task, today, nextWeekStart, planner, settings) {
  if (task.source === 'nudge') return null;
  const t = parse(task.raw);
  /* A 📅 only when the line is parked (see isParked). */
  if (!L.isOpen(t) || t.scheduled || (t.due && !isParked(t, today, nextWeekStart))) return null;
  const base = {
    key: `${task.path}:${task.line}`, source: 'tasks', path: task.path, line: task.line, raw: task.raw,
    text: nameOf(t.text, t.tags), scheduled: '', due: t.due, start: t.start, time: '',
    deadlineOnly: false, priority: t.priority, tags: t.tags.slice(), done: false, doneDate: '', date: '', tagged: false,
    unique: task.unique === true,
  };
  if (t.start) return Object.assign(base, { slot: t.start >= nextWeekStart ? 'nextWeek' : 'later' });
  if (task.path === planner || inFolders(task.path, settings.laterFolders)) return Object.assign(base, { slot: 'later' });
  /* Parked in Later from a note Later doesn't otherwise read (Q36). The tag
     test builds a RegExp, so it only runs on a line that could hold the tag. */
  const tag = settings.laterTag || '#later';
  const raw = String(task.raw || '');
  if (raw.toLowerCase().includes(String(tag).toLowerCase()) && L.hasTag(raw, tag)) {
    return Object.assign(base, { slot: 'later', tagged: true });
  }
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

/* Within a day: events first — all-day ones, then timed ones by the clock,
   then by name; then anything at a set time, earliest first; then by
   priority, then where the line lives. A time is compared as written in
   its note, "9:00" or "09:00" alike: a single-digit hour is padded, so 9:00
   comes before 10:30 (as text it would come after). */
const byPlace = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line;

const clock = t => String(t || '').trim().replace(/^(\d):/, '0$1:');

function byTimeThenPriority(a, b) {
  const ea = a.source === 'event', eb = b.source === 'event';
  if (ea !== eb) return ea ? -1 : 1;
  const ta = clock(a.time), tb = clock(b.time);
  /* An all-day event has no time, and '' sorts before every clock time —
     compared apart from the name, so a letter-named one still leads. */
  if (ea) return (ta < tb ? -1 : ta > tb ? 1 : 0) || String(a.text).localeCompare(String(b.text));
  if (ta || tb) {
    if (!ta) return 1;
    if (!tb) return -1;
    if (ta !== tb) return ta < tb ? -1 : 1;
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
     nothing is rolled forward in the note. A day that isn't on the calendar
     (⏳ 2026-09-31) has gone too — it is Slipped, so it can't vanish. */
  const slipped = [];
  /* Every done card whose ✅ is today, wherever its planned day is. */
  const doneToday = [];
  const planner = plannerPathOf(settings);
  startParseGeneration();
  for (const task of tasks) {
    if (inFolders(task.path, settings.excludeFolders)) continue;
    const card = cardFor(task, today, nwStart);
    if (!card) {
      const parked = undatedCard(task, today, nwStart, planner, settings);
      if (parked) (parked.slot === 'later' ? later : nextWeek.anyDay).push(parked);
      continue;
    }
    if (card.done) {
      if (card.doneDate === today) doneToday.push(card);
      const d = byDate.get(card.date);
      if (d) d.done.push(card);
      else {
        const n = nwByDate.get(card.date);
        if (n) n.done.push(Object.assign(card, { slot: 'nextWeek' }));
      }
      continue;
    }
    if (!D.isDate(card.date) || card.date < today) { slipped.push(card); continue; }
    const d = byDate.get(card.date);
    if (d) { d.cards.push(card); continue; }
    const n = nwByDate.get(card.date);
    if (n) n.cards.push(Object.assign(card, { slot: 'nextWeek' }));
  }
  const tray = rhythm ? placeRhythm(rhythm, days, today, start, byDate, nextWeek.days, nwByDate) : [];
  for (const d of days) { d.cards.sort(byTimeThenPriority); d.done.sort(byTimeThenPriority); }
  for (const d of nextWeek.days) { d.cards.sort(byTimeThenPriority); d.done.sort(byTimeThenPriority); }
  doneToday.sort(byTimeThenPriority);
  nextWeek.anyDay.sort(byPlace);
  later.sort((a, b) => ((b.path === planner) - (a.path === planner)) || byPlace(a, b));
  nextWeek.count = nextWeek.anyDay.length + nextWeek.days.reduce((n, d) => n + d.cards.length, 0);
  slipped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byTimeThenPriority(a, b)));
  return { weekStart: start, today, days, slipped, tray, nextWeek, later, doneToday };
}

/* Rhythm on the board, all by Rhythm's own rules: events on their day,
   practices promised to a day on that day, a count of daily practices, and
   the tray — weekly and monthly practices with sessions still to place (its
   shelf(), as on Rhythm's own Plan board). The tray looks from the first day still ahead to the end of NEXT
   week, so a practice promised to a day next week (a monthly one, whose period
   reaches that far) counts as placed; shelf() itself stops at the end of each
   practice's own period, so a weekly one promised next week still wants a day
   this week. On Sunday the first day is the week ahead. */
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
  const left = D.diffDays(from, D.addDays(start, 13)) + 1;
  return RM.shelf(data, from, left, { weekStart }).map(s => ({
    name: s.p.name, area: s.p.area || '', path: s.p.path, need: s.need, target: s.pr.target,
  }));
}

/* What a card can do — ONE rule, used by the phone sheet and the desktop
   Move menu alike (the store enforces the same limits on writes). */
function actionsFor(card, board) {
  const a = { open: true, day: false, nextWeek: false, later: false, laterWhy: '', done: false, drop: false, dropWhy: '' };
  /* Finished, or fixed: nothing to move. */
  if (card.done || card.source === 'event') return a;
  a.day = true;
  a.done = !card.fromTray;
  if (card.source === 'tasks') {
    const t = parse(card.raw || '');
    const due = card.due || (t && t.due) || '';
    const dueSooner = !!due && due >= board.today && due < board.nextWeek.start;
    /* Already in Next week (a day or "any day"): parking there would only
       write a 🛫 and nothing would move. */
    a.nextWeek = !dueSooner && card.slot !== 'nextWeek';
    a.later = !due && card.slot !== 'later';
    /* A 🔁 to-do needs a date for Tasks to repeat it, and Later has none; and
       Tasks never makes the next occurrence of a cancelled line, so dropping
       it would end the repeat for good. */
    if (t && t.recurrence) { a.later = false; a.laterWhy = 'repeats'; a.dropWhy = 'repeats'; }
    else a.drop = true;
  }
  return a;
}

module.exports = { planBoard, plannerPathOf, actionsFor };
