'use strict';
/* A stand-in Obsidian app for store tests: an in-memory vault, a metadata
   cache that finds task list items the way Obsidian does, and optional plugin
   stand-ins. Not a test file itself (no .test.cjs suffix).

   Where this stub differs from Obsidian, a store test can pass on behaviour
   Obsidian doesn't have — so it is kept faithful to what the lane-A audit
   (7 Oct 2026) saw in the real app:
   - a list item is a TASK only when a space, a tab or the end of the line
     follows the box ("- [ ]x" is a plain list item), and never inside front
     matter or a fenced code block (``` or ~~~);
   - vault.create throws when the path already exists, createFolder when the
     folder does (callers must survive losing that race);
   - the metadata cache is built from the text each time it is asked, so a
     test can make it go stale by wrapping getFileCache.
   This file models OBSIDIAN, not Tasks: Obsidian also lets a tab sit between
   the list marker and the box, which Tasks' own reader refuses. */

const TASK_ITEM = /^[\s>]*([-*+]|\d+[.)])[ \t]+\[(.)\](?:[ \t]|\r?$)/;
const LIST_ITEM = /^[\s>]*([-*+]|\d+[.)])[ \t]+/;
const FENCE = /^[\s>]*(`{3,}|~{3,})(.*)$/;

/* Which lines are list items / tasks, written independently of src/ so a bug
   in the store's own scanner can't hide in the stand-in. */
function listItemsOf(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  let from = 0;
  if (lines[0] !== undefined && lines[0].replace(/^\uFEFF/, '').trimEnd() === '---') {
    const close = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'));
    if (close > 0) from = close + 1;
  }
  const items = [];
  let fence = null;
  for (let i = from; i < lines.length; i++) {
    const l = lines[i];
    const f = FENCE.exec(l);
    if (fence) {
      if (f && f[1][0] === fence.ch && f[1].length >= fence.len && !f[2].trim()) fence = null;
      continue;
    }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) { fence = { ch: f[1][0], len: f[1].length }; continue; }
    if (!LIST_ITEM.test(l)) continue;
    const t = TASK_ITEM.exec(l);
    const item = { position: { start: { line: i } } };
    if (t) item.task = t[2];
    items.push(item);
  }
  return items;
}

function makeApp(files = {}, plugins = {}) {
  const store = new Map(Object.entries(files));
  const fileOf = path => ({ path, name: path.split('/').pop(), basename: path.split('/').pop().replace(/\.md$/, ''), extension: 'md' });
  const reads = [];
  const folders = new Set();
  return {
    reads,
    files: store,
    vault: {
      getMarkdownFiles: () => [...store.keys()].filter(p => p.endsWith('.md')).map(fileOf),
      getFileByPath: p => (store.has(p) ? fileOf(p) : null),
      /* A folder exists if any note lives under it; children are the notes
         directly inside (enough for readers that list one folder). */
      getFolderByPath: p => {
        const dir = p.replace(/\/+$/, '');
        const inside = [...store.keys()].filter(k => k.startsWith(dir + '/'));
        if (!inside.length && !folders.has(dir)) return null;
        return { path: dir, children: inside.filter(k => !k.slice(dir.length + 1).includes('/')).map(fileOf) };
      },
      cachedRead: async f => { reads.push(f.path); return store.get(f.path); },
      read: async f => store.get(f.path),
      modify: async (f, t) => { store.set(f.path, t); },
      /* Atomic read-modify-write, as Obsidian's vault.process. */
      process: async (f, fn) => { const t = fn(store.get(f.path)); store.set(f.path, t); return t; },
      create: async (p, t) => {
        if (store.has(p)) throw new Error('File already exists.');
        store.set(p, t);
        return fileOf(p);
      },
      createFolder: async p => {
        const dir = p.replace(/\/+$/, '');
        if (folders.has(dir) || [...store.keys()].some(k => k.startsWith(dir + '/'))) throw new Error('Folder already exists.');
        folders.add(dir);
      },
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: f => {
        const text = store.get(f.path);
        if (text == null) return null;
        const listItems = listItemsOf(text);
        return listItems.length ? { listItems } : {};
      },
      on: () => ({}),
    },
    plugins: { plugins },
  };
}

module.exports = { makeApp };
