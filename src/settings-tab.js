'use strict';
/* Settings: which folders stay off the board. */

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
