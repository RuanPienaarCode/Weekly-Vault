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

  /* 13. quick-add writes a Tasks line with that day's ⏳ under "## Inbox"
         in the planner note: at the end of that section, nothing else moved */
  {
    const app = makeApp({ 'Planning/Fortnight.md': '# Fortnight\n\n## Inbox\n- [ ] Earlier thing ⏳ 2026-09-29\n\n## Someday\n- [ ] Learn to sail\n' });
    const store = makeStore({ app, settings: { plannerNote: 'Planning/Fortnight.md' } });
    const r = await store.add({ text: '  Call   the plumber ', date: '2026-10-01' });
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(app.files.get('Planning/Fortnight.md'), '# Fortnight\n\n## Inbox\n- [ ] Earlier thing ⏳ 2026-09-29\n- [ ] Call the plumber ⏳ 2026-10-01\n\n## Someday\n- [ ] Learn to sail\n');
  }

  /* 13b. a planner note without an Inbox gets one at the end */
  {
    const app = makeApp({ 'Plan.md': '# My plan\nSome words.' });
    await makeStore({ app, settings: { plannerNote: 'Plan.md' } }).add({ text: 'Buy bulbs', date: '2026-10-02' });
    assert.strictEqual(app.files.get('Plan.md'), '# My plan\nSome words.\n\n## Inbox\n- [ ] Buy bulbs ⏳ 2026-10-02\n');
  }

  /* 13c. no planner note yet: created, folder and all */
  {
    const app = makeApp({});
    await makeStore({ app, settings: {} }).add({ text: 'Buy bulbs', date: '2026-10-02' });
    assert.strictEqual(app.files.get('Planning/Fortnight.md'), '# Fortnight\n\n## Inbox\n- [ ] Buy bulbs ⏳ 2026-10-02\n');
  }

  /* 13d. nothing typed: nothing written */
  {
    const app = makeApp({});
    assert.deepStrictEqual(await makeStore({ app, settings: {} }).add({ text: '   ', date: '2026-10-02' }), { ok: false, reason: 'empty' });
    assert.strictEqual(app.files.size, 0);
  }

  /* 13e. what you type is kept, Tasks fields included; the column's day
          becomes (or replaces) its ⏳; a CRLF note stays CRLF */
  {
    const app = makeApp({ 'P.md': '## Inbox\r\n- [ ] A\r\n' });
    const store = makeStore({ app, settings: { plannerNote: 'P.md' } });
    await store.add({ text: 'File tax #admin 📅 2026-10-31', date: '2026-10-02' });
    await store.add({ text: 'Moved ⏳ 2026-12-01', date: '2026-10-03' });
    assert.strictEqual(app.files.get('P.md'), '## Inbox\r\n- [ ] A\r\n- [ ] File tax #admin 📅 2026-10-31 ⏳ 2026-10-02\r\n- [ ] Moved ⏳ 2026-10-03\r\n');
  }

  /* 13f. mixed line endings: only the new line is written; every other line
          keeps its own ending */
  {
    const app = makeApp({ 'P.md': '# T\r\nline lf\nmore\r\n## Inbox\r\n- [ ] A\r\n' });
    await makeStore({ app, settings: { plannerNote: 'P.md' } }).add({ text: 'B', date: '2026-10-01' });
    assert.strictEqual(app.files.get('P.md'), '# T\r\nline lf\nmore\r\n## Inbox\r\n- [ ] A\r\n- [ ] B ⏳ 2026-10-01\r\n');
  }

  /* 13g. a "#" line inside a code fence is not a heading */
  {
    const app = makeApp({ 'P.md': '## Inbox\n- [ ] A\n```bash\n# install\nnpm i\n```\n\n## Later\n' });
    await makeStore({ app, settings: { plannerNote: 'P.md' } }).add({ text: 'New', date: '2026-10-01' });
    assert.strictEqual(app.files.get('P.md'), '## Inbox\n- [ ] A\n```bash\n# install\nnpm i\n```\n- [ ] New ⏳ 2026-10-01\n\n## Later\n');
    const fenced = makeApp({ 'Q.md': 'Intro\n```\n## Inbox\n```\n' });
    await makeStore({ app: fenced, settings: { plannerNote: 'Q.md' } }).add({ text: 'New', date: '2026-10-01' });
    assert.strictEqual(fenced.files.get('Q.md'), 'Intro\n```\n## Inbox\n```\n\n## Inbox\n- [ ] New ⏳ 2026-10-01\n');
  }

  /* 13h. the planner path is tidied: ".md" added, "./" and "/" dropped */
  {
    for (const [setting, path] of [['Planning/Fortnight', 'Planning/Fortnight.md'], ['./Planning/F.md', 'Planning/F.md'], ['/Plan.md', 'Plan.md']]) {
      const app = makeApp({});
      await makeStore({ app, settings: { plannerNote: setting } }).add({ text: 'X', date: '2026-10-01' });
      assert.deepStrictEqual([...app.files.keys()], [path], setting);
    }
  }

  /* 13i. a typed checkbox isn't doubled */
  {
    const app = makeApp({});
    const store = makeStore({ app, settings: {} });
    await store.add({ text: '- [ ] Buy milk', date: '2026-10-01' });
    await store.add({ text: '[ ] Buy eggs', date: '2026-10-01' });
    assert.strictEqual(app.files.get('Planning/Fortnight.md'), '# Fortnight\n\n## Inbox\n- [ ] Buy milk ⏳ 2026-10-01\n- [ ] Buy eggs ⏳ 2026-10-01\n');
  }

  /* 13j. the note appears between our check and our create (a second add,
          or sync): the add goes into the note that now exists */
  {
    const app = makeApp({});
    const create = app.vault.create;
    app.vault.create = async p => { await create(p, '# Theirs\n'); throw new Error('File already exists.'); };
    const r = await makeStore({ app, settings: {} }).add({ text: 'Mine', date: '2026-10-01' });
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(app.files.get('Planning/Fortnight.md'), '# Theirs\n\n## Inbox\n- [ ] Mine ⏳ 2026-10-01\n');
  }

  /* 14. park in Next week: 🛫 next Monday, ⏳ removed */
  {
    const app = makeApp({ 'H.md': '- [ ] Paint fence ⏳ 2026-10-01 🔼\n- [ ] Tidy shed 🛫 2026-10-05' });
    const store = makeStore({ app, settings: {} });
    assert.deepStrictEqual(await store.park({ source: 'tasks', path: 'H.md', line: 0, raw: '- [ ] Paint fence ⏳ 2026-10-01 🔼' }, 'nextWeek', '2026-10-05'), { ok: true });
    assert.strictEqual(app.files.get('H.md'), '- [ ] Paint fence 🔼 🛫 2026-10-05\n- [ ] Tidy shed 🛫 2026-10-05');
    /* 14b. Later: no ⏳, no 🛫 — and H.md isn't a Later source, so the
            line is tagged #later (Q36) */
    await store.park({ source: 'tasks', path: 'H.md', line: 1, raw: '- [ ] Tidy shed 🛫 2026-10-05' }, 'later');
    assert.strictEqual(app.files.get('H.md'), '- [ ] Paint fence 🔼 🛫 2026-10-05\n- [ ] Tidy shed #later');
    /* 14c. a parked card put on a day before its 🛫 loses the 🛫, so the
            line doesn't say "not before Monday" and "on Wednesday" at once */
    await store.move({ source: 'tasks', path: 'H.md', line: 0, raw: '- [ ] Paint fence 🔼 🛫 2026-10-05' }, '2026-10-01');
    assert.strictEqual(app.files.get('H.md'), '- [ ] Paint fence 🔼 ⏳ 2026-10-01\n- [ ] Tidy shed #later');
  }

  /* 14d. a 🛫 on or before the new day stays */
  {
    const app = makeApp({ 'H.md': '- [ ] Paint fence 🛫 2026-10-05' });
    await makeStore({ app, settings: {} }).move({ source: 'tasks', path: 'H.md', line: 0, raw: '- [ ] Paint fence 🛫 2026-10-05' }, '2026-10-07');
    assert.strictEqual(app.files.get('H.md'), '- [ ] Paint fence 🛫 2026-10-05 ⏳ 2026-10-07');
  }

  /* 14e. reminders, practices and events need a day (for now) */
  {
    const store = makeStore({ app: makeApp({}), settings: {} });
    for (const source of ['nudge', 'practice']) assert.deepStrictEqual(await store.park({ source, text: 'x', path: 'p' }, 'later'), { ok: false, reason: 'needs-day' });
    assert.deepStrictEqual(await store.park({ source: 'event', path: 'e' }, 'nextWeek', '2026-10-05'), { ok: false, reason: 'locked' });
  }

  /* 14f. quick-add into Next week ("any day") and Later */
  {
    const app = makeApp({});
    const store = makeStore({ app, settings: {} });
    await store.add({ text: 'Plan the trip', slot: 'nextWeek', monday: '2026-10-05' });
    await store.add({ text: 'Someday: learn Italian', slot: 'later' });
    assert.strictEqual(app.files.get('Planning/Fortnight.md'), '# Fortnight\n\n## Inbox\n- [ ] Plan the trip 🛫 2026-10-05\n- [ ] Someday: learn Italian\n');
  }

  /* 15. Later from a note Later doesn't read: dates off, #later on (Q36);
         back onto a day or into Next week: #later off */
  {
    const app = makeApp({ 'Work/Projects.md': '- [ ] Prepare slides for Friday ⏳ 2026-10-02', 'Planning/Fortnight.md': '## Inbox\n- [ ] Bread ⏳ 2026-10-02' });
    const store = makeStore({ app, settings: { laterTag: '#later' } });
    const r = await store.park({ source: 'tasks', path: 'Work/Projects.md', line: 0, raw: '- [ ] Prepare slides for Friday ⏳ 2026-10-02' }, 'later');
    assert.deepStrictEqual(r, { ok: true, tagged: true, before: '- [ ] Prepare slides for Friday ⏳ 2026-10-02', after: '- [ ] Prepare slides for Friday #later' });
    assert.strictEqual(app.files.get('Work/Projects.md'), '- [ ] Prepare slides for Friday #later');
    /* the planner note is already a Later source: no tag */
    await store.park({ source: 'tasks', path: 'Planning/Fortnight.md', line: 1, raw: '- [ ] Bread ⏳ 2026-10-02' }, 'later');
    assert.strictEqual(app.files.get('Planning/Fortnight.md'), '## Inbox\n- [ ] Bread');
    /* back onto a day */
    await store.move({ source: 'tasks', path: 'Work/Projects.md', line: 0, raw: '- [ ] Prepare slides for Friday #later' }, '2026-10-02');
    assert.strictEqual(app.files.get('Work/Projects.md'), '- [ ] Prepare slides for Friday ⏳ 2026-10-02');
    /* into Later again, then Next week */
    await store.park({ source: 'tasks', path: 'Work/Projects.md', line: 0, raw: '- [ ] Prepare slides for Friday ⏳ 2026-10-02' }, 'later');
    await store.park({ source: 'tasks', path: 'Work/Projects.md', line: 0, raw: '- [ ] Prepare slides for Friday #later' }, 'nextWeek', '2026-10-05');
    assert.strictEqual(app.files.get('Work/Projects.md'), '- [ ] Prepare slides for Friday 🛫 2026-10-05');
  }

  /* 15b. a line in an included Later folder isn't tagged */
  {
    const app = makeApp({ 'Projects/G.md': '- [ ] Dig ⏳ 2026-10-02' });
    await makeStore({ app, settings: { laterFolders: ['Projects'] } }).park({ source: 'tasks', path: 'Projects/G.md', line: 0, raw: '- [ ] Dig ⏳ 2026-10-02' }, 'later');
    assert.strictEqual(app.files.get('Projects/G.md'), '- [ ] Dig');
  }

  /* 15c. undo puts back exactly the line that was there, if it's unchanged */
  {
    const app = makeApp({ 'W.md': '- [ ] Slides #later' });
    const store = makeStore({ app, settings: {} });
    assert.deepStrictEqual(await store.revert({ path: 'W.md', line: 0 }, '- [ ] Slides #later', '- [ ] Slides ⏳ 2026-10-02'), { ok: true });
    assert.strictEqual(app.files.get('W.md'), '- [ ] Slides ⏳ 2026-10-02');
    assert.deepStrictEqual(await store.revert({ path: 'W.md', line: 0 }, '- [ ] Slides #later', 'x'), { ok: false, reason: 'changed' });
  }

  /* 15d. deadlines and parking. 📅 is never touched, so:
          - due before next Monday: Next week would hide it past its
            deadline — refused ('due-sooner');
          - already overdue, or due next week or later: Next week is fine;
          - Later: refused while it has a 📅 ('has-deadline') */
  {
    const app = makeApp({ 'Home.md': '- [ ] File tax ⏳ 2026-10-01 📅 2026-10-02\n- [ ] Licence disc 📅 2026-07-31\n- [ ] Book service 📅 2026-10-09' });
    const store = makeStore({ app, settings: {} });
    const soon = { source: 'tasks', path: 'Home.md', line: 0, raw: '- [ ] File tax ⏳ 2026-10-01 📅 2026-10-02' };
    assert.deepStrictEqual(await store.park(soon, 'nextWeek', '2026-10-05', '2026-09-30'), { ok: false, reason: 'due-sooner', due: '2026-10-02' });
    assert.deepStrictEqual(await store.park(soon, 'later', undefined, '2026-09-30'), { ok: false, reason: 'has-deadline' });
    const overdue = { source: 'tasks', path: 'Home.md', line: 1, raw: '- [ ] Licence disc 📅 2026-07-31' };
    assert.deepStrictEqual(await store.park(overdue, 'nextWeek', '2026-10-05', '2026-09-30'), { ok: true });
    const ahead = { source: 'tasks', path: 'Home.md', line: 2, raw: '- [ ] Book service 📅 2026-10-09' };
    assert.deepStrictEqual(await store.park(ahead, 'nextWeek', '2026-10-05', '2026-09-30'), { ok: true });
    assert.strictEqual(app.files.get('Home.md'), '- [ ] File tax ⏳ 2026-10-01 📅 2026-10-02\n- [ ] Licence disc 📅 2026-07-31 🛫 2026-10-05\n- [ ] Book service 📅 2026-10-09 🛫 2026-10-05');
  }

  /* 16. a Rhythm log edited in Obsidian's Properties panel (block lists):
         the list is replaced whole, never duplicated (Rhythm c3ad307) */
  {
    const app = makeApp({ 'Rhythm/Log/2026-10-02.md': '---\nrhythm: log\ndone:\n  - Read\nplan:\n  - Paint\n---\nNotes.\n' }, rhythm);
    await makeStore({ app, settings: {} }).move({ source: 'practice', text: 'Gym', path: 'p', fromTray: true }, '2026-10-02');
    const text = app.files.get('Rhythm/Log/2026-10-02.md');
    assert.strictEqual((text.match(/^plan:/gm) || []).length, 1, text);
    assert.strictEqual((text.match(/^done:/gm) || []).length, 1, text);
    const { parseFrontmatter } = require('../src/rhythm/markdown');
    assert.deepStrictEqual(parseFrontmatter(text).fm.plan, ['Paint', 'Gym']);
    assert.deepStrictEqual(parseFrontmatter(text).fm.done, ['Read']);
    assert.ok(text.endsWith('Notes.\n'), text);
  }

  console.log('store-write OK');
})().catch(e => { console.error(e); process.exit(1); });
