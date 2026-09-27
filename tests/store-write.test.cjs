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

  /* 12. ticking a to-do goes through Tasks itself, so a repeating one gets
         its next occurrence exactly as Tasks would write it */
  {
    const calls = [];
    const tasksPlugin = { apiV1: { executeToggleTaskDoneCommand: (line, path) => {
      calls.push([line, path]);
      return '- [ ] Water plants 🔁 every week ⏳ 2026-10-08\n- [x] Water plants 🔁 every week ⏳ 2026-10-01 ✅ 2026-09-30';
    } } };
    const app = makeApp({ 'Home.md': '# Home\n- [ ] Water plants 🔁 every week ⏳ 2026-10-01\nafter' }, { 'obsidian-tasks-plugin': tasksPlugin });
    const r = await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'Home.md', line: 1, raw: '- [ ] Water plants 🔁 every week ⏳ 2026-10-01' }, '2026-09-30');
    assert.deepStrictEqual(r, { ok: true });
    assert.deepStrictEqual(calls, [['- [ ] Water plants 🔁 every week ⏳ 2026-10-01', 'Home.md']]);
    assert.strictEqual(app.files.get('Home.md'), '# Home\n- [ ] Water plants 🔁 every week ⏳ 2026-10-08\n- [x] Water plants 🔁 every week ⏳ 2026-10-01 ✅ 2026-09-30\nafter');
  }

  /* 12b. without Tasks: a plain tick, nothing else */
  {
    const app = makeApp({ 'Home.md': '- [ ] Call plumber ⏳ 2026-10-01' });
    await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'Home.md', line: 0, raw: '- [ ] Call plumber ⏳ 2026-10-01' }, '2026-09-30');
    assert.strictEqual(app.files.get('Home.md'), '- [x] Call plumber ⏳ 2026-10-01');
  }

  /* 12c. a changed line is refused, as for moves */
  {
    const app = makeApp({ 'Home.md': '- [ ] Call plumber now ⏳ 2026-10-01' });
    const r = await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'Home.md', line: 0, raw: '- [ ] Call plumber ⏳ 2026-10-01' }, '2026-09-30');
    assert.deepStrictEqual(r, { ok: false, reason: 'changed' });
    assert.strictEqual(app.files.get('Home.md'), '- [ ] Call plumber now ⏳ 2026-10-01');
  }

  /* 12d. a reminder ticks through Nudge's toggle, naming its list */
  {
    const calls = [];
    const nudge = { isOurs: () => true, path: () => 'Reminders.md', load: async () => ({ items: [] }),
      toggle: async (item, today) => { calls.push([item.raw, item.line, item.group, today]); return { ok: true }; } };
    const r = await makeStore({ app: makeApp({}, { 'nudge-reminders': { store: nudge } }), settings: {} })
      .tick({ source: 'nudge', path: 'Reminders.md', line: 3, raw: '- [ ] Pay rates 📅 2026-10-01', group: 'Home' }, '2026-09-30');
    assert.deepStrictEqual(r, { ok: true });
    assert.deepStrictEqual(calls, [['- [ ] Pay rates 📅 2026-10-01', 3, 'Home', '2026-09-30']]);
  }

  /* 12e. a practice ticked is done TODAY in Rhythm's log (as Rhythm's tick);
          if it was promised to another day, that promise is released */
  {
    const app = makeApp({
      'Rhythm/Log/2026-09-30.md': '---\nrhythm: log\nskip: [Gym]\n---\n',
      'Rhythm/Log/2026-10-02.md': '---\nrhythm: log\ndone: []\nplan: [Gym]\n---\n',
    }, rhythm);
    const r = await makeStore({ app, settings: {} }).tick({ source: 'practice', text: 'Gym', path: 'p', date: '2026-10-02' }, '2026-09-30');
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(app.files.get('Rhythm/Log/2026-09-30.md'), '---\nrhythm: log\ndone: [Gym]\n---\n');
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-02.md'), '---\nrhythm: log\ndone: []\n---\n');
  }

  /* 12f. events can't be ticked */
  assert.deepStrictEqual(await makeStore({ app: makeApp({}), settings: {} }).tick({ source: 'event', path: 'e' }, '2026-09-30'), { ok: false, reason: 'locked' });

  /* 12g. a double click can't tick twice: a card already being written is
          refused until the first write finishes */
  {
    let calls = 0;
    const tasksPlugin = { apiV1: { executeToggleTaskDoneCommand: () => { calls++; return '- [ ] Pills 🔁 every day when done 📅 2026-09-28\n- [x] Pills 🔁 every day when done 📅 2026-09-28 ✅ 2026-09-27'; } } };
    const app = makeApp({ 'H.md': '- [ ] Pills 🔁 every day when done 📅 2026-09-28' }, { 'obsidian-tasks-plugin': tasksPlugin });
    const store = makeStore({ app, settings: {} });
    const card = { key: 'H.md:0', source: 'tasks', path: 'H.md', line: 0, raw: '- [ ] Pills 🔁 every day when done 📅 2026-09-28' };
    const both = await Promise.all([store.tick(card, '2026-09-27'), store.tick(card, '2026-09-27')]);
    assert.deepStrictEqual(both, [{ ok: true }, { ok: false, reason: 'busy' }]);
    assert.strictEqual(calls, 1);
    assert.strictEqual(app.files.get('H.md'), '- [ ] Pills 🔁 every day when done 📅 2026-09-28\n- [x] Pills 🔁 every day when done 📅 2026-09-28 ✅ 2026-09-27');
  }

  /* 12h. CRLF notes stay CRLF through a Tasks tick: Tasks gets the line
          without its \r, and every line it returns gets it back */
  {
    let seen = null;
    const tasksPlugin = { apiV1: { executeToggleTaskDoneCommand: line => { seen = line; return '- [ ] x 🔁 every day ⏳ 2026-09-28\n- [x] x 🔁 every day ⏳ 2026-09-27 ✅ 2026-09-27'; } } };
    const app = makeApp({ 'C.md': '# A\r\n- [ ] x 🔁 every day ⏳ 2026-09-27\r\nafter\r\n' }, { 'obsidian-tasks-plugin': tasksPlugin });
    await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'C.md', line: 1, raw: '- [ ] x 🔁 every day ⏳ 2026-09-27\r' }, '2026-09-27');
    assert.strictEqual(seen, '- [ ] x 🔁 every day ⏳ 2026-09-27');
    assert.strictEqual(app.files.get('C.md'), '# A\r\n- [ ] x 🔁 every day ⏳ 2026-09-28\r\n- [x] x 🔁 every day ⏳ 2026-09-27 ✅ 2026-09-27\r\nafter\r\n');
  }

  /* 12i. without Tasks the tick says so, so the board can tell you once */
  {
    const app = makeApp({ 'Home.md': '- [ ] Call plumber' });
    const r = await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'Home.md', line: 0, raw: '- [ ] Call plumber' }, '2026-09-30');
    assert.deepStrictEqual(r, { ok: true, plain: true });
  }

  /* 12j. Nudge's own reason for a refusal comes through */
  {
    const nudge = { isOurs: () => true, path: () => 'Reminders.md', load: async () => ({ items: [] }), toggle: async () => ({ ok: false, reason: 'repeat' }) };
    const r = await makeStore({ app: makeApp({}, { 'nudge-reminders': { store: nudge } }), settings: {} })
      .tick({ source: 'nudge', path: 'Reminders.md', line: 0, raw: '- [ ] Pills 🔁 every day', group: '' }, '2026-09-30');
    assert.deepStrictEqual(r, { ok: false, reason: 'repeat' });
  }

  /* 12k. a practice already done today: ticking its promise for another
          day is refused, so that promise isn't silently lost */
  {
    const app = makeApp({
      'Rhythm/Log/2026-09-30.md': '---\nrhythm: log\ndone: [Gym]\n---\n',
      'Rhythm/Log/2026-10-02.md': '---\nrhythm: log\ndone: []\nplan: [Gym]\n---\n',
    }, rhythm);
    const r = await makeStore({ app, settings: {} }).tick({ source: 'practice', text: 'Gym', path: 'p', date: '2026-10-02' }, '2026-09-30');
    assert.deepStrictEqual(r, { ok: false, reason: 'done-today' });
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-02.md'), '---\nrhythm: log\ndone: []\nplan: [Gym]\n---\n');
  }

  console.log('store-write OK');
})().catch(e => { console.error(e); process.exit(1); });
