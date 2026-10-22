'use strict';
/* The plugin's wiring that has no DOM in it, run against src/ with a stubbed
   `obsidian`:
   - which vault events refresh the board (only notes it could be showing;
     'create' and 'resolved' only once the layout is ready, 'resolved' once);
   - the commands wait for a tab restored at startup to load before they act;
   - the settings tab tidies the paths and folders it saves. */
const assert = require('node:assert');
const Module = require('node:module');

/* Obsidian's normalizePath: one kind of slash, none doubled or at either end,
   nothing left is "/". */
const normalizePath = p => p.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || '/';

class Plugin {
  constructor(app) { this.app = app; this.refs = []; this.commands = []; this.ribbons = []; }
  registerView() {}
  addCommand(c) { this.commands.push(c); }
  addRibbonIcon(icon, title, cb) { this.ribbons.push({ icon, title, cb }); return {}; }
  addSettingTab() {}
  registerEvent(ref) { this.refs.push(ref); }
  registerInterval(id) { clearInterval(id); }
  async loadData() { return null; }
  async saveData() {}
}
/* A Setting that remembers the onChange handler of each control, by name. */
const handlers = {};
class Setting {
  constructor() { this.name = ''; }
  setName(n) { this.name = n; return this; }
  setDesc() { return this; }
  _control() {
    const c = { setPlaceholder: () => c, setValue: () => c, addOption: () => c, onChange: fn => { handlers[this.name] = fn; return c; } };
    return c;
  }
  addText(cb) { cb(this._control()); return this; }
  addTextArea(cb) { cb(this._control()); return this; }
  addToggle(cb) { cb(this._control()); return this; }
  addDropdown(cb) { cb(this._control()); return this; }
}
const stub = {
  Plugin, Setting, normalizePath,
  ItemView: class ItemView { constructor(leaf) { this.leaf = leaf; } },
  PluginSettingTab: class PluginSettingTab { constructor(app, plugin) { this.app = app; this.containerEl = { empty() {}, createDiv() { return { setText() {} }; } }; } },
  Notice: class Notice {}, Modal: class Modal {}, Menu: class Menu {}, setIcon: () => {}, Platform: { isMobile: false },
};
global.window = globalThis;
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? stub : origLoad.call(this, request, ...rest); };

/* An app that records the events asked for. */
function fakeApp() {
  const on = { vault: [], meta: [] };
  const offed = [];
  let layoutReady = null;
  const tag = (list, name, cb) => { const ref = { name, cb }; list.push(ref); return ref; };
  const log = [];
  const leaf = {
    view: null,
    loadIfDeferred: async () => { await Promise.resolve(); log.push('loaded'); leaf.view = { ctl: { openReview: async () => log.push('openReview'), showIntro: async () => log.push('showIntro') } }; },
  };
  const app = {
    on, offed, log, leaf,
    layoutReady: () => layoutReady(),
    workspace: {
      getLeavesOfType: () => [leaf],
      getLeaf: () => ({ setViewState: async () => {} }),
      revealLeaf: async () => { await new Promise(r => setTimeout(r, 5)); log.push('revealed'); },
      onLayoutReady: cb => { layoutReady = cb; },
    },
    vault: { on: (name, cb) => tag(on.vault, name, cb) },
    metadataCache: { on: (name, cb) => tag(on.meta, name, cb), offref: ref => offed.push(ref) },
  };
  return app;
}
const names = list => list.map(r => r.name);
const get = (list, name) => list.find(r => r.name === name);

(async () => {
  try {
    const FortnightPlugin = require('../src/main.js');
    const { FortnightSettingTab } = require('../src/settings-tab.js');

    const app = fakeApp();
    const p = new FortnightPlugin(app);
    await p.onload();
    let refreshes = 0;
    p.refreshSoon = () => { refreshes++; };
    const seen = [];
    /* The store decides what is relevant; here: the planner note and anything with "tasks" in its name. */
    p.store.isRelevant = (file, cache) => { seen.push([file.path, cache]); return file.path === 'Planning/Fortnight.md' || /tasks/.test(file.path); };

    /* Before the layout is ready: changed / delete / rename only. */
    assert.deepStrictEqual(names(app.on.meta), ['changed']);
    assert.deepStrictEqual(names(app.on.vault), ['delete', 'rename']);

    /* 'changed' refreshes for a relevant note only, and hands the store the cache it carried. */
    const cache = { listItems: [] };
    get(app.on.meta, 'changed').cb({ path: 'Notes/essay.md' }, 'text', cache);
    assert.strictEqual(refreshes, 0, 'typing in an unrelated note does not reload the board');
    get(app.on.meta, 'changed').cb({ path: 'Projects/tasks.md' }, 'text', cache);
    assert.strictEqual(refreshes, 1, 'a note with tasks does');
    assert.strictEqual(seen[seen.length - 1][1], cache, 'the event\'s cache reaches isRelevant');

    /* delete: by the file; rename: the new path OR the old one. */
    get(app.on.vault, 'delete').cb({ path: 'Notes/essay.md' });
    assert.strictEqual(refreshes, 1);
    get(app.on.vault, 'delete').cb({ path: 'Projects/tasks.md' });
    assert.strictEqual(refreshes, 2);
    get(app.on.vault, 'rename').cb({ path: 'Archive/essay.md' }, 'Notes/essay.md');
    assert.strictEqual(refreshes, 2, 'an unrelated note renamed');
    get(app.on.vault, 'rename').cb({ path: 'Archive/old.md' }, 'Projects/tasks.md');
    assert.strictEqual(refreshes, 3, 'a tasks note moved out: the board must forget it');
    get(app.on.vault, 'rename').cb({ path: 'Projects/tasks-2.md' }, 'Projects/tasks.md');
    assert.strictEqual(refreshes, 4);

    /* After the layout is ready: one reload, then 'create' and a one-shot 'resolved'. */
    app.layoutReady();
    assert.strictEqual(refreshes, 5, 'one reload when the layout is ready');
    assert.deepStrictEqual(names(app.on.vault), ['delete', 'rename', 'create']);
    assert.deepStrictEqual(names(app.on.meta), ['changed', 'resolved']);
    get(app.on.vault, 'create').cb({ path: 'Notes/new.md' });
    assert.strictEqual(refreshes, 5, 'a file appearing while the vault loads is not a reason to reload');
    get(app.on.vault, 'create').cb({ path: 'Planning/Fortnight.md' });
    assert.strictEqual(refreshes, 6);
    const resolved = get(app.on.meta, 'resolved');
    resolved.cb();
    assert.strictEqual(refreshes, 7, 'the first full index reloads');
    assert.deepStrictEqual(app.offed, [resolved], 'and then unhooks itself: it fires after every edit, and carries no file');

    /* A store without isRelevant (or one that throws) must not silence the board. */
    delete p.store.isRelevant;
    get(app.on.meta, 'changed').cb({ path: 'Notes/essay.md' }, 'text', null);
    assert.strictEqual(refreshes, 8, 'no filter available: reload, as before');
    p.store.isRelevant = () => { throw new Error('boom'); };
    get(app.on.meta, 'changed').cb({ path: 'Notes/essay.md' }, 'text', null);
    assert.strictEqual(refreshes, 9);

    /* Commands wait for the tab to load and be revealed, then act on THAT view. */
    const review = p.commands.find(c => c.id === 'review');
    await review.callback();
    assert.deepStrictEqual(app.log, ['loaded', 'revealed', 'openReview'], 'a deferred tab is loaded and revealed before Review opens');
    app.log.length = 0;
    app.leaf.view = null;
    await p.commands.find(c => c.id === 'welcome').callback();
    assert.deepStrictEqual(app.log, ['loaded', 'revealed', 'showIntro']);
    app.log.length = 0;
    await p.commands.find(c => c.id === 'open').callback();
    assert.deepStrictEqual(app.log, ['loaded', 'revealed'], 'Open board only reveals');
    const got = await p.activateView();
    assert.strictEqual(got, app.leaf, 'activateView hands back the leaf');

    /* Settings: paths and folders are tidied as Obsidian tidies them. */
    const saved = [];
    const plugin = { settings: { plannerNote: 'Planning/Fortnight.md', excludeFolders: [], laterFolders: [] }, store: { plannerPath: () => 'Planning/Fortnight.md' }, saveSettings: async () => { saved.push(JSON.stringify(plugin.settings)); } };
    new FortnightSettingTab({}, plugin).display();
    await handlers['Planner note']('  Planning//Fortnight.md ');
    assert.strictEqual(plugin.settings.plannerNote, 'Planning/Fortnight.md');
    await handlers['Planner note']('\\Notes\\Plan');
    assert.strictEqual(plugin.settings.plannerNote, 'Notes/Plan', 'one kind of slash, none at the ends');
    await handlers['Planner note']('   ');
    assert.strictEqual(plugin.settings.plannerNote, 'Planning/Fortnight.md', 'blank falls back to the default');
    await handlers['Review folder']('//Reviews//2026/');
    assert.strictEqual(plugin.settings.reviewFolder, 'Reviews/2026');
    await handlers['Review folder']('');
    assert.strictEqual(plugin.settings.reviewFolder, '', 'blank stays blank: the Rhythm log');
    await handlers['Excluded folders']('Templates\n /Archive/Old/ \n\n/\nTemplates');
    assert.deepStrictEqual(plugin.settings.excludeFolders, ['Templates', 'Archive/Old']);
    await handlers['Later: also show undated to-dos from']('Projects//Active\n\\Someday');
    assert.deepStrictEqual(plugin.settings.laterFolders, ['Projects/Active', 'Someday']);
    assert.strictEqual(saved.length, 7, 'every change is saved');

    console.log('ui wiring OK');
  } finally {
    Module._load = origLoad;
  }
})().catch(e => { console.error(e); process.exit(1); });
