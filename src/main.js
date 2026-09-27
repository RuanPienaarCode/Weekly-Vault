'use strict';
/* ============================================================================
   FORTNIGHT — Obsidian plugin (entry point)

   Plan two weeks, live one day: a board over your Tasks lines, Nudge
   reminders and Rhythm practices. Vault API only — desktop and iOS/Android.
   Source lives in src/ as CommonJS modules; esbuild bundles them into main.js
   (target safari15 — the real engine floor on mobile, not minAppVersion).
   ============================================================================ */

const { Plugin, Notice } = require('obsidian');
const { VIEW_TYPE, ICON, DEFAULT_SETTINGS } = require('./constants');
const { FortnightView } = require('./view');
const { FortnightSettingTab } = require('./settings-tab');
const { makeStore } = require('./store');
const D = require('./dates');

class FortnightPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = makeStore(this);

    this.registerView(VIEW_TYPE, leaf => new FortnightView(leaf, this));
    this.addRibbonIcon(ICON, 'Open Fortnight', () => this.activateView());
    this.addCommand({ id: 'open', name: 'Open Fortnight', callback: () => this.activateView() });
    this.addCommand({
      id: 'welcome', name: 'Show the welcome again',
      callback: async () => { await this.activateView(); for (const v of this.boardViews()) v.ctl.showIntro(); },
    });
    this.addSettingTab(new FortnightSettingTab(this.app, this));

    /* Any note edited, anywhere (including on another device via sync):
       re-read once things settle. The metadata cache fires after it has
       re-indexed the note's task lines, so the reload sees the new state. */
    const soon = () => this.refreshSoon();
    this.registerEvent(this.app.metadataCache.on('changed', soon));
    this.registerEvent(this.app.vault.on('delete', soon));
    this.registerEvent(this.app.vault.on('rename', soon));
    this.registerEvent(this.app.vault.on('create', soon));
    /* A board restored at startup may render before the metadata cache has
       indexed the vault; reload once the layout (and cache) are ready. */
    this.app.workspace.onLayoutReady(() => this.refreshSoon());
    this.registerEvent(this.app.metadataCache.on('resolved', soon));

    /* Past midnight the board moves on a day (and on Sunday, a week). */
    this._day = D.todayISO();
    this.registerInterval(window.setInterval(() => {
      if (D.todayISO() !== this._day) { this._day = D.todayISO(); this.refreshViews(); }
    }, 60 * 1000));
  }

  onunload() {
    window.clearTimeout(this._soon);
  }

  /* Settings are typed a key at a time: save each change, redraw once. */
  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshSoon();
  }

  boardViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter(v => v && v.ctl);
  }

  refreshViews() { for (const v of this.boardViews()) v.ctl.refresh(); }

  refreshSoon() {
    window.clearTimeout(this._soon);
    this._soon = window.setTimeout(() => this.refreshViews(), 300);
  }

  /* Open the note a card lives in, at its line. */
  async openTask(card) {
    const file = this.app.vault.getFileByPath(card.path);
    if (!file) { new Notice(`Fortnight: ${card.path} no longer exists.`); return; }
    await this.app.workspace.getLeaf(false).openFile(file, { eState: { line: card.line } });
  }

  /* Reuse an open Fortnight tab rather than stacking a second one. */
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}

module.exports = FortnightPlugin;
