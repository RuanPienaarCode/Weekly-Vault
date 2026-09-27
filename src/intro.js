'use strict';
/* The daily welcome: a greeting, then "Plan the week" (on the days you sit
   down to plan) or "Plan today", with a line saying what is waiting — then
   it fades into the board. Pure: the view decides timing and animation. */

const D = require('./dates');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function greeting(hour, name) {
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const who = String(name || '').trim();
  return `Good ${part}${who ? ', ' + who : ''}`;
}

/* The planning days are the last day of the week and the first: Sunday and
   Monday for a Monday week. */
function isPlanningDay(iso, weekStart) {
  const wd = D.weekday(iso);
  return wd === weekStart || wd === (weekStart + 6) % 7;
}

function weekSummary(board) {
  const reminders = board.days.filter(d => !d.past)
    .reduce((n, d) => n + d.cards.filter(c => c.source === 'nudge').length, 0);
  const toPlace = board.tray.reduce((n, t) => n + (t.need > 0 ? 1 : 0), 0);
  return [
    board.slipped.length ? `${board.slipped.length} slipped` : '',
    toPlace ? plural(toPlace, 'practice to place', 'practices to place') : '',
    reminders ? plural(reminders, 'reminder this week', 'reminders this week') : '',
  ].filter(Boolean);
}

function todaySummary(board) {
  const today = board.days.find(d => d.date === board.today);
  const n = today ? today.cards.length : 0;
  return [
    n ? plural(n, 'thing today', 'things today') : '',
    board.slipped.length ? `${board.slipped.length} slipped` : '',
  ].filter(Boolean);
}

/* now: { date: 'YYYY-MM-DD', hour: 0-23 }. The planning days come from the
   board's own week (Rhythm's week start when Rhythm is there), so the
   welcome and the board always agree on which week is being planned. */
function introScreens(board, now, settings = {}) {
  const week = isPlanningDay(now.date, D.weekday(board.weekStart));
  const bits = week ? weekSummary(board) : todaySummary(board);
  return {
    welcome: {
      title: greeting(now.hour, settings.name),
      sub: `${DAY_NAMES[D.weekday(now.date)]} ${+now.date.slice(8, 10)} ${MONTHS[+now.date.slice(5, 7) - 1]}`,
    },
    plan: {
      title: week ? 'Plan the week' : 'Plan today',
      summary: bits.length ? bits.join(' · ') : 'Nothing waiting — a clean slate.',
    },
  };
}

/* Once a day, on the first open, unless switched off. */
function shouldShowIntro(settings, today) {
  return settings.showWelcome !== false && settings.lastWelcome !== today;
}

module.exports = { introScreens, shouldShowIntro };
