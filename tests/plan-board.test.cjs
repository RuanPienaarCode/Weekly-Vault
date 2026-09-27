'use strict';
/* planBoard: the pure board model. Fixtures are in-memory tasks; every
   expected value is a hand-written literal. */
const assert = require('node:assert');
const { planBoard } = require('../src/plan');

const dates = b => b.days.map(d => d.date);
const task = (raw, path = 'Notes/Home.md', line = 0) => ({ path, line, raw });
const day = (b, date) => b.days.find(d => d.date === date);
const texts = (b, date) => day(b, date).cards.map(c => c.text);
const WED = '2026-09-30';

/* 1. mid-week: Wed 30 Sep 2026 shows Mon 28 Sep – Sun 4 Oct */
{
  const b = planBoard({ today: '2026-09-30', tasks: [], settings: {} });
  assert.strictEqual(b.weekStart, '2026-09-28');
  assert.deepStrictEqual(dates(b), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepStrictEqual(b.days.map(d => d.past), [true, true, false, false, false, false, false]);
  assert.deepStrictEqual(b.days.map(d => d.isToday), [false, false, true, false, false, false, false]);
}

/* 2. on Sunday the board jumps to the week ahead, with today kept in
      front of it so nothing dated today disappears */
{
  const b = planBoard({ today: '2026-10-04', tasks: [task('- [ ] Sunday thing ⏳ 2026-10-04')], settings: {} });
  assert.strictEqual(b.weekStart, '2026-10-05');
  assert.deepStrictEqual(dates(b), ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepStrictEqual(b.days.map(d => d.past), [false, false, false, false, false, false, false, false]);
  assert.deepStrictEqual(b.days.map(d => d.isToday), [true, false, false, false, false, false, false, false]);
  assert.deepStrictEqual(texts(b, '2026-10-04'), ['Sunday thing']);
  /* Saturday is still the current week, with no extra column */
  const sat = planBoard({ today: '2026-10-03', tasks: [], settings: {} });
  assert.strictEqual(sat.weekStart, '2026-09-28');
  assert.strictEqual(sat.days.length, 7);
}

/* 3. a ⏳ line lands on its day */
{
  const b = planBoard({ today: WED, tasks: [task('- [ ] Call plumber ⏳ 2026-10-01', 'Notes/Home.md', 4)], settings: {} });
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Call plumber']);
  const c = day(b, '2026-10-01').cards[0];
  assert.strictEqual(c.key, 'Notes/Home.md:4');
  assert.strictEqual(c.path, 'Notes/Home.md');
  assert.strictEqual(c.line, 4);
  assert.strictEqual(c.scheduled, '2026-10-01');
  assert.strictEqual(c.deadlineOnly, false);
  assert.deepStrictEqual(b.days.filter(d => d.date !== '2026-10-01').map(d => d.cards.length), [0, 0, 0, 0, 0, 0]);
}

/* 4. 📅 only → its due day as a deadline; ⏳ and 📅 → the ⏳ day, due kept */
{
  const b = planBoard({ today: WED, settings: {}, tasks: [
    task('- [ ] File tax return 📅 2026-10-02', 'Admin.md', 1),
    task('- [ ] Draft report ⏳ 2026-09-30 📅 2026-10-03', 'Work.md', 2),
  ] });
  assert.deepStrictEqual(texts(b, '2026-10-02'), ['File tax return']);
  assert.strictEqual(day(b, '2026-10-02').cards[0].deadlineOnly, true);
  assert.strictEqual(day(b, '2026-10-02').cards[0].due, '2026-10-02');
  assert.deepStrictEqual(texts(b, '2026-09-30'), ['Draft report']);
  assert.strictEqual(day(b, '2026-09-30').cards[0].due, '2026-10-03');
  assert.strictEqual(day(b, '2026-09-30').cards[0].deadlineOnly, false);
  assert.deepStrictEqual(texts(b, '2026-10-03'), []);
}

/* 5. undated, out-of-week, done and cancelled lines stay off the board */
{
  const b = planBoard({ today: WED, settings: {}, tasks: [
    task('- [ ] Sort the garage'),
    task('- [ ] Next month thing ⏳ 2026-10-20'),
    task('- [ ] Last week thing ⏳ 2026-09-21'),
    task('- [x] Already done ⏳ 2026-10-01 ✅ 2026-09-29'),
    task('- [-] Dropped ⏳ 2026-10-01'),
    task('- [/] Half done ⏳ 2026-10-01'),
    task('Not a task ⏳ 2026-10-01'),
  ] });
  assert.deepStrictEqual(b.days.map(d => d.cards.map(c => c.text)), [[], [], [], ['Half done'], [], [], []]);
}

/* 6. excluded folders match whole folder names, not substrings */
{
  const b = planBoard({ today: WED, settings: { excludeFolders: ['Templates', 'Archive/Old/'] }, tasks: [
    task('- [ ] Template placeholder ⏳ 2026-10-01', 'Templates/Daily.md'),
    task('- [ ] Deep template ⏳ 2026-10-01', 'Templates/Sub/Weekly.md'),
    task('- [ ] My templates note ⏳ 2026-10-01', 'MyTemplates/Plan.md'),
    task('- [ ] Old archive ⏳ 2026-10-01', 'Archive/Old/2025.md'),
    task('- [ ] Kept archive ⏳ 2026-10-01', 'Archive/Keep.md'),
  ] });
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Kept archive', 'My templates note']);
}

/* 7. within a day: higher priority first, then note path, then line */
{
  const b = planBoard({ today: WED, settings: {}, tasks: [
    task('- [ ] Low thing ⏳ 2026-10-01 🔽', 'A.md', 1),
    task('- [ ] Plain B2 ⏳ 2026-10-01', 'B.md', 2),
    task('- [ ] Urgent ⏳ 2026-10-01 ⏫', 'Z.md', 9),
    task('- [ ] Plain A5 ⏳ 2026-10-01', 'A.md', 5),
    task('- [ ] Plain B1 ⏳ 2026-10-01', 'B.md', 1),
    task('- [ ] Top ⏳ 2026-10-01 🔺', 'Y.md', 3),
  ] });
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Top', 'Urgent', 'Plain A5', 'Plain B1', 'Plain B2', 'Low thing']);
}

/* 9. a Nudge reminder lands on its due day, carrying its time and source;
      timed cards come first, by time */
{
  const nudge = (text, due, time, extra = {}) => Object.assign(
    { source: 'nudge', path: 'Reminders.md', line: 3, text, due, time, priority: 'normal', done: false, raw: '' }, extra);
  const b = planBoard({ today: WED, settings: {}, tasks: [
    task('- [ ] Plain thing ⏳ 2026-10-01 ⏫', 'A.md', 1),
    nudge('Phone the dentist', '2026-10-01', '09:30', { line: 4 }),
    nudge('Collect parcel', '2026-10-01', '', { line: 5 }),
    nudge('Early call', '2026-10-01', '07:45', { line: 6 }),
    nudge('Already done', '2026-10-01', '', { done: true, line: 7 }),
    nudge('Next month', '2026-10-30', ''),
  ] });
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Early call', 'Phone the dentist', 'Plain thing', 'Collect parcel']);
  const c = day(b, '2026-10-01').cards[1];
  assert.strictEqual(c.source, 'nudge');
  assert.strictEqual(c.time, '09:30');
  assert.strictEqual(c.key, 'Reminders.md:4');
  assert.strictEqual(c.deadlineOnly, false);
  assert.strictEqual(day(b, '2026-10-01').cards[2].source, 'tasks');
  /* a reminder with only ⏳ sits on that day */
  const p = planBoard({ today: WED, settings: {}, tasks: [nudge('Planned only', '', '', { scheduled: '2026-10-02' })] });
  assert.deepStrictEqual(texts(p, '2026-10-02'), ['Planned only']);
}

/* 10. anything open whose day has passed is Slipped: off its old day, in
       b.slipped (oldest first), with that day kept as `date` — never moved */
{
  const b = planBoard({ today: WED, settings: {}, tasks: [
    task('- [ ] Planned Monday ⏳ 2026-09-28', 'A.md', 1),
    task('- [ ] Way back ⏳ 2026-08-12', 'A.md', 2),
    task('- [ ] Deadline gone 📅 2026-09-29', 'A.md', 3),
    task('- [ ] Planned past, due later ⏳ 2026-09-29 📅 2026-10-02', 'A.md', 4),
    task('- [ ] Today still today ⏳ 2026-09-30', 'A.md', 5),
    task('- [x] Done in the past ⏳ 2026-09-28 ✅ 2026-09-28', 'A.md', 6),
    task('- [-] Dropped in the past ⏳ 2026-09-28', 'A.md', 7),
    { source: 'nudge', path: 'Reminders.md', line: 2, text: 'Missed reminder', due: '2026-09-15', scheduled: '', time: '', done: false, priority: 'normal', raw: '' },
  ] });
  assert.deepStrictEqual(b.slipped.map(c => [c.text, c.date]), [
    ['Way back', '2026-08-12'],
    ['Missed reminder', '2026-09-15'],
    ['Planned Monday', '2026-09-28'],
    ['Deadline gone', '2026-09-29'],
    ['Planned past, due later', '2026-09-29'],
  ]);
  assert.strictEqual(b.slipped[3].deadlineOnly, true);
  assert.strictEqual(b.slipped[4].due, '2026-10-02');
  assert.deepStrictEqual(texts(b, '2026-09-28'), []);
  assert.deepStrictEqual(texts(b, '2026-09-29'), []);
  assert.deepStrictEqual(texts(b, WED), ['Today still today']);
}

/* 10b. on Sunday, Slipped is what's before today — not the week ahead */
{
  const b = planBoard({ today: '2026-10-04', settings: {}, tasks: [
    task('- [ ] Missed Saturday ⏳ 2026-10-03'),
    task('- [ ] Sunday thing ⏳ 2026-10-04'),
  ] });
  assert.deepStrictEqual(b.slipped.map(c => c.text), ['Missed Saturday']);
  assert.deepStrictEqual(texts(b, '2026-10-04'), ['Sunday thing']);
}

/* 10c. nothing slipped is an empty list, not missing */
assert.deepStrictEqual(planBoard({ today: WED, tasks: [], settings: {} }).slipped, []);

/* 10d. excluded folders apply to Slipped; same-day ties go by time, then
       priority, then note and line */
{
  const nudge = (text, due, time) => ({ source: 'nudge', path: 'Reminders.md', line: 9, text, due, scheduled: '', time, done: false, priority: 'normal', raw: '' });
  const b = planBoard({ today: WED, settings: { excludeFolders: ['Archive'] }, tasks: [
    task('- [ ] Archived and late ⏳ 2026-09-20', 'Archive/Old.md', 1),
    task('- [ ] Plain late ⏳ 2026-09-20', 'B.md', 2),
    task('- [ ] Urgent late ⏳ 2026-09-20 ⏫', 'C.md', 3),
    nudge('Timed late', '2026-09-20', '09:00'),
    nudge('Newer timed', '2026-09-28', '07:00'),
  ] });
  assert.deepStrictEqual(b.slipped.map(c => c.text), ['Timed late', 'Urgent late', 'Plain late', 'Newer timed']);
}

console.log('plan-board OK');
