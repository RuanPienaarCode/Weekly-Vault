'use strict';
/* The store: everything Fortnight reads from (and, later, writes to) the
   vault and the plugins it works with. The board model never touches the
   vault; it is handed what load() returns. */

const { parseFrontmatter, patchFrontmatter, buildNote } = require('./rhythm/markdown');
const L = require('./tasks-line');
const RD = require('./rhythm/dates');

const NUDGE_ID = 'nudge-reminders';
const TASKS_ID = 'obsidian-tasks-plugin';
const RHYTHM_ID = 'rhythm';
/* Rhythm's folder names under its root (Rhythm's constants.js FOLDERS). */
const RHYTHM_FOLDERS = { areas: 'Areas', practices: 'Practices', events: 'Events', log: 'Log' };

function makeStore(plugin) {
  const app = plugin.app;
  /* Sources that are installed but could not be read on the last load. */
  let problems = [];
  /* Cards being written right now. A second tick or move of the same card
     (a double click) is refused until the first write lands — otherwise a
     repeating to-do could be completed twice. */
  const inFlight = new Set();
  const once = async (card, fn) => {
    const key = card.key || `${card.source}:${card.path}:${card.line}:${card.text}`;
    if (inFlight.has(key)) return { ok: false, reason: 'busy' };
    inFlight.add(key);
    try { return await fn(); } finally { inFlight.delete(key); }
  };

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
        text: r.title, due: r.due || '', scheduled: r.scheduled || '', doneDate: r.doneDate || '', time: r.time || '', done: !!r.done,
        priority: r.priority || 'normal', tags: r.tags || [], group: r.group || '',
      }));
    } catch (e) {
      console.warn('Fortnight: could not read Nudge reminders', e);
      problems.push('nudge');
      return [];
    }
  }

  /* Rhythm, if enabled: its plugin settings and tidied root folder. */
  function rhythmRoot() {
    const rp = app.plugins && app.plugins.plugins && app.plugins.plugins[RHYTHM_ID];
    if (!rp) return null;
    const rs = rp.settings || {};
    /* Tidied as Obsidian's normalizePath would: one kind of slash, no
       doubles, none at either end. */
    const root = String(rs.folder || 'Rhythm').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
    return { root, weekStart: rs.weekStart === 0 ? 0 : 1 };
  }

  /* Rhythm's records, read exactly as Rhythm's own io.js load() reads them:
     its folder, its frontmatter parser, its field defaults. null when the
     vault has no Rhythm folder. */
  async function loadRhythm() {
    /* Only when Rhythm itself is enabled — as with Nudge, a stray folder of
       the same name is not a reason to fill the board. */
    const rr = rhythmRoot();
    if (!rr) return null;
    const { root } = rr;
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
    return { areas, practices, goals: [], events, log, weekStart: rr.weekStart, folder: root };
  }

  /* ---- writes ---------------------------------------------------------- */

  /* Edit one line of a note, but only if it still says what the board
     read: if the author (or sync) changed it meanwhile, refuse rather than
     guess, and let the board reload. */
  /* fn may return several lines (Tasks writes a repeating to-do's next
     occurrence above the ticked one); they replace the one line. */
  async function editLine(card, fn) {
    const file = app.vault.getFileByPath(card.path);
    if (!file) return { ok: false, reason: 'missing' };
    let out = { ok: false, reason: 'changed' };
    /* One atomic read-modify-write (vault.process): a sync that lands
       while we work can't be overwritten. split/join on \n keeps each
       line's own \r; fn is given and returns lines without it. */
    await app.vault.process(file, text => {
      const lines = text.split('\n');
      if (lines[card.line] !== card.raw) return text;
      const cr = card.raw.endsWith('\r') ? '\r' : '';
      const bare = cr ? card.raw.slice(0, -1) : card.raw;
      lines[card.line] = fn(bare).split('\n').map(l => l + cr).join('\n');
      out = { ok: true };
      return lines.join('\n');
    });
    return out;
  }

  /* One flag for a practice on a day, exactly as Rhythm's io.js setFlag():
     a tick clears skip, snooze and the day's plan; a plan clears skip and
     snooze. Written with Rhythm's own frontmatter writer, so Rhythm reads
     back precisely what it would have written itself. */
  async function setRhythmFlag(date, key, name, on) {
    const rr = rhythmRoot();
    if (!rr) return { ok: false, reason: 'no-rhythm' };
    const dir = `${rr.root}/${RHYTHM_FOLDERS.log}`;
    const path = `${dir}/${date}.md`;
    const apply = text => {
      const { fm } = parseFrontmatter(text);
      const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
      const cur = { done: list(fm.done), skip: list(fm.skip), snooze: list(fm.snooze), plan: list(fm.plan) };
      const toggle = (arr, add) => (add ? (arr.includes(name) ? arr : [...arr, name]) : arr.filter(n => n !== name));
      cur[key] = toggle(cur[key], on);
      if (key === 'done' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); cur.plan = toggle(cur.plan, false); }
      if (key === 'plan' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); }
      const fields = { done: cur.done };
      for (const k of ['skip', 'snooze', 'plan']) fields[k] = cur[k].length ? cur[k] : undefined;
      return patchFrontmatter(text, fields);
    };
    const file = app.vault.getFileByPath(path);
    if (file) { await app.vault.process(file, apply); return { ok: true }; }
    for (const d of [rr.root, dir]) if (!app.vault.getFolderByPath(d)) await app.vault.createFolder(d);
    try {
      await app.vault.create(path, apply(buildNote({ rhythm: 'log' }, '')));
    } catch (e) {
      /* Lost a race: the day's log appeared meanwhile (Rhythm, or sync).
         Patch the one that exists instead. */
      const now = app.vault.getFileByPath(path);
      if (!now) throw e;
      await app.vault.process(now, apply);
    }
    return { ok: true };
  }

  async function doneOn(date, name) {
    const rr = rhythmRoot();
    const f = rr && app.vault.getFileByPath(`${rr.root}/${RHYTHM_FOLDERS.log}/${date}.md`);
    if (!f) return false;
    const { fm } = parseFrontmatter(await app.vault.cachedRead(f));
    return (Array.isArray(fm.done) ? fm.done : (fm.done ? [fm.done] : [])).map(String).includes(name);
  }

  /* Put a card on another day. Each kind moves the way its owner moves it:
     a Tasks line by its ⏳ alone (📅 is never touched), a reminder through
     Nudge, a practice by its promise in Rhythm's log. Events are fixed. */
  function move(card, date) { return once(card, () => moveNow(card, date)); }
  async function moveNow(card, date) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    if (card.source === 'tasks') return editLine(card, raw => L.setField(raw, 'scheduled', date));
    if (card.source === 'nudge') {
      const ours = nudge();
      if (!ours || typeof ours.setDue !== 'function') return { ok: false, reason: 'no-nudge' };
      /* The list (group) lets Nudge tell apart two reminders with the same
         text in different lists. */
      const r = await ours.setDue({ raw: card.raw, line: card.line, group: card.group }, date);
      return r && r.ok === false ? { ok: false, reason: r.reason || 'changed' } : { ok: true };
    }
    if (card.source === 'practice') {
      /* Two writes, new day first (as Rhythm's movePlan): a failure half way
         leaves the practice on one of the days, never on neither. */
      if (!card.fromTray && card.date === date) return { ok: true };
      const on = await setRhythmFlag(date, 'plan', card.text, true);
      if (!on.ok || card.fromTray || !card.date) return on;
      return setRhythmFlag(card.date, 'plan', card.text, false);
    }
    return { ok: false, reason: 'unknown' };
  }

  /* Tick a card done. Each kind is ticked the way its owner ticks it: a
     Tasks line through Tasks itself (so 🔁 repeats and ✅ dates follow
     your Tasks settings exactly), a reminder through Nudge, a practice as
     done TODAY in Rhythm's log — releasing its promise to another day, if
     it had one. Without Tasks, a plain [x]. */
  function tick(card, today) { return once(card, () => tickNow(card, today)); }
  async function tickNow(card, today) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    if (card.source === 'tasks') {
      const tp = app.plugins && app.plugins.plugins && app.plugins.plugins[TASKS_ID];
      const api = tp && tp.apiV1 && typeof tp.apiV1.executeToggleTaskDoneCommand === 'function' ? tp.apiV1 : null;
      const r = await editLine(card, raw => (api ? api.executeToggleTaskDoneCommand(raw, card.path) : L.setStatus(raw, 'x')));
      /* plain: ticked without Tasks, so no ✅ date or repeat — the board
         says so once. */
      return r.ok && !api ? { ok: true, plain: true } : r;
    }
    if (card.source === 'nudge') {
      const ours = nudge();
      if (!ours || typeof ours.toggle !== 'function') return { ok: false, reason: 'no-nudge' };
      const r = await ours.toggle({ raw: card.raw, line: card.line, group: card.group }, today);
      return r && r.ok === false ? { ok: false, reason: r.reason || 'changed' } : { ok: true };
    }
    if (card.source === 'practice') {
      /* Already done today, and this card is a promise for another day:
         ticking it would add no session and only delete that promise. */
      if (card.date && card.date !== today && await doneOn(today, card.text)) return { ok: false, reason: 'done-today' };
      const done = await setRhythmFlag(today, 'done', card.text, true);
      if (!done.ok || !card.date || card.date === today) return done;
      return setRhythmFlag(card.date, 'plan', card.text, false);
    }
    return { ok: false, reason: 'unknown' };
  }

  return { load, loadRhythm, move, tick, problems: () => problems.slice() };
}

module.exports = { makeStore };
