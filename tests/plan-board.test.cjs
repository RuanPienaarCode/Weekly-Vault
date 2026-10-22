'use strict';
/* planBoard: the pure board model. Fixtures are in-memory tasks; every
   expected value is a hand-written literal. */
const assert = require('node:assert');
const { planBoard, actionsFor } = require('../src/plan');

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
  assert.strictEqual(c.raw, '- [ ] Call plumber ⏳ 2026-10-01');
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

/* ---- Rhythm: records exactly as Rhythm's own load() shapes them ---- */
const E = (o = {}) => ({ done: new Set(o.done || []), skip: new Set(), snooze: new Set(), plan: new Set(o.plan || []), note: '' });
const rhythmFixture = () => ({
  weekStart: 1,
  areas: [{ name: 'Body', order: 1 }, { name: 'Craft', order: 2 }],
  practices: [
    { name: 'Gym', area: 'Body', cadence: '3/week', path: 'Rhythm/Practices/Gym.md' },
    { name: 'Paint', area: 'Craft', cadence: 'weekly', path: 'Rhythm/Practices/Paint.md' },
    { name: 'Read', area: 'Craft', cadence: 'daily', path: 'Rhythm/Practices/Read.md' },
    { name: 'Journal', area: 'Craft', cadence: 'daily', path: 'Rhythm/Practices/Journal.md' },
    { name: 'Sabbath walk', area: 'Body', cadence: 'daily', days: ['sat'], path: 'Rhythm/Practices/Sabbath walk.md' },
  ],
  events: [
    { name: 'Dentist', area: 'Body', date: '2026-10-01', time: '14:00', path: 'Rhythm/Events/Dentist.md' },
    { name: 'Birthday', area: '', date: '2026-10-03', time: '', path: 'Rhythm/Events/Birthday.md' },
    { name: 'Old event', area: '', date: '2026-09-29', time: '', path: 'Rhythm/Events/Old event.md' },
  ],
  log: new Map([['2026-09-28', E({ done: ['Gym'] })], ['2026-10-02', E({ plan: ['Gym'] })]]),
});

/* 11. Rhythm events sit on their day, locked, before everything else */
{
  const b = planBoard({ today: WED, settings: {}, rhythm: rhythmFixture(), tasks: [
    task('- [ ] Early to-do ⏳ 2026-10-01 ⏫', 'A.md', 1),
    { source: 'nudge', path: 'Reminders.md', line: 1, text: 'Morning reminder', due: '2026-10-01', scheduled: '', time: '08:00', done: false, priority: 'normal', raw: '' },
  ] });
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Dentist', 'Morning reminder', 'Early to-do']);
  const ev = day(b, '2026-10-01').cards[0];
  assert.strictEqual(ev.source, 'event');
  assert.strictEqual(ev.locked, true);
  assert.strictEqual(ev.time, '14:00');
  assert.strictEqual(ev.path, 'Rhythm/Events/Dentist.md');
  assert.strictEqual(ev.area, 'Body');
  assert.deepStrictEqual(texts(b, '2026-10-03'), ['Birthday']);
  /* an event whose day has passed is simply past — it never "slips" */
  assert.deepStrictEqual(b.slipped.map(c => c.text), []);
}

/* 12. practices promised to a day (Rhythm's log `plan`) show on that day */
{
  const b = planBoard({ today: WED, settings: {}, rhythm: rhythmFixture(), tasks: [] });
  const fri = day(b, '2026-10-02').cards;
  assert.deepStrictEqual(fri.map(c => [c.source, c.text]), [['practice', 'Gym']]);
  assert.strictEqual(fri[0].path, 'Rhythm/Practices/Gym.md');
}

/* 13. the Practices owed tray: weekly-cadence practices with sessions not
       yet placed on a day, per Rhythm's own shelf(); plus a daily count */
{
  const b = planBoard({ today: WED, settings: {}, rhythm: rhythmFixture(), tasks: [] });
  /* Gym: 3/week, 1 done Mon, 1 promised to Fri → 1 still to place.
     Paint: weekly, none done or placed → 1. Equal pressure; Body ranks first. */
  assert.deepStrictEqual(b.tray.map(t => [t.name, t.need, t.target]), [['Gym', 1, 3], ['Paint', 1, 1]]);
  assert.deepStrictEqual(b.days.map(d => d.dailyCount), [2, 2, 2, 2, 2, 3, 2]);
}

/* 13b. on Sunday the tray is for the week ahead: nothing done there yet */
{
  const b = planBoard({ today: '2026-10-04', settings: {}, rhythm: rhythmFixture(), tasks: [] });
  assert.deepStrictEqual(b.tray.map(t => [t.name, t.need]), [['Gym', 3], ['Paint', 1]]);
}

/* 13c. no Rhythm: no tray, no events, no daily counts */
{
  const b = planBoard({ today: WED, settings: {}, tasks: [] });
  assert.deepStrictEqual(b.tray, []);
  assert.deepStrictEqual(b.days.map(d => d.dailyCount), [0, 0, 0, 0, 0, 0, 0]);
}

/* 13d. with Rhythm, the board's week is Rhythm's week: a Sunday-start
       Rhythm makes Sunday day one, so a practice planned for today counts
       as placed and the tray doesn't ask for it again */
{
  const data = rhythmFixture();
  data.weekStart = 0;
  data.practices = [{ name: 'Paint', area: 'Craft', cadence: 'weekly', path: 'Rhythm/Practices/Paint.md' }];
  data.log = new Map([['2026-10-04', E({ plan: ['Paint'] })]]);
  const b = planBoard({ today: '2026-10-04', settings: {}, rhythm: data, tasks: [] });
  assert.strictEqual(b.weekStart, '2026-10-04');
  assert.deepStrictEqual(b.days[0].cards.map(c => c.text), ['Paint']);
  assert.deepStrictEqual(b.tray, []);
}

/* 13e. events in Rhythm's order: time then name, so all-day comes first */
{
  const data = rhythmFixture();
  data.events = [
    { name: 'Dentist', date: '2026-10-01', time: '14:00', path: 'e/Dentist.md' },
    { name: '10k race', date: '2026-10-01', time: '', path: 'e/10k.md' },
  ];
  assert.deepStrictEqual(texts(planBoard({ today: WED, settings: {}, rhythm: data, tasks: [] }), '2026-10-01'), ['10k race', 'Dentist']);
}

/* 13f. monthly practices reach the tray too, as on Rhythm's own Plan board */
{
  const data = rhythmFixture();
  data.practices = [{ name: 'Range day', area: 'Body', cadence: 'monthly', path: 'p/Range.md' }];
  assert.deepStrictEqual(planBoard({ today: WED, settings: {}, rhythm: data, tasks: [] }).tray.map(t => [t.name, t.need]), [['Range day', 1]]);
}

/* 14. done cards stay on their day, in a separate `done` list: a Tasks line
       by its ⏳ (else 📅, else ✅ day), a Nudge reminder by its due day, a
       flexible practice ticked in Rhythm's log on that day */
{
  const data = rhythmFixture();
  data.log = new Map([['2026-10-01', E({ done: ['Gym', 'Read'] })]]);
  const b = planBoard({ today: WED, settings: {}, rhythm: data, tasks: [
    task('- [x] Called plumber ⏳ 2026-10-01 ✅ 2026-10-01', 'A.md', 1),
    task('- [x] Filed early 📅 2026-10-02 ✅ 2026-09-30', 'A.md', 2),
    task('- [x] Just done ✅ 2026-09-30', 'A.md', 3),
    task('- [-] Dropped ⏳ 2026-10-01', 'A.md', 4),
    task('- [x] Done last week ⏳ 2026-09-21 ✅ 2026-09-21', 'A.md', 5),
    task('- [x] Slipped, then done today ⏳ 2026-09-21 ✅ 2026-09-30', 'A.md', 6),
    { source: 'nudge', path: 'Reminders.md', line: 1, text: 'Paid rates', due: '2026-10-01', scheduled: '', time: '', done: true, priority: 'normal', raw: '- [x] Paid rates 📅 2026-10-01' },
  ] });
  assert.deepStrictEqual(day(b, '2026-10-01').done.map(c => [c.source, c.text]), [['tasks', 'Called plumber'], ['nudge', 'Paid rates'], ['practice', 'Gym']]);
  assert.deepStrictEqual(day(b, '2026-10-02').done.map(c => c.text), ['Filed early']);
  /* a slipped card ticked today shows in today's Done, not on its old day */
  assert.deepStrictEqual(day(b, WED).done.map(c => c.text), ['Just done', 'Slipped, then done today']);
  /* only the fixed Dentist event is still open that day */
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Dentist']);
  assert.strictEqual(day(b, '2026-10-01').done[0].done, true);
  /* done is never slipped */
  assert.deepStrictEqual(b.slipped, []);
}

/* 15. Next week: its seven days hold what is dated in it (⏳, 📅-only,
       Nudge due, Rhythm events and planned practices); "any day" holds
       lines parked with 🛫 on a Monday of a later week and no ⏳ */
{
  const data = rhythmFixture();
  data.events = [{ name: 'Flight', date: '2026-10-06', time: '07:10', path: 'e/Flight.md' }];
  data.log = new Map([['2026-10-08', E({ plan: ['Paint'] })]]);
  const b = planBoard({ today: WED, settings: {}, rhythm: data, tasks: [
    task('- [ ] Next Tue thing ⏳ 2026-10-06', 'A.md', 1),
    task('- [ ] Tax due 📅 2026-10-09', 'A.md', 2),
    task('- [ ] Some day next week 🛫 2026-10-05', 'A.md', 3),
    task('- [ ] Parked further out 🛫 2026-10-19', 'A.md', 4),
    task('- [ ] Too far ⏳ 2026-10-20', 'A.md', 5),
    task('- [x] Done next week ⏳ 2026-10-06 ✅ 2026-09-30', 'A.md', 6),
    { source: 'nudge', path: 'Reminders.md', line: 1, text: 'Renew licence', due: '2026-10-07', scheduled: '', time: '', done: false, priority: 'normal', raw: '' },
  ] });
  assert.strictEqual(b.nextWeek.start, '2026-10-05');
  assert.deepStrictEqual(b.nextWeek.days.map(d => d.date), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepStrictEqual(b.nextWeek.days.map(d => d.cards.map(c => c.text)), [[], ['Flight', 'Next Tue thing'], ['Renew licence'], ['Paint'], ['Tax due'], [], []]);
  assert.deepStrictEqual(b.nextWeek.anyDay.map(c => c.text), ['Some day next week', 'Parked further out']);
  assert.strictEqual(b.nextWeek.count, 7);
  assert.strictEqual(b.nextWeek.anyDay[0].slot, 'nextWeek');
}

/* 15b. on Sunday, next week is the week after the one the board jumped to */
assert.strictEqual(planBoard({ today: '2026-10-04', tasks: [], settings: {} }).nextWeek.start, '2026-10-12');

/* 16. Later: open, undated lines from the planner note and the included
       folders (planner note first), plus 🛫 lines whose week has come
       without a day — never lost */
{
  const b = planBoard({ today: WED, settings: { plannerNote: 'Planning/Fortnight.md', laterFolders: ['Projects'] }, tasks: [
    task('- [ ] Project idea', 'Projects/Garden.md', 2),
    task('- [ ] Inbox thought', 'Planning/Fortnight.md', 5),
    task('- [ ] Random undated', 'Notes/Home.md', 1),
    task('- [ ] Parked for this week 🛫 2026-09-28', 'Notes/Home.md', 3),
    task('- [x] Done undated', 'Planning/Fortnight.md', 6),
    task('- [ ] Project deadline 📅 2026-10-01', 'Projects/Garden.md', 3),
  ] });
  assert.deepStrictEqual(b.later.map(c => c.text), ['Inbox thought', 'Parked for this week', 'Project idea']);
  assert.strictEqual(b.later[0].slot, 'later');
  /* the dated project line is on its day, not in Later */
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Project deadline']);
}

/* 16b. a line tagged #later (Q36: a card parked from a note Later doesn't
        otherwise read) shows in Later wherever it lives, marked as tagged */
{
  const b = planBoard({ today: WED, settings: { plannerNote: 'Planning/Fortnight.md', laterTag: '#later' }, tasks: [
    task('- [ ] Prepare slides #later', 'Work/Projects.md', 4),
    task('- [ ] Not tagged', 'Work/Projects.md', 5),
    task('- [ ] Tagged but dated #later ⏳ 2026-10-01', 'Work/Projects.md', 6),
  ] });
  assert.deepStrictEqual(b.later.map(c => [c.text, c.tagged]), [['Prepare slides', true]]);
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Tagged but dated']);
}

/* 16c. the planner path is read the same way the store writes it: a
        setting without ".md" still finds the note's undated to-dos */
{
  const b = planBoard({ today: WED, settings: { plannerNote: './Planning/Fortnight' }, tasks: [task('- [ ] Buy paint', 'Planning/Fortnight.md', 3)] });
  assert.deepStrictEqual(b.later.map(c => c.text), ['Buy paint']);
}

/* 17. an overdue deadline parked in Next week (🛫 next Monday) waits in
       "any day", not in Slipped — until its week comes */
{
  const parked = task('- [ ] Licence disc 📅 2026-07-31 🛫 2026-10-05', 'Cars.md', 2);
  const b = planBoard({ today: WED, settings: {}, tasks: [parked] });
  assert.deepStrictEqual(b.nextWeek.anyDay.map(c => c.text), ['Licence disc']);
  assert.deepStrictEqual(b.slipped, []);
  /* the week has come: it slips again, by its overdue 📅 */
  const later = planBoard({ today: '2026-10-06', settings: {}, tasks: [parked] });
  assert.deepStrictEqual(later.slipped.map(c => c.text), ['Licence disc']);
}

/* 18. what a card can do — ONE rule for the phone sheet and the desktop
       menu: done cards only open; events only open; reminders and
       practices need a day; a 📅 blocks Later, and Next week if due
       before next Monday; a 🔁 to-do can't be dropped (a cancelled line
       ends the whole repeat in Tasks) */
{
  const b = planBoard({ today: WED, tasks: [], settings: {} });
  const only = a => Object.keys(a).filter(k => a[k]).sort();
  const t = (raw, extra = {}) => Object.assign({ source: 'tasks', raw, date: '2026-10-01', due: '', done: false }, extra);
  assert.deepStrictEqual(only(actionsFor(t('- [ ] Paint'), b)), ['day', 'done', 'drop', 'later', 'nextWeek', 'open']);
  assert.deepStrictEqual(only(actionsFor(t('- [x] Painted ✅ 2026-09-30', { done: true }), b)), ['open']);
  assert.deepStrictEqual(only(actionsFor({ source: 'event', date: '2026-10-01' }, b)), ['open']);
  assert.deepStrictEqual(only(actionsFor({ source: 'nudge', raw: '', date: '2026-10-01' }, b)), ['day', 'done', 'open']);
  assert.deepStrictEqual(only(actionsFor({ source: 'practice', fromTray: true }, b)), ['day', 'open']);
  assert.deepStrictEqual(only(actionsFor(t('- [ ] Tax 📅 2026-10-02', { due: '2026-10-02' }), b)), ['day', 'done', 'drop', 'open']);
  assert.deepStrictEqual(only(actionsFor(t('- [ ] Rego 📅 2026-07-31', { due: '2026-07-31' }), b)), ['day', 'done', 'drop', 'nextWeek', 'open']);
  const bins = actionsFor(t('- [ ] Bins out 🔁 every week ⏳ 2026-10-01'), b);
  assert.strictEqual(bins.drop, false);
  assert.strictEqual(bins.dropWhy, 'repeats');
}

/* ---- audit 7 Oct 2026, lane B: the board model ---- */
const D = require('../src/dates');

/* 19. B1/B2: "parked" is exactly what Fortnight's Next week writes — an
       OVERDUE 📅 plus a 🛫 on a later week's Monday. A deadline still ahead
       is never hidden behind its 🛫: it sits on its due day. */
{
  const ahead = planBoard({ today: WED, settings: {}, tasks: [task('- [ ] Renew disc 📅 2026-10-02 🛫 2026-10-05', 'Cars.md', 2)] });
  assert.deepStrictEqual(texts(ahead, '2026-10-02'), ['Renew disc']);
  assert.strictEqual(day(ahead, '2026-10-02').cards[0].deadlineOnly, true);
  assert.deepStrictEqual(ahead.nextWeek.anyDay, []);
  assert.deepStrictEqual(ahead.later, []);
  /* the Tasks-repeat shape: park an overdue 🔁, tick it, and Tasks moves
     📅 and 🛫 forward together — 📅 25 Oct, 🛫 4 Nov */
  const rep = [task('- [ ] Water plants 🔁 every week 🛫 2026-11-04 📅 2026-10-25', 'Home.md', 1)];
  const onDay = planBoard({ today: '2026-10-21', settings: {}, tasks: rep });
  assert.deepStrictEqual(texts(onDay, '2026-10-25'), ['Water plants']);
  assert.deepStrictEqual(onDay.nextWeek.anyDay, []);
  /* 28 Oct: the 25th has passed and the 🛫 is in a later week → parked */
  const parked = planBoard({ today: '2026-10-28', settings: {}, tasks: rep });
  assert.deepStrictEqual(parked.nextWeek.anyDay.map(c => c.text), ['Water plants']);
  assert.deepStrictEqual(parked.slipped, []);
  /* 3 Nov: its 🛫 week has come → it slips by its overdue 📅, never Later */
  const back = planBoard({ today: '2026-11-03', settings: {}, tasks: rep });
  assert.deepStrictEqual(back.slipped.map(c => [c.text, c.date]), [['Water plants', '2026-10-25']]);
  assert.deepStrictEqual(back.later, []);
  assert.deepStrictEqual(back.nextWeek.anyDay, []);
  /* B2: Sunday — the board has jumped to the week ahead, so Monday's 🛫
     is no longer "a later week": the overdue card is Slipped, not in Later */
  const sun = planBoard({ today: '2026-10-04', settings: {}, tasks: [task('- [ ] Licence disc 📅 2026-07-31 🛫 2026-10-05', 'Cars.md', 2)] });
  assert.deepStrictEqual(sun.slipped.map(c => c.text), ['Licence disc']);
  assert.deepStrictEqual(sun.later, []);
  assert.deepStrictEqual(sun.nextWeek.anyDay, []);
}

/* 20. B4: a date that isn't on the calendar can never make a card vanish —
       it is Slipped (string order would put 31 Sep after today). Impossible
       days are not rolled to the next month: 29 Feb 2028 is real, 2027 isn't. */
{
  assert.strictEqual(D.isDate('2028-02-29'), true);
  assert.strictEqual(D.isDate('2027-02-29'), false);
  assert.strictEqual(D.isDate('2026-09-31'), false);
  assert.strictEqual(D.isDate('2026-13-01'), false);
  assert.strictEqual(D.isDate('2026-00-10'), false);
  assert.strictEqual(D.isDate('2026-9-1'), false);
  assert.strictEqual(D.isDate(''), false);
  assert.strictEqual(D.isDate(undefined), false);
  /* shown as written, never "1 undefined" */
  assert.strictEqual(D.short('2026-10-01'), '1 Oct');
  assert.strictEqual(D.short('2028-02-29'), '29 Feb');
  assert.strictEqual(D.short('2026-13-01'), '2026-13-01');
  assert.strictEqual(D.short('2026-09-31'), '2026-09-31');
  const b = planBoard({ today: WED, settings: {}, tasks: [
    task('- [ ] Day thirty-one ⏳ 2026-09-31', 'Notes/Home.md', 1),
    task('- [ ] Feb thirty 📅 2026-02-30', 'Notes/Home.md', 2),
    task('- [ ] Month thirteen ⏳ 2026-13-01', 'Notes/Home.md', 3),
    task('- [ ] Fine one ⏳ 2026-10-01', 'Notes/Home.md', 4),
    task('- [ ] Leap day, far off ⏳ 2028-02-29', 'Notes/Home.md', 5),
    task('- [x] Done on a bad day ⏳ 2026-09-31 ✅ 2026-09-30', 'Notes/Home.md', 6),
    { source: 'nudge', path: 'Reminders.md', line: 1, text: 'Bad nudge', due: '2026-02-30', scheduled: '', time: '', done: false, priority: 'normal', raw: '' },
  ] });
  assert.deepStrictEqual(b.slipped.map(c => [c.text, c.date]), [
    ['Feb thirty', '2026-02-30'], ['Bad nudge', '2026-02-30'], ['Day thirty-one', '2026-09-31'], ['Month thirteen', '2026-13-01'],
  ]);
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Fine one']);
  /* a done card with an impossible planned day falls back to the day it was done */
  assert.deepStrictEqual(day(b, WED).done.map(c => c.text), ['Done on a bad day']);
}

/* 21. B3: all-day events lead (even with a letter-named one), then timed
       events by the CLOCK — "9:00" is before "10:30", not after — then
       other timed cards the same way, then untimed by priority */
{
  const data = rhythmFixture();
  data.events = [
    { name: 'Dentist', date: '2026-10-01', time: '14:00', path: 'e/Dentist.md' },
    { name: 'Standup', date: '2026-10-01', time: '9:00', path: 'e/Standup.md' },
    { name: 'Run', date: '2026-10-01', time: '07:30', path: 'e/Run.md' },
    { name: 'Birthday', date: '2026-10-01', time: '', path: 'e/Birthday.md' },
    { name: 'Anniversary', date: '2026-10-01', time: '', path: 'e/Anniversary.md' },
  ];
  const n = (text, time, line) => ({ source: 'nudge', path: 'Reminders.md', line, text, due: '2026-10-01', scheduled: '', time, done: false, priority: 'normal', raw: '' });
  const b = planBoard({ today: WED, settings: {}, rhythm: data, tasks: [
    task('- [ ] Plain ⏳ 2026-10-01', 'A.md', 1),
    n('Late', '10:30', 2), n('Nine', '9:00', 3), n('Early', '07:45', 4),
  ] });
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['Anniversary', 'Birthday', 'Run', 'Standup', 'Dentist', 'Early', 'Nine', 'Late', 'Plain']);
}

/* 22. B5: the tray looks to the end of NEXT week, so a monthly practice
       promised to a day next week (same month) is placed. A weekly one
       promised next week still wants a day THIS week; a monthly one promised
       into the next month still wants a day this month. */
{
  const data = () => {
    const d = rhythmFixture();
    d.practices = [
      { name: 'Range day', area: 'Body', cadence: 'monthly', path: 'p/Range.md' },
      { name: 'Paint', area: 'Craft', cadence: 'weekly', path: 'p/Paint.md' },
    ];
    d.events = [];
    return d;
  };
  const a = data();
  a.log = new Map([['2026-10-14', E({ plan: ['Range day', 'Paint'] })]]);
  const b = planBoard({ today: '2026-10-07', settings: {}, rhythm: a, tasks: [] });
  assert.deepStrictEqual(b.tray.map(t => [t.name, t.need]), [['Paint', 1]]);
  assert.deepStrictEqual(b.nextWeek.days[2].cards.map(c => c.text), ['Paint', 'Range day']);
  const z = data();
  z.log = new Map([['2026-11-03', E({ plan: ['Range day'] })]]);
  assert.deepStrictEqual(planBoard({ today: '2026-10-28', settings: {}, rhythm: z, tasks: [] }).tray.map(t => [t.name, t.need]), [['Range day', 1], ['Paint', 1]]);
}

/* 23. B6/F2: doneToday is every done card whose ✅ is today — wherever its
       planned day is (this week, next week, past, beyond the board) — and
       every card carries its doneDate. A done card on a next-week day sits in
       THAT day's done list. Excluded folders stay out; a done line with no ✅
       and a past day keeps vanishing (nothing says when it happened). */
{
  const nudge = (text, line, due, extra = {}) => Object.assign(
    { source: 'nudge', path: 'Reminders.md', line, text, due, scheduled: '', time: '', done: true, doneDate: WED, priority: 'normal', raw: `- [x] ${text}` }, extra);
  const b = planBoard({ today: WED, settings: { excludeFolders: ['Archive'] }, tasks: [
    task('- [x] Done early ⏳ 2026-10-02 ✅ 2026-09-30', 'A.md', 1),
    task('- [x] Done in the past ⏳ 2026-09-28 ✅ 2026-09-28', 'A.md', 2),
    task('- [x] Slipped ticked ⏳ 2026-09-21 ✅ 2026-09-30', 'A.md', 3),
    task('- [x] Next week ticked ⏳ 2026-10-06 ✅ 2026-09-30', 'A.md', 4),
    task('- [x] Far ticked ⏳ 2026-12-01 ✅ 2026-09-30', 'A.md', 5),
    task('- [x] Ticked as due 📅 2026-09-30 ✅ 2026-09-30', 'A.md', 6),
    task('- [x] No tick date ⏳ 2026-09-21', 'A.md', 7),
    task('- [x] Excluded ⏳ 2026-10-01 ✅ 2026-09-30', 'Archive/X.md', 1),
    task('- [ ] Still open ⏳ 2026-10-01', 'A.md', 8),
    nudge('Paid rates', 2, '2026-10-01'),
    nudge('Late rates', 3, '2026-09-20'),
    nudge('Paid last week', 4, '2026-09-22', { doneDate: '2026-09-22' }),
  ] });
  assert.deepStrictEqual(b.doneToday.map(c => c.text), [
    'Done early', 'Slipped ticked', 'Next week ticked', 'Far ticked', 'Ticked as due', 'Paid rates', 'Late rates',
  ]);
  assert.deepStrictEqual(b.doneToday.map(c => c.doneDate), Array(7).fill(WED));
  assert.deepStrictEqual(day(b, '2026-10-02').done.map(c => c.text), ['Done early']);
  assert.deepStrictEqual(day(b, '2026-10-01').done.map(c => c.text), ['Paid rates']);
  assert.deepStrictEqual(day(b, WED).done.map(c => c.text), ['Slipped ticked', 'Ticked as due', 'Late rates']);
  assert.deepStrictEqual(day(b, '2026-09-28').done.map(c => c.text), ['Done in the past']);
  assert.deepStrictEqual(b.nextWeek.days[1].done.map(c => [c.text, c.slot]), [['Next week ticked', 'nextWeek']]);
  assert.deepStrictEqual(b.slipped, []);
  /* nothing done today: an empty list, not missing; open cards carry no doneDate */
  const none = planBoard({ today: WED, settings: {}, tasks: [task('- [ ] Open ⏳ 2026-10-01')] });
  assert.deepStrictEqual(none.doneToday, []);
  assert.strictEqual(day(none, '2026-10-01').cards[0].doneDate, '');
}

/* 24. B9/F1/contract 3: what a card can do — Next week is off for a card
       already in Next week (a day or "any day": the park would only write
       a 🛫 and nothing would move); Later is off for a 🔁 to-do, with the
       reason; the due-sooner line is "today up to, not including, next Monday" */
{
  const b = planBoard({ today: WED, tasks: [], settings: {} });
  const only = a => Object.keys(a).filter(k => a[k]).sort();
  const t = (raw, extra = {}) => Object.assign({ source: 'tasks', raw, date: '2026-10-01', due: '', done: false }, extra);
  assert.deepStrictEqual(only(actionsFor(t('- [ ] Tax 📅 2026-10-09', { due: '2026-10-09', date: '2026-10-09', slot: 'nextWeek' }), b)), ['day', 'done', 'drop', 'open']);
  assert.deepStrictEqual(only(actionsFor(t('- [ ] Call ⏳ 2026-10-07', { date: '2026-10-07', slot: 'nextWeek' }), b)), ['day', 'done', 'drop', 'later', 'open']);
  assert.deepStrictEqual(only(actionsFor(t('- [ ] Some day', { date: '', slot: 'nextWeek' }), b)), ['day', 'done', 'drop', 'later', 'open']);
  /* a to-do in Later can't go to Later again; the rest is open */
  assert.deepStrictEqual(only(actionsFor(t('- [ ] Idea', { date: '', slot: 'later' }), b)), ['day', 'done', 'drop', 'nextWeek', 'open']);
  /* 🔁: no Later (Tasks needs a date on a repeat), and it says why */
  const bins = actionsFor(t('- [ ] Bins out 🔁 every week ⏳ 2026-10-01'), b);
  assert.strictEqual(bins.later, false);
  assert.strictEqual(bins.laterWhy, 'repeats');
  assert.deepStrictEqual(only(bins), ['day', 'done', 'laterWhy', 'nextWeek', 'open', 'dropWhy'].sort());
  assert.strictEqual(actionsFor(t('- [ ] Bins out 🔁 every week', { date: '' }), b).later, false);
  assert.strictEqual(actionsFor(t('- [ ] Bins out 🔁 every week', { date: '' }), b).laterWhy, 'repeats');
  assert.strictEqual(actionsFor(t('- [ ] Paint'), b).laterWhy, '');
  /* due-sooner read from the line when the card has no due: Wed 30 Sep,
     next Monday 5 Oct */
  const nw = raw => actionsFor({ source: 'tasks', raw, date: '', done: false }, b).nextWeek;
  assert.strictEqual(nw('- [ ] X 📅 2026-09-29'), true);
  assert.strictEqual(nw('- [ ] X 📅 2026-09-30'), false);
  assert.strictEqual(nw('- [ ] X 📅 2026-10-04'), false);
  assert.strictEqual(nw('- [ ] X 📅 2026-10-05'), true);
  /* on the jump day (Sunday 4 Oct) the board shows the week ahead and next
     week is the one after it: a deadline on Friday 9th is "sooner" */
  const sun = planBoard({ today: '2026-10-04', tasks: [], settings: {} });
  const nwSun = raw => actionsFor({ source: 'tasks', raw, date: '', done: false }, sun).nextWeek;
  assert.strictEqual(nwSun('- [ ] X 📅 2026-10-03'), true);
  assert.strictEqual(nwSun('- [ ] X 📅 2026-10-04'), false);
  assert.strictEqual(nwSun('- [ ] X 📅 2026-10-09'), false);
  assert.strictEqual(nwSun('- [ ] X 📅 2026-10-12'), true);
  assert.strictEqual(sun.nextWeek.start, '2026-10-12');
}

/* 25. contract 1 — card.unique: the store's "this exact line occurs once in
       its note" flag crosses to the card as a strict boolean, on dated and
       undated (Later / Next week) cards alike */
{
  const u = (raw, path, line, unique) => Object.assign(task(raw, path, line), unique === undefined ? {} : { unique });
  const b = planBoard({ today: WED, settings: { plannerNote: 'Planning/Fortnight.md' }, tasks: [
    u('- [ ] Once ⏳ 2026-10-01', 'A.md', 1, true),
    u('- [ ] Twin ⏳ 2026-10-01', 'A.md', 2, false),
    u('- [ ] Unknown ⏳ 2026-10-01', 'A.md', 3),
    u('- [ ] Truthy ⏳ 2026-10-01', 'A.md', 4, 'yes'),
    u('- [ ] Later once', 'Planning/Fortnight.md', 5, true),
    u('- [ ] Later twin', 'Planning/Fortnight.md', 6, false),
    u('- [ ] Later truthy', 'Planning/Fortnight.md', 8, 'yes'),
    u('- [ ] Parked 🛫 2026-10-05', 'A.md', 7, true),
  ] });
  assert.deepStrictEqual(day(b, '2026-10-01').cards.map(c => [c.text, c.unique]), [['Once', true], ['Twin', false], ['Unknown', false], ['Truthy', false]]);
  assert.deepStrictEqual(b.later.map(c => [c.text, c.unique]), [['Later once', true], ['Later twin', false], ['Later truthy', false]]);
  assert.deepStrictEqual(b.nextWeek.anyDay.map(c => [c.text, c.unique]), [['Parked', true]]);
}

/* 26. B7 (model side) + G4: a line that is only tags still has a name on
       the card; parsing is cached by raw across boards but a board never
       shares state with the last one; the tag test is case-blind and whole-
       tag; plannerPathOf reads each setting afresh */
{
  const b = planBoard({ today: WED, settings: {}, tasks: [task('- [ ] #errand #home ⏳ 2026-10-01', 'A.md', 1)] });
  assert.deepStrictEqual(texts(b, '2026-10-01'), ['#errand #home']);
  assert.deepStrictEqual(day(b, '2026-10-01').cards[0].tags, ['#errand', '#home']);
  /* the same raw on a second board: fresh card, and scribbling on the first
     board's tags can't reach the next */
  const raw = '- [ ] Write ⏳ 2026-10-01 #work';
  const one = planBoard({ today: WED, settings: {}, tasks: [task(raw, 'A.md', 1)] });
  one.days[3].cards[0].tags.push('#poison');
  one.days[3].cards[0].text = 'changed';
  const two = planBoard({ today: WED, settings: {}, tasks: [task(raw, 'A.md', 1), task(raw, 'B.md', 2)] });
  assert.deepStrictEqual(two.days[3].cards.map(c => [c.text, c.tags.join(' ')]), [['Write', '#work'], ['Write', '#work']]);
  /* a different line at the same place is read afresh */
  const three = planBoard({ today: WED, settings: {}, tasks: [task('- [ ] Rewrite ⏳ 2026-10-02', 'A.md', 1)] });
  assert.deepStrictEqual(texts(three, '2026-10-02'), ['Rewrite']);
  assert.deepStrictEqual(texts(three, '2026-10-01'), []);
  /* the later tag: case-blind, whole tag only, any configured tag */
  const tagged = planBoard({ today: WED, settings: { laterTag: '#Someday' }, tasks: [
    task('- [ ] Mixed case #SOMEDAY', 'A.md', 1),
    task('- [ ] Longer tag #somedayish', 'A.md', 2),
    task('- [ ] Default tag #later', 'A.md', 3),
    task('- [ ] No tag at all', 'A.md', 4),
  ] });
  assert.deepStrictEqual(tagged.later.map(c => c.text), ['Mixed case']);
  /* the planner path memo follows the setting, never sticks */
  const { plannerPathOf } = require('../src/plan');
  assert.strictEqual(plannerPathOf({ plannerNote: 'Plans/Mine' }), 'Plans/Mine.md');
  assert.strictEqual(plannerPathOf({}), 'Planning/Fortnight.md');
  assert.strictEqual(plannerPathOf({ plannerNote: './Other.md' }), 'Other.md');
  assert.strictEqual(plannerPathOf({ plannerNote: 'Plans/Mine' }), 'Plans/Mine.md');
  assert.strictEqual(plannerPathOf(undefined), 'Planning/Fortnight.md');
}

/* 27. calendar boundaries and the weekStart-0 jump, with no Rhythm to
       override the setting */
{
  /* Saturday jumps to a Sunday-start week: today stays in front */
  const sat = planBoard({ today: '2026-10-03', tasks: [], settings: { weekStart: 0 } });
  assert.strictEqual(sat.weekStart, '2026-10-04');
  assert.deepStrictEqual(dates(sat), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  assert.deepStrictEqual(sat.days.map(d => d.isToday), [true, false, false, false, false, false, false, false]);
  assert.strictEqual(sat.nextWeek.start, '2026-10-11');
  const fri = planBoard({ today: '2026-10-02', tasks: [], settings: { weekStart: 0 } });
  assert.strictEqual(fri.weekStart, '2026-09-27');
  assert.strictEqual(fri.days.length, 7);
  assert.strictEqual(fri.nextWeek.start, '2026-10-04');
  const sun = planBoard({ today: '2026-10-04', tasks: [], settings: { weekStart: 0 } });
  assert.strictEqual(sun.weekStart, '2026-10-04');
  assert.strictEqual(sun.days.length, 7);
  /* year end: Thu 31 Dec 2026 shows Mon 28 Dec – Sun 3 Jan */
  const ye = planBoard({ today: '2026-12-31', settings: {}, tasks: [task('- [ ] New year ⏳ 2027-01-01', 'A.md', 1), task('- [ ] Back in 2027 ⏳ 2027-01-05', 'A.md', 2)] });
  assert.deepStrictEqual(dates(ye), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.strictEqual(ye.nextWeek.start, '2027-01-04');
  assert.deepStrictEqual(texts(ye, '2027-01-01'), ['New year']);
  assert.deepStrictEqual(ye.nextWeek.days[1].cards.map(c => c.text), ['Back in 2027']);
  /* leap year: Sunday 27 Feb 2028 jumps to the week with a 29 Feb in it */
  const leap = planBoard({ today: '2028-02-27', settings: {}, tasks: [task('- [ ] Leap day ⏳ 2028-02-29', 'A.md', 1)] });
  assert.deepStrictEqual(dates(leap), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04', '2028-03-05']);
  assert.strictEqual(leap.nextWeek.start, '2028-03-06');
  assert.deepStrictEqual(texts(leap, '2028-02-29'), ['Leap day']);
  /* a common year has no 29th: Sunday 28 Feb 2027 goes straight to 1 Mar */
  const common = planBoard({ today: '2027-02-28', settings: {}, tasks: [] });
  assert.deepStrictEqual(dates(common), ['2027-02-28', '2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06', '2027-03-07']);
  assert.strictEqual(common.nextWeek.start, '2027-03-08');
}

/* 28. a reminder that slipped and was ticked today is done, not slipped:
       it sits in today's Done */
{
  const b = planBoard({ today: WED, settings: {}, tasks: [
    { source: 'nudge', path: 'Reminders.md', line: 1, text: 'Late call', due: '2026-09-20', scheduled: '', time: '', done: true, doneDate: WED, priority: 'normal', raw: '- [x] Late call' },
  ] });
  assert.deepStrictEqual(b.slipped, []);
  assert.deepStrictEqual(day(b, WED).done.map(c => [c.source, c.text, c.date]), [['nudge', 'Late call', WED]]);
}

/* 29. G4: a line is parsed once however many boards show it (and once per
       board, though an undated line is looked at twice), and the tag
       RegExp is only built for a line that could hold the tag */
{
  const L = require('../src/tasks-line');
  const realParse = L.parseTask, realHas = L.hasTag;
  let parses = 0, tagTests = 0;
  L.parseTask = raw => { parses++; return realParse(raw); };
  L.hasTag = (raw, tag) => { tagTests++; return realHas(raw, tag); };
  try {
    const tasks = [
      task('- [ ] Cache dated ⏳ 2026-10-01', 'Cache.md', 1),
      task('- [ ] Cache undated plain', 'Cache.md', 2),
      task('- [ ] Cache undated tagged #later', 'Cache.md', 3),
    ];
    const first = planBoard({ today: WED, settings: {}, tasks });
    assert.strictEqual(parses, 3);
    assert.strictEqual(tagTests, 1);
    assert.deepStrictEqual(first.later.map(c => c.text), ['Cache undated tagged']);
    const again = planBoard({ today: WED, settings: {}, tasks });
    assert.strictEqual(parses, 3);
    assert.deepStrictEqual(again.later.map(c => c.text), ['Cache undated tagged']);
    const more = planBoard({ today: WED, settings: {}, tasks: tasks.concat(task('- [ ] Cache new ⏳ 2026-10-02', 'Cache.md', 4)) });
    assert.strictEqual(parses, 4);
    assert.deepStrictEqual(texts(more, '2026-10-02'), ['Cache new']);
  } finally {
    L.parseTask = realParse;
    L.hasTag = realHas;
  }
}

console.log('plan-board OK');
