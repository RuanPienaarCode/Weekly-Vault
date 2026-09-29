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

console.log('review OK');
