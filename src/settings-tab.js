'use strict';
/* Settings: the welcome, and which folders stay off the board. */

const { PluginSettingTab, Setting } = require('obsidian');

class FortnightSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
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
      .setName('Excluded folders')
      .setDesc('To-dos in these folders never appear on the board. One folder per line, e.g. Templates.')
      .addTextArea(t => t
        .setPlaceholder('Templates')
        .setValue((this.plugin.settings.excludeFolders || []).join('\n'))
        .onChange(async v => {
          this.plugin.settings.excludeFolders = v.split('\n').map(x => x.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = { FortnightSettingTab };
