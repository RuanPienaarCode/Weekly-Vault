'use strict';
/* The store: everything Fortnight reads from (and, later, writes to) the
   vault and the plugins it works with. The board model never touches the
   vault; it is handed what load() returns. */

const NUDGE_ID = 'nudge-reminders';

function makeStore(plugin) {
  const app = plugin.app;

  /* Nudge owns its note. Its reminders come through Nudge itself (#3b), so
     the note is skipped here and nothing appears twice. */
  const nudge = () => {
    const p = app.plugins && app.plugins.plugins && app.plugins.plugins[NUDGE_ID];
    return p && p.store ? p.store : null;
  };

  /* Every task line in the vault as { path, line, raw }. Obsidian's metadata
     cache says which notes hold tasks and on which lines, so only those
     notes are read. */
  async function load() {
    const ours = nudge();
    const out = [];
    for (const f of app.vault.getMarkdownFiles()) {
      if (ours && ours.isOurs(f.path)) continue;
      const cache = app.metadataCache.getFileCache(f);
      const items = ((cache && cache.listItems) || []).filter(li => li.task !== undefined);
      if (!items.length) continue;
      const lines = (await app.vault.cachedRead(f)).split('\n');
      for (const li of items) {
        const line = li.position.start.line;
        if (lines[line] != null) out.push({ path: f.path, line, raw: lines[line] });
      }
    }
    return out;
  }

  return { load };
}

module.exports = { makeStore };
