'use strict';
/* A stale Nudge tick. Nudge's toggle answers { ok: false, reason: 'stale' }
   when it found the reminder's line only by its date-tolerant fallback on a
   🔁 line — the reminder rolled on (or was edited) since the caller read it.
   The reason must reach the board as 'stale' (not flattened to 'changed'),
   and the board must say it in words, not "something went wrong". */
const assert = require('node:assert');
const Module = require('node:module');
const { makeApp } = require('./_stub.cjs');
const { makeStore } = require('../src/store');

/* board.js asks for obsidian at load; nothing from it is used by why(). */
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? {} : origLoad.call(this, request, ...rest); };
const { why } = require('../src/board');
Module._load = origLoad;

(async () => {
  const raw = '- [ ] Pills 🔁 every day 📅 2026-10-08 ⏰ 08:00';
  const calls = [];
  const nudge = { isOurs: () => true, path: () => 'Reminders.md',
    load: async () => ({ items: [{ raw, line: 4, group: 'Home', due: '2026-10-08', title: 'Pills' }] }),
    toggle: async (item, today) => { calls.push([item.raw, today]); return { ok: false, reason: 'stale' }; } };
  const store = makeStore({ app: makeApp({}, { 'nudge-reminders': { store: nudge } }), settings: {} });

  /* 1. Fortnight's store passes Nudge's 'stale' through unchanged */
  const r = await store.tick({ source: 'nudge', path: 'Reminders.md', line: 4, raw, group: 'Home' }, '2026-10-08');
  assert.deepStrictEqual(r, { ok: false, reason: 'stale' });
  assert.deepStrictEqual(calls, [[raw, '2026-10-08']]);

  /* 2. the board words it plainly, and says nothing was ticked */
  assert.strictEqual(why('stale'), 'that reminder changed in Nudge since this board read it, so nothing was ticked — the board has been refreshed');
  assert.notStrictEqual(why('stale'), why('no-such-reason'));

  /* 3. a bare { ok: false } from Nudge (its malformed-input answer) still
        reads as 'changed', which the board words too */
  nudge.toggle = async () => ({ ok: false });
  const bare = await store.tick({ source: 'nudge', path: 'Reminders.md', line: 4, raw, group: 'Home' }, '2026-10-08');
  assert.deepStrictEqual(bare, { ok: false, reason: 'changed' });
  assert.notStrictEqual(why(bare.reason), why('no-such-reason'));

  console.log('nudge-stale OK');
})().catch(e => { console.error(e); process.exit(1); });
