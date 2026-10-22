'use strict';
/* The workspace view hosting the board. */

const { ItemView } = require('obsidian');
const { VIEW_TYPE, ICON } = require('./constants');
const { mountBoard } = require('./board');

class FortnightView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    /* A dashboard: links opened from it go to another tab, never replace it. */
    this.navigation = false;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Fortnight'; }
  getIcon() { return ICON; }

  async onOpen() {
    this.ctl = mountBoard(this);
    /* A new theme or accent colour: the board follows without a reload. */
    const ws = this.app && this.app.workspace;
    if (ws && typeof ws.on === 'function') this.registerEvent(ws.on('css-change', () => { if (this.ctl) this.ctl.restyle(); }));
    await this.ctl.start();
  }

  /* Crossing the phone width swaps the board for the day view. */
  onResize() {
    if (this.ctl) this.ctl.relayout();
  }

  async onClose() {
    if (this.ctl) { this.ctl.stop(); this.ctl = null; }
  }
}

module.exports = { FortnightView };
