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
    const nudge = { isOurs: p => p === 'Reminders.md', path: () => 'Reminders.md',
      load: async () => ({ items: [{ raw: '- [ ] Phone the dentist 📅 2026-10-01 ⏰ 09:30', line: 0, group: '', due: '2026-10-01', title: 'Phone the dentist' }] }),
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
    const nudge = { isOurs: () => true, path: () => 'Reminders.md',
      load: async () => ({ items: [{ raw: '- [ ] Phone mum 📅 2026-10-01', line: 7, group: 'Work', due: '2026-10-01', title: 'Phone mum' }] }),
      setDue: async (item, due) => { calls.push(Object.assign({ due }, item)); return { ok: true }; } };
    const app = makeApp({}, { 'nudge-reminders': { store: nudge } });
    await makeStore({ app, settings: {} }).move({ source: 'nudge', path: 'Reminders.md', line: 7, raw: '- [ ] Phone mum 📅 2026-10-01', group: 'Work' }, '2026-10-09');
    assert.deepStrictEqual(calls, [{ due: '2026-10-09', raw: '- [ ] Phone mum 📅 2026-10-01', line: 7, group: 'Work' }]);
  }

  /* 11i. Nudge says it couldn't find the reminder: reported, not hidden */
  {
    const nudge = { isOurs: () => true, path: () => 'Reminders.md', setDue: async () => ({ ok: false }),
      load: async () => ({ items: [{ raw: '- [ ] Gone', line: 0, group: '', due: '2026-10-01', title: 'Gone' }] }) };
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

  /* 12b. without Tasks: a plain tick — [x] and the ✅ date (B8: without it a
          slipped card ticked today had no day to sit on and left the board),
          nothing else; a CRLF note keeps its \r */
  {
    const app = makeApp({ 'Home.md': '- [ ] Call plumber ⏳ 2026-10-01\n- [ ] Pay rates 📅 2026-10-02 ^abc\r\n' });
    const store = makeStore({ app, settings: {} });
    await store.tick({ source: 'tasks', path: 'Home.md', line: 0, raw: '- [ ] Call plumber ⏳ 2026-10-01' }, '2026-09-30');
    await store.tick({ source: 'tasks', path: 'Home.md', line: 1, raw: '- [ ] Pay rates 📅 2026-10-02 ^abc\r' }, '2026-09-30');
    assert.strictEqual(app.files.get('Home.md'), '- [x] Call plumber ⏳ 2026-10-01 ✅ 2026-09-30\n- [x] Pay rates 📅 2026-10-02 ✅ 2026-09-30 ^abc\r\n');
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
    const nudge = { isOurs: () => true, path: () => 'Reminders.md',
      load: async () => ({ items: [{ raw: '- [ ] Pay rates 📅 2026-10-01', line: 3, group: 'Home', due: '2026-10-01', title: 'Pay rates' }] }),
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
    const nudge = { isOurs: () => true, path: () => 'Reminders.md', toggle: async () => ({ ok: false, reason: 'repeat' }),
      load: async () => ({ items: [{ raw: '- [ ] Pills 🔁 every day', line: 0, group: '', due: '2026-10-01', title: 'Pills' }] }) };
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
    assert.deepStrictEqual(r, { ok: true, raw: '- [ ] Call the plumber ⏳ 2026-10-01' });
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
    assert.deepStrictEqual(r, { ok: true, raw: '- [ ] Mine ⏳ 2026-10-01' });
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

  /* 17. Drop marks a to-do cancelled — the box only — and says what it was,
         so Undo can put it back; reminders, practices and events refuse */
  {
    const app = makeApp({ 'H.md': '# H\r\n- [ ] Clean gutters ⏳ 2026-10-01\r\n' });
    const store = makeStore({ app, settings: {} });
    const card = { source: 'tasks', path: 'H.md', line: 1, raw: '- [ ] Clean gutters ⏳ 2026-10-01\r' };
    const r = await store.drop(card, '2026-09-30');
    /* cancelled the way Tasks cancels: [-] and a ❌ date */
    assert.deepStrictEqual(r, { ok: true, before: '- [ ] Clean gutters ⏳ 2026-10-01\r', after: '- [-] Clean gutters ⏳ 2026-10-01 ❌ 2026-09-30\r' });
    assert.strictEqual(app.files.get('H.md'), '# H\r\n- [-] Clean gutters ⏳ 2026-10-01 ❌ 2026-09-30\r\n');
    await store.revert(card, r.after, r.before);
    assert.strictEqual(app.files.get('H.md'), '# H\r\n- [ ] Clean gutters ⏳ 2026-10-01\r\n');
    for (const source of ['nudge', 'practice']) assert.deepStrictEqual(await store.drop({ source, path: 'p', text: 'x' }), { ok: false, reason: 'not-droppable' });
    assert.deepStrictEqual(await store.drop({ source: 'event', path: 'e' }), { ok: false, reason: 'locked' });
    /* a 🔁 repeat would end for good: refused */
    const app2 = makeApp({ 'B.md': '- [ ] Bins out 🔁 every week ⏳ 2026-09-28' });
    assert.deepStrictEqual(await makeStore({ app: app2, settings: {} }).drop({ source: 'tasks', path: 'B.md', line: 0, raw: '- [ ] Bins out 🔁 every week ⏳ 2026-09-28' }, '2026-09-30'), { ok: false, reason: 'repeats' });
    assert.strictEqual(app2.files.get('B.md'), '- [ ] Bins out 🔁 every week ⏳ 2026-09-28');
  }

  /* 17b. a done card can't be moved or parked (its plan date is history) */
  {
    const app = makeApp({ 'H.md': '- [x] Called plumber ⏳ 2026-09-29 ✅ 2026-09-28' });
    const store = makeStore({ app, settings: {} });
    const done = { source: 'tasks', path: 'H.md', line: 0, raw: '- [x] Called plumber ⏳ 2026-09-29 ✅ 2026-09-28', done: true };
    assert.deepStrictEqual(await store.move(done, '2026-10-01'), { ok: false, reason: 'done' });
    assert.deepStrictEqual(await store.park(done, 'nextWeek', '2026-10-05', '2026-09-30'), { ok: false, reason: 'done' });
    assert.strictEqual(app.files.get('H.md'), '- [x] Called plumber ⏳ 2026-09-29 ✅ 2026-09-28');
  }

  /* 18. the review is APPENDED to the day's log — nothing above it moves */
  {
    const parts = { done: ['Call plumber'], moved: [['Fix the gate', 'Tue 29 Sep']], dropped: [], left: 0, reflection: 'steady' };
    const app = makeApp({ 'Rhythm/Log/2026-09-30.md': '---\nrhythm: log\ndone: [Gym]\n---\nWent well.' }, rhythm);
    const store = makeStore({ app, settings: {} });
    const r = await store.writeReview('2026-09-30', parts, '21:40');
    assert.deepStrictEqual(r, { ok: true, path: 'Rhythm/Log/2026-09-30.md' });
    assert.strictEqual(app.files.get('Rhythm/Log/2026-09-30.md'),
      '---\nrhythm: log\ndone: [Gym]\n---\nWent well.\n\n## Review\n- Done: 1 — Call plumber\n- Moved: 1 — Fix the gate → Tue 29 Sep\n- Reflection: steady\n');
    /* 18b. a second review the same evening gets its time in the heading */
    await store.writeReview('2026-09-30', { done: [], moved: [], dropped: ['Book the vet'], left: 0, reflection: '' }, '22:05');
    assert.ok(app.files.get('Rhythm/Log/2026-09-30.md').endsWith('- Reflection: steady\n\n## Review · 22:05\n- Dropped: 1 — Book the vet\n'));
  }

  /* 18c. no log note yet: created the way Rhythm would, then the review */
  {
    const app = makeApp({ 'Rhythm/Practices/Gym.md': 'x' }, rhythm);
    await makeStore({ app, settings: {} }).writeReview('2026-09-30', { done: [], moved: [], dropped: [], left: 0, reflection: '' }, '21:00');
    /* exactly as Rhythm creates a day's log (done: []) */
    assert.strictEqual(app.files.get('Rhythm/Log/2026-09-30.md'), '---\nrhythm: log\ndone: []\n---\n\n## Review\n- Nothing left open.\n');
  }

  /* 18d. another folder (settings.reviewFolder): a plain note; a CRLF note
          gets a CRLF review */
  {
    const app = makeApp({ 'Journal/2026-09-30.md': '# Tue\r\nMorning pages.\r\n' });
    await makeStore({ app, settings: { reviewFolder: 'Journal' } }).writeReview('2026-09-30', { done: ['A'], moved: [], dropped: [], left: 2, reflection: '' }, '21:00');
    assert.strictEqual(app.files.get('Journal/2026-09-30.md'), '# Tue\r\nMorning pages.\r\n\r\n## Review\r\n- Done: 1 — A\r\n- Left open: 2\r\n');
    const empty = makeApp({});
    await makeStore({ app: empty, settings: { reviewFolder: 'Journal/' } }).writeReview('2026-09-30', { done: [], moved: [], dropped: [], left: 0, reflection: '' }, '21:00');
    assert.strictEqual(empty.files.get('Journal/2026-09-30.md'), '## Review\n- Nothing left open.\n');
  }

  /* 18e. the folder is tidied like every other path setting; a "folder"
          that is really a note is refused BEFORE anything is written */
  {
    const app = makeApp({ 'Journal/2026-09-30.md': 'x' });
    const store = makeStore({ app, settings: { reviewFolder: './Journal//' } });
    assert.deepStrictEqual(await store.reviewTarget('2026-09-30'), { ok: true, path: 'Journal/2026-09-30.md', heading: '## Review' });
    const bad = makeApp({ 'Journal/Day.md': 'x' });
    assert.deepStrictEqual(await makeStore({ app: bad, settings: { reviewFolder: 'Journal/Day.md' } }).reviewTarget('2026-09-30'), { ok: false, reason: 'folder-is-note' });
    /* the heading the preview shows is the heading that gets written */
    const twice = makeApp({ 'Journal/2026-09-30.md': '## Review\n- Nothing left open.\n' });
    assert.deepStrictEqual(await makeStore({ app: twice, settings: { reviewFolder: 'Journal' } }).reviewTarget('2026-09-30', '22:05'), { ok: true, path: 'Journal/2026-09-30.md', heading: '## Review · 22:05' });
  }

  /* 19. a line that only SHIFTED (a 🔁 tick inserted its next occurrence
         above it, or a sync added a line) is still found — when the card was
         the one identical line in its note at load (`unique`) and is still the
         one identical line now; two identical lines stay refused */
  {
    const app = makeApp({ 'H.md': '- [ ] New occurrence\n- [ ] A 🔁 every day\n- [ ] B ⏳ 2026-09-30' });
    const store = makeStore({ app, settings: {} });
    assert.deepStrictEqual(await store.move({ source: 'tasks', path: 'H.md', line: 1, raw: '- [ ] B ⏳ 2026-09-30', unique: true }, '2026-10-01'), { ok: true });
    assert.strictEqual(app.files.get('H.md'), '- [ ] New occurrence\n- [ ] A 🔁 every day\n- [ ] B ⏳ 2026-10-01');
    const dup = makeApp({ 'D.md': '- [ ] same\nx\n- [ ] same' });
    assert.deepStrictEqual(await makeStore({ app: dup, settings: {} }).move({ source: 'tasks', path: 'D.md', line: 1, raw: '- [ ] same', unique: true }, '2026-10-01'), { ok: false, reason: 'changed' });
    assert.strictEqual(dup.files.get('D.md'), '- [ ] same\nx\n- [ ] same');
  }

  /* 19b. A1: a card that was NOT unique at load is never relocated. Trips.md
          has the same to-do under Cape Town and under Durban; the Cape Town
          one is ticked elsewhere, so its line is gone — moving its card must
          not edit the Durban twin that happens to be the only one left. */
  {
    const app = makeApp({ 'Trips.md': '# Cape Town\n- [ ] Book hotel\n# Durban\n- [ ] Book hotel\n' });
    const store = makeStore({ app, settings: {} });
    const cards = (await store.load()).filter(t => t.source === 'tasks');
    assert.deepStrictEqual(cards.map(c => [c.line, c.unique]), [[1, false], [3, false]]);
    const capeTown = cards[0];
    app.files.set('Trips.md', '# Cape Town\n- [x] Book hotel ✅ 2026-10-06\n# Durban\n- [ ] Book hotel\n');
    assert.deepStrictEqual(await store.move(capeTown, '2026-10-09'), { ok: false, reason: 'changed' });
    assert.deepStrictEqual(await store.tick(capeTown, '2026-10-07'), { ok: false, reason: 'changed' });
    assert.deepStrictEqual(await store.drop(capeTown, '2026-10-07'), { ok: false, reason: 'changed' });
    assert.strictEqual(app.files.get('Trips.md'), '# Cape Town\n- [x] Book hotel ✅ 2026-10-06\n# Durban\n- [ ] Book hotel\n');
  }

  /* 19c. a card from load() that was unique follows its line when a line is
          inserted above it, and Undo follows it too */
  {
    const app = makeApp({ 'W.md': '- [ ] Slides ⏳ 2026-10-02\n- [ ] Other\n' });
    const store = makeStore({ app, settings: {} });
    const card = (await store.load()).find(t => t.line === 0);
    assert.strictEqual(card.unique, true);
    app.files.set('W.md', '- [ ] Inserted above\n- [ ] Slides ⏳ 2026-10-02\n- [ ] Other\n');
    const r = await store.drop(card, '2026-10-07');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(app.files.get('W.md'), '- [ ] Inserted above\n- [-] Slides ⏳ 2026-10-02 ❌ 2026-10-07\n- [ ] Other\n');
    app.files.set('W.md', '- [ ] Another above\n- [ ] Inserted above\n- [-] Slides ⏳ 2026-10-02 ❌ 2026-10-07\n- [ ] Other\n');
    assert.deepStrictEqual(await store.revert(card, r.after, r.before), { ok: true });
    assert.strictEqual(app.files.get('W.md'), '- [ ] Another above\n- [ ] Inserted above\n- [ ] Slides ⏳ 2026-10-02\n- [ ] Other\n');
  }

  /* ---- audit 7 Oct 2026, lane S ---- */

  /* 20. A2: a Nudge card is only written through if Nudge still holds that
         exact line in that list. Nudge finds a reminder again by its TITLE
         when its line is gone, so a stale tick of a 🔁 reminder (ticked on
         the phone since) would complete the NEXT occurrence. Refused before
         Nudge is asked to write anything. */
  {
    const calls = [];
    let items = [{ raw: '- [ ] Pills 🔁 every day 📅 2026-10-09 ⏰ 08:00', line: 4, group: 'Home', due: '2026-10-09', title: 'Pills' }];
    const nudge = { isOurs: () => true, path: () => 'Reminders.md', load: async () => ({ items }),
      toggle: async item => { calls.push(['toggle', item.raw]); return { ok: true }; },
      setDue: async (item, due) => { calls.push(['setDue', item.raw, due]); return { ok: true }; } };
    const store = makeStore({ app: makeApp({}, { 'nudge-reminders': { store: nudge } }), settings: {} });
    /* last night's card: Nudge has since rolled the series on to the 9th */
    const stale = { source: 'nudge', path: 'Reminders.md', line: 4, raw: '- [ ] Pills 🔁 every day 📅 2026-10-08 ⏰ 08:00', group: 'Home' };
    assert.deepStrictEqual(await store.tick(stale, '2026-10-08'), { ok: false, reason: 'changed' });
    assert.deepStrictEqual(await store.move(stale, '2026-10-10'), { ok: false, reason: 'changed' });
    assert.deepStrictEqual(calls, []);
    /* the current card goes through */
    const fresh = Object.assign({}, stale, { raw: items[0].raw });
    assert.deepStrictEqual(await store.tick(fresh, '2026-10-09'), { ok: true });
    assert.deepStrictEqual(await store.move(fresh, '2026-10-10'), { ok: true });
    assert.deepStrictEqual(calls, [['toggle', items[0].raw], ['setDue', items[0].raw, '2026-10-10']]);
    /* the same line in another list is not this reminder */
    calls.length = 0;
    assert.deepStrictEqual(await store.tick(Object.assign({}, fresh, { group: 'Work' }), '2026-10-09'), { ok: false, reason: 'changed' });
    /* a line that only moved (one match) is fine… */
    assert.deepStrictEqual(await store.tick(Object.assign({}, fresh, { line: 1 }), '2026-10-09'), { ok: true });
    /* …but two identical reminders in a list: only a card whose line still matches is certain */
    items = [Object.assign({}, items[0], { line: 2 }), Object.assign({}, items[0], { line: 5 })];
    assert.deepStrictEqual(await store.tick(Object.assign({}, fresh, { line: 5 }), '2026-10-09'), { ok: true });
    assert.deepStrictEqual(await store.tick(Object.assign({}, fresh, { line: 3 }), '2026-10-09'), { ok: false, reason: 'changed' });
    assert.deepStrictEqual(calls, [['toggle', items[0].raw], ['toggle', items[0].raw]]);
    /* a Nudge that cannot be read: nothing is written */
    nudge.load = async () => { throw new Error('boom'); };
    assert.deepStrictEqual(await store.tick(fresh, '2026-10-09'), { ok: false, reason: 'changed' });
    assert.strictEqual(calls.length, 2);
  }

  /* 20b. A5: Nudge can only set 📅, so a reminder with no 📅 (only ⏳) isn't
          moved — setDue would give it a deadline nobody set while the ⏳
          stayed on the old day. It can still be ticked. */
  {
    const calls = [];
    const nudge = { isOurs: () => true, path: () => 'Reminders.md',
      load: async () => ({ items: [{ raw: '- [ ] Plan trip ⏳ 2026-10-08', line: 0, group: '', due: '', scheduled: '2026-10-08', title: 'Plan trip' }] }),
      setDue: async () => { calls.push('setDue'); return { ok: true }; }, toggle: async () => { calls.push('toggle'); return { ok: true }; } };
    const store = makeStore({ app: makeApp({}, { 'nudge-reminders': { store: nudge } }), settings: {} });
    const card = { source: 'nudge', path: 'Reminders.md', line: 0, raw: '- [ ] Plan trip ⏳ 2026-10-08', group: '' };
    assert.deepStrictEqual(await store.move(card, '2026-10-09'), { ok: false, reason: 'nudge-no-due' });
    assert.deepStrictEqual(await store.tick(card, '2026-10-08'), { ok: true });
    assert.deepStrictEqual(calls, ['toggle']);
  }

  /* 21. A3: Tasks' answer is checked before it is written. Its toggle falls
         back to a crude replace for a line it can't read as a task (a global
         filter, a tab), which can leave the box open or dirty — a result with
         no done line in it is refused ('not-done') and nothing is written. */
  {
    const run = async (out, text, raw = '- [ ] Send invoice ⏳ 2026-10-07') => {
      const app = makeApp({ 'Work.md': text }, { 'obsidian-tasks-plugin': { apiV1: { executeToggleTaskDoneCommand: () => out } } });
      const r = await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'Work.md', line: 0, raw }, '2026-10-07');
      return [r, app.files.get('Work.md')];
    }
    const text = '- [ ] Send invoice ⏳ 2026-10-07\n- [ ] Next';
    assert.deepStrictEqual(await run('- [ ]\t[ ] Send invoice ⏳ 2026-10-07', text), [{ ok: false, reason: 'not-done' }, text]);
    assert.deepStrictEqual(await run('- [/] Send invoice ⏳ 2026-10-07', text), [{ ok: false, reason: 'not-done' }, text]);
    assert.deepStrictEqual(await run('- [-] Send invoice ⏳ 2026-10-07', text), [{ ok: false, reason: 'not-done' }, text]);
    assert.deepStrictEqual(await run(undefined, text), [{ ok: false, reason: 'not-done' }, text]);
    assert.deepStrictEqual(await run('Send invoice', text), [{ ok: false, reason: 'not-done' }, text]);
    /* a done line anywhere in the answer (a 🔁's next occurrence comes first) is fine */
    assert.deepStrictEqual(await run('- [ ] Send invoice ⏳ 2026-10-14\n- [x] Send invoice ⏳ 2026-10-07 ✅ 2026-10-07', text),
      [{ ok: true }, '- [ ] Send invoice ⏳ 2026-10-14\n- [x] Send invoice ⏳ 2026-10-07 ✅ 2026-10-07\n- [ ] Next']);
  }

  /* 21b. A6: Tasks answers "" for a 🏁 delete to-do — the line goes, and no
          blank line is left behind (CRLF notes included) */
  {
    const run = async (text, line, raw) => {
      const app = makeApp({ 'Work.md': text }, { 'obsidian-tasks-plugin': { apiV1: { executeToggleTaskDoneCommand: () => '' } } });
      const r = await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'Work.md', line, raw }, '2026-10-07');
      return [r, app.files.get('Work.md')];
    };
    assert.deepStrictEqual(await run('- [ ] a ⏳ 2026-10-07\n- [ ] Throwaway 🏁 delete ⏳ 2026-10-07\n- [ ] c ⏳ 2026-10-07\n', 1, '- [ ] Throwaway 🏁 delete ⏳ 2026-10-07'),
      [{ ok: true }, '- [ ] a ⏳ 2026-10-07\n- [ ] c ⏳ 2026-10-07\n']);
    assert.deepStrictEqual(await run('# A\r\n- [ ] x 🏁 delete\r\nafter\r\n', 1, '- [ ] x 🏁 delete\r'), [{ ok: true }, '# A\r\nafter\r\n']);
  }

  /* 22. A7: quick-add keeps a CRLF note CRLF even when the Inbox's last line
         (or the whole note) has no line ending, and a BOM in front of the
         heading doesn't hide it */
  {
    const add = async (text, extra = {}) => {
      const app = makeApp({ 'Planning/Fortnight.md': text });
      const r = await makeStore({ app, settings: {} }).add(Object.assign({ text: 'b', date: '2026-10-07' }, extra));
      return [r, app.files.get('Planning/Fortnight.md')];
    };
    /* CRLF, Inbox is the last thing and the file has no final newline: the new line is the new last line */
    assert.deepStrictEqual(await add('# Fortnight\r\n\r\n## Inbox\r\n- [ ] a'),
      [{ ok: true, raw: '- [ ] b ⏳ 2026-10-07' }, '# Fortnight\r\n\r\n## Inbox\r\n- [ ] a\r\n- [ ] b ⏳ 2026-10-07']);
    /* CRLF, no Inbox yet, last line unterminated */
    assert.deepStrictEqual(await add('# Fortnight\r\nnotes'),
      [{ ok: true, raw: '- [ ] b ⏳ 2026-10-07\r' }, '# Fortnight\r\nnotes\r\n\r\n## Inbox\r\n- [ ] b ⏳ 2026-10-07\r\n']);
    /* LF stays LF, with and without a final newline */
    assert.deepStrictEqual(await add('x\n## Inbox\n- [ ] a'), [{ ok: true, raw: '- [ ] b ⏳ 2026-10-07' }, 'x\n## Inbox\n- [ ] a\n- [ ] b ⏳ 2026-10-07']);
    /* a BOM before the heading: the Inbox is found, and the BOM stays where it was */
    assert.deepStrictEqual(await add('﻿## Inbox\n- [ ] a ⏳ 2026-10-07\n\n## Notes\nx\n'),
      [{ ok: true, raw: '- [ ] b ⏳ 2026-10-07' }, '﻿## Inbox\n- [ ] a ⏳ 2026-10-07\n- [ ] b ⏳ 2026-10-07\n\n## Notes\nx\n']);
    assert.deepStrictEqual(await add('﻿## Inbox\r\n- [ ] a\r\n'),
      [{ ok: true, raw: '- [ ] b ⏳ 2026-10-07\r' }, '﻿## Inbox\r\n- [ ] a\r\n- [ ] b ⏳ 2026-10-07\r\n']);
    /* a BOM and no Inbox: one is added after, the BOM still first */
    assert.deepStrictEqual(await add('﻿# Plan\nx\n'),
      [{ ok: true, raw: '- [ ] b ⏳ 2026-10-07' }, '﻿# Plan\nx\n\n## Inbox\n- [ ] b ⏳ 2026-10-07\n']);
    /* an "## Inbox" inside front matter is not the Inbox */
    assert.deepStrictEqual(await add('---\n## Inbox\n---\nbody\n'),
      [{ ok: true, raw: '- [ ] b ⏳ 2026-10-07' }, '---\n## Inbox\n---\nbody\n\n## Inbox\n- [ ] b ⏳ 2026-10-07\n']);
  }

  /* 22b. F3/contract 5: add says exactly what it wrote — including the \r of a
          CRLF note, so the board can look for that very raw line */
  {
    const app = makeApp({ 'P.md': '## Inbox\r\n- [ ] A\r\n' });
    const store = makeStore({ app, settings: { plannerNote: 'P.md' } });
    assert.deepStrictEqual(await store.add({ text: 'File tax 📅 2026-10-31', date: '2026-10-02' }), { ok: true, raw: '- [ ] File tax 📅 2026-10-31 ⏳ 2026-10-02\r' });
    const fresh = makeApp({});
    assert.deepStrictEqual(await makeStore({ app: fresh, settings: {} }).add({ text: 'Plan the trip', slot: 'nextWeek', monday: '2026-10-12' }), { ok: true, raw: '- [ ] Plan the trip 🛫 2026-10-12' });
    assert.deepStrictEqual(await makeStore({ app: fresh, settings: {} }).add({ text: '   ', date: '2026-10-02' }), { ok: false, reason: 'empty' });
    /* and the line it says is the line load() then reads back */
    const back = (await makeStore({ app: fresh, settings: {} }).load()).map(t => t.raw);
    assert.deepStrictEqual(back, ['- [ ] Plan the trip 🛫 2026-10-12']);
  }

  /* 23. A8: a practice already DONE on a day can't be promised to that day —
         it would sit in both lists and Rhythm would key two cards the same.
         Refused from the tray and between days; the old day keeps its promise. */
  {
    const files = () => ({
      'Rhythm/Log/2026-10-01.md': '---\nrhythm: log\ndone: [Gym]\n---\n',
      'Rhythm/Log/2026-10-02.md': '---\nrhythm: log\nplan: [Gym]\n---\n',
      'Rhythm/Log/2026-10-03.md': '---\nrhythm: log\ndone:\n  - Gym\n---\n',
    });
    const app = makeApp(files(), rhythm);
    const store = makeStore({ app, settings: {} });
    assert.deepStrictEqual(await store.move({ source: 'practice', text: 'Gym', path: 'p', fromTray: true }, '2026-10-01'), { ok: false, reason: 'done-that-day' });
    assert.deepStrictEqual(await store.move({ source: 'practice', text: 'Gym', path: 'p', date: '2026-10-02' }, '2026-10-01'), { ok: false, reason: 'done-that-day' });
    assert.deepStrictEqual(await store.move({ source: 'practice', text: 'Gym', path: 'p', fromTray: true }, '2026-10-03'), { ok: false, reason: 'done-that-day' });
    for (const [path, text] of Object.entries(files())) assert.strictEqual(app.files.get(path), text, path);
    /* another practice, or the same one on a day it isn't done: fine */
    assert.deepStrictEqual(await store.move({ source: 'practice', text: 'Paint', path: 'p', fromTray: true }, '2026-10-01'), { ok: true });
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-01.md'), '---\nrhythm: log\ndone: [Gym]\nplan: [Paint]\n---\n');
    assert.deepStrictEqual(await store.move({ source: 'practice', text: 'Gym', path: 'p', date: '2026-10-02' }, '2026-10-04'), { ok: true });
    assert.strictEqual(app.files.get('Rhythm/Log/2026-10-04.md'), '---\nrhythm: log\ndone: []\nplan: [Gym]\n---\n');
  }

  /* 24. A9: the review goes to Rhythm's log only when Rhythm's folder is
         really there. Rhythm switched on but never set up: Reviews/, and no
         Rhythm folder is made behind its back (that would hide its setup). */
  {
    const parts = { done: [], moved: [], dropped: [], left: 0, reflection: '' };
    const app = makeApp({ 'Home.md': 'x' }, rhythm);
    const store = makeStore({ app, settings: {} });
    assert.deepStrictEqual(await store.reviewTarget('2026-09-30', '21:00'), { ok: true, path: 'Reviews/2026-09-30.md', heading: '## Review' });
    assert.deepStrictEqual(await store.writeReview('2026-09-30', parts, '21:00'), { ok: true, path: 'Reviews/2026-09-30.md' });
    assert.strictEqual(app.files.get('Reviews/2026-09-30.md'), '## Review\n- Nothing left open.\n');
    assert.strictEqual(app.vault.getFolderByPath('Rhythm'), null);
    /* with the folder there, as before */
    const set = makeApp({ 'Rhythm/Areas/Body.md': '---\nrhythm: area\n---\n' }, rhythm);
    assert.deepStrictEqual(await makeStore({ app: set, settings: {} }).reviewTarget('2026-09-30', '21:00'), { ok: true, path: 'Rhythm/Log/2026-09-30.md', heading: '## Review' });
    /* and the setting wins either way */
    assert.deepStrictEqual(await makeStore({ app: set, settings: { reviewFolder: 'Journal' } }).reviewTarget('2026-09-30', '21:00'), { ok: true, path: 'Journal/2026-09-30.md', heading: '## Review' });
  }

  /* 25. A10: a folder that appears between our check and our createFolder
         (sync, a second add) is not an error; a real failure still is */
  {
    const racy = app => { const orig = app.vault.createFolder; app.vault.createFolder = async p => { await orig(p); throw new Error('Folder already exists.'); }; return app; };
    const a = racy(makeApp({}));
    assert.deepStrictEqual(await makeStore({ app: a, settings: {} }).add({ text: 'X', date: '2026-10-01' }), { ok: true, raw: '- [ ] X ⏳ 2026-10-01' });
    assert.strictEqual(a.files.get('Planning/Fortnight.md'), '# Fortnight\n\n## Inbox\n- [ ] X ⏳ 2026-10-01\n');
    const b = racy(makeApp({}, rhythm));
    assert.deepStrictEqual(await makeStore({ app: b, settings: {} }).move({ source: 'practice', text: 'Gym', path: 'p', fromTray: true }, '2026-10-01'), { ok: true });
    assert.strictEqual(b.files.get('Rhythm/Log/2026-10-01.md'), '---\nrhythm: log\ndone: []\nplan: [Gym]\n---\n');
    const c = racy(makeApp({}));
    assert.deepStrictEqual(await makeStore({ app: c, settings: {} }).writeReview('2026-09-30', { done: [], moved: [], dropped: [], left: 0, reflection: '' }, '21:00'), { ok: true, path: 'Reviews/2026-09-30.md' });
    const broken = makeApp({});
    broken.vault.createFolder = async () => { throw new Error('EACCES'); };
    await assert.rejects(makeStore({ app: broken, settings: {} }).add({ text: 'X', date: '2026-10-01' }), /EACCES/);
  }

  /* 25b. the stand-in itself behaves as Obsidian does where it matters here */
  {
    const app = makeApp({ 'A.md': 'x', 'F/B.md': 'y' });
    await assert.rejects(app.vault.create('A.md', 'z'), /already exists/);
    await assert.rejects(app.vault.createFolder('F'), /already exists/);
    await app.vault.createFolder('G');
    await assert.rejects(app.vault.createFolder('G'), /already exists/);
  }

  /* 26. F1/contract 4: a 🔁 to-do can't go to Later — its ⏳ would be stripped
         and Tasks needs a date on a repeat. Next week (🛫) is fine. */
  {
    const app = makeApp({ 'H.md': '- [ ] Take the bins out ⏳ 2026-10-07 🔁 every week\n- [ ] Pills 🔁 every day 📅 2026-09-01' });
    const store = makeStore({ app, settings: {} });
    const bins = { source: 'tasks', path: 'H.md', line: 0, raw: '- [ ] Take the bins out ⏳ 2026-10-07 🔁 every week' };
    assert.deepStrictEqual(await store.park(bins, 'later', undefined, '2026-10-07'), { ok: false, reason: 'repeats' });
    assert.deepStrictEqual(await store.park({ source: 'tasks', path: 'H.md', line: 1, raw: '- [ ] Pills 🔁 every day 📅 2026-09-01' }, 'later', undefined, '2026-10-07'), { ok: false, reason: 'repeats' });
    assert.strictEqual(app.files.get('H.md'), '- [ ] Take the bins out ⏳ 2026-10-07 🔁 every week\n- [ ] Pills 🔁 every day 📅 2026-09-01');
    assert.deepStrictEqual(await store.park(bins, 'nextWeek', '2026-10-12', '2026-10-07'), { ok: true });
    assert.strictEqual(app.files.get('H.md'), '- [ ] Take the bins out 🔁 every week 🛫 2026-10-12\n- [ ] Pills 🔁 every day 📅 2026-09-01');
  }

  /* 27. an editLine that Tasks answers with several lines still replaces just
         the one (unchanged), and a tick with no `today` still dates itself */
  {
    const app = makeApp({ 'H.md': '- [ ] Call plumber' });
    await makeStore({ app, settings: {} }).tick({ source: 'tasks', path: 'H.md', line: 0, raw: '- [ ] Call plumber' });
    assert.ok(/^- \[x\] Call plumber ✅ \d{4}-\d{2}-\d{2}$/.test(app.files.get('H.md')), app.files.get('H.md'));
  }

  console.log('store-write OK');
})().catch(e => { console.error(e); process.exit(1); });
