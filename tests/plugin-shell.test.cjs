'use strict';
/* The plugin shell as Obsidian sees it: loading the built main.js registers
   the Fortnight view, an "Open Fortnight" command and a ribbon icon, and the
   command opens that view. Runs against the real bundle, so it needs a build. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const bundlePath = path.join(__dirname, '..', 'main.js');
assert.ok(fs.existsSync(bundlePath), 'main.js missing — run ./build.sh');

class Plugin {
  constructor() {
    this.views = {}; this.commands = []; this.ribbons = []; this.opened = [];
    const self = this;
    this.app = {
      workspace: {
        getLeavesOfType: () => [],
        getLeaf: () => ({ setViewState: async s => { self.opened.push(s.type); } }),
        revealLeaf: () => {},
        onLayoutReady: fn => fn(),
      },
    };
  }
  registerView(type, factory) { this.views[type] = factory; }
  addCommand(c) { this.commands.push(c); }
  addRibbonIcon(icon, title, cb) { this.ribbons.push({ icon, title, cb }); return {}; }
  addSettingTab() {}
  registerEvent() {}
  async loadData() { return null; }
  async saveData() {}
}
const stub = {
  Plugin, ItemView: class ItemView { constructor(leaf) { this.leaf = leaf; } },
  PluginSettingTab: class PluginSettingTab {}, Setting: class Setting {}, Notice: class Notice {},
  Modal: class Modal {}, Menu: class Menu {}, setIcon: () => {}, normalizePath: p => p, Platform: { isMobile: false },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? stub : origLoad.call(this, request, ...rest); };

(async () => {
  try {
    const FortnightPlugin = require(bundlePath);
    const p = new FortnightPlugin();
    await p.onload();

    assert.deepStrictEqual(Object.keys(p.views), ['fortnight-planner-view']);
    const view = p.views['fortnight-planner-view']({});
    assert.strictEqual(view.getViewType(), 'fortnight-planner-view');
    assert.strictEqual(view.getDisplayText(), 'Fortnight');
    assert.strictEqual(view.getIcon(), 'calendar-range');

    const open = p.commands.find(c => c.id === 'open');
    assert.ok(open, 'an "open" command is registered');
    assert.strictEqual(open.name, 'Open Fortnight');
    assert.deepStrictEqual(p.ribbons.map(r => r.icon), ['calendar-range']);

    await open.callback();
    assert.deepStrictEqual(p.opened, ['fortnight-planner-view'], 'the command opens the Fortnight view');
    await p.ribbons[0].cb();
    assert.deepStrictEqual(p.opened, ['fortnight-planner-view', 'fortnight-planner-view'], 'so does the ribbon');
    console.log('plugin shell OK');
  } finally {
    Module._load = origLoad;
  }
})().catch(e => { console.error(e); process.exit(1); });
