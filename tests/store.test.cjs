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
    const r = await makeStore({ app, settings: {} }).loadRhythm('2026-09-30');
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
    const r = await makeStore({ app, settings: {} }).loadRhythm('2026-09-30');
    assert.deepStrictEqual(r.practices.map(p => p.name), ['Gym']);
    assert.strictEqual(r.weekStart, 0);
  }

  /* ---- audit 7 Oct 2026, lane S ---- */

  /* 11. C11/G6: load reads each task note's TEXT and finds the task lines
         itself. The metadata cache only says WHICH notes to read — a cache
         that lags a write (its line numbers from before a line was inserted)
         can't put a card on the wrong line. */
  {
    const app = makeApp({ 'Home.md': '# Home\n## Someday\n- [ ] Call plumber ⏳ 2026-10-01\n- [ ] File tax' });
    const fresh = app.metadataCache.getFileCache;
    /* the cache still says: one task, on line 1 (where "## Someday" is now) */
    app.metadataCache.getFileCache = f => (f.path === 'Home.md' ? { listItems: [{ task: ' ', position: { start: { line: 1 } } }] } : fresh(f));
    const got = (await makeStore({ app, settings: {} }).load()).map(t => [t.path, t.line, t.raw]);
    assert.deepStrictEqual(got, [['Home.md', 2, '- [ ] Call plumber ⏳ 2026-10-01'], ['Home.md', 3, '- [ ] File tax']]);
  }

  /* 11b. what Obsidian doesn't count isn't a card: fenced code, front matter,
          "- [ ]x" (A10); a tab after the marker, which Tasks can't edit (A3) */
  {
    const app = makeApp({
      'Notes.md': '---\ntags: [a]\n---\n```\n- [ ] example ⏳ 2026-10-01\n```\n- [ ]x not a task\n-\t[ ] tabbed\n- [ ] real ⏳ 2026-10-02\r\n',
    });
    const got = (await makeStore({ app, settings: {} }).load()).map(t => [t.line, t.raw]);
    assert.deepStrictEqual(got, [[8, '- [ ] real ⏳ 2026-10-02\r']]);
  }

  /* 11c. contract 1: a card is `unique` when its exact line occurs once in
          its note — twins (the same to-do under two headings) are not, and a
          twin inside a code fence still counts: a write that has to find the
          line again would see it */
  {
    const app = makeApp({
      'Trips.md': '# Cape Town\n- [ ] Book hotel\n# Durban\n- [ ] Book hotel\n- [ ] Pack\n',
      'Fence.md': '- [ ] A\n```\n- [ ] A\n```\n- [ ] B\r\n',
    });
    const got = (await makeStore({ app, settings: {} }).load()).map(t => [t.path, t.line, t.unique]);
    assert.deepStrictEqual(got, [['Trips.md', 1, false], ['Trips.md', 3, false], ['Trips.md', 4, true], ['Fence.md', 0, false], ['Fence.md', 4, true]]);
  }

  /* 11d. A4: with a Tasks global filter, only lines containing it are tasks
          to Tasks — the rest would be written by Tasks' crude fallback, so
          they are not offered. No filter, no data.json, or a read that fails:
          every line. */
  {
    const files = { 'A.md': '- [ ] Buy milk #task ⏳ 2026-10-01\n- [ ] Idle thought\n- [x] Done #task' };
    const withFilter = makeApp(files, { 'obsidian-tasks-plugin': { loadData: async () => ({ globalFilter: '#task' }) } });
    assert.deepStrictEqual((await makeStore({ app: withFilter, settings: {} }).load()).map(t => t.line), [0, 2]);
    for (const loadData of [async () => ({ globalFilter: '' }), async () => null, async () => { throw new Error('no file'); }, undefined]) {
      const app = makeApp(files, { 'obsidian-tasks-plugin': { loadData } });
      assert.deepStrictEqual((await makeStore({ app, settings: {} }).load()).map(t => t.line), [0, 1, 2]);
    }
  }

  /* 11e. G5: the notes are read together, not one after another — and the
          cards still come out in the vault's note order, however the reads
          finish */
  {
    const app = makeApp({ 'A.md': '- [ ] a', 'B.md': '- [ ] b', 'C.md': '- [ ] c' });
    const wait = { 'A.md': 30, 'B.md': 15, 'C.md': 1 };
    let inFlight = 0; let most = 0;
    app.vault.cachedRead = async f => {
      inFlight++; most = Math.max(most, inFlight);
      await new Promise(r => setTimeout(r, wait[f.path]));
      inFlight--;
      return app.files.get(f.path);
    };
    assert.deepStrictEqual((await makeStore({ app, settings: {} }).load()).map(t => t.path), ['A.md', 'B.md', 'C.md']);
    assert.strictEqual(most, 3);
  }

  /* 11f. the planner note is always read — a quick-add into a note the cache
          hasn't indexed yet must show on the very next board — while another
          note with no tasks in the cache is not */
  {
    const app = makeApp({ 'Planning/Fortnight.md': '# Fortnight\n\n## Inbox\n- [ ] New ⏳ 2026-10-07', 'Other.md': '- [ ] Unindexed' });
    app.metadataCache.getFileCache = () => ({});
    const got = (await makeStore({ app, settings: {} }).load()).map(t => [t.path, t.line]);
    assert.deepStrictEqual(got, [['Planning/Fortnight.md', 3]]);
    assert.deepStrictEqual(app.reads, ['Planning/Fortnight.md']);
  }

  /* 11g. a note that had tasks at the last load is read again even if the
          cache has gone quiet about it: the cards don't flicker away */
  {
    const app = makeApp({ 'Home.md': '- [ ] Call plumber' });
    const store = makeStore({ app, settings: {} });
    assert.strictEqual((await store.load()).length, 1);
    app.metadataCache.getFileCache = () => ({});
    assert.strictEqual((await store.load()).length, 1);
    /* …and once its text really has no task, it is forgotten */
    app.files.set('Home.md', 'nothing here');
    assert.strictEqual((await store.load()).length, 0);
    app.files.set('Home.md', '- [ ] Back again');
    assert.strictEqual((await store.load()).length, 0);
  }

  /* 12. G3/contract 9: only the log notes the board can use are read — from
         the 1st of the month of (today - 7) to the end of the month of
         (today + 21). Boundaries counted by hand. */
  {
    const logs = dates => {
      const files = { 'Rhythm/Practices/Gym.md': '---\ncadence: daily\n---\n', 'Rhythm/Log/scratch.md': '---\ndone: [Gym]\n---\n' };
      for (const d of dates) files[`Rhythm/Log/${d}.md`] = '---\nrhythm: log\ndone: [Gym]\n---\n';
      return makeApp(files, { rhythm: { settings: {} } });
    };
    const keys = async (dates, today) => { const app = logs(dates); const r = await makeStore({ app, settings: {} }).loadRhythm(today); return [[...r.log.keys()], app.reads.filter(p => p.includes('/Log/'))]; };
    /* 7 Oct: window 1 Sep .. 31 Oct */
    assert.deepStrictEqual(await keys(['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-31', '2026-11-01'], '2026-10-07'),
      [['2026-09-01', '2026-09-30', '2026-10-31'], ['Rhythm/Log/2026-09-01.md', 'Rhythm/Log/2026-09-30.md', 'Rhythm/Log/2026-10-31.md']]);
    /* 3 Jan: today-7 is 27 Dec, so from 1 Dec; today+21 is 24 Jan, so to 31 Jan */
    assert.deepStrictEqual((await keys(['2025-11-30', '2025-12-01', '2026-01-31', '2026-02-01'], '2026-01-03'))[0], ['2025-12-01', '2026-01-31']);
    /* 20 Dec: today+21 is 10 Jan, so to 31 Jan the next year */
    assert.deepStrictEqual((await keys(['2026-11-30', '2026-12-01', '2027-01-31', '2027-02-01'], '2026-12-20'))[0], ['2026-12-01', '2027-01-31']);
    /* 1 Feb 2028 (leap): today+21 is 22 Feb, so to 29 Feb; today-7 is 25 Jan, so from 1 Jan */
    assert.deepStrictEqual((await keys(['2027-12-31', '2028-01-01', '2028-02-29', '2028-03-01'], '2028-02-01'))[0], ['2028-01-01', '2028-02-29']);
    /* a 7 Oct today reaching back to 30 Sep: from 1 Sep, not 1 Oct */
    assert.deepStrictEqual((await keys(['2026-09-01'], '2026-10-07'))[0], ['2026-09-01']);
    /* no argument: today. A log named for today is read; one from 2000 is not */
    const D = require('../src/dates');
    const now = D.todayISO();
    const r = await makeStore({ app: logs([now, '2000-01-01']), settings: {} }).loadRhythm();
    assert.deepStrictEqual([...r.log.keys()], [now]);
  }

  /* 12b. G5: Rhythm's notes are read together too, yet still handed over
          sorted by name */
  {
    const app = makeApp({ 'Rhythm/Practices/B.md': '---\ncadence: daily\n---\n', 'Rhythm/Practices/A.md': '---\ncadence: daily\n---\n', 'Rhythm/Practices/C.md': '---\ncadence: daily\n---\n' }, { rhythm: { settings: {} } });
    const wait = { 'Rhythm/Practices/A.md': 25, 'Rhythm/Practices/B.md': 10, 'Rhythm/Practices/C.md': 1 };
    let inFlight = 0; let most = 0;
    app.vault.cachedRead = async f => { inFlight++; most = Math.max(most, inFlight); await new Promise(r => setTimeout(r, wait[f.path])); inFlight--; return app.files.get(f.path); };
    const r = await makeStore({ app, settings: {} }).loadRhythm('2026-10-07');
    assert.deepStrictEqual(r.practices.map(p => p.name), ['A', 'B', 'C']);
    assert.ok(most >= 2, `reads overlapped (${most})`);
  }

  /* 13. contract 6: isRelevant(file, cache) says whether a vault event for
         that file can change the board — so typing in an unrelated note
         doesn't redraw it */
  {
    const nudgeStore = { isOurs: p => p === 'Reminders.md', path: () => 'Reminders.md', load: async () => ({ items: [] }) };
    const app = makeApp({
      'Planning/Fortnight.md': '## Inbox\n',
      'Home.md': '- [ ] Call plumber',
      'Ideas.md': 'no tasks',
      'Rhythm/Log/2026-10-01.md': '---\nrhythm: log\n---\n',
    }, { rhythm: { settings: {} }, 'nudge-reminders': { store: nudgeStore } });
    const store = makeStore({ app, settings: {} });
    const none = { listItems: [{ position: { start: { line: 0 } } }] };
    const tasks = { listItems: [{ task: ' ', position: { start: { line: 0 } } }] };
    /* the planner note, Nudge's note and anything under Rhythm's folder */
    assert.strictEqual(store.isRelevant({ path: 'Planning/Fortnight.md', extension: 'md' }, null), true);
    assert.strictEqual(store.isRelevant({ path: 'Reminders.md', extension: 'md' }, {}), true);
    assert.strictEqual(store.isRelevant({ path: 'Rhythm/Log/2026-10-01.md', extension: 'md' }, {}), true);
    assert.strictEqual(store.isRelevant({ path: 'Rhythm/Practices/New.md', extension: 'md' }, {}), true);
    /* an unrelated note: only if its cache holds a task now */
    assert.strictEqual(store.isRelevant({ path: 'Ideas.md', extension: 'md' }, {}), false);
    assert.strictEqual(store.isRelevant({ path: 'Ideas.md', extension: 'md' }, none), false);
    assert.strictEqual(store.isRelevant({ path: 'Ideas.md', extension: 'md' }, tasks), true);
    /* no cache given: asked of the metadata cache */
    assert.strictEqual(store.isRelevant({ path: 'Home.md', extension: 'md' }), true);
    assert.strictEqual(store.isRelevant({ path: 'Ideas.md', extension: 'md' }), false);
    /* a note that had tasks at the last load stays relevant after they are gone (a delete, a rename) */
    await store.load();
    assert.strictEqual(store.isRelevant({ path: 'Home.md', extension: 'md' }, {}), true);
    assert.strictEqual(store.isRelevant({ path: 'Gone.md', extension: 'md' }, null), false);
    /* not a note */
    assert.strictEqual(store.isRelevant({ path: 'Planning/Fortnight.png', extension: 'png' }, null), false);
    /* folders: a rename or delete of one that holds the planner note, the
       Rhythm folder or a note with tasks */
    assert.strictEqual(store.isRelevant({ path: 'Planning', children: [] }), true);
    assert.strictEqual(store.isRelevant({ path: 'Rhythm', children: [] }), true);
    assert.strictEqual(store.isRelevant({ path: 'Rhythm/Log', children: [] }), true);
    assert.strictEqual(store.isRelevant({ path: 'Misc', children: [] }), false);
  }

  /* 13b. Rhythm's folder follows Rhythm's own setting; without Rhythm enabled
          a folder of that name is just a folder, and Nudge's name is nothing
          special without Nudge */
  {
    const app = makeApp({ 'Life/Log/2026-10-01.md': 'x', 'Rhythm/Log/2026-10-01.md': 'x' }, { rhythm: { settings: { folder: 'Life' } } });
    const store = makeStore({ app, settings: { plannerNote: 'Plan.md' } });
    assert.strictEqual(store.isRelevant({ path: 'Life/Log/2026-10-01.md', extension: 'md' }, {}), true);
    assert.strictEqual(store.isRelevant({ path: 'Rhythm/Log/2026-10-01.md', extension: 'md' }, {}), false);
    assert.strictEqual(store.isRelevant({ path: 'Plan.md', extension: 'md' }, {}), true);
    assert.strictEqual(store.isRelevant({ path: 'Planning/Fortnight.md', extension: 'md' }, {}), false);
    const bare = makeStore({ app: makeApp({ 'Rhythm/Log/2026-10-01.md': 'x' }), settings: {} });
    assert.strictEqual(bare.isRelevant({ path: 'Rhythm/Log/2026-10-01.md', extension: 'md' }, {}), false);
    assert.strictEqual(bare.isRelevant({ path: 'Reminders.md', extension: 'md' }, {}), false);
  }

  console.log('store OK');
})().catch(e => { console.error(e); process.exit(1); });
