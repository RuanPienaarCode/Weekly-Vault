'use strict';
/* A stand-in Obsidian app for store tests: an in-memory vault, a metadata
   cache that finds task list items the way Obsidian does (one listItem per
   list line, `task` set on checkbox lines), and optional plugin stand-ins.
   Not a test file itself (no .test.cjs suffix). */

const TASK_ITEM = /^[\s>]*([-*+]|\d+[.)])[ \t]+\[(.)\]/;
const LIST_ITEM = /^[\s>]*([-*+]|\d+[.)])[ \t]+/;

function makeApp(files = {}, plugins = {}) {
  const store = new Map(Object.entries(files));
  const fileOf = path => ({ path, name: path.split('/').pop(), basename: path.split('/').pop().replace(/\.md$/, ''), extension: 'md' });
  const reads = [];
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
        if (!inside.length) return null;
        return { path: dir, children: inside.filter(k => !k.slice(dir.length + 1).includes('/')).map(fileOf) };
      },
      cachedRead: async f => { reads.push(f.path); return store.get(f.path); },
      read: async f => store.get(f.path),
      modify: async (f, t) => { store.set(f.path, t); },
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: f => {
        const text = store.get(f.path);
        if (text == null) return null;
        const listItems = [];
        text.split('\n').forEach((l, i) => {
          if (!LIST_ITEM.test(l)) return;
          const t = TASK_ITEM.exec(l);
          const item = { position: { start: { line: i } } };
          if (t) item.task = t[2];
          listItems.push(item);
        });
        return listItems.length ? { listItems } : {};
      },
      on: () => ({}),
    },
    plugins: { plugins },
  };
}

module.exports = { makeApp };
