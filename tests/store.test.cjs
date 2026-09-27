'use strict';
/* store over a stand-in Obsidian app: what it reads from the vault. */
const assert = require('node:assert');
const { makeApp } = require('./_stub.cjs');
const { makeStore } = require('../src/store');

(async () => {
  /* 8. load finds every task line with its path and line, nothing else,
        reads only notes that hold tasks, and skips Nudge's own note */
  {
    const app = makeApp({
      'Home.md': '# Home\n\n- [ ] Call plumber ⏳ 2026-10-01\n- plain bullet\nSome text\n  - [x] Done thing',
      'Ideas.md': '# Ideas\n\nNo tasks here.\n- just a list',
      'Reminders.md': '- [ ] Nudge thing 📅 2026-10-01',
      'Work/Q4.md': '> - [ ] Quoted task 📅 2026-10-02',
    }, { 'nudge-reminders': { store: { isOurs: p => p === 'Reminders.md', path: () => 'Reminders.md', load: async () => ({ items: [] }) } } });
    const store = makeStore({ app, settings: {} });
    const tasks = await store.load();
    const got = tasks.map(t => [t.path, t.line, t.raw]).sort();
    assert.deepStrictEqual(got, [
      ['Home.md', 2, '- [ ] Call plumber ⏳ 2026-10-01'],
      ['Home.md', 5, '  - [x] Done thing'],
      ['Work/Q4.md', 0, '> - [ ] Quoted task 📅 2026-10-02'],
    ]);
    assert.deepStrictEqual(app.reads.sort(), ['Home.md', 'Work/Q4.md']);
  }

  /* 8b. without Nudge installed, its note is just another note */
  {
    const app = makeApp({ 'Reminders.md': '- [ ] Nudge thing 📅 2026-10-01' });
    const tasks = await makeStore({ app, settings: {} }).load();
    assert.deepStrictEqual(tasks.map(t => t.path), ['Reminders.md']);
  }

  /* 9. Nudge reminders come through Nudge's own store, read by Nudge */
  {
    const nudgeStore = {
      isOurs: p => p === 'Reminders.md',
      path: () => 'Reminders.md',
      load: async () => ({ items: [
        { title: 'Phone the dentist', due: '2026-10-01', time: '09:30', done: false, priority: 'high', line: 4, raw: '- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30 ⏫', tags: ['#health'], group: 'Family' },
        { title: 'Old thing', due: '2026-09-01', time: '', done: true, priority: 'normal', line: 6, raw: '- [x] Old thing 📅 2026-09-01', tags: [] },
        { title: 'Planned only', due: '', scheduled: '2026-10-02', time: '', done: false, priority: 'normal', line: 7, raw: '- [ ] Planned only ⏳ 2026-10-02', tags: [] },
      ] }),
    };
    const app = makeApp({ 'Reminders.md': 'ignored — Nudge reads it', 'Home.md': '- [ ] Call plumber ⏳ 2026-10-01' },
      { 'nudge-reminders': { store: nudgeStore } });
    const tasks = await makeStore({ app, settings: {} }).load();
    const nudged = tasks.filter(t => t.source === 'nudge');
    assert.deepStrictEqual(nudged, [
      { source: 'nudge', path: 'Reminders.md', line: 4, raw: '- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30 ⏫',
        text: 'Phone the dentist', due: '2026-10-01', scheduled: '', doneDate: '', time: '09:30', done: false, priority: 'high', tags: ['#health'], group: 'Family' },
      { source: 'nudge', path: 'Reminders.md', line: 6, raw: '- [x] Old thing 📅 2026-09-01',
        text: 'Old thing', due: '2026-09-01', scheduled: '', doneDate: '', time: '', done: true, priority: 'normal', tags: [], group: '' },
      { source: 'nudge', path: 'Reminders.md', line: 7, raw: '- [ ] Planned only ⏳ 2026-10-02',
        text: 'Planned only', due: '', scheduled: '2026-10-02', doneDate: '', time: '', done: false, priority: 'normal', tags: [], group: '' },
    ]);
    assert.deepStrictEqual(tasks.filter(t => t.source !== 'nudge').map(t => t.path), ['Home.md']);
    assert.deepStrictEqual(app.reads, ['Home.md']);
  }

  /* 9b. a failure inside Nudge costs only its cards, never the board */
  {
    const app = makeApp({ 'Home.md': '- [ ] Call plumber ⏳ 2026-10-01' },
      { 'nudge-reminders': { store: { isOurs: () => false, path: () => 'Reminders.md', load: async () => { throw new Error('boom'); } } } });
    const store = makeStore({ app, settings: {} });
    const tasks = await store.load();
    assert.deepStrictEqual(tasks.map(t => t.path), ['Home.md']);
    /* and the board is told, so it can say so quietly */
    assert.deepStrictEqual(store.problems(), ['nudge']);
  }

  /* 9c. Nudge not installed at all is not a problem — most people won't have it */
  {
    const store = makeStore({ app: makeApp({ 'Home.md': '- [ ] X ⏳ 2026-10-01' }), settings: {} });
    await store.load();
    assert.deepStrictEqual(store.problems(), []);
  }

  /* 10. Rhythm's notes, read the way Rhythm reads them */
  {
    const app = makeApp({
      'Rhythm/Areas/Body.md': '---\nrhythm: area\norder: 1\n---\nLook after it.',
      'Rhythm/Practices/Gym.md': '---\nrhythm: practice\narea: Body\ncadence: 3/week\n---\n',
      'Rhythm/Practices/Old habit.md': '---\nrhythm: practice\narea: Body\ncadence: daily\nstatus: aside\n---\n',
      'Rhythm/Events/Dentist.md': '---\nrhythm: event\narea: Body\ndate: 2026-10-01\ntime: "14:00"\n---\n',
      'Rhythm/Log/2026-09-28.md': '---\nrhythm: log\ndone: [Gym]\nplan: []\n---\n',
      'Rhythm/Log/scratch.md': '---\ndone: [Gym]\n---\n',
    }, { rhythm: { settings: {} } });
    const r = await makeStore({ app, settings: {} }).loadRhythm();
    assert.strictEqual(r.weekStart, 1);
    assert.deepStrictEqual(r.areas.map(a => [a.name, a.order]), [['Body', 1]]);
    assert.deepStrictEqual(r.practices.map(p => [p.name, p.area, p.cadence, p.path]), [['Gym', 'Body', '3/week', 'Rhythm/Practices/Gym.md']]);
    assert.deepStrictEqual(r.events.map(e => [e.name, e.date, e.time, e.path]), [['Dentist', '2026-10-01', '14:00', 'Rhythm/Events/Dentist.md']]);
    assert.deepStrictEqual([...r.log.keys()], ['2026-09-28']);
    assert.deepStrictEqual([...r.log.get('2026-09-28').done], ['Gym']);
  }

  /* 10b. no Rhythm folder, or Rhythm not enabled: nothing to show */
  assert.strictEqual(await makeStore({ app: makeApp({ 'Home.md': 'x' }, { rhythm: { settings: {} } }), settings: {} }).loadRhythm(), null);
  assert.strictEqual(await makeStore({ app: makeApp({ 'Rhythm/Practices/Gym.md': '---\ncadence: 3/week\n---\n' }), settings: {} }).loadRhythm(), null);

  /* 10c. Rhythm's own settings win: its folder and its week start */
  {
    const app = makeApp({ 'Life/Practices/Gym.md': '---\ncadence: 3/week\n---\n' },
      { rhythm: { settings: { folder: '/Life//', weekStart: 0 } } });
    const r = await makeStore({ app, settings: {} }).loadRhythm();
    assert.deepStrictEqual(r.practices.map(p => p.name), ['Gym']);
    assert.strictEqual(r.weekStart, 0);
  }

  console.log('store OK');
})().catch(e => { console.error(e); process.exit(1); });
