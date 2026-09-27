'use strict';
/* The rhythm model — pure functions over plain records.

   Records (all produced by io.js from notes; `path` is the note path):
     area     { name, order, note, path }
     practice { name, area, cadence, days, minutes, when, note, path }
     goal     { name, area, horizon, status, next, note, path }
     event    { name, area, date, time, note, path, calendar? }
     log      Map<dateISO, { done:Set, skip:Set, snooze:Set, plan:Set, note:string }>

   The design rule this file enforces: Today shows a SHORT list, and a
   varied one. Everything due is ranked by urgency (what is still owed
   against the days left in its period), then spread so no life area takes
   a second slot before every pressing area has one, then trimmed to
   `focusCount`. */

const D = require('./dates');

/* ---- log access ------------------------------------------------------ */

const EMPTY = Object.freeze({ done: new Set(), skip: new Set(), snooze: new Set(), plan: new Set(), note: '' });
const entry = (log, iso) => (log && log.get(iso)) || EMPTY;
const logHas = (log, iso, name) => entry(log, iso).done.has(name);
const isSkipped = (log, iso, name) => entry(log, iso).skip.has(name);
const isSnoozed = (log, iso, name) => entry(log, iso).snooze.has(name);
/* A plan is a promise to a DAY: "this one on Thursday". It is how the load
   gets spread instead of every flexible practice shouting on every day. */
const isPlanned = (log, iso, name) => entry(log, iso).plan.has(name);

/* The next day AFTER `from` that this practice is promised to, if any —
   bounded by `until` when given (a plan only quiets a practice within its
   CURRENT period: a promise made for next week must leave this week's ask
   alone). Without a bound, falls back to a 21-day scan. */
function plannedAhead(log, from, name, until) {
  const cap = until || D.addDays(from, 21);
  let d = from;
  for (;;) {
    d = D.addDays(d, 1);
    if (d > cap) return null;
    if (isPlanned(log, d, name)) return d;
  }
}

/* How many times a practice is promised inside a window. */
function plannedCount(log, from, days, name) {
  let n = 0;
  for (let i = 0; i < days; i++) if (isPlanned(log, D.addDays(from, i), name)) n++;
  return n;
}

/* Daily practices are not planned — they are simply every day (or every
   listed weekday). Only weekly and monthly ones have a "when" to choose,
   so only those reach the board. */
function isFlexible(p) {
  const c = parseCadence(p.cadence) || { per: 'day' };
  return c.per !== 'day';
}

/* ---- cadence -------------------------------------------------------- */

/* daily | weekly | monthly | 3/week | 2x/week | 1/month | 4 per week */
function parseCadence(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'daily' || s === 'every day') return { per: 'day', times: 1 };
  if (s === 'weekly' || s === 'every week') return { per: 'week', times: 1 };
  if (s === 'monthly' || s === 'every month') return { per: 'month', times: 1 };
  const m = /^(\d+)\s*(?:x|times)?\s*(?:\/|per|a|each)?\s*(day|week|month)s?$/.exec(s);
  if (m) {
    const times = Math.max(1, parseInt(m[1], 10));
    return { per: m[2], times: m[2] === 'day' ? 1 : times };
  }
  return null;
}

function cadenceLabel(c) {
  if (!c) return '';
  if (c.per === 'day') return 'Daily';
  if (c.times === 1) return c.per === 'week' ? 'Weekly' : 'Monthly';
  return `${c.times}× a ${c.per}`;
}

/* The last day of the period this cadence sits in right now — the end of
   the week for weekly/N-per-week, the end of the month for monthly/
   N-per-month, `date` itself for daily (which has no ahead-of-today period
   to promise into). */
function periodEnd(c, date, weekStart) {
  if (c.per === 'week') { const d = D.weekDays(date, weekStart); return d[d.length - 1]; }
  if (c.per === 'month') { const d = D.monthDays(date); return d[d.length - 1]; }
  return date;
}

function parseDays(list) {
  const arr = Array.isArray(list) ? list : (list ? String(list).split(',') : []);
  const out = [];
  for (const raw of arr) {
    const k = String(raw).trim().toLowerCase().slice(0, 3);
    if (D.DAY_KEYS.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/* ---- progress ------------------------------------------------------- */

function countIn(log, days, name) {
  let n = 0;
  for (const d of days) if (logHas(log, d, name)) n++;
  return n;
}

/* Progress of one practice on `date` inside its cadence period.
     { per, target, done, doneToday, skippedToday, snoozed, due, remaining,
       daysLeft, urgency, dueDay } */
function progress(p, log, date, weekStart) {
  const c = parseCadence(p.cadence) || { per: 'day', times: 1 };
  const doneToday = logHas(log, date, p.name);
  const skippedToday = isSkipped(log, date, p.name);
  const days = parseDays(p.days);
  /* Promised to today, or promised to a later day (in which case today
     stays quiet — the decision is already made). */
  const planned = isPlanned(log, date, p.name);
  const deferredTo = planned ? null : plannedAhead(log, date, p.name, periodEnd(c, date, weekStart));
  if (c.per === 'day') {
    const dueDay = !days.length || days.includes(D.dayKey(date));
    const due = dueDay && !doneToday && !skippedToday;
    const snoozed = isSnoozed(log, date, p.name);
    return { per: 'day', target: 1, done: doneToday ? 1 : 0, doneToday, skippedToday, snoozed, planned, deferredTo, due, remaining: due ? 1 : 0, daysLeft: 1, urgency: due ? 1 : 0, dueDay };
  }
  const period = c.per === 'week' ? D.weekDays(date, weekStart) : D.monthDays(date);
  const done = countIn(log, period, p.name);
  const remaining = Math.max(0, c.times - done);
  const idx = period.indexOf(date);
  const daysLeft = idx < 0 ? period.length : period.length - idx; // including today
  const due = remaining > 0 && !doneToday && !skippedToday;
  const urgency = due ? Math.min(1, remaining / Math.max(1, daysLeft)) : 0;
  /* Snooze means "later today", and only today — whatever the cadence.
     Pushing something to a named day is a PLAN, which says which day, so a
     second vaguer mechanism spanning the week would only be a subtler way
     of doing the same job. */
  const snoozed = isSnoozed(log, date, p.name);
  return { per: c.per, target: c.times, done, doneToday, skippedToday, snoozed, planned, deferredTo, due: due || (planned && !doneToday && !skippedToday), remaining, daysLeft, urgency, dueDay: true };
}

/* Days since this was last ticked, counting back from `date` — 0 for
   today, null if it has not happened inside the window. The Areas page
   shows it so "what should I set aside" is answered by the record rather
   than by guilt. */
function lastDone(log, name, from, back = 90) {
  for (let i = 0; i <= back; i++) {
    if (logHas(log, D.addDays(from, -i), name)) return i;
  }
  return null;
}

function sinceLabel(n, back = 90) {
  if (n === null || n === undefined) return `not in ${back} days`;
  if (n === 0) return 'done today';
  if (n === 1) return 'done yesterday';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  return `${Math.round(n / 30)} months ago`;
}

/* When this practice's own history begins: the earlier of the first date
   it appears anywhere in the log (done, skipped, snoozed or planned) and
   its `created` date, if either is known. Deliberately per-practice — the
   log's overall first date belongs to whichever practice was tracked
   first, not to one added this morning. */
function practiceStart(p, log) {
  let first = null;
  if (log) for (const [k, e] of log) {
    if (!D.isISO(k) || !e) continue;
    const seen = (e.done && e.done.has(p.name)) || (e.skip && e.skip.has(p.name))
      || (e.snooze && e.snooze.has(p.name)) || (e.plan && e.plan.has(p.name));
    if (seen && (!first || k < first)) first = k;
  }
  const created = D.isISO(p.created) ? p.created : null;
  if (first && created) return first < created ? first : created;
  return first || created || null;
}

/* Consecutive days before `date` on which a daily practice was not done
   (capped) — the "you've missed this" signal. */
function missedRun(p, log, date, cap = 7) {
  const days = parseDays(p.days);
  /* Never count back past this practice's OWN start: a practice added
     yesterday must not open with "Missed 7 days" borrowed from some other,
     older practice's history. With no tick and no `created` at all, there
     is no evidence it existed before today, so it starts today. */
  const start = practiceStart(p, log) || date;
  let n = 0, d = D.addDays(date, -1);
  while (n < cap && d >= start) {
    const dueDay = !days.length || days.includes(D.dayKey(d));
    if (dueDay) {
      if (logHas(log, d, p.name)) break;
      n++;
    }
    d = D.addDays(d, -1);
  }
  return n;
}

/* One plain sentence for why a row is in front of you. */
function reasonFor(p, pr, log, date) {
  if (pr.doneToday) return 'Done';
  if (pr.skippedToday) return 'Not today';
  if (pr.planned) return 'You planned this for today';
  if (pr.deferredTo) return `Planned for ${D.relative(pr.deferredTo, date)}`;
  if (pr.per === 'day') {
    const days = parseDays(p.days);
    if (days.length) return days.map(k => D.DAY_NAMES[D.DAY_KEYS.indexOf(k)] + 's').join(', ');
    const missed = missedRun(p, log, date);
    if (missed >= 2) return `Missed ${missed} days`;
    return 'Every day';
  }
  const per = pr.per;
  if (pr.remaining <= 0) return `Done for the ${per}`;
  if (pr.remaining > pr.daysLeft) return `Behind this ${per}`;
  if (pr.remaining === pr.daysLeft) return pr.daysLeft === 1 ? `Last chance this ${per}` : `Every day left this ${per}`;
  return `${pr.remaining} more this ${per} · ${pr.daysLeft} days left`;
}

/* ---- ranking -------------------------------------------------------- */

function areaRank(areas) {
  const rank = new Map();
  const sorted = [...areas].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  sorted.forEach((a, i) => rank.set(a.name, i));
  return rank;
}

const WHEN_ORDER = { morning: 0, day: 1, evening: 2, night: 3 };

/* An untimed practice sorts after every timed one. The sentinel is a real
   late time rather than a punctuation mark, because localeCompare puts
   punctuation BEFORE digits and would have floated the untimed ones to the
   top of the morning. */
const timeKey = p => p.time || '99:99';
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const WHEN_LABEL = { morning: 'Morning', day: 'During the day', evening: 'Evening', night: 'Before bed', '': 'Any time' };

/* Anything needed within about three days is "pressing". */
const PRESSING = 1 / 3;

function planDay(data, date, opts) {
  const focusCount = Math.max(1, (opts && opts.focusCount) || 3);
  const weekStart = (opts && opts.weekStart) ?? 1;
  const rank = areaRank(data.areas || []);
  const rows = (data.practices || []).map(p => {
    const pr = progress(p, data.log, date, weekStart);
    return { p, pr, reason: reasonFor(p, pr, data.log, date) };
  });
  const done = rows.filter(r => r.pr.doneToday);
  const skipped = rows.filter(r => r.pr.skippedToday && !r.pr.doneToday);
  const byRank = (a, b) =>
    ((b.pr.planned ? 1 : 0) - (a.pr.planned ? 1 : 0))
    || (b.pr.urgency - a.pr.urgency)
    || ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99))
    || ((WHEN_ORDER[a.p.when] ?? 9) - (WHEN_ORDER[b.p.when] ?? 9))
    || cmp(timeKey(a.p), timeKey(b.p))
    || a.p.name.localeCompare(b.p.name);
  /* A promise to a later day is that day's business: it leaves today
     altogether rather than sinking to the bottom of today's list, and is
     handed back separately so the page can still account for it. */
  const outstanding = rows.filter(r => r.pr.due);
  const deferred = outstanding.filter(r => r.pr.deferredTo);
  const due = outstanding.filter(r => !r.pr.deferredTo).sort(byRank);

  /* Spread: first one item per area among the pressing, unsnoozed rows
     (areas in priority order, best item of each), then the rest of the
     pressing rows by rank, then everything else by rank. */
  const eligible = due.filter(r => !r.pr.snoozed);
  const pressing = eligible.filter(r => r.pr.urgency >= PRESSING);
  const picked = [];
  const seenAreas = new Set();
  for (const r of pressing) {
    if (picked.length >= focusCount) break;
    if (seenAreas.has(r.p.area)) continue;
    seenAreas.add(r.p.area);
    picked.push(r);
  }
  for (const r of pressing) {
    if (picked.length >= focusCount) break;
    if (!picked.includes(r)) picked.push(r);
  }
  for (const r of eligible) {
    if (picked.length >= focusCount) break;
    if (!picked.includes(r)) picked.push(r);
  }
  const later = due.filter(r => !picked.includes(r));
  return { focus: picked, later, done, skipped, deferred, all: rows };
}

/* Group rows by time of day, keeping their order inside each group. */
function groupByWhen(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = WHEN_ORDER[r.p.when] !== undefined ? r.p.when : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 9 : WHEN_ORDER[a]) - (b === '' ? 9 : WHEN_ORDER[b]));
  return keys.map(k => ({ when: k, label: WHEN_LABEL[k], rows: groups.get(k) }));
}

/* ---- goals and events ---------------------------------------------- */

const goalActive = g => !g.status || g.status === 'active';

function sortGoals(goals) {
  return [...(goals || [])].filter(goalActive).sort((a, b) => {
    const ea = D.horizonEnd(a.horizon), eb = D.horizonEnd(b.horizon);
    if (ea && eb) return ea < eb ? -1 : ea > eb ? 1 : a.name.localeCompare(b.name);
    if (ea) return -1;
    if (eb) return 1;
    return a.name.localeCompare(b.name);
  });
}

const hasStep = g => !!(g.next && String(g.next).trim());

function nextGoal(goals) {
  return sortGoals(goals).find(hasStep) || null;
}

function goalsWithoutStep(goals) {
  return sortGoals(goals).filter(g => !hasStep(g));
}

const eventKey = e => (e.date || '') + (e.time || '') + (e.name || '');

function upcoming(events, from, days) {
  const to = D.addDays(from, days);
  return (events || [])
    .filter(e => D.isISO(e.date) && e.date >= from && e.date <= to)
    .sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
}

function eventsInMonth(events, iso) {
  const key = D.monthKey(iso);
  return (events || []).filter(e => D.monthKey(e.date) === key)
    .sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
}

function goalsForMonth(goals, iso) {
  const key = D.monthKey(iso);
  return sortGoals(goals).filter(g => {
    const end = D.horizonEnd(g.horizon);
    return end && D.monthKey(end) <= key;
  });
}

/* ---- summaries ------------------------------------------------------ */

function weekSummary(data, date, weekStart) {
  const days = D.weekDays(date, weekStart ?? 1);
  const rank = areaRank(data.areas || []);
  return (data.practices || []).map(p => {
    const c = parseCadence(p.cadence) || { per: 'day', times: 1 };
    const dl = parseDays(p.days);
    const ticks = days.map(d => logHas(data.log, d, p.name));
    const done = ticks.filter(Boolean).length;
    let target;
    if (c.per === 'day') target = dl.length || 7;
    else if (c.per === 'week') target = c.times;
    else target = null;
    const month = c.per === 'month' ? progress(p, data.log, date, weekStart ?? 1) : null;
    return { p, days, ticks, done, target, month, cadence: c };
  }).sort((a, b) => ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99)) || a.p.name.localeCompare(b.p.name));
}

function monthSummary(data, date, weekStart) {
  const days = D.monthDays(date);
  const rank = areaRank(data.areas || []);
  const weeks = Math.round(days.length / 7);
  return (data.practices || []).map(p => {
    const c = parseCadence(p.cadence) || { per: 'day', times: 1 };
    const dl = parseDays(p.days);
    const done = countIn(data.log, days, p.name);
    let target;
    if (c.per === 'day') target = dl.length ? days.filter(d => dl.includes(D.dayKey(d))).length : days.length;
    else if (c.per === 'week') target = c.times * weeks;
    else target = c.times;
    return { p, done, target, cadence: c, ticks: days.map(d => logHas(data.log, d, p.name)) };
  }).sort((a, b) => ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99)) || a.p.name.localeCompare(b.p.name));
}

/* Week in review: what got done against what was asked, what slipped. */
function weekReview(data, date, weekStart) {
  const rows = weekSummary(data, date, weekStart).filter(r => r.target !== null);
  const asked = rows.reduce((n, r) => n + r.target, 0);
  const done = rows.reduce((n, r) => n + Math.min(r.done, r.target), 0);
  const met = rows.filter(r => r.done >= r.target);
  const slipped = rows.filter(r => r.done < r.target).sort((a, b) => (a.done / a.target) - (b.done / b.target));
  const ratio = asked ? done / asked : 0;
  return { rows, asked, done, ratio, met, slipped };
}

/* ---- streaks -------------------------------------------------------- */

/* Days in a row (ending on `date`) with at least one tick. */
function streak(log, date) {
  let n = 0, d = date;
  while (log && log.get(d) && log.get(d).done && log.get(d).done.size) { n++; d = D.addDays(d, -1); }
  return n;
}

/* Good weeks in a row: a week counts when at least 60% of what was asked
   got done. The current week joins the run only once it qualifies; an
   unfinished week never breaks it. */
const GOOD_WEEK = 0.6;
function weekStreak(data, date, weekStart) {
  const ws = weekStart ?? 1;
  /* A practice only counts toward a week if it existed for the whole of
     that week — otherwise adding a new practice today rewrites the verdict
     on every past week it was never part of. */
  const forWeek = (d) => {
    const practices = (data.practices || []).filter(p => (practiceStart(p, data.log) || date) <= d);
    return weekReview({ ...data, practices }, d, ws);
  };
  let n = 0;
  let d = D.weekStart(date, ws);
  const cur = forWeek(d);
  if (cur.asked && cur.ratio >= GOOD_WEEK) n++;
  d = D.addDays(d, -7);
  for (let i = 0; i < 104; i++) {
    const r = forWeek(d);
    if (!r.asked || r.ratio < GOOD_WEEK) break;
    n++;
    d = D.addDays(d, -7);
  }
  return n;
}

function streakLabel(data, date, opts) {
  const mode = (opts && opts.streakMode) || 'days';
  if (mode === 'off') return '';
  if (mode === 'weeks') {
    const n = weekStreak(data, date, opts && opts.weekStart);
    return n >= 1 ? `${n} good week${n === 1 ? '' : 's'} in a row` : '';
  }
  /* The run only breaks once a whole PAST day had no tick — before
     anything is ticked today, show the run through yesterday rather than
     letting an unticked "today" zero it out every morning. */
  const today = entry(data.log, date);
  const from = today.done && today.done.size ? date : D.addDays(date, -1);
  const n = streak(data.log, from);
  return n >= 2 ? `${n} days in a row` : '';
}

/* ---- the plan board ------------------------------------------------- */

/* `n` day columns from `from`: what is promised to each day, the events
   already fixed there, and how many daily practices sit underneath. */
function boardDays(data, from, n, opts) {
  const weekStart = (opts && opts.weekStart) ?? 1;
  const events = (opts && opts.events) || data.events || [];
  const dailies = (data.practices || []).filter(p => !isFlexible(p));
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = D.addDays(from, i);
    const planned = (data.practices || [])
      .filter(p => isPlanned(data.log, date, p.name))
      .map(p => ({ p, pr: progress(p, data.log, date, weekStart) }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
    const dayEvents = events.filter(e => e.date === date)
      .sort((a, b) => ((a.time || '') + a.name).localeCompare((b.time || '') + b.name));
    const dailyCount = dailies.filter(p => {
      const days = parseDays(p.days);
      return !days.length || days.includes(D.dayKey(date));
    }).length;
    out.push({ date, planned, events: dayEvents, dailyCount, load: planned.length + dayEvents.length });
  }
  return out;
}

/* The shelf: flexible practices with sessions still to place. `need` is
   what the period still wants minus what is already promised inside the
   window, so a 4/week run shows "×2" once two are on the board. */
function shelf(data, from, n, opts) {
  const weekStart = (opts && opts.weekStart) ?? 1;
  const rank = areaRank(data.areas || []);
  const out = [];
  for (const p of (data.practices || []).filter(isFlexible)) {
    const pr = progress(p, data.log, from, weekStart);
    /* A promise only counts as "placed" if it falls inside THIS period —
       a plan for next week must not quiet this week's need, even though
       the rolling board window `n` reaches into next week. */
    const c = parseCadence(p.cadence) || { per: 'day', times: 1 };
    const bound = Math.max(0, Math.min(n, D.diffDays(from, periodEnd(c, from, weekStart)) + 1));
    const placed = plannedCount(data.log, from, bound, p.name);
    const need = Math.max(0, pr.remaining - placed);
    if (need <= 0) continue;
    /* Pressure, not urgency: urgency goes to zero the moment something is
       ticked today, but a 4/week run ticked this morning still has three
       sessions looking for a home. What matters here is how much is left
       against how long is left to place it. */
    const pressure = need / Math.max(1, pr.daysLeft);
    out.push({ p, pr, need, placed, pressure, reason: reasonFor(p, pr, data.log, from) });
  }
  return out.sort((a, b) =>
    (b.pressure - a.pressure)
    || ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99))
    || a.p.name.localeCompare(b.p.name));
}

module.exports = {
  entry, logHas, isSkipped, isSnoozed, isPlanned, lastDone, sinceLabel, plannedAhead, plannedCount, isFlexible,
  boardDays, shelf,
  parseCadence, cadenceLabel, parseDays, progress, missedRun, reasonFor,
  planDay, groupByWhen, areaRank, WHEN_LABEL,
  sortGoals, nextGoal, goalsWithoutStep, upcoming, eventsInMonth, goalsForMonth,
  weekSummary, monthSummary, weekReview, streak, weekStreak, streakLabel,
};
