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
    this.addCommand({ id: 'open', name: 'Open board', callback: () => this.activateView() });
    this.addCommand({
      id: 'review', name: 'Review today',
      callback: async () => { const v = await this.openBoard(); if (v) await v.ctl.openReview(); },
    });
    this.addCommand({
      id: 'welcome', name: 'Show the welcome again',
      callback: async () => { const v = await this.openBoard(); if (v) await v.ctl.showIntro(); },
    });
    this.addSettingTab(new FortnightSettingTab(this.app, this));

    /* A note changed, anywhere (including on another device via sync):
       re-read once things settle — but only for notes the board could be
       showing (see store.isRelevant), not every keystroke in every note.
       The metadata cache fires 'changed' after it has re-indexed a note's
       task lines. */
    const soon = () => this.refreshSoon();
    const relevant = (file, cache) => {
      const s = this.store;
      if (!s || typeof s.isRelevant !== 'function') return true;
      try { return !!s.isRelevant(file, cache); } catch (e) { return true; }
    };
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => { if (relevant(file, cache)) soon(); }));
    this.registerEvent(this.app.vault.on('delete', file => { if (relevant(file)) soon(); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { if (relevant(file) || relevant({ path: oldPath })) soon(); }));
    this.app.workspace.onLayoutReady(() => {
      /* A board restored at startup may render before the metadata cache has
         indexed the vault; reload once the layout (and cache) are ready. */
      soon();
      /* 'create' fires for every file while the vault loads, and 'resolved'
         after every modification: neither is registered before the layout is
         ready, and 'resolved' only once (the first full index). */
      this.registerEvent(this.app.vault.on('create', file => { if (relevant(file)) soon(); }));
      const mc = this.app.metadataCache;
      const once = mc.on('resolved', () => { if (mc.offref) mc.offref(once); soon(); });
      this.registerEvent(once);
    });

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

  /* Reuse an open Fortnight tab rather than stacking a second one. Resolves
     to the leaf once it is shown — a tab restored at startup is only a
     placeholder until revealLeaf has loaded it. */
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (typeof leaf.loadIfDeferred === 'function') await leaf.loadIfDeferred();
    await workspace.revealLeaf(leaf);
    return leaf;
  }

  /* The open board's view (opening it first), or null. */
  async openBoard() {
    const leaf = await this.activateView();
    return leaf && leaf.view && leaf.view.ctl ? leaf.view : null;
  }
}

module.exports = FortnightPlugin;
