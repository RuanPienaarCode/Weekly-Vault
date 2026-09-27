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
        { title: 'Phone the dentist', due: '2026-10-01', time: '09:30', done: false, priority: 'high', line: 4, raw: '- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30 ⏫', tags: ['#health'] },
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
        text: 'Phone the dentist', due: '2026-10-01', scheduled: '', time: '09:30', done: false, priority: 'high', tags: ['#health'] },
      { source: 'nudge', path: 'Reminders.md', line: 6, raw: '- [x] Old thing 📅 2026-09-01',
        text: 'Old thing', due: '2026-09-01', scheduled: '', time: '', done: true, priority: 'normal', tags: [] },
      { source: 'nudge', path: 'Reminders.md', line: 7, raw: '- [ ] Planned only ⏳ 2026-10-02',
        text: 'Planned only', due: '', scheduled: '2026-10-02', time: '', done: false, priority: 'normal', tags: [] },
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

  console.log('store OK');
})().catch(e => { console.error(e); process.exit(1); });
