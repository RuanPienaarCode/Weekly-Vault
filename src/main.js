'use strict';
/* ============================================================================
   FORTNIGHT — Obsidian plugin (entry point)

   Plan two weeks, live one day: a board over your Tasks lines, Nudge
   reminders and Rhythm practices. Vault API only — desktop and iOS/Android.
   Source lives in src/ as CommonJS modules; esbuild bundles them into main.js
   (target safari15 — the real engine floor on mobile, not minAppVersion).
   ============================================================================ */

const { Plugin } = require('obsidian');
const { VIEW_TYPE, ICON, DEFAULT_SETTINGS } = require('./constants');
const { FortnightView } = require('./view');

class FortnightPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.registerView(VIEW_TYPE, leaf => new FortnightView(leaf, this));
    this.addRibbonIcon(ICON, 'Open Fortnight', () => this.activateView());
    this.addCommand({ id: 'open', name: 'Open Fortnight', callback: () => this.activateView() });
  }

  async saveSettings() { await this.saveData(this.settings); }

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
