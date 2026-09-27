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
    }, { 'nudge-reminders': { store: { isOurs: p => p === 'Reminders.md' } } });
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

  console.log('store OK');
})().catch(e => { console.error(e); process.exit(1); });
