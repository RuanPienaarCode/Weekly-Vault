'use strict';
/* review: the evening review — which cards it asks about, and the exact
   text it appends to the day's log. Hand-written literal expectations. */
const assert = require('node:assert');
const { reviewCards, reviewText } = require('../src/review');

const card = (source, text, extra = {}) => Object.assign({ source, text, done: false }, extra);

/* 1. it asks about today's open to-dos and reminders — Slipped included —
      never events, practices (Rhythm tracks those) or done cards */
{
  const board = {
    today: '2026-09-30',
    slipped: [card('tasks', 'Old thing')],
    days: [
      { date: '2026-09-30', cards: [card('event', 'Dentist'), card('tasks', 'Call plumber'), card('nudge', 'Pay rates'), card('practice', 'Gym')], done: [card('tasks', 'Bought bulbs', { done: true })] },
      { date: '2026-10-01', cards: [card('tasks', 'Tomorrow thing')], done: [] },
    ],
  };
  assert.deepStrictEqual(reviewCards(board).map(c => c.text), ['Old thing', 'Call plumber', 'Pay rates']);
}

/* 2. the text: one line per kind of outcome, empty kinds left out */
assert.strictEqual(reviewText({
  heading: '## Review',
  done: ['Call plumber', 'Buy bulbs'],
  moved: [['Fix the gate', 'Tue 29 Sep'], ['Email the landlord', 'Later']],
  dropped: ['Book the vet'],
  left: 1,
  reflection: '  a good,   steady day ',
}), [
  '## Review',
  '- Done: 2 — Call plumber, Buy bulbs',
  '- Moved: 2 — Fix the gate → Tue 29 Sep; Email the landlord → Later',
  '- Dropped: 1 — Book the vet',
  '- Left open: 1',
  '- Reflection: a good, steady day',
  '',
].join('\n'));

/* 3. a quiet day still says so */
assert.strictEqual(reviewText({ heading: '## Review', done: [], moved: [], dropped: [], left: 0, reflection: '' }), '## Review\n- Nothing left open.\n');

/* 4. a reflection can't break the note: newlines fold, a leading "#" or
      "-" can't become a heading or a new list item */
assert.strictEqual(
  reviewText({ heading: '## Review', done: [], moved: [], dropped: [], left: 0, reflection: 'line one\n# not a heading' }),
  '## Review\n- Nothing left open.\n- Reflection: line one # not a heading\n');

/* 5. B7: "%%" opens an Obsidian comment that runs to the next "%%" — one
      unpaired in a to-do's text (or the reflection) would hide the rest of
      the log. It is broken apart wherever it appears, text and reflection */
assert.strictEqual(
  reviewText({ heading: '## Review', done: ['Fix 100%% of it', 'a %%% b'], moved: [['Tidy %% desk', 'Later']], dropped: ['x%%'], left: 0, reflection: 'felt 50%% done' }),
  [
    '## Review',
    '- Done: 2 — Fix 100% % of it, a % % % b',
    '- Moved: 1 — Tidy % % desk → Later',
    '- Dropped: 1 — x% %',
    '- Reflection: felt 50% % done',
    '',
  ].join('\n'));
/* a single % is just a percent sign */
assert.strictEqual(reviewText({ heading: '## Review', done: ['Pay 5% fee'], moved: [], dropped: [], left: 0, reflection: '' }), '## Review\n- Done: 1 — Pay 5% fee\n');

/* 6. B7: a to-do with nothing to name it never prints an empty "Done: 1 — " */
assert.strictEqual(
  reviewText({ heading: '## Review', done: ['', '   '], moved: [['', 'Later']], dropped: [''], left: 0, reflection: '' }),
  '## Review\n- Done: 2 — (untitled), (untitled)\n- Moved: 1 — (untitled) → Later\n- Dropped: 1 — (untitled)\n');

/* 7. on the jump day (Sunday, the board already showing the week ahead) the
      review is still about TODAY: Slipped first, then what is on today's
      column — never Monday's cards, never next week's */
{
  const { planBoard } = require('../src/plan');
  const t = (raw, line) => ({ path: 'A.md', line, raw });
  const board = planBoard({ today: '2026-10-04', settings: {}, tasks: [
    t('- [ ] Missed Saturday ⏳ 2026-10-03', 1),
    t('- [ ] Sunday thing ⏳ 2026-10-04', 2),
    t('- [ ] Monday thing ⏳ 2026-10-05', 3),
    t('- [ ] Next week thing ⏳ 2026-10-13', 4),
    t('- [x] Sunday done ⏳ 2026-10-04 ✅ 2026-10-04', 5),
    t('- [ ] Licence disc 📅 2026-07-31 🛫 2026-10-05', 6),
    { source: 'nudge', path: 'Reminders.md', line: 1, text: 'Sunday call', due: '2026-10-04', scheduled: '', time: '18:00', done: false, priority: 'normal', raw: '' },
  ] });
  assert.strictEqual(board.weekStart, '2026-10-05');
  assert.deepStrictEqual(reviewCards(board).map(c => c.text), ['Licence disc', 'Missed Saturday', 'Sunday call', 'Sunday thing']);
}

console.log('review OK');
