'use strict';
/* The store: everything Fortnight reads from (and, later, writes to) the
   vault and the plugins it works with. The board model never touches the
   vault; it is handed what load() returns. */

const { parseFrontmatter, patchFrontmatter, buildNote } = require('./rhythm/markdown');
const L = require('./tasks-line');
const { plannerPathOf } = require('./plan');
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

  /* The planner note's path, tidied: one kind of slash, no "./" or leading
     "/", and ".md" added — a path without it would create a file Obsidian
     never lists as a note, so added to-dos would never show. */
  const plannerPath = () => plannerPathOf(plugin.settings);

  /* Quick-add: a new Tasks line with the column's day as its ⏳, written at
     the end of the planner note's "## Inbox" section (made if missing).
     What was typed is kept, Tasks fields and all; only ⏳ is set, and a
     typed checkbox isn't doubled. Every other line keeps its own ending,
     and "#" lines inside code fences are not headings. */
  async function add({ text, date, slot, monday }) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().replace(/^(?:[-*+] +)?\[.\] */, '');
    if (!clean) return { ok: false, reason: 'empty' };
    const base = `- [ ] ${clean}`;
    const line = slot === 'nextWeek' || slot === 'later' ? parked(base, slot, monday, plannerPath()) : onDay(base, date);
    const path = plannerPath();
    const insert = textNow => {
      const lines = textNow.split('\n');
      const bare = l => l.replace(/\r$/, '');
      const crOf = l => (l && l.endsWith('\r') ? '\r' : '');
      /* Headings outside code fences, as [index, level, text]. */
      const heads = [];
      let fence = null;
      lines.forEach((l, i) => {
        const b = bare(l);
        const f = b.match(/^\s*(```+|~~~+)/);
        if (f) { fence = fence === null ? f[1][0] : (f[1][0] === fence ? null : fence); return; }
        if (fence !== null) return;
        const h = b.match(/^(#{1,6})\s+(.*?)\s*$/);
        if (h) heads.push([i, h[1].length, h[2]]);
      });
      const inbox = heads.find(h => /^inbox$/i.test(h[2]));
      if (!inbox) {
        while (lines.length && bare(lines[lines.length - 1]) === '') lines.pop();
        const cr = crOf(lines[lines.length - 1]);
        lines.push(cr, `## Inbox${cr}`, line + cr, '');
        return lines.join('\n');
      }
      const next = heads.find(h => h[0] > inbox[0] && h[1] <= inbox[1]);
      const end = next ? next[0] : lines.length;
      let at = inbox[0] + 1;
      for (let i = inbox[0] + 1; i < end; i++) if (bare(lines[i]).trim()) at = i + 1;
      lines.splice(at, 0, line + crOf(lines[at - 1]));
      return lines.join('\n');
    };
    const file = app.vault.getFileByPath(path);
    if (file) { await app.vault.process(file, insert); return { ok: true }; }
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir);
    }
    try {
      await app.vault.create(path, `# Fortnight\n\n## Inbox\n${line}\n`);
    } catch (e) {
      /* Lost a race (a second add, or sync): write into the note that won. */
      const now = app.vault.getFileByPath(path);
      if (!now) throw e;
      await app.vault.process(now, insert);
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

  const laterTag = () => plugin.settings.laterTag || '#later';
  /* Notes Later reads without a tag: the planner note and chosen folders. */
  function isLaterSource(path) {
    if (path === plannerPath()) return true;
    return (plugin.settings.laterFolders || []).some(f => {
      const dir = String(f).replace(/^\/+|\/+$/g, '');
      return dir && path.startsWith(dir + '/');
    });
  }

  /* A Tasks line put on a day: its ⏳ set, any #later taken off; a 🛫
     ("not before") later than that day is dropped, so the line doesn't
     contradict itself. */
  function onDay(raw, date) {
    const next = L.setField(L.removeTag(raw, laterTag()), 'scheduled', date);
    const t = L.parseTask(next);
    return t && t.start && t.start > date ? L.setField(next, 'start', null) : next;
  }

  /* A Tasks line parked without a day: Next week is 🛫 its Monday (Tasks'
     own "not before"); Later is neither ⏳ nor 🛫 — and, in a note Later
     doesn't otherwise read, a #later tag so it stays on the board (Q36).
     📅 is never touched. */
  function parked(raw, where, monday, path) {
    const bare = L.setField(L.removeTag(raw, laterTag()), 'scheduled', null);
    if (where === 'nextWeek') return L.setField(bare, 'start', monday);
    const undated = L.setField(bare, 'start', null);
    return isLaterSource(path) ? undated : L.addTag(undated, laterTag());
  }

  function park(card, where, monday) { return once(card, () => parkNow(card, where, monday)); }
  async function parkNow(card, where, monday) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    /* Reminders and practices need a day for now (#11, #12). */
    if (card.source !== 'tasks') return { ok: false, reason: 'needs-day' };
    /* A 📅 deadline is never touched and keeps the card on its due day, so
       parking it would change the note and claim a move that didn't happen. */
    const t = L.parseTask(card.raw);
    if (t && t.due) return { ok: false, reason: 'has-deadline' };
    let after = null;
    const r = await editLine(card, raw => (after = parked(raw, where, monday, card.path)));
    /* Tagged: say so, with what it was, so the board can offer Undo. */
    if (r.ok && where === 'later' && after && L.hasTag(after, laterTag()) && !L.hasTag(card.raw, laterTag())) {
      const cr = card.raw.endsWith('\r') ? '\r' : '';
      return { ok: true, tagged: true, before: card.raw, after: after + cr };
    }
    return r;
  }

  /* Undo: put back the line that was there, if it still reads as we left
     it. editLine keeps the line's own \r. */
  function revert(card, now, before) {
    return editLine({ path: card.path, line: card.line, raw: now }, () => before.replace(/\r$/, ''));
  }

  /* Put a card on another day. Each kind moves the way its owner moves it:
     a Tasks line by its ⏳ alone (📅 is never touched), a reminder through
     Nudge, a practice by its promise in Rhythm's log. Events are fixed. */
  function move(card, date) { return once(card, () => moveNow(card, date)); }
  async function moveNow(card, date) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    if (card.source === 'tasks') return editLine(card, raw => onDay(raw, date));
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

  return { load, loadRhythm, move, park, revert, tick, add, plannerPath, problems: () => problems.slice() };
}

module.exports = { makeStore };
