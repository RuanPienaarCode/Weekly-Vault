'use strict';
/* The workspace view hosting the board. Empty until the board lands (#3). */

const { ItemView } = require('obsidian');
const { VIEW_TYPE, ICON } = require('./constants');

class FortnightView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Fortnight'; }
  getIcon() { return ICON; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('fortnight');
    const empty = root.createDiv({ cls: 'fn-empty' });
    empty.createEl('h2', { text: 'Fortnight' });
    empty.createEl('p', { text: 'Your two-week board will appear here.' });
  }

  async onClose() {
    this.contentEl.empty();
  }
}

module.exports = { FortnightView };
