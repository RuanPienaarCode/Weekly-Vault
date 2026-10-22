'use strict';
/* The store: everything Fortnight reads from (and, later, writes to) the
   vault and the plugins it works with. The board model never touches the
   vault; it is handed what load() returns. */

const { parseFrontmatter, patchFrontmatter, buildNote } = require('./rhythm/markdown');
const L = require('./tasks-line');
const { plannerPathOf } = require('./plan');
const { reviewText } = require('./review');
const D = require('./dates');
const RD = require('./rhythm/dates');

const NUDGE_ID = 'nudge-reminders';
const TASKS_ID = 'obsidian-tasks-plugin';
const RHYTHM_ID = 'rhythm';
/* Rhythm's folder names under its root (Rhythm's constants.js FOLDERS). */
const RHYTHM_FOLDERS = { areas: 'Areas', practices: 'Practices', events: 'Events', log: 'Log' };

/* editLine's fn may answer with one of these instead of text: take the line
   out (Tasks answers "" for a 🏁 delete to-do), or refuse and write nothing. */
const REMOVE = { remove: true };
const refuse = reason => ({ refuse: reason });

/* Does a metadata-cache entry list at least one task? */
const hasTaskItems = c => !!(c && c.listItems && c.listItems.some(li => li.task !== undefined));

function makeStore(plugin) {
  const app = plugin.app;
  /* Sources that are installed but could not be read on the last load. */
  let problems = [];
  /* Cards being written right now. A second tick or move of the same card
     (a double click) is refused until the first write lands — otherwise a
     repeating to-do could be completed twice. */
  const inFlight = new Set();
  /* The notes that held task lines at the last load — kept so a note whose
     tasks have just gone (or whose cache has not caught up) still counts as
     something the board must redraw for. */
  let taskPaths = new Set();
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

  /* Tasks' global filter, if Tasks is enabled and has one. Tasks keeps its
     settings out of reach of other plugins (module-level, not on the plugin
     object); loadData() is the one door, and what it returns is what Tasks
     itself saved. Unreadable or absent: no filter. */
  async function tasksGlobalFilter() {
    const tp = app.plugins && app.plugins.plugins && app.plugins.plugins[TASKS_ID];
    if (!tp || typeof tp.loadData !== 'function') return '';
    try {
      const data = await tp.loadData();
      return data && typeof data.globalFilter === 'string' ? data.globalFilter : '';
    } catch (e) { return ''; }
  }

  /* Every task line in the vault as { path, line, raw, unique }. The metadata
     cache only says WHICH notes to read (it can lag a write by a moment, and
     then its line numbers point at the wrong line); each of those notes is
     read as text and its task lines found here, by the rules Obsidian counts
     them by (tasks-line.js). The planner note is always read — a to-do just
     added to it must show before the cache has indexed it — and so is any
     note that had tasks last time. The reads run together.
     unique: the exact line occurs once in its note, so a write that must find
     it again after it has shifted can do so without guessing between twins.
     Tasks' global filter, if one is set, hides the lines Tasks itself would
     not treat as tasks (its toggle would write those by a crude fallback). */
  async function load() {
    problems = [];
    const ours = nudge();
    const planner = plannerPath();
    const filter = await tasksGlobalFilter();
    const wanted = app.vault.getMarkdownFiles().filter(f => {
      if (ours && ours.isOurs(f.path)) return false;
      return f.path === planner || taskPaths.has(f.path) || hasTaskItems(app.metadataCache.getFileCache(f));
    });
    const [texts, nudged] = await Promise.all([
      Promise.all(wanted.map(f => app.vault.cachedRead(f))),
      reminders(ours),
    ]);
    const out = [];
    const had = new Set();
    wanted.forEach((f, n) => {
      const found = L.taskLines(texts[n]);
      if (!found.length) return;
      had.add(f.path);
      const want = new Set(found.map(t => t.raw));
      const count = new Map();
      for (const l of texts[n].split('\n')) if (want.has(l)) count.set(l, (count.get(l) || 0) + 1);
      for (const t of found) {
        if (L.inFilter(t.raw, filter)) out.push({ source: 'tasks', path: f.path, line: t.line, raw: t.raw, unique: count.get(t.raw) === 1 });
      }
    });
    taskPaths = had;
    return out.concat(nudged);
  }

  /* Can a vault event for this file change what the board shows? True for the
     planner note, Nudge's note, anything under Rhythm's folder, a note whose
     cache holds a task now, and a note that held tasks at the last load (its
     tasks may just have gone: a delete, a rename). A folder counts when it
     holds any of those. file is a TFile/TFolder or just { path }; cache is
     what the event carried — when it carries none, the metadata cache is
     asked. */
  function isRelevant(file, cache) {
    if (!file || typeof file.path !== 'string') return false;
    const path = file.path;
    const under = (p, dir) => p === dir || p.startsWith(dir + '/');
    const rr = rhythmRoot();
    const ours = nudge();
    const planner = plannerPath();
    if (file.extension === undefined && Array.isArray(file.children)) {
      const tracked = [planner, ...taskPaths];
      if (ours) tracked.push(ours.path());
      return tracked.some(p => under(p, path)) || (!!rr && (under(rr.root, path) || under(path, rr.root)));
    }
    if (file.extension !== undefined && file.extension !== 'md') return false;
    if (path === planner || taskPaths.has(path)) return true;
    if (ours && ours.isOurs(path)) return true;
    if (rr && under(path, rr.root)) return true;
    return hasTaskItems(cache != null ? cache : app.metadataCache.getFileCache(file));
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

  /* The log notes the board can use: from the 1st of the month of (today - 7)
     to the last day of the month of (today + 21) — the shown fortnight plus a
     week back, and the monthly cadences that count from the 1st. A vault with
     years of daily logs would otherwise be read in full on every refresh. */
  function logWindow(today) {
    const back = D.addDays(today, -7);
    const ahead = D.addDays(today, 21);
    return [`${back.slice(0, 8)}01`, `${ahead.slice(0, 8)}${String(RD.daysInMonth(ahead)).padStart(2, '0')}`];
  }

  /* Rhythm's records, read exactly as Rhythm's own io.js load() reads them:
     its folder, its frontmatter parser, its field defaults — except that only
     the log notes inside logWindow(today) are read. null when the vault has
     no Rhythm folder. today is an ISO date (default: today). */
  async function loadRhythm(today) {
    /* Only when Rhythm itself is enabled — as with Nudge, a stray folder of
       the same name is not a reason to fill the board. */
    const rr = rhythmRoot();
    if (!rr) return null;
    const { root } = rr;
    if (!app.vault.getFolderByPath(root)) return null;
    const [lo, hi] = logWindow(RD.isISO(today) ? today : D.todayISO());
    const baseName = f => (f.basename !== undefined ? f.basename : String(f.name || '').replace(/\.md$/, ''));
    /* Each kind's notes, read together, handed back sorted by name. */
    const readAll = async (key, keep) => {
      const folder = app.vault.getFolderByPath(`${root}/${RHYTHM_FOLDERS[key]}`);
      const files = ((folder && folder.children) || []).filter(c => c.extension === 'md' && (!keep || keep(baseName(c))))
        .sort((a, b) => baseName(a).localeCompare(baseName(b)));
      const read = await Promise.all(files.map(async f => {
        try { return { name: baseName(f), path: f.path, fm: parseFrontmatter(await app.vault.cachedRead(f)).fm }; }
        catch (e) { console.warn('Fortnight: could not read', f.path, e); return null; }
      }));
      return read.filter(Boolean);
    };
    const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
    const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
    const [areaNotes, practiceNotes, eventNotes, logNotes] = await Promise.all([
      readAll('areas'), readAll('practices'), readAll('events'),
      readAll('log', name => RD.isISO(name) && name >= lo && name <= hi),
    ]);
    const areas = areaNotes.map(r => ({ name: r.name, order: num(r.fm.order), path: r.path }));
    const practices = practiceNotes
      .filter(r => r.fm.status !== 'aside' && r.fm.status !== 'paused')
      .map(r => ({
        name: r.name, area: r.fm.area || '', cadence: r.fm.cadence || 'daily', days: r.fm.days,
        minutes: num(r.fm.minutes), when: r.fm.when || '', time: r.fm.time ? String(r.fm.time) : '', path: r.path,
      }));
    const events = eventNotes.map(r => ({
      name: r.name, area: r.fm.area || '', date: String(r.fm.date || ''), time: r.fm.time ? String(r.fm.time) : '', path: r.path,
    }));
    const log = new Map();
    for (const r of logNotes) {
      if (!RD.isISO(r.name)) continue;
      log.set(r.name, { done: new Set(list(r.fm.done)), skip: new Set(list(r.fm.skip)), snooze: new Set(list(r.fm.snooze)), plan: new Set(list(r.fm.plan)), note: '' });
    }
    return { areas, practices, goals: [], events, log, weekStart: rr.weekStart, folder: root };
  }

  /* ---- writes ---------------------------------------------------------- */

  /* Edit one line of a note, but only if it still says what the board
     read: if the author (or sync) changed it meanwhile, refuse rather than
     guess, and let the board reload. */
  /* fn gets the line (without its \r) and returns the text that replaces it
     — several lines if it likes (Tasks writes a repeating to-do's next
     occurrence above the ticked one) — or REMOVE to take the line out, or
     refuse(reason) to write nothing at all. */
  async function editLine(card, fn) {
    const file = app.vault.getFileByPath(card.path);
    if (!file) return { ok: false, reason: 'missing' };
    let out = { ok: false, reason: 'changed' };
    /* One atomic read-modify-write (vault.process): a sync that lands
       while we work can't be overwritten. split/join on \n keeps each
       line's own \r; fn is given and returns lines without it. */
    await app.vault.process(file, text => {
      const lines = text.split('\n');
      /* Not where the board saw it? A line that merely SHIFTED (a 🔁 tick
         inserted its next occurrence above, or sync added a line) is still
         this card — but only if the card was the one identical line in its
         note when the board read it (card.unique, from load()) and is the
         one identical line now. A twin that was already there (the same
         to-do under two headings) means "the one left" may be the OTHER
         card's line, so then: refuse rather than guess. */
      let at = card.line;
      if (lines[at] !== card.raw) {
        if (card.unique !== true) return text;
        const same = [];
        lines.forEach((l, i) => { if (l === card.raw) same.push(i); });
        if (same.length !== 1) return text;
        at = same[0];
      }
      const cr = card.raw.endsWith('\r') ? '\r' : '';
      const bare = cr ? card.raw.slice(0, -1) : card.raw;
      const res = fn(bare);
      if (res === REMOVE) {
        lines.splice(at, 1);
      } else if (res && typeof res === 'object') {
        out = { ok: false, reason: res.refuse };
        return text;
      } else {
        lines[at] = String(res).split('\n').map(l => l + cr).join('\n');
      }
      out = { ok: true };
      return lines.join('\n');
    });
    return out;
  }

  /* A folder, made if it is not there — and if making it fails because it
     appeared in the meantime (sync, a second write), that is fine. */
  async function ensureFolder(dir) {
    if (app.vault.getFolderByPath(dir)) return;
    try { await app.vault.createFolder(dir); }
    catch (e) { if (!app.vault.getFolderByPath(dir)) throw e; }
  }
  /* Every folder on the way down to dir. */
  async function ensureFolders(dir) {
    const parts = String(dir || '').split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) await ensureFolder(parts.slice(0, i).join('/'));
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
    let refused = null;
    const apply = text => {
      const { fm } = parseFrontmatter(text);
      const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
      const cur = { done: list(fm.done), skip: list(fm.skip), snooze: list(fm.snooze), plan: list(fm.plan) };
      /* Already DONE that day: promising it again would list it as both, and
         Rhythm would key two cards the same. Decided inside the write. */
      if (key === 'plan' && on && cur.done.includes(name)) { refused = 'done-that-day'; return text; }
      const toggle = (arr, add) => (add ? (arr.includes(name) ? arr : [...arr, name]) : arr.filter(n => n !== name));
      cur[key] = toggle(cur[key], on);
      if (key === 'done' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); cur.plan = toggle(cur.plan, false); }
      if (key === 'plan' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); }
      const fields = { done: cur.done };
      for (const k of ['skip', 'snooze', 'plan']) fields[k] = cur[k].length ? cur[k] : undefined;
      return patchFrontmatter(text, fields);
    };
    const result = () => (refused ? { ok: false, reason: refused } : { ok: true });
    const file = app.vault.getFileByPath(path);
    if (file) { await app.vault.process(file, apply); return result(); }
    await ensureFolders(dir);
    try {
      await app.vault.create(path, apply(buildNote({ rhythm: 'log' }, '')));
    } catch (e) {
      /* Lost a race: the day's log appeared meanwhile (Rhythm, or sync).
         Patch the one that exists instead. */
      const now = app.vault.getFileByPath(path);
      if (!now) throw e;
      await app.vault.process(now, apply);
    }
    return result();
  }

  /* The planner note's path, tidied: one kind of slash, no "./" or leading
     "/", and ".md" added — a path without it would create a file Obsidian
     never lists as a note, so added to-dos would never show. */
  const plannerPath = () => plannerPathOf(plugin.settings);

  /* Quick-add: a new Tasks line with the column's day as its ⏳, written at
     the end of the planner note's "## Inbox" section (made if missing).
     What was typed is kept, Tasks fields and all; only ⏳ is set, and a
     typed checkbox isn't doubled. Every other line keeps its own ending,
     "#" lines inside code fences or front matter are not headings, and a
     BOM in front of the first line stays where it is. Says what it wrote:
     { ok: true, raw } — raw is the line exactly as it sits in the note (with
     its \r in a CRLF note), so the board can look for that very line. */
  async function add({ text, date, slot, monday }) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().replace(/^(?:[-*+] +)?\[.\] */, '');
    if (!clean) return { ok: false, reason: 'empty' };
    const base = `- [ ] ${clean}`;
    const line = slot === 'nextWeek' || slot === 'later' ? parked(base, slot, monday, plannerPath()) : onDay(base, date);
    const path = plannerPath();
    let written = line;
    const insert = textNow => {
      const bom = textNow.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '';
      const lines = textNow.slice(bom.length).split('\n');
      const bare = l => l.replace(/\r$/, '');
      /* The note's own ending, for a line that has none of its own to copy
         (the last line of a note with no final newline). */
      const noteCr = /\r\n/.test(textNow) ? '\r' : '';
      const skip = L.verbatimLines(lines);
      /* Headings outside code fences and front matter, as [index, level, text]. */
      const heads = [];
      lines.forEach((l, i) => {
        if (skip[i]) return;
        const h = bare(l).match(/^(#{1,6})\s+(.*?)\s*$/);
        if (h) heads.push([i, h[1].length, h[2]]);
      });
      const inbox = heads.find(h => /^inbox$/i.test(h[2]));
      if (!inbox) {
        const before = lines.length;
        while (lines.length && bare(lines[lines.length - 1]) === '') lines.pop();
        /* Copy the ending of the last line kept. If nothing followed it, it
           has none yet — it gets the note's, because lines now follow it. */
        const last = lines.length - 1;
        let cr = noteCr;
        if (last >= 0 && lines[last].endsWith('\r')) cr = '\r';
        else if (last >= 0 && lines.length < before) cr = '';
        else if (last >= 0) lines[last] += cr;
        lines.push(cr, `## Inbox${cr}`, line + cr, '');
        written = line + cr;
        return bom + lines.join('\n');
      }
      const next = heads.find(h => h[0] > inbox[0] && h[1] <= inbox[1]);
      const end = next ? next[0] : lines.length;
      let at = inbox[0] + 1;
      for (let i = inbox[0] + 1; i < end; i++) if (bare(lines[i]).trim()) at = i + 1;
      const prev = at - 1;
      if (prev === lines.length - 1) {
        /* The note ends on that line with no line ending: it gets one, and
           the new line is the new last line, ending as the note did. */
        if (!lines[prev].endsWith('\r')) lines[prev] += noteCr;
        lines.push(line);
        written = line;
      } else {
        const cr = lines[prev].endsWith('\r') ? '\r' : '';
        lines.splice(at, 0, line + cr);
        written = line + cr;
      }
      return bom + lines.join('\n');
    };
    const file = app.vault.getFileByPath(path);
    if (file) { await app.vault.process(file, insert); return { ok: true, raw: written }; }
    await ensureFolders(path.split('/').slice(0, -1).join('/'));
    try {
      await app.vault.create(path, `# Fortnight\n\n## Inbox\n${line}\n`);
      written = line;
    } catch (e) {
      /* Lost a race (a second add, or sync): write into the note that won. */
      const now = app.vault.getFileByPath(path);
      if (!now) throw e;
      await app.vault.process(now, insert);
    }
    return { ok: true, raw: written };
  }

  /* The evening review, APPENDED to the day's note — nothing above it is
     touched. The folder: settings.reviewFolder, else Rhythm's log (when
     Rhythm is on and has its folder), else "Reviews". A second review the same day gets its
     time in the heading. The note keeps its own line endings. */
  /* Where today's review goes, and the heading it will have — asked
     BEFORE anything is changed, so the preview shows the exact text and a
     bad folder is caught while nothing has been written. */
  const tidyFolder = v => String(v || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '');
  function reviewFolderOf() {
    const rr = rhythmRoot();
    const own = tidyFolder(plugin.settings.reviewFolder);
    /* Rhythm's log only when Rhythm is on AND its folder exists: creating
       Rhythm/Log for it would make Rhythm think it has data, and its setup
       would never show. */
    const useRhythm = !own && !!rr && !!app.vault.getFolderByPath(rr.root);
    return { folder: own || (useRhythm ? `${rr.root}/${RHYTHM_FOLDERS.log}` : 'Reviews'), isRhythmLog: useRhythm };
  }
  const headingFor = (text, time) => (/^## Review\b/m.test(text || '') ? `## Review · ${time}` : '## Review');
  async function reviewTarget(date, time) {
    const { folder } = reviewFolderOf();
    if (app.vault.getFileByPath(folder)) return { ok: false, reason: 'folder-is-note' };
    const path = `${folder}/${date}.md`;
    const f = app.vault.getFileByPath(path);
    return { ok: true, path, heading: headingFor(f ? await app.vault.cachedRead(f) : '', time) };
  }

  async function writeReview(date, parts, time, fixedHeading) {
    const { folder, isRhythmLog } = reviewFolderOf();
    if (app.vault.getFileByPath(folder)) return { ok: false, reason: 'folder-is-note' };
    const path = `${folder}/${date}.md`;
    const append = text => {
      const eol = /\r\n/.test(text) ? '\r\n' : '\n';
      const heading = fixedHeading || headingFor(text, time);
      const block = reviewText(Object.assign({ heading }, parts)).replace(/\n/g, eol);
      const lead = !text ? '' : text.endsWith(eol) ? eol : eol + eol;
      return text + lead + block;
    };
    const file = app.vault.getFileByPath(path);
    if (file) { await app.vault.process(file, append); return { ok: true, path }; }
    await ensureFolders(folder);
    /* A new Rhythm log starts exactly as Rhythm starts one (done: []). */
    const start = isRhythmLog ? patchFrontmatter(buildNote({ rhythm: 'log' }, ''), { done: [] }) : '';
    try {
      await app.vault.create(path, append(start));
    } catch (e) {
      /* Lost a race (Rhythm made the day's log meanwhile): append to it. */
      const now = app.vault.getFileByPath(path);
      if (!now) throw e;
      await app.vault.process(now, append);
    }
    return { ok: true, path };
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

  function park(card, where, monday, today = D.todayISO()) { return once(card, () => parkNow(card, where, monday, today)); }
  async function parkNow(card, where, monday, today) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    if (isDone(card)) return { ok: false, reason: 'done' };
    /* Reminders and practices need a day for now (#11, #12). */
    if (card.source !== 'tasks') return { ok: false, reason: 'needs-day' };
    /* 📅 is never touched. Next week (🛫 its Monday) is fine for a deadline
       already past or not before that Monday; one due sooner would be
       hidden past its deadline. Later can't hold a dated card at all — nor a
       repeating one: Tasks needs a date on a 🔁, and Later strips them. */
    const t = L.parseTask(card.raw);
    if (where === 'later' && t && t.recurrence) return { ok: false, reason: 'repeats' };
    if (t && t.due) {
      if (where === 'later') return { ok: false, reason: 'has-deadline' };
      if (t.due >= today && t.due < monday) return { ok: false, reason: 'due-sooner', due: t.due };
    }
    let after = null;
    const r = await editLine(card, raw => (after = parked(raw, where, monday, card.path)));
    /* Tagged: say so, with what it was, so the board can offer Undo. */
    if (r.ok && where === 'later' && after && L.hasTag(after, laterTag()) && !L.hasTag(card.raw, laterTag())) {
      const cr = card.raw.endsWith('\r') ? '\r' : '';
      return { ok: true, tagged: true, before: card.raw, after: after + cr };
    }
    return r;
  }

  /* Drop: the to-do is cancelled ([-]) — only the box changes, and the line
     stays in its note. Says what it was, so the board can offer Undo. */
  function drop(card, today = D.todayISO()) { return once(card, () => dropNow(card, today)); }
  async function dropNow(card, today) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    if (card.source !== 'tasks') return { ok: false, reason: 'not-droppable' };
    /* Tasks never makes the next occurrence of a cancelled line: dropping
       a 🔁 to-do would end its repeat for good. */
    if ((L.parseTask(card.raw || '') || {}).recurrence) return { ok: false, reason: 'repeats' };
    let after = null;
    /* Cancelled the way Tasks cancels: [-] and a ❌ date. */
    const r = await editLine(card, raw => (after = L.setField(L.setStatus(raw, '-'), 'cancelledDate', today)));
    if (!r.ok) return r;
    const cr = card.raw.endsWith('\r') ? '\r' : '';
    return { ok: true, before: card.raw, after: after + cr };
  }

  /* Undo: put back the line that was there, if it still reads as we left
     it. editLine keeps the line's own \r. The card's `unique` carries over:
     a to-do that had no twin may be found again where it shifted to. */
  function revert(card, now, before) {
    return editLine({ path: card.path, line: card.line, raw: now, unique: card.unique }, () => before.replace(/\r$/, ''));
  }

  /* Put a card on another day. Each kind moves the way its owner moves it:
     a Tasks line by its ⏳ alone (📅 is never touched), a reminder through
     Nudge, a practice by its promise in Rhythm's log. Events are fixed. */
  function move(card, date) { return once(card, () => moveNow(card, date)); }
  /* Finished is finished: its plan date is history. */
  const isDone = card => card.done || (card.source === 'tasks' && !!(L.parseTask(card.raw || '') || {}).done);

  /* Does Nudge still hold this reminder — the exact line, in the same list?
     Nudge finds a reminder again by its TITLE when its line is gone, so a
     stale card for a 🔁 reminder (ticked on the phone since, the series rolled
     on) would be matched to the NEXT occurrence and complete that one instead.
     So ask first, and write only on a certain match: one line with this exact
     text in this list, or — among identical ones — the one at the card's own
     line. Returns Nudge's current copy of it, or null. (A Nudge old enough to
     have no load() cannot be asked; the card stands as it is.) */
  async function nudgeHolds(ours, card) {
    if (typeof ours.load !== 'function') return card;
    let items;
    try { items = (await ours.load()).items || []; } catch (e) { return null; }
    const same = items.filter(r => r.raw === card.raw && (card.group === undefined || (r.group || '') === (card.group || '')));
    if (same.length === 1) return same[0];
    return same.find(r => r.line === card.line) || null;
  }

  async function moveNow(card, date) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    if (isDone(card)) return { ok: false, reason: 'done' };
    if (card.source === 'tasks') return editLine(card, raw => onDay(raw, date));
    if (card.source === 'nudge') {
      const ours = nudge();
      if (!ours || typeof ours.setDue !== 'function') return { ok: false, reason: 'no-nudge' };
      const held = await nudgeHolds(ours, card);
      if (!held) return { ok: false, reason: 'changed' };
      /* Nudge can only set 📅. A reminder with just a ⏳ would gain a deadline
         nobody set while its ⏳ stayed on the old day. */
      if (!held.due) return { ok: false, reason: 'nudge-no-due' };
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
     it had one. Without Tasks, a plain [x] with today's ✅ date. */
  function tick(card, today = D.todayISO()) { return once(card, () => tickNow(card, today)); }
  async function tickNow(card, today) {
    if (card.source === 'event') return { ok: false, reason: 'locked' };
    if (card.source === 'tasks') {
      const tp = app.plugins && app.plugins.plugins && app.plugins.plugins[TASKS_ID];
      const api = tp && tp.apiV1 && typeof tp.apiV1.executeToggleTaskDoneCommand === 'function' ? tp.apiV1 : null;
      const r = await editLine(card, raw => {
        if (!api) return L.setField(L.setStatus(raw, 'x'), 'doneDate', today);
        const out = api.executeToggleTaskDoneCommand(raw, card.path);
        /* "" is Tasks' answer for a 🏁 delete to-do: the line goes. */
        if (out === '') return REMOVE;
        /* Tasks falls back to a crude replace for a line it can't read as a
           task, and that can leave the box open or the line mangled. Only an
           answer with a done line in it is written. */
        const done = typeof out === 'string' && out.split('\n').some(l => { const t = L.parseTask(l); return !!t && t.done; });
        return done ? out : refuse('not-done');
      });
      /* plain: ticked without Tasks, so no repeat — the board says so once. */
      return r.ok && !api ? { ok: true, plain: true } : r;
    }
    if (card.source === 'nudge') {
      const ours = nudge();
      if (!ours || typeof ours.toggle !== 'function') return { ok: false, reason: 'no-nudge' };
      if (!await nudgeHolds(ours, card)) return { ok: false, reason: 'changed' };
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

  return { load, loadRhythm, isRelevant, move, park, revert, drop, tick, add, reviewTarget, writeReview, plannerPath, problems: () => problems.slice() };
}

module.exports = { makeStore };
