'use strict';
/* The store: everything Fortnight reads from (and, later, writes to) the
   vault and the plugins it works with. The board model never touches the
   vault; it is handed what load() returns. */

const { parseFrontmatter } = require('./rhythm/markdown');
const RD = require('./rhythm/dates');

const NUDGE_ID = 'nudge-reminders';
const RHYTHM_ID = 'rhythm';
/* Rhythm's folder names under its root (Rhythm's constants.js FOLDERS). */
const RHYTHM_FOLDERS = { areas: 'Areas', practices: 'Practices', events: 'Events', log: 'Log' };

function makeStore(plugin) {
  const app = plugin.app;
  /* Sources that are installed but could not be read on the last load. */
  let problems = [];

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
    problems = [];
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
        if (lines[line] != null) out.push({ source: 'tasks', path: f.path, line, raw: lines[line] });
      }
    }
    return out.concat(await reminders(ours));
  }

  /* Nudge's reminders, read by Nudge itself: its ⏰ time sits after the date,
     where a Tasks-style reader stops. A failure inside Nudge costs only its
     cards, never the board. */
  async function reminders(ours) {
    if (!ours || typeof ours.load !== 'function') return [];
    try {
      const { items } = await ours.load();
      const path = ours.path();
      return (items || []).map(r => ({
        source: 'nudge', path, line: r.line, raw: r.raw,
        text: r.title, due: r.due || '', scheduled: r.scheduled || '', time: r.time || '', done: !!r.done,
        priority: r.priority || 'normal', tags: r.tags || [],
      }));
    } catch (e) {
      console.warn('Fortnight: could not read Nudge reminders', e);
      problems.push('nudge');
      return [];
    }
  }

  /* Rhythm's records, read exactly as Rhythm's own io.js load() reads them:
     its folder, its frontmatter parser, its field defaults. null when the
     vault has no Rhythm folder. */
  async function loadRhythm() {
    /* Only when Rhythm itself is enabled — as with Nudge, a stray folder of
       the same name is not a reason to fill the board. */
    const rp = app.plugins && app.plugins.plugins && app.plugins.plugins[RHYTHM_ID];
    if (!rp) return null;
    const rs = rp.settings || {};
    /* Tidied as Obsidian's normalizePath would: one kind of slash, no
       doubles, none at either end. */
    const root = String(rs.folder || 'Rhythm').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
    if (!app.vault.getFolderByPath(root)) return null;
    const baseName = f => (f.basename !== undefined ? f.basename : String(f.name || '').replace(/\.md$/, ''));
    const readAll = async key => {
      const folder = app.vault.getFolderByPath(`${root}/${RHYTHM_FOLDERS[key]}`);
      const files = ((folder && folder.children) || []).filter(c => c.extension === 'md')
        .sort((a, b) => baseName(a).localeCompare(baseName(b)));
      const out = [];
      for (const f of files) {
        try { out.push({ name: baseName(f), path: f.path, fm: parseFrontmatter(await app.vault.cachedRead(f)).fm }); }
        catch (e) { console.warn('Fortnight: could not read', f.path, e); }
      }
      return out;
    };
    const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
    const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
    const areas = (await readAll('areas')).map(r => ({ name: r.name, order: num(r.fm.order), path: r.path }));
    const practices = (await readAll('practices'))
      .filter(r => r.fm.status !== 'aside' && r.fm.status !== 'paused')
      .map(r => ({
        name: r.name, area: r.fm.area || '', cadence: r.fm.cadence || 'daily', days: r.fm.days,
        minutes: num(r.fm.minutes), when: r.fm.when || '', time: r.fm.time ? String(r.fm.time) : '', path: r.path,
      }));
    const events = (await readAll('events')).map(r => ({
      name: r.name, area: r.fm.area || '', date: String(r.fm.date || ''), time: r.fm.time ? String(r.fm.time) : '', path: r.path,
    }));
    const log = new Map();
    for (const r of await readAll('log')) {
      if (!RD.isISO(r.name)) continue;
      log.set(r.name, { done: new Set(list(r.fm.done)), skip: new Set(list(r.fm.skip)), snooze: new Set(list(r.fm.snooze)), plan: new Set(list(r.fm.plan)), note: '' });
    }
    return { areas, practices, goals: [], events, log, weekStart: rs.weekStart === 0 ? 0 : 1, folder: root };
  }

  return { load, loadRhythm, problems: () => problems.slice() };
}

module.exports = { makeStore };
