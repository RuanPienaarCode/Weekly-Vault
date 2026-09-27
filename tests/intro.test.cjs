'use strict';
/* intro: the daily welcome and the "Plan the week / Plan today" screen that
   fades into the board. Pure; expected values are hand-written literals. */
const assert = require('node:assert');
const { introScreens, shouldShowIntro } = require('../src/intro');

const at = (iso, hh) => ({ date: iso, hour: hh });
const board = (o = {}) => Object.assign({
  today: '2026-09-27', weekStart: '2026-09-28', slipped: [], tray: [],
  days: [],
}, o);
const card = (source, extra = {}) => Object.assign({ source }, extra);

/* 1. greeting by time of day, with the name only when one is set */
assert.strictEqual(introScreens(board(), at('2026-09-27', 8), {}).welcome.title, 'Good morning');
assert.strictEqual(introScreens(board(), at('2026-09-27', 13), { name: 'Ruan' }).welcome.title, 'Good afternoon, Ruan');
assert.strictEqual(introScreens(board(), at('2026-09-27', 19), { name: '  ' }).welcome.title, 'Good evening');
assert.strictEqual(introScreens(board(), at('2026-09-27', 8), {}).welcome.sub, 'Sunday 27 September');

/* 2. Sunday and Monday plan the week; other days plan today */
assert.strictEqual(introScreens(board(), at('2026-09-27', 8), {}).plan.title, 'Plan the week');
assert.strictEqual(introScreens(board({ today: '2026-09-28' }), at('2026-09-28', 8), {}).plan.title, 'Plan the week');
assert.strictEqual(introScreens(board({ today: '2026-09-30' }), at('2026-09-30', 8), {}).plan.title, 'Plan today');
/* the planning days follow the BOARD's week (Rhythm's, when Rhythm is
   there): a Sunday-start board plans on Saturday and Sunday, not Monday */
{
  const sunWeek = today => board({ today, weekStart: '2026-10-04' });
  assert.strictEqual(introScreens(sunWeek('2026-10-03'), at('2026-10-03', 8), { weekStart: 1 }).plan.title, 'Plan the week');
  assert.strictEqual(introScreens(sunWeek('2026-10-04'), at('2026-10-04', 8), { weekStart: 1 }).plan.title, 'Plan the week');
  assert.strictEqual(introScreens(sunWeek('2026-10-05'), at('2026-10-05', 8), { weekStart: 1 }).plan.title, 'Plan today');
}

/* 3. the week summary: what is waiting, singular and plural */
{
  const b = board({
    slipped: [card('tasks'), card('tasks')],
    tray: [{ name: 'Gym', need: 2 }, { name: 'Paint', need: 1 }],
    days: [
      { date: '2026-09-27', past: false, cards: [card('nudge')] },
      { date: '2026-09-28', past: false, cards: [card('nudge'), card('tasks'), card('event')] },
    ],
  });
  assert.strictEqual(introScreens(b, at('2026-09-27', 8), {}).plan.summary, '2 slipped · 2 practices to place · 2 reminders this week');
  /* the same, as separate figures for the big-number layout */
  assert.deepStrictEqual(introScreens(b, at('2026-09-27', 8), {}).plan.stats, [
    { n: 2, label: 'slipped', slip: true }, { n: 2, label: 'practices to place', slip: false }, { n: 2, label: 'reminders this week', slip: false },
  ]);
  const one = board({ slipped: [card('tasks')], tray: [{ name: 'Gym', need: 1 }], days: [{ date: '2026-09-28', past: false, cards: [card('nudge')] }] });
  assert.strictEqual(introScreens(one, at('2026-09-27', 8), {}).plan.summary, '1 slipped · 1 practice to place · 1 reminder this week');
}

/* 4. the today summary counts only today */
{
  const b = board({
    today: '2026-09-30',
    slipped: [card('tasks')],
    days: [
      { date: '2026-09-30', past: false, cards: [card('tasks'), card('nudge'), card('event'), card('practice')] },
      { date: '2026-10-01', past: false, cards: [card('tasks')] },
    ],
  });
  assert.strictEqual(introScreens(b, at('2026-09-30', 8), {}).plan.summary, '4 things today · 1 slipped');
  assert.deepStrictEqual(introScreens(b, at('2026-09-30', 8), {}).plan.stats, [
    { n: 4, label: 'things today', slip: false }, { n: 1, label: 'slipped', slip: true },
  ]);
}

/* 5. nothing waiting */
assert.strictEqual(introScreens(board({ today: '2026-09-30' }), at('2026-09-30', 8), {}).plan.summary, 'Nothing waiting — a clean slate.');
assert.deepStrictEqual(introScreens(board({ today: '2026-09-30' }), at('2026-09-30', 8), {}).plan.stats, []);
/* the welcome's big numeral is today's day of the month */
assert.strictEqual(introScreens(board(), at('2026-09-27', 8), {}).welcome.day, '27');

/* 6. once a day, and never when switched off */
assert.strictEqual(shouldShowIntro({ showWelcome: true, lastWelcome: '' }, '2026-09-27'), true);
assert.strictEqual(shouldShowIntro({ showWelcome: true, lastWelcome: '2026-09-27' }, '2026-09-27'), false);
assert.strictEqual(shouldShowIntro({ showWelcome: true, lastWelcome: '2026-09-26' }, '2026-09-27'), true);
assert.strictEqual(shouldShowIntro({ showWelcome: false, lastWelcome: '' }, '2026-09-27'), false);
assert.strictEqual(shouldShowIntro({}, '2026-09-27'), true);

console.log('intro OK');
