'use strict';
/* Settings: the welcome, and which folders stay off the board. */

const { PluginSettingTab, Setting } = require('obsidian');

class FortnightSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /* A planner note inside an excluded folder: its to-dos would never show. */
  warnIfHidden(el) {
    const path = this.plugin.store.plannerPath();
    const hidden = (this.plugin.settings.excludeFolders || []).find(f => {
      const dir = String(f).replace(/^\/+|\/+$/g, '');
      return dir && path.startsWith(dir + '/');
    });
    el.setText(hidden ? `The planner note is inside the excluded folder "${hidden}", so to-dos added from the board won't show on it.` : '');
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('Your name')
      .setDesc('Used in the daily greeting. Leave blank for just "Good morning".')
      .addText(t => t
        .setValue(this.plugin.settings.name || '')
        .onChange(async v => { this.plugin.settings.name = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName('Daily welcome')
      .setDesc('The first time you open Fortnight each day: a greeting, then "Plan the week" or "Plan today", fading into the board.')
      .addToggle(t => t
        .setValue(this.plugin.settings.showWelcome !== false)
        .onChange(async v => { this.plugin.settings.showWelcome = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName('Planner note')
      .setDesc('Where "Add a to-do" writes new to-dos, under an "## Inbox" heading. Created if it doesn\'t exist.')
      .addText(t => t
        .setPlaceholder('Planning/Fortnight.md')
        .setValue(this.plugin.settings.plannerNote || '')
        .onChange(async v => {
          this.plugin.settings.plannerNote = v.trim() || 'Planning/Fortnight.md';
          await this.plugin.saveSettings();
          this.warnIfHidden(warning);
        }));
    const warning = containerEl.createDiv({ cls: 'setting-item-description mod-warning' });
    this.warnIfHidden(warning);
    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('To-dos in these folders never appear on the board. One folder per line, e.g. Templates.')
      .addTextArea(t => t
        .setPlaceholder('Templates')
        .setValue((this.plugin.settings.excludeFolders || []).join('\n'))
        .onChange(async v => {
          this.plugin.settings.excludeFolders = v.split('\n').map(x => x.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          this.warnIfHidden(warning);
        }));
  }
}

module.exports = { FortnightSettingTab };
