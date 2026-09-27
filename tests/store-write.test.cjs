'use strict';
/* store writes over a stand-in Obsidian app: moving cards. Each test checks
   the resulting FILE TEXT and the calls made to the other plugins. */
const assert = require('node:assert');
const { makeApp } = require('./_stub.cjs');
const { makeStore } = require('../src/store');

const rhythm = { rhythm: { settings: {} } };

(async () => {
  /* 11. a to-do moves by its ⏳ alone; nothing else in the note changes */
  {
    const note = '# Home\n- [ ] Call plumber ⏳ 2026-10-01 📅 2026-10-03\n- [ ] File tax 📅 2026-10-02\nnotes below';
    const app = makeApp({ 'Home.md': note });
    const store = makeStore({ app, settings: {} });
    const r = await store.move({ source: 'tasks', path: 'Home.md', line: 1, raw: '- [ ] Call plumber ⏳ 2026-10-01 📅 2026-10-03' }, '2026-10-02');
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(app.files.get('Home.md'), '# Home\n- [ ] Call plumber ⏳ 2026-10-02 📅 2026-10-03\n- [ ] File tax 📅 2026-10-02\nnotes below');
    /* a deadline-only card gains a ⏳ and keeps its 📅 */
    await store.move({ source: 'tasks', path: 'Home.md', line: 2, raw: '- [ ] File tax 📅 2026-10-02' }, '2026-09-30');
    assert.strictEqual(app.files.get('Home.md'), '# Home\n- [ ] Call plumber ⏳ 2026-10-02 📅 2026-10-03\n- [ ] File tax 📅 2026-10-02 ⏳ 2026-09-30\nnotes below');
  }

  /* 11b. the line changed since the board loaded: refuse, touch nothing */
  {
    const app = makeApp({ 'Home.md': '- [ ] Call plumber today ⏳ 2026-10-01' });
    const r = await makeStore({ app, settings: {} }).move({ source: 'tasks', path: 'Home.md', line: 0, raw: '- [ ] Call plumber ⏳ 2026-10-01' }, '2026-10-02');
    assert.deepStrictEqual(r, { ok: false, reason: 'changed' });
    assert.strictEqual(app.files.get('Home.md'), '- [ ] Call plumber today ⏳ 2026-10-01');
  }

  /* 11c. a Nudge reminder moves through Nudge; Fortnight writes nothing */
  {
    const calls = [];
    const nudge = { isOurs: p => p === 'Reminders.md', path: () => 'Reminders.md', load: async () => ({ items: [] }),
      setDue: async (item, due) => { calls.push([item.raw, item.line, due]); return { ok: true }; } };
    const app = makeApp({ 'Reminders.md': '- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30' }, { 'nudge-reminders': { store: nudge } });
    const r = await makeStore({ app, settings: {} }).move({ source: 'nudge', path: 'Reminders.md', line: 0, raw: '- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30' }, '2026-10-03');
    assert.deepStrictEqual(r, { ok: true });
    assert.deepStrictEqual(calls, [['- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30', 0, '2026-10-03']]);
    assert.strictEqual(app.files.get('Reminders.md'), '- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30');
  }

  /* 11d. a practice from the tray is promised to a day in Rhythm's log,
          creating the day's log note the way Rhythm would */
  {
    const app = makeApp({ 'Rhythm/Practices/Gym.md': '---\ncadence: 3/week\n---\n' }, rhythm);
    const store = makeStore({ app, settings: {} });
    const r = await store.move({ source: 'practice', text: 'Gym', path: 'Rhythm/Practices/Gym.md', fromTray: true }, '2026-10-01');
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-01.md'), '---\nrhythm: log\ndone: []\nplan: [Gym]\n---\n');
  }

  /* 11e. a practice moved between days: promised to the new day first, then
          released from the old one; the rest of each log is kept */
  {
    const app = makeApp({
      'Rhythm/Log/2026-10-01.md': '---\nrhythm: log\ndone: [Read]\nplan: [Gym, Paint]\n---\nA good day.\n',
      'Rhythm/Log/2026-10-02.md': '---\nrhythm: log\nskip: [Gym]\n---\n',
    }, rhythm);
    const r = await makeStore({ app, settings: {} }).move({ source: 'practice', text: 'Gym', path: 'Rhythm/Practices/Gym.md', date: '2026-10-01' }, '2026-10-02');
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-01.md'), '---\nrhythm: log\ndone: [Read]\nplan: [Paint]\n---\n\nA good day.\n');
    /* a plan clears a skip, as in Rhythm */
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-02.md'), '---\nrhythm: log\ndone: []\nplan: [Gym]\n---\n');
  }

  /* 11f. events are fixed */
  {
    const app = makeApp({ 'Rhythm/Events/Dentist.md': '---\ndate: 2026-10-01\n---\n' }, rhythm);
    const r = await makeStore({ app, settings: {} }).move({ source: 'event', path: 'Rhythm/Events/Dentist.md' }, '2026-10-02');
    assert.deepStrictEqual(r, { ok: false, reason: 'locked' });
    assert.strictEqual(app.files.get('Rhythm/Events/Dentist.md'), '---\ndate: 2026-10-01\n---\n');
  }

  /* 11g. a write that lands mid-move (sync from a phone) is never lost:
          moves are one atomic read-modify-write, not read … then write */
  {
    const app = makeApp({ 'A.md': '- [ ] X ⏳ 2026-10-01\n- [ ] Y', 'Rhythm/Log/2026-10-02.md': '---\nrhythm: log\n---\n' }, rhythm);
    const gap = (path, extra) => { const read = app.vault.read; app.vault.read = async f => { const t = await read(f); if (f.path === path) app.files.set(path, extra(t)); return t; }; };
    gap('A.md', t => t + '\n- [ ] Z typed on phone');
    gap('Rhythm/Log/2026-10-02.md', () => '---\nrhythm: log\ndone: [Read]\n---\n');
    const store = makeStore({ app, settings: {} });
    await store.move({ source: 'tasks', path: 'A.md', line: 0, raw: '- [ ] X ⏳ 2026-10-01' }, '2026-10-05');
    await store.move({ source: 'practice', text: 'Gym', path: 'p', fromTray: true }, '2026-10-02');
    assert.strictEqual(app.files.get('A.md'), '- [ ] X ⏳ 2026-10-05\n- [ ] Y');
    /* the stub's gap only fires on read(): a correct move never calls it */
    app.vault.read = async () => { throw new Error('move must not read-then-write'); };
    await store.move({ source: 'tasks', path: 'A.md', line: 1, raw: '- [ ] Y' }, '2026-10-06');
    await store.move({ source: 'practice', text: 'Paint', path: 'p', fromTray: true }, '2026-10-02');
    assert.strictEqual(app.files.get('A.md'), '- [ ] X ⏳ 2026-10-05\n- [ ] Y ⏳ 2026-10-06');
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-02.md'), '---\nrhythm: log\ndone: []\nplan: [Gym, Paint]\n---\n');
  }

  /* 11h. a Nudge move names the reminder's list, so two reminders with the
          same text in different lists can't be mixed up */
  {
    const calls = [];
    const nudge = { isOurs: () => true, path: () => 'Reminders.md', load: async () => ({ items: [] }),
      setDue: async (item, due) => { calls.push(Object.assign({ due }, item)); return { ok: true }; } };
    const app = makeApp({}, { 'nudge-reminders': { store: nudge } });
    await makeStore({ app, settings: {} }).move({ source: 'nudge', path: 'Reminders.md', line: 7, raw: '- [ ] Phone mum 📅 2026-10-01', group: 'Work' }, '2026-10-09');
    assert.deepStrictEqual(calls, [{ due: '2026-10-09', raw: '- [ ] Phone mum 📅 2026-10-01', line: 7, group: 'Work' }]);
  }

  /* 11i. Nudge says it couldn't find the reminder: reported, not hidden */
  {
    const nudge = { isOurs: () => true, path: () => 'Reminders.md', load: async () => ({ items: [] }), setDue: async () => ({ ok: false }) };
    const r = await makeStore({ app: makeApp({}, { 'nudge-reminders': { store: nudge } }), settings: {} })
      .move({ source: 'nudge', path: 'Reminders.md', line: 0, raw: '- [ ] Gone', group: '' }, '2026-10-09');
    assert.deepStrictEqual(r, { ok: false, reason: 'changed' });
  }

  console.log('store-write OK');
})().catch(e => { console.error(e); process.exit(1); });
