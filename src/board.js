'use strict';
/* The board (desktop): this week's days as columns in the Grouped look.
   What goes where is planBoard's call; moving a card is the store's. */

const { setIcon, Menu, Notice, Platform } = require('obsidian');
const { planBoard, actionsFor } = require('./plan');
const { introScreens, shouldShowIntro } = require('./intro');
const { reviewCards, reviewText } = require('./review');
const H = require('./board-helpers');
const D = require('./dates');

const { DOW, dayNum, short } = D;
const noteName = path => path.split('/').pop().replace(/\.md$/, '');
/* "Wed 7 Oct" — or, for a day that doesn't exist (a line can say ⏳ 2026-09-31),
   the text as written: no weekday invented for it. */
const dayLabel = date => (D.isDate(date) ? `${DOW[D.weekday(date)]} ${short(date)}` : short(date));
const DRAG_TYPE = 'text/x-fortnight-card';

/* The card being dragged, held from dragstart to drop. The drop must move
   THIS card: looking it up by its path:line key at drop time moved a
   different to-do whenever a refresh mid-drag had shifted the lines. (The
   store still checks the line is what this card read, so a stale card is
   refused, never misapplied.) Module-level so a drag between two Fortnight
   windows lands too. */
let dragged = null;
let uid = 0;

/* Why a write was refused, in words. 'busy' (a double click) is silent. */
const REASON = {
  changed: 'it changed in its note — the board has been refreshed',
  /* Nudge's toggle found the line only by its date-tolerant fallback on a 🔁
     reminder: it rolled on (or was edited) since this board read it. */
  stale: 'that reminder changed in Nudge since this board read it, so nothing was ticked — the board has been refreshed',
  locked: 'events are fixed',
  repeat: "Nudge couldn't work out its next date",
  'done-today': "it's already done today — that promise is kept for its day",
  'done-that-day': "that practice is already done on that day",
  missing: 'its note no longer exists',
  'no-nudge': "Nudge isn't available",
  'no-rhythm': "Rhythm isn't available",
  'nudge-no-due': "this reminder has no 📅 date, and Nudge can only change a reminder's 📅 — set its date in Nudge first",
  'needs-day': 'reminders and practices need a day — drop it on one',
  'not-droppable': 'only to-dos can be dropped',
  'not-done': "Tasks didn't mark it done, so nothing was changed",
  done: "it's done — its date is history",
  repeats: 'it repeats (🔁), and dropping it would end the repeat — tick it instead, or change the repeat in its note',
  'has-deadline': 'it has a 📅 deadline — put it on a day instead, or remove the deadline in its note',
  'due-sooner': "it's due before next week — put it on a day this week instead",
};
/* 'repeats' says different things for a drop and for Later. */
const REASON_LATER_REPEATS = 'it repeats (🔁), and Later has no date to repeat from — put it on a day or in Next week instead';
const why = reason => REASON[reason] || 'something went wrong (see the console)';

/* A Notice with a message and an Undo button, built the way Obsidian builds
   its own (createFragment + createEl) when they exist. onUndo gets the
   notice, to hide it. */
function undoNotice(message, onUndo, ms) {
  const frag = typeof createFragment === 'function' ? createFragment() : document.createDocumentFragment();
  const add = (tag, o) => {
    if (frag.createEl) return frag.createEl(tag, o);
    const el = frag.appendChild(document.createElement(tag));
    el.textContent = o.text;
    if (o.cls) el.className = o.cls;
    return el;
  };
  add('span', { text: message });
  const undo = add('button', { text: 'Undo', cls: 'mod-cta' });
  const notice = new Notice(frag, ms || 8000);
  undo.addEventListener('click', async ev => {
    ev.stopPropagation();
    await onUndo(notice);
  });
}

function mountBoard(view) {
  const plugin = view.plugin;
  const root = view.contentEl;
  root.empty();
  root.addClass('fortnight');
  /* The window this view lives in: a pop-out's document and timers are not
     the global ones. */
  const doc = () => root.ownerDocument;
  const win = () => root.ownerDocument.defaultView || window;

  /* The board redraws inside main; the welcome lies over it, untouched by
     a redraw underneath. */
  const main = root.createDiv({ cls: 'fn-main' });
  let stopped = false;
  let intro = null;
  let lastBoard = null;
  let loading = null;
  let again = false;
  /* A write just landed: the next draw happens even if the board reads the
     same (a refused write leaves buttons half-pressed). */
  let forceNext = false;
  /* What the last draw was made from (board + view state): a load that
     brings nothing new redraws nothing. */
  let lastSig = null;
  let wantWelcome = false;
  let showAllSlipped = false;
  /* What is typed in each day's add field, kept across redraws (a sync or
     the previous add landing mid-typing must not wipe it). */
  const drafts = new Map();
  /* Add fields with a write in flight: a second Enter waits. */
  const writing = new Set();
  /* Phone (or a narrow pane): one day at a time. What is shown — a date,
     'nextWeek' or 'later' — and whether the last draw was the phone one. */
  let phoneSel = null;
  let wasPhone = null;
  let sheet = null;
  const isPhone = () => !!(Platform && Platform.isPhone) || (root.clientWidth > 0 && root.clientWidth < 640);
  /* Next week shown as its seven days (else one summary column). */
  let nextOpen = false;
  /* Days whose Done group is open, by date. */
  const openDone = new Set();
  let lastTasks = [];
  let lastRhythm = null;
  const SLIPPED_PREVIEW = 5;

  /* ---- the accent ------------------------------------------------------- */

  /* Pixels of any CSS colour the cheap parser can't read (oklch, named, …):
     a 1px canvas parses it for us. null if the browser can't either. */
  function canvasRgb(css) {
    try {
      const ctx = doc().createElement('canvas').getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#010203';
      ctx.fillStyle = css;
      if (ctx.fillStyle === '#010203' && !/^#010203$/i.test(css)) return null;
      ctx.fillRect(0, 0, 1, 1);
      const px = ctx.getImageData(0, 0, 1, 1).data;
      return [px[0], px[1], px[2]];
    } catch (e) { return null; }
  }
  /* Following the theme's accent hands Fortnight whatever colour the user
     picked — Obsidian's own default is 2.9:1 on a white page. Where that
     can't be read, lower its lightness (same hue) until it can (4.5:1). */
  let accentKey = '';
  let accentFix = null;
  function themeAccentFix() {
    const cs = win().getComputedStyle(root);
    const accent = cs.getPropertyValue('--interactive-accent').trim();
    const paper = cs.getPropertyValue('--background-primary').trim();
    const key = `${accent}|${paper}`;
    if (key !== accentKey) {
      accentKey = key;
      const a = accent && (H.parseColor(accent) || canvasRgb(accent));
      const p = paper && (H.parseColor(paper) || canvasRgb(paper));
      accentFix = a && p ? H.clampAccent(a, p) : null;
    }
    return accentFix;
  }
  function applyAccent() {
    const theme = plugin.settings.accent === 'theme';
    root.toggleClass('fn-blue', !theme);
    const fix = theme ? themeAccentFix() : null;
    if (fix) {
      root.style.setProperty('--fn-hsl', fix);
      root.style.setProperty('--fn-accent', `hsl(${fix})`);
    } else {
      root.style.removeProperty('--fn-hsl');
      root.style.removeProperty('--fn-accent');
    }
  }
  applyAccent();

  /* ---- keeping the reader's place across a redraw ----------------------- */

  /* Every control worth coming back to is registered under a stable key
     (tick:<card>, add:<day>, …) as it is drawn. Before a redraw the focused
     one's key is noted; after it, that control — or, if it is gone (a
     to-do ticked off, moved to another day), the top of its column — gets
     focus again. */
  let focusMap = new Map();
  const fk = (el, key) => { el.setAttribute('data-fn-focus', key); focusMap.set(key, el); return el; };

  function captureFocus() {
    const a = doc().activeElement;
    if (!a || !a.getAttribute || !main.contains(a)) return null;
    const key = a.getAttribute('data-fn-focus');
    if (!key) return null;
    const col = a.closest('[data-fn-col]');
    const f = { key, col: col ? col.getAttribute('data-fn-col') : '' };
    /* A half-typed to-do keeps its caret (or selection). */
    if (a.tagName === 'INPUT' && typeof a.selectionStart === 'number') {
      f.start = a.selectionStart;
      f.end = a.selectionEnd;
      f.dir = a.selectionDirection || 'none';
    }
    return f;
  }

  function restoreFocus(f) {
    if (!f || stopped) return;
    let el = focusMap.get(f.key);
    if (!el) {
      const col = f.col && Array.from(main.querySelectorAll('[data-fn-col]')).find(c => c.getAttribute('data-fn-col') === f.col);
      el = col ? (col.querySelector('.fn-row') || col.querySelector('.fn-addinput')) : null;
      if (!el) el = focusMap.get('review');
    }
    if (!el) return;
    el.focus({ preventScroll: true });
    if (f.start != null && el.getAttribute('data-fn-focus') === f.key) {
      try { el.setSelectionRange(f.start, f.end, f.dir); } catch (e) { /* not a text field any more */ }
    }
  }

  /* While the sheet or the review is up, the pane behind doesn't scroll
     (CSS: .fn-locked). */
  const syncLock = () => root.toggleClass('fn-locked', !!(sheet || review));

  /* ---- writes ----------------------------------------------------------- */

  /* Move a card and redraw. A refusal (the note changed underneath, or the
     card is fixed) is said plainly and the board reloads from the vault. */
  async function moveTo(card, date) {
    let r;
    try { r = await plugin.store.move(card, date); }
    catch (e) { console.error('Fortnight: move failed', e); r = { ok: false, reason: 'error' }; }
    if (!r.ok && r.reason !== 'busy') {
      new Notice(`Fortnight: couldn't move "${card.text}": ${why(r.reason)}.`);
    }
    await refresh(true);
  }

  /* Tick a card done; the store routes it to Tasks, Nudge or Rhythm. */
  async function tickCard(card) {
    let r;
    try { r = await plugin.store.tick(card, D.todayISO()); }
    catch (e) { console.error('Fortnight: tick failed', e); r = { ok: false, reason: 'error' }; }
    if (!r.ok && r.reason !== 'busy') {
      new Notice(`Fortnight: couldn't tick "${card.text}": ${why(r.reason)}.`);
    }
    if (r.plain && !plugin._toldPlainTick) {
      plugin._toldPlainTick = true;
      new Notice('Fortnight: ticked as a plain [x]. Install the Tasks plugin to get ✅ dates and repeating to-dos.', 8000);
    }
    await refresh(true);
  }

  /* Where a card or a new to-do can go: a day, Next week ("any day"), or
     Later. key is what drafts and focus are remembered by. */
  const dayDest = date => ({ key: date, date, label: dayLabel(date) });
  const nextDest = board => ({ key: 'nextWeek', slot: 'nextWeek', monday: board.nextWeek.start, label: 'Next week' });
  const LATER = { key: 'later', slot: 'later', label: 'Later' };

  async function parkTo(card, dest) {
    let r;
    try { r = await plugin.store.park(card, dest.slot, dest.monday); }
    catch (e) { console.error('Fortnight: move failed', e); r = { ok: false, reason: 'error' }; }
    if (!r.ok && r.reason !== 'busy') {
      const reason = r.reason === 'due-sooner' && r.due
        ? `it's due ${dayLabel(r.due)} — put it on a day before then instead`
        : r.reason === 'repeats' ? REASON_LATER_REPEATS : why(r.reason);
      new Notice(`Fortnight: couldn't move "${card.text}" to ${dest.label}: ${reason}.`);
    }
    /* Tagged in its own note: say where, and offer to take it back. */
    if (r.ok && r.tagged) {
      const tag = plugin.settings.laterTag || '#later';
      undoNotice(`"${card.text}" is in Later — tagged ${tag} in ${card.path.replace(/\.md$/, '')}. `, async notice => {
        const back = await plugin.store.revert(card, r.after, r.before);
        if (notice && notice.hide) notice.hide();
        if (!back.ok) new Notice(`Fortnight: couldn't undo — the line changed in ${card.path}.`);
        await refresh(true);
      });
    }
    await refresh(true);
  }

  const sendTo = (card, dest) => (dest.date ? moveTo(card, dest.date) : parkTo(card, dest));

  /* Drop: cancelled in its note, with Undo. */
  async function dropCard(card) {
    let r;
    try { r = await plugin.store.drop(card); }
    catch (e) { console.error('Fortnight: drop failed', e); r = { ok: false, reason: 'error' }; }
    if (!r.ok) {
      if (r.reason !== 'busy') new Notice(`Fortnight: couldn't drop "${card.text}": ${why(r.reason)}.`);
    } else {
      undoNotice(`Dropped "${card.text}". `, async notice => {
        const back = await plugin.store.revert(card, r.after, r.before);
        if (notice && notice.hide) notice.hide();
        if (!back.ok) new Notice(`Fortnight: couldn't undo — the line changed in ${card.path}.`);
        await refresh(true);
      });
    }
    await refresh(true);
  }

  /* ---- moving by hand --------------------------------------------------- */

  /* The days a card can still go to: today and the days ahead on the board. */
  const openDays = board => board.days.filter(d => !d.past);

  function moveMenu(e, card, board) {
    const menu = new Menu();
    for (const d of openDays(board)) {
      menu.addItem(i => i
        .setTitle(d.isToday ? `Today (${DOW[D.weekday(d.date)]})` : dayLabel(d.date))
        .setIcon('calendar')
        .setDisabled(d.date === card.date && !card.fromTray)
        .onClick(() => moveTo(card, d.date)));
    }
    if (card.source === 'tasks') {
      /* The same rule as the phone sheet (actionsFor in plan.js). */
      const can = actionsFor(card, board);
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Next week (any day)').setIcon('calendar-range').setDisabled(!can.nextWeek).onClick(() => parkTo(card, nextDest(board))));
      menu.addItem(i => i.setTitle('Later').setIcon('inbox').setDisabled(!can.later).onClick(() => parkTo(card, LATER)));
    }
    menu.showAtMouseEvent(e);
  }

  function makeDraggable(el, card, board) {
    if (card.source === 'event') return;
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', e => {
      dragged = card;
      e.dataTransfer.setData(DRAG_TYPE, card.key);
      e.dataTransfer.effectAllowed = 'move';
      el.addClass('is-dragging');
    });
    el.addEventListener('dragend', () => { dragged = null; el.removeClass('is-dragging'); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); moveMenu(e, card, board); });
  }

  function makeDropTarget(el, dest) {
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.addClass('is-drop');
    });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.removeClass('is-drop'); });
    el.addEventListener('drop', e => {
      el.removeClass('is-drop');
      const card = dragged;
      dragged = null;
      /* Only what was picked up here: the type carries the card's key. */
      if (!card || e.dataTransfer.getData(DRAG_TYPE) !== card.key) return;
      e.preventDefault();
      if (dest.date && card.date === dest.date && !card.fromTray) return;
      if (!dest.date && card.slot === dest.slot && !card.date) return;
      sendTo(card, dest);
    });
  }

  /* ---- cards and columns ------------------------------------------------ */

  function renderCard(list, card, board, slipped) {
    const li = list.createEl('li', { cls: [`is-${card.source}`, slipped ? 'is-slipped' : '', card.done ? 'is-done' : ''] });
    /* The tick sits beside the row, not inside it: a button can't hold a
       button. Events are fixed, done cards are done. It is marked busy, not
       disabled: a disabled button gives up keyboard focus. */
    if (card.source !== 'event' && !card.done) {
      const tick = li.createEl('button', { cls: 'fn-tick', attr: { type: 'button', 'aria-label': `Mark "${card.text}" done` } });
      fk(tick, `tick:${card.key}`);
      tick.createSpan({ cls: 'fn-ring' });
      tick.addEventListener('click', e => {
        e.stopPropagation();
        if (tick.classList.contains('is-ticking')) return;
        tick.addClass('is-ticking');
        tick.setAttribute('aria-disabled', 'true');
        tickCard(card);
      });
    }
    const row = li.createEl('button', { cls: 'fn-row', attr: { type: 'button', title: `Open in ${card.path}` } });
    fk(row, `row:${card.key}`);
    row.addEventListener('click', () => (wasPhone ? openSheet(card, board) : plugin.openTask(card)));
    if (!card.done && !wasPhone) makeDraggable(row, card, board);
    if (card.source === 'event') {
      /* A fixed appointment: time in front, a lock — it can't be dragged. */
      row.createSpan({ cls: card.time ? 'fn-evtime' : ['fn-evtime', 'is-allday'], text: card.time || 'All day' });
    }
    const body = row.createDiv({ cls: 'fn-body' });
    body.createSpan({ cls: 'fn-title', text: card.text || '(untitled)' });
    if (card.source === 'event') {
      const lock = row.createSpan({ cls: 'fn-ic fn-lock', attr: { 'aria-label': 'Fixed event' } });
      setIcon(lock, 'lock');
    }
    const meta = body.createDiv({ cls: 'fn-meta' });
    if (slipped) meta.createSpan({ cls: 'fn-slip-from', text: `from ${dayLabel(card.date)}` });
    if (card.time && card.source !== 'event') meta.createSpan({ cls: 'fn-time', text: card.time });
    /* A due date only earns a label when it adds something: a deadline-only
       card, or a planned card due on another day. */
    if (card.due && (card.deadlineOnly || card.due !== card.date || slipped)) {
      /* On its due day a deadline-only card just says so; a planned card
         that is due later says when. */
      const text = card.deadlineOnly ? 'Deadline'
        : card.due === board.today ? 'Due today' : D.isDate(card.due) ? `Due ${DOW[D.weekday(card.due)]} ${dayNum(card.due)}` : `Due ${card.due}`;
      meta.createSpan({ cls: ['fn-due', card.due <= board.today ? 'is-now' : '', card.deadlineOnly ? 'is-deadline' : ''], text });
    }
    if (card.source === 'event' || card.source === 'practice') {
      const from = meta.createSpan({ cls: 'fn-from fn-rhythm' });
      if (card.source === 'practice') setIcon(from.createSpan({ cls: 'fn-ic' }), 'repeat');
      from.createSpan({ text: card.area || 'Rhythm' });
    } else if (card.source === 'nudge') {
      const from = meta.createSpan({ cls: 'fn-from fn-nudge', attr: { 'aria-label': 'Nudge reminder' } });
      setIcon(from.createSpan({ cls: 'fn-ic' }), 'bell');
      from.createSpan({ text: 'Nudge' });
    } else {
      /* Tagged into Later from elsewhere: the folder too, so you know
         which project it came from. */
      meta.createSpan({ cls: 'fn-from', text: card.tagged ? card.path.replace(/\.md$/, '') : noteName(card.path) });
    }
    /* The way to move a card without a mouse or a long press: a button that
       opens the same sheet a phone tap does. (On a phone the row itself
       opens the sheet.) */
    if (!wasPhone) {
      const more = li.createEl('button', {
        cls: 'fn-cardmore', attr: { type: 'button', 'aria-label': `More actions for "${card.text || '(untitled)'}"`, title: 'More actions' },
      });
      fk(more, `more:${card.key}`);
      setIcon(more, 'more-horizontal');
      more.addEventListener('click', e => { e.stopPropagation(); openSheet(card, board); });
    }
  }

  function renderDay(boardEl, day, board) {
    const lead = day.date < board.weekStart && !day.past;
    const col = boardEl.createDiv({ cls: 'fn-col' + (day.isToday ? ' is-today' : '') + (day.past ? ' is-past' : '') + (lead ? ' is-lead' : ''), attr: { 'data-fn-col': day.date } });
    const dailyBadge = parent => {
      if (!day.dailyCount) return;
      const daily = parent.createSpan({ cls: 'fn-daily', attr: { title: `${day.dailyCount} daily practices in Rhythm` } });
      setIcon(daily.createSpan({ cls: 'fn-ic' }), 'sun');
      daily.createSpan({ text: `${day.dailyCount} daily` });
    };
    if (day.past) {
      /* A day gone by: a thin numeral. What was left open has moved up
         into Slipped. */
      col.createSpan({ cls: 'fn-pastnum', text: dayNum(day.date) });
      col.createSpan({ cls: 'fn-pastdow', text: DOW[D.weekday(day.date)] });
      if (day.done.length) col.createSpan({ cls: 'fn-pastdone', text: `${day.done.length} done` });
      return;
    }
    /* Hairline: the date's numeral carries the column — today's large and
       in the accent colour. */
    const head = col.createDiv({ cls: day.isToday ? ['fn-head', 'is-today'] : 'fn-head' });
    if (day.isToday) {
      head.createSpan({ cls: 'fn-bignum', text: dayNum(day.date) });
      const labels = head.createDiv({ cls: 'fn-todaylabels' });
      labels.createEl('strong', { text: 'Today' });
      labels.createSpan({ text: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][D.weekday(day.date)] });
      dailyBadge(labels);
    } else {
      head.createSpan({ cls: 'fn-num', text: dayNum(day.date) });
      const line = head.createDiv({ cls: 'fn-dowline' });
      line.createSpan({ text: DOW[D.weekday(day.date)] });
      dailyBadge(line);
    }
    if (day.isToday && board.slipped.length) renderSlipped(col, board);
    const card = col.createDiv({ cls: 'fn-card' });
    makeDropTarget(col, dayDest(day.date));
    if (!day.cards.length) {
      card.createDiv({ cls: 'fn-empty-day', text: day.done.length ? 'All done' : 'Nothing planned' });
    } else {
      const list = card.createEl('ul', { cls: 'fn-list', attr: { 'aria-label': dayLabel(day.date) } });
      for (const c of day.cards) renderCard(list, c, board);
    }
    renderAdd(card, dayDest(day.date));
    renderDone(card, day, board);
  }

  /* Next week: "any day" cards, a line per day saying how much is there,
     and a button to open it out into its seven days. */
  function renderNextWeek(boardEl, board) {
    const nw = board.nextWeek;
    const col = boardEl.createDiv({ cls: ['fn-col', 'fn-next'], attr: { 'data-fn-col': 'nextWeek' } });
    const head = col.createDiv({ cls: 'fn-head' });
    head.createSpan({ cls: 'fn-coltitle', text: 'Next week' });
    head.createDiv({ cls: 'fn-dowline', text: `${short(nw.start)} – ${short(D.addDays(nw.start, 6))}` });
    const card = col.createDiv({ cls: 'fn-card' });
    makeDropTarget(col, nextDest(board));
    card.createDiv({ cls: 'fn-subhead', text: nw.anyDay.length ? `Any day · ${nw.anyDay.length}` : 'Any day' });
    if (nw.anyDay.length) {
      const list = card.createEl('ul', { cls: 'fn-list', attr: { 'aria-label': 'Next week, any day' } });
      for (const c of nw.anyDay) renderCard(list, c, board);
    }
    if (!nextOpen) {
      for (const d of nw.days) {
        const row = card.createDiv({ cls: 'fn-nd' });
        row.createSpan({ cls: 'fn-nd-dow', text: `${DOW[D.weekday(d.date)]} ${dayNum(d.date)}` });
        const dots = row.createSpan({ cls: 'fn-nd-dots' });
        for (const c of d.cards.slice(0, 6)) dots.createEl('i', { cls: c.source === 'event' ? 'is-event' : '' });
        row.createSpan({ cls: 'fn-nd-n', text: d.cards.length ? String(d.cards.length) : '' });
      }
    }
    renderAdd(card, nextDest(board));
    /* On a phone the Next tab always shows the days: no toggle. */
    if (!wasPhone) {
      const toggle = card.createEl('button', {
        cls: 'fn-more', attr: { type: 'button', 'aria-expanded': String(nextOpen) },
        text: nextOpen ? 'Hide the days' : 'Show 7 days',
      });
      fk(toggle, 'nextToggle');
      toggle.addEventListener('click', () => { nextOpen = !nextOpen; render(lastTasks, lastRhythm); });
    }
    if (nextOpen) {
      for (const d of nw.days) {
        renderDay(boardEl, Object.assign({ past: false, isToday: false }, d), board);
        boardEl.lastChild.addClass('is-nextweek');
      }
    }
  }

  /* Later: undated to-dos waiting for a week. */
  function renderLater(boardEl, board) {
    const col = boardEl.createDiv({ cls: ['fn-col', 'fn-later'], attr: { 'data-fn-col': 'later' } });
    const head = col.createDiv({ cls: 'fn-head' });
    head.createSpan({ cls: 'fn-coltitle', text: 'Later' });
    head.createDiv({ cls: 'fn-dowline', text: board.later.length ? `${board.later.length} parked · no date` : 'Drop here to park without a date' });
    const card = col.createDiv({ cls: 'fn-card' });
    makeDropTarget(col, LATER);
    const own = board.later.filter(c => !c.tagged);
    const tagged = board.later.filter(c => c.tagged);
    if (!board.later.length) card.createDiv({ cls: 'fn-empty-day', text: 'Nothing parked' });
    if (own.length) {
      if (tagged.length) card.createDiv({ cls: 'fn-subhead', text: `Planner note · ${own.length}` });
      const list = card.createEl('ul', { cls: 'fn-list', attr: { 'aria-label': 'Later' } });
      for (const c of own) renderCard(list, c, board);
    }
    if (tagged.length) {
      const tag = plugin.settings.laterTag || '#later';
      card.createDiv({ cls: 'fn-subhead', text: `Tagged ${tag} · ${tagged.length}` });
      const list = card.createEl('ul', { cls: 'fn-list', attr: { 'aria-label': `Later, tagged ${tag}` } });
      for (const c of tagged) renderCard(list, c, board);
    }
    renderAdd(card, LATER);
  }

  /* ---- phone ------------------------------------------------------------ */

  /* Which of the phone's tabs is showing: a date still open, 'nextWeek' or
     'later' — today if what it held has gone. */
  function normaliseSel(board) {
    const open = board.days.filter(d => !d.past);
    if (!phoneSel || (phoneSel !== 'nextWeek' && phoneSel !== 'later' && !open.some(d => d.date === phoneSel))) phoneSel = board.today;
  }

  /* One day at a time: a row of thin numerals to switch, then Next and
     Later; the chosen day as a single full-width column. */
  function renderPhone(board) {
    const open = board.days.filter(d => !d.past);
    const sw = main.createDiv({ cls: 'fn-switch', attr: { role: 'group', 'aria-label': 'Day' } });
    const cards = n => `${n} ${n === 1 ? 'card' : 'cards'}`;
    const tab = (key, label, num, count, name) => {
      const on = phoneSel === key;
      const b = sw.createEl('button', { cls: ['fn-sw', on ? 'is-on' : ''], attr: Object.assign({ type: 'button', 'aria-label': name }, on ? { 'aria-current': 'true' } : {}) });
      fk(b, `sw:${key}`);
      b.createSpan({ cls: 'fn-swl', text: label });
      b.createSpan({ cls: 'fn-swn', text: num });
      if (count) b.createSpan({ cls: 'fn-swc', text: String(count) });
      b.addEventListener('click', () => { phoneSel = key; render(lastTasks, lastRhythm); });
    };
    for (const d of open) tab(d.date, d.isToday ? 'Today' : DOW[D.weekday(d.date)], dayNum(d.date), 0, `${d.isToday ? 'Today, ' : ''}${dayLabel(d.date)}`);
    tab('nextWeek', 'Next', '›', board.nextWeek.count, board.nextWeek.count ? `Next week, ${cards(board.nextWeek.count)}` : 'Next week');
    tab('later', 'Later', '…', board.later.length, board.later.length ? `Later, ${cards(board.later.length)}` : 'Later');
    const body = main.createDiv({ cls: 'fn-pbody' });
    if (phoneSel === 'nextWeek') {
      const keep = nextOpen;
      nextOpen = true;
      renderNextWeek(body, board);
      nextOpen = keep;
    } else if (phoneSel === 'later') {
      renderLater(body, board);
    } else {
      renderDay(body, open.find(d => d.date === phoneSel), board);
    }
    /* Centre the chosen day in the switcher — scrolling the switcher only,
       never the pane (scrollIntoView would jump the whole view). */
    const on = sw.querySelector('.is-on');
    if (on) sw.scrollLeft = Math.max(0, on.offsetLeft - (sw.clientWidth - on.offsetWidth) / 2);
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.layer.remove();
    const back = sheet.returnFocus;
    sheet = null;
    syncLock();
    restoreFocus(back);
  }

  /* The tap sheet: where should this card go? Big targets for the usual
     answers, a 14-day picker for the rest, then Done / Open / Drop. What
     doesn't apply to this kind of card is shown but disabled. */
  function openSheet(card, board) {
    const returnFocus = captureFocus();
    closeSheet();
    const today = board.today;
    const tomorrow = D.addDays(today, 1);
    const can = actionsFor(card, board);
    const layer = root.createDiv({ cls: 'fn-sheet-layer' });
    /* Over what is on screen, even on a board scrolled down (its height is
       CSS's: it follows the pane when a keyboard or a turn resizes it). */
    layer.style.top = `${root.scrollTop}px`;
    const back = layer.createDiv({ cls: 'fn-sheet-back' });
    back.addEventListener('click', closeSheet);
    const el = layer.createDiv({ cls: 'fn-sheet', attr: { role: 'dialog', 'aria-modal': 'true', 'aria-label': card.text } });
    /* While open, Tab / Escape are kept to the sheet. */
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      const all = Array.from(el.querySelectorAll('button:not([disabled])'));
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1];
      const active = el.ownerDocument.activeElement;
      if (!el.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    sheet = { layer, returnFocus, onKey };
    syncLock();
    /* Keys only while focus is inside the sheet — never Obsidian-wide. */
    layer.addEventListener('keydown', onKey);
    el.createDiv({ cls: 'fn-sh-grab', attr: { 'aria-hidden': 'true' } });
    el.createDiv({ cls: 'fn-sh-title', text: card.text || '(untitled)' });
    const dayName = date => (date === today ? 'Today' : dayLabel(date));
    const where = card.source === 'event' ? `Fixed event · ${dayName(card.date)}`
      : card.fromTray ? 'Practice · not placed yet'
      : card.date ? `${dayName(card.date)} · ${noteName(card.path)}`
      : `${card.slot === 'nextWeek' ? 'Next week' : 'Later'} · ${noteName(card.path)}`;
    el.createDiv({ cls: 'fn-sh-meta', text: where });

    const act = fn => () => { closeSheet(); fn(); };
    const button = (parent, cls, label, sub, disabled, onClick) => {
      const b = parent.createEl('button', { cls, attr: { type: 'button' } });
      b.createSpan({ cls: 'fn-sh-label', text: label });
      if (sub) b.createSpan({ cls: 'fn-sh-sub', text: sub });
      if (disabled) b.disabled = true;
      else b.addEventListener('click', act(onClick));
      return b;
    };

    const grid = el.createDiv({ cls: 'fn-sh-grid' });
    const here = date => date === card.date && !card.fromTray;
    button(grid, 'fn-sh-big', 'Today', `${DOW[D.weekday(today)]} ${dayNum(today)}`, !can.day || here(today), () => moveTo(card, today));
    button(grid, 'fn-sh-big', 'Tomorrow', `${DOW[D.weekday(tomorrow)]} ${dayNum(tomorrow)}`, !can.day || here(tomorrow), () => moveTo(card, tomorrow));
    button(grid, 'fn-sh-big', 'Next week', `from ${short(board.nextWeek.start)}`, !can.nextWeek, () => parkTo(card, nextDest(board)));
    button(grid, 'fn-sh-big', 'Later', can.laterWhy === 'repeats' ? 'repeats' : 'no date', !can.later, () => parkTo(card, LATER));

    el.createDiv({ cls: 'fn-sh-h', text: 'Pick a day' });
    const picker = el.createDiv({ cls: 'fn-picker' });
    const days = board.days.filter(d => !d.past).map(d => d.date).concat(board.nextWeek.days.map(d => d.date)).slice(0, 14);
    for (const date of days) {
      const b = picker.createEl('button', { cls: ['fn-pk', date === card.date ? 'is-current' : '', date === today ? 'is-today' : ''], attr: { type: 'button', 'aria-label': dayLabel(date) } });
      b.createSpan({ cls: 'fn-pk-dow', text: DOW[D.weekday(date)].slice(0, 2) });
      b.createSpan({ cls: 'fn-pk-num', text: dayNum(date) });
      if (!can.day || here(date)) b.disabled = true;
      else b.addEventListener('click', act(() => moveTo(card, date)));
    }

    const list = el.createDiv({ cls: 'fn-sh-actions' });
    button(list, 'fn-sh-row is-done', 'Done', '', !can.done, () => tickCard(card));
    button(list, 'fn-sh-row', 'Open note', '', !card.path, () => plugin.openTask(card.fromTray ? { path: card.path, line: 0 } : card));
    button(list, 'fn-sh-row is-drop', 'Drop', can.dropWhy === 'repeats' ? 'repeats — tick it instead' : '', !can.drop, () => dropCard(card));
    button(list, 'fn-sh-row is-cancel', 'Cancel', '', false, () => {});

    const first = el.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  /* ---- Review today ------------------------------------------------------ */

  /* A full-pane panel over the board: each of today's open cards in turn,
     then a summary with a reflection and the exact text to be written.
     Nothing is written until Finish; Cancel leaves everything as it was. */
  let review = null;

  /* restore: give focus back to the button that opened it, if focus was in
     the panel (or nowhere) — not if the reader has gone elsewhere since. */
  function closeReview(restore = true) {
    if (!review) return;
    const a = doc().activeElement;
    const had = !a || a === doc().body || review.layer.contains(a);
    review.layer.remove();
    review = null;
    syncLock();
    if (!restore || stopped || !had) return;
    const rb = focusMap.get('review');
    if (rb && root.contains(rb)) rb.focus({ preventScroll: true });
  }

  async function openReview() {
    if (stopped || review) return;
    if (!lastBoard) await refresh();
    if (stopped || review || !lastBoard) return;
    closeSheet();
    const board = lastBoard;
    const cards = reviewCards(board);
    const todayDay = board.days.find(d => d.date === board.today);
    /* Done today: every Tasks / Nudge card ticked today, wherever its plan
       day was (board.doneToday), and the practices ticked today. */
    const doneCards = Array.isArray(board.doneToday)
      ? board.doneToday.concat(todayDay ? todayDay.done.filter(c => c.source === 'practice') : [])
      : (todayDay ? todayDay.done : []);
    const alreadyDone = doneCards.map(c => c.text);
    const choices = new Map();
    let step = 0;
    let reflection = '';
    /* Where it will be written, with the exact heading — asked now, so the
       preview is the text and a bad folder shows before anything changes. */
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let target = { ok: true, heading: '## Review', path: '' };
    plugin.store.reviewTarget(board.today, time).then(t => { target = t; if (review && step >= cards.length) draw(); });
    const layer = root.createDiv({ cls: 'fn-review', attr: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review today' } });
    layer.style.top = `${root.scrollTop}px`;
    const inner = layer.createDiv({ cls: 'fn-rv-inner' });
    const onKey = e => {
      if (e.key === 'Escape') {
        /* An Escape that only cancels an IME composition isn't ours. */
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault(); e.stopPropagation();
        /* Choices already made aren't thrown away by one stray Escape: the
           first moves to Cancel, a second (or a click) discards. */
        const cancel = layer.querySelector('.fn-rv-cancel');
        const toLose = choices.size > 0 || reflection.trim() !== '';
        if (toLose && cancel && layer.ownerDocument.activeElement !== cancel) { cancel.focus(); return; }
        closeReview();
        return;
      }
      if (e.key !== 'Tab') return;
      const all = Array.from(layer.querySelectorAll('button:not([disabled]), input'));
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1];
      const active = layer.ownerDocument.activeElement;
      if (!layer.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    review = { layer, onKey };
    syncLock();
    /* Keys only while focus is inside the review: Escape elsewhere in
       Obsidian must never throw away the choices made so far. */
    layer.addEventListener('keydown', onKey);

    const whereLabel = c => (c.kind === 'day' ? (c.date === D.addDays(board.today, 1) ? 'tomorrow' : dayLabel(c.date))
      : c.kind === 'nextWeek' ? 'next week' : 'Later');
    /* What the choices add up to, as reviewText parts (before writing). */
    const parts = () => {
      const p = { done: alreadyDone.slice(), moved: [], dropped: [], left: 0, reflection };
      for (const card of cards) {
        const c = choices.get(card.key) || { kind: 'leave' };
        if (c.kind === 'done') p.done.push(card.text);
        else if (c.kind === 'drop') p.dropped.push(card.text);
        else if (c.kind === 'leave') p.left++;
        else p.moved.push([card.text, whereLabel(c)]);
      }
      return p;
    };

    const draw = () => {
      inner.empty();
      const head = inner.createDiv({ cls: 'fn-rv-head' });
      head.createSpan({ cls: 'fn-rv-kicker', text: 'Review today' });
      const cancel = head.createEl('button', { cls: 'fn-rv-cancel', attr: { type: 'button' }, text: 'Cancel' });
      cancel.addEventListener('click', () => closeReview());
      if (step < cards.length) drawCard(cards[step]);
      else drawSummary();
      const first = inner.querySelector('.fn-sh-big:not([disabled]), input, button.fn-rv-finish');
      if (first) first.focus();
    };

    const choose = (card, c) => { choices.set(card.key, c); step++; draw(); };

    const drawCard = card => {
      inner.createDiv({ cls: 'fn-rv-prog', text: `${step + 1} of ${cards.length}` });
      const bar = inner.createDiv({ cls: 'fn-rv-bar' });
      bar.createDiv({ cls: 'fn-rv-fill' }).style.width = `${(step / cards.length) * 100}%`;
      const titleId = `fn-rv-title-${++uid}`;
      inner.createDiv({ cls: 'fn-sh-title', text: card.text || '(untitled)', attr: { id: titleId } });
      inner.createDiv({ cls: 'fn-sh-meta', text: `${card.date && card.date < board.today ? `Slipped from ${short(card.date)}` : 'Today'} · ${card.source === 'nudge' ? 'Nudge' : noteName(card.path)}` });
      const can = actionsFor(card, board);
      /* The choices belong to the card named above them: a screen reader
         hears "Done" as an answer about THIS to-do. */
      const choicesEl = inner.createDiv({ cls: 'fn-rv-choices', attr: { role: 'group', 'aria-labelledby': titleId } });
      const btn = (parent, cls, label, sub, ok, c) => {
        const b = parent.createEl('button', { cls, attr: { type: 'button' } });
        b.createSpan({ cls: 'fn-sh-label', text: label });
        if (sub) b.createSpan({ cls: 'fn-sh-sub', text: sub });
        if (!ok) b.disabled = true;
        else b.addEventListener('click', () => choose(card, c));
        return b;
      };
      const tomorrow = D.addDays(board.today, 1);
      const grid = choicesEl.createDiv({ cls: 'fn-sh-grid' });
      btn(grid, 'fn-sh-big', 'Done', 'it happened', can.done, { kind: 'done' });
      btn(grid, 'fn-sh-big', 'Tomorrow', `${DOW[D.weekday(tomorrow)]} ${dayNum(tomorrow)}`, can.day, { kind: 'day', date: tomorrow });
      btn(grid, 'fn-sh-big', 'Next week', `from ${short(board.nextWeek.start)}`, can.nextWeek, { kind: 'nextWeek' });
      btn(grid, 'fn-sh-big', 'Later', can.laterWhy === 'repeats' ? 'repeats' : 'no date', can.later, { kind: 'later' });
      choicesEl.createDiv({ cls: 'fn-sh-h', text: 'Pick a day' });
      const picker = choicesEl.createDiv({ cls: 'fn-picker' });
      const days = board.days.filter(d => d.date > board.today).map(d => d.date).concat(board.nextWeek.days.map(d => d.date)).slice(0, 14);
      for (const date of days) {
        const b = picker.createEl('button', { cls: 'fn-pk', attr: { type: 'button', 'aria-label': dayLabel(date) } });
        b.createSpan({ cls: 'fn-pk-dow', text: DOW[D.weekday(date)].slice(0, 2) });
        b.createSpan({ cls: 'fn-pk-num', text: dayNum(date) });
        if (!can.day) b.disabled = true;
        else b.addEventListener('click', () => choose(card, { kind: 'day', date }));
      }
      const rows = choicesEl.createDiv({ cls: 'fn-sh-actions' });
      btn(rows, 'fn-sh-row is-drop', 'Drop', can.dropWhy === 'repeats' ? 'repeats — tick it instead' : '', can.drop, { kind: 'drop' });
      btn(rows, 'fn-sh-row', 'Leave it', 'stays open, slips tomorrow', true, { kind: 'leave' });
      if (step > 0) {
        const back = rows.createEl('button', { cls: 'fn-sh-row is-cancel', attr: { type: 'button' }, text: 'Back' });
        back.addEventListener('click', () => { step--; draw(); });
      }
    };

    const drawSummary = () => {
      const p = parts();
      inner.createDiv({ cls: ['fn-intro-title', 'is-big'], text: cards.length ? 'That’s the day' : 'Nothing left open' });
      const stats = inner.createDiv({ cls: 'fn-stats' });
      for (const [n, label, slip] of [[p.done.length, 'done', false], [p.moved.length, 'moved', false], [p.dropped.length, 'dropped', true], [p.left, 'left open', false]]) {
        const f = stats.createDiv({ cls: slip && n ? ['fn-stat', 'is-slip'] : 'fn-stat' });
        f.createSpan({ cls: 'fn-snum', text: String(n) });
        f.createSpan({ cls: 'fn-slabel', text: label });
      }
      inner.createDiv({ cls: 'fn-sh-h', text: 'One line about today (optional)' });
      const input = inner.createEl('input', { cls: 'fn-rv-input', attr: { type: 'text', placeholder: 'What went well, what didn’t…', 'aria-label': 'Reflection', maxlength: '300', enterkeyhint: 'done' } });
      input.value = reflection;
      if (!target.ok) {
        inner.createDiv({ cls: 'fn-rv-error', text: 'The review folder in Fortnight’s settings names a note, not a folder. Fix it there — nothing has been changed.' });
      }
      inner.createDiv({ cls: 'fn-sh-h', text: target.path ? `Will be added to ${target.path}` : 'Will be added to today’s log' });
      const pre = inner.createEl('pre', { cls: 'fn-rv-preview' });
      const show = () => { pre.setText(reviewText(Object.assign({ heading: target.heading || '## Review' }, parts()))); };
      input.addEventListener('input', () => { reflection = input.value; show(); });
      /* Enter is the keyboard's Done: put the keyboard away so Finish is in
         view (a phone keyboard otherwise covers it), and leave focus on
         Finish — not on the page behind, where Tab would wander off. */
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        input.blur();
        const go = inner.querySelector('.fn-rv-finish:not([disabled])');
        if (go) go.focus();
      });
      show();
      const rows = inner.createDiv({ cls: 'fn-rv-actions' });
      if (cards.length) {
        const back = rows.createEl('button', { cls: 'fn-rv-back', attr: { type: 'button' }, text: 'Back' });
        back.addEventListener('click', () => { step--; draw(); });
      }
      const finish = rows.createEl('button', { cls: ['fn-rv-finish', 'mod-cta'], attr: { type: 'button' }, text: 'Finish review' });
      if (!target.ok) finish.disabled = true;
      finish.addEventListener('click', async () => {
        finish.disabled = true;
        finish.setText('Writing…');
        await finishReview(board, cards, choices, alreadyDone, reflection, whereLabel, time, target.heading);
      });
    };

    draw();
  }

  /* Apply each choice through the store (so every write keeps its usual
     guards), then write what ACTUALLY happened — a refused move counts as
     left open, and says so. */
  async function finishReview(board, cards, choices, alreadyDone, reflection, whereLabel, time, heading) {
    const p = { done: alreadyDone.slice(), moved: [], dropped: [], left: 0, reflection };
    const failed = [];
    /* Bottom of each note first: ticking a 🔁 to-do inserts its next
       occurrence above it, which would shift every card below. The text
       keeps the order you reviewed in. */
    const order = cards.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (b.line || 0) - (a.line || 0)));
    const outcome = new Map();
    for (const card of order) {
      const c = choices.get(card.key) || { kind: 'leave' };
      let r = { ok: true };
      try {
        if (c.kind === 'done') r = await plugin.store.tick(card, board.today);
        else if (c.kind === 'day') r = await plugin.store.move(card, c.date);
        else if (c.kind === 'nextWeek') r = await plugin.store.park(card, 'nextWeek', board.nextWeek.start);
        else if (c.kind === 'later') r = await plugin.store.park(card, 'later');
        else if (c.kind === 'drop') r = await plugin.store.drop(card);
      } catch (e) { console.error('Fortnight: review step failed', e); r = { ok: false, reason: 'error' }; }
      outcome.set(card.key, r);
    }
    for (const card of cards) {
      const c = choices.get(card.key) || { kind: 'leave' };
      const r = outcome.get(card.key);
      if (!r.ok) { failed.push(card.text); p.left++; continue; }
      if (c.kind === 'done') p.done.push(card.text);
      else if (c.kind === 'drop') p.dropped.push(card.text);
      else if (c.kind === 'leave') p.left++;
      else p.moved.push([card.text, whereLabel(c)]);
    }
    let w;
    try { w = await plugin.store.writeReview(board.today, p, time, heading); }
    catch (e) { console.error('Fortnight: review write failed', e); w = { ok: false }; }
    closeReview();
    const stayed = failed.length ? ` ${failed.length} couldn't be changed and stay open (they were edited meanwhile, or no longer match): ${failed.join(', ')}.` : '';
    if (w.ok) new Notice(`Fortnight: review added to ${w.path}.${stayed}`, 10000);
    else new Notice(`Fortnight: couldn't write the review (see the console). Your other choices were applied.${stayed}`, 10000);
    await refresh(true);
  }

  /* "+ Add a to-do": Enter writes it to the planner note with this day's ⏳. */
  function renderAdd(card, dest) {
    const row = card.createDiv({ cls: 'fn-addrow' });
    const plus = row.createSpan({ cls: 'fn-ic fn-add-ic' });
    setIcon(plus, 'plus');
    const input = row.createEl('input', {
      cls: 'fn-addinput',
      attr: { type: 'text', placeholder: 'Add a to-do', 'aria-label': `Add a to-do: ${dest.label}`, enterkeyhint: 'done' },
    });
    fk(input, `add:${dest.key}`);
    input.value = drafts.get(dest.key) || '';
    input.addEventListener('input', () => { if (input.value) drafts.set(dest.key, input.value); else drafts.delete(dest.key); });
    input.addEventListener('focus', () => row.addClass('is-focused'));
    input.addEventListener('blur', () => row.removeClass('is-focused'));
    input.addEventListener('keydown', async e => {
      if (e.key === 'Escape') { input.value = ''; drafts.delete(dest.key); input.blur(); return; }
      /* keyCode 229: WebKit's Enter that only confirms an IME word. */
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const text = input.value;
      if (!text.trim() || writing.has(dest.key)) return;
      /* The field is left alone while the write runs — not disabled or
         read-only, either of which takes focus (and a phone's keyboard)
         away. A second Enter waits on `writing`; anything typed meanwhile
         stays in the draft. */
      writing.add(dest.key);
      input.setAttribute('aria-busy', 'true');
      let r;
      try { r = await plugin.store.add(dest.date ? { text, date: dest.date } : { text, slot: dest.slot, monday: dest.monday }); }
      catch (err) { console.error('Fortnight: add failed', err); r = { ok: false, reason: 'error' }; }
      writing.delete(dest.key);
      input.removeAttribute('aria-busy');
      if (!r.ok) {
        new Notice(`Fortnight: couldn't add that to-do (${r.reason === 'error' ? 'see the console' : r.reason}).`);
        return;
      }
      /* Only what was sent is cleared; anything typed since stays. */
      if (drafts.get(dest.key) === text) drafts.delete(dest.key);
      await refresh(true);
      /* Typed with a date the board doesn't reach (or into a note it
         doesn't read): written, but nothing appeared — say where it went. */
      if (r.raw && lastBoard && !H.boardHasRaw(lastBoard, r.raw)) {
        new Notice(H.addedNotice(r.raw, lastBoard, plugin.store.plannerPath()), 10000);
      }
    });
  }

  /* What you got through: collapsed under the day, a tap to open. */
  function renderDone(card, day, board) {
    if (!day.done.length) return;
    const open = openDone.has(day.date);
    const toggle = card.createEl('button', {
      cls: 'fn-done', attr: { type: 'button', 'aria-expanded': String(open) },
      text: `Done · ${day.done.length}`,
    });
    fk(toggle, `done:${day.date}`);
    toggle.addEventListener('click', () => {
      if (open) openDone.delete(day.date); else openDone.add(day.date);
      render(lastTasks, lastRhythm);
    });
    if (!open) return;
    const list = card.createEl('ul', { cls: ['fn-list', 'fn-donelist'], attr: { 'aria-label': `Done, ${dayLabel(day.date)}` } });
    for (const c of day.done) renderCard(list, c, board);
  }

  /* Still open from a day gone by: oldest first, a few at a time. */
  function renderSlipped(col, board) {
    const all = board.slipped;
    col.createDiv({ cls: ['fn-gh', 'fn-gh-slip'], text: `Slipped · ${all.length}` });
    const card = col.createDiv({ cls: ['fn-card', 'fn-slipcard'] });
    const list = card.createEl('ul', { cls: 'fn-list', attr: { 'aria-label': 'Slipped' } });
    const shown = showAllSlipped ? all : all.slice(0, SLIPPED_PREVIEW);
    for (const c of shown) renderCard(list, c, board, true);
    if (all.length > SLIPPED_PREVIEW) {
      const more = card.createEl('button', {
        cls: 'fn-more', attr: { type: 'button' },
        text: showAllSlipped ? 'Show fewer' : `Show all ${all.length}`,
      });
      fk(more, 'slipMore');
      /* Redraw from what is already loaded — no vault re-read; focus stays
         on the toggle (render restores it). */
      more.addEventListener('click', () => {
        showAllSlipped = !showAllSlipped;
        render(lastTasks, lastRhythm);
      });
    }
  }

  /* Weekly practices still looking for a day, per Rhythm. */
  function renderTray(top, board) {
    const wrap = top.createDiv({ cls: 'fn-traywrap' });
    wrap.createSpan({ cls: 'fn-traylabel', text: 'Practices owed' });
    const card = wrap.createDiv({ cls: 'fn-tray' });
    const more = wrap.createSpan({ cls: 'fn-traymore' });
    /* How many chips sit past the right edge, kept true as it scrolls. */
    const countHidden = () => {
      const edge = card.getBoundingClientRect().right;
      const hidden = Array.from(card.children).filter(c => c.getBoundingClientRect().left > edge - 24).length;
      more.setText(hidden ? `+${hidden}` : '');
      card.toggleClass('has-more', hidden > 0);
    };
    card.addEventListener('scroll', countHidden, { passive: true });
    win().requestAnimationFrame(countHidden);
    for (const t of board.tray) {
      const chip = card.createEl('button', {
        cls: 'fn-chip', attr: { type: 'button', title: `Choose a day for ${t.name}` },
      });
      fk(chip, `chip:${t.name}`);
      chip.createSpan({ cls: 'fn-grip', attr: { 'aria-hidden': 'true' } });
      chip.createSpan({ text: t.name });
      chip.createSpan({ cls: 'fn-chip-n', text: t.target > 1 ? `${t.need} of ${t.target} left` : 'to place' });
      /* Drag a practice onto a day to promise it there, in Rhythm's log —
         or tap / press it and pick the day (the sheet has Open note too). */
      const pc = { key: `tray:${t.name}`, source: 'practice', fromTray: true, text: t.name, path: t.path };
      chip.addEventListener('click', () => openSheet(pc, board));
      if (!wasPhone) makeDraggable(chip, pc, board);
    }
  }

  /* ---- drawing ---------------------------------------------------------- */

  function render(tasks, rhythm, force) {
    if (stopped) return;
    applyAccent();
    lastTasks = tasks;
    lastRhythm = rhythm;
    /* Read the layout ONCE, up front: asked per card after the old DOM is
       gone, every question forces a layout (and a short page resets the
       scroll position to the top). */
    const phone = isPhone();
    const board = planBoard({ today: D.todayISO(), tasks, rhythm, settings: plugin.settings });
    lastBoard = board;
    if (intro) intro.update(board);
    normaliseSel(board);
    /* Same board, same view state: the DOM would come out identical. */
    const sig = H.signature(board, [phone, phone ? phoneSel : '', nextOpen, showAllSlipped, Array.from(openDone).sort(), plugin.settings.laterTag || '', plugin.store.problems()]);
    if (!force && sig !== null && sig === lastSig && main.firstChild) return;
    lastSig = sig;

    /* A redraw keeps the reader where they were: the scroll position and
       the focused control. */
    const keep = captureFocus();
    const scrollTop = root.scrollTop;
    const prev = main.querySelector('.fn-board');
    const scrollLeft = prev ? prev.scrollLeft : 0;
    main.empty();
    focusMap = new Map();
    wasPhone = phone;
    root.toggleClass('fn-phone', phone);
    const top = main.createDiv({ cls: 'fn-top' });
    const title = top.createDiv({ cls: 'fn-titlebox' });
    title.createDiv({ cls: 'fn-kicker', text: board.weekStart > board.today ? 'Today, then the week' : 'This week' });
    title.createDiv({ cls: 'fn-range', text: `${short(board.weekStart)} – ${short(D.addDays(board.weekStart, 6))}` });
    /* Installed but unreadable: say so quietly, once, above the board. */
    if (plugin.store.problems().includes('nudge')) {
      top.createSpan({ cls: 'fn-problem', text: 'Nudge reminders could not be read — they are missing from this board.' });
    }
    const rb = top.createEl('button', { cls: 'fn-reviewbtn', attr: { type: 'button' }, text: 'Review today' });
    fk(rb, 'review');
    rb.addEventListener('click', () => openReview());
    if (board.tray.length) renderTray(top, board);
    if (phone) {
      renderPhone(board);
    } else {
      const boardEl = main.createDiv({ cls: 'fn-board' });
      for (const day of board.days) renderDay(boardEl, day, board);
      renderNextWeek(boardEl, board);
      renderLater(boardEl, board);
      boardEl.scrollLeft = scrollLeft;
    }
    if (scrollTop) root.scrollTop = scrollTop;
    restoreFocus(keep);
  }

  /* One load at a time. A change that arrives mid-load is not dropped: it
     earns exactly one more load once this one finishes. force: a write just
     landed, draw even if nothing reads differently. */
  async function refresh(force) {
    if (stopped) return;
    if (force) forceNext = true;
    if (loading) { again = true; return loading; }
    loading = (async () => {
      try {
        do {
          again = false;
          const [tasks, rhythm] = await Promise.all([plugin.store.load(), plugin.store.loadRhythm(D.todayISO())]);
          const f = forceNext;
          forceNext = false;
          render(tasks, rhythm, f);
        } while (again && !stopped);
      } finally { loading = null; }
    })();
    await loading;
    maybeWelcome();
  }

  /* ---- the welcome ------------------------------------------------------ */

  /* The daily welcome: greeting → "Plan the week" / "Plan today" → the
     board, each fading into the next. A tap moves on at once. */
  const WELCOME_MS = 1900;
  const PLAN_MS = 2800;
  const FADE_MS = 450;

  async function showIntro() {
    if (stopped || intro) return;
    if (!lastBoard) await refresh();
    if (stopped || intro || !lastBoard) return;
    const now = new Date();
    const nowAt = { date: D.todayISO(now), hour: now.getHours() };
    const screens = introScreens(lastBoard, nowAt, plugin.settings);
    /* role=status: announced politely. It takes focus so Escape / Enter /
       Space can dismiss it, and keeps it (Tab does nothing) until it is
       gone: the board underneath is covered, so tabbing into it would be
       tabbing into the dark. */
    const el = root.createDiv({ cls: 'fn-intro', attr: { role: 'status', 'aria-live': 'polite', tabindex: '-1' } });
    /* Cover what is on screen, even on a board scrolled down (height is
       CSS's). */
    el.style.top = `${root.scrollTop}px`;
    const one = el.createDiv({ cls: ['fn-intro-screen', 'is-welcome'] });
    one.createSpan({ cls: 'fn-intro-num', text: screens.welcome.day });
    const words = one.createDiv({ cls: 'fn-intro-words' });
    words.createDiv({ cls: 'fn-intro-title', text: screens.welcome.title });
    words.createDiv({ cls: 'fn-intro-sub', text: screens.welcome.sub });
    const two = el.createDiv({ cls: ['fn-intro-screen', 'is-plan'] });
    two.createDiv({ cls: ['fn-intro-title', 'is-big'], text: screens.plan.title });
    const figures = two.createDiv({ cls: 'fn-stats' });
    const drawStats = plan => {
      figures.empty();
      if (!plan.stats.length) { figures.createDiv({ cls: 'fn-intro-sub', text: plan.summary }); return; }
      for (const x of plan.stats) {
        const f = figures.createDiv({ cls: x.slip ? ['fn-stat', 'is-slip'] : 'fn-stat' });
        f.createSpan({ cls: 'fn-snum', text: String(x.n) });
        f.createSpan({ cls: 'fn-slabel', text: x.label });
      }
    };
    drawStats(screens.plan);
    el.createDiv({ cls: 'fn-intro-hint', text: 'Tap to skip' });

    /* One stage counter that only moves forward: 0 greeting, 1 plan,
       2 fading out, 3 gone. Taps and timers both just ask for the next
       stage, so a double tap can never skip the clean-up. */
    let stage = -1;
    let timer = null;
    let frame = null;
    const go = n => {
      if (n <= stage) return;
      stage = n;
      win().clearTimeout(timer);
      if (n === 0) { one.addClass('is-in'); timer = win().setTimeout(() => go(1), WELCOME_MS); }
      else if (n === 1) { one.removeClass('is-in'); two.addClass('is-in'); timer = win().setTimeout(() => go(2), PLAN_MS); }
      else if (n === 2) { el.addClass('is-out'); timer = win().setTimeout(() => go(3), FADE_MS); }
      else finish();
    };
    function finish() {
      win().clearTimeout(timer);
      if (frame != null) win().cancelAnimationFrame(frame);
      const a = doc().activeElement;
      const had = !a || a === doc().body || el.contains(a);
      el.remove();
      intro = null;
      /* Focus was on the welcome: on to the board's first control. */
      const rb = focusMap.get('review');
      if (had && !stopped && rb && root.contains(rb)) rb.focus({ preventScroll: true });
    }
    el.addEventListener('click', () => go(stage + 1));
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') go(3);
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(stage + 1); }
      else if (e.key === 'Tab') { e.preventDefault(); el.focus(); }
    });
    intro = {
      finish,
      /* The board may finish loading after the welcome appears (at startup,
         before the vault is indexed): keep the summary true to it. */
      update(board) { drawStats(introScreens(board, nowAt, plugin.settings).plan); },
    };
    el.focus();
    /* Next frame, so the greeting fades in rather than appearing. */
    frame = win().requestAnimationFrame(() => { frame = null; go(0); });
  }

  /* Is this board on screen? A tab behind another, or one closed while it
     loaded, has no layout (and nobody to greet). */
  const visible = () => !stopped && root.isConnected && root.getClientRects().length > 0;

  /* First open of the day: remember it at once (without redrawing), so a
     second tab or a reload doesn't greet you twice — but only once the
     welcome really shows, in a view that can be seen. A view opened hidden
     waits (relayout and every refresh ask again). */
  function maybeWelcome() {
    if (!wantWelcome || !visible() || !lastBoard) return;
    const today = D.todayISO();
    wantWelcome = false;
    if (!shouldShowIntro(plugin.settings, today)) return;
    plugin.settings.lastWelcome = today;
    showIntro();
    if (plugin.saveData) plugin.saveData(plugin.settings);
  }

  async function start() {
    wantWelcome = true;
    await refresh();
    maybeWelcome();
  }

  /* The pane was resized: redraw if it crossed the phone width. */
  function relayout() {
    if (stopped) return;
    if (lastBoard && isPhone() !== wasPhone) render(lastTasks, lastRhythm);
    maybeWelcome();
  }

  return {
    start, refresh, showIntro, relayout, openReview,
    /* Obsidian's theme or accent changed. */
    restyle: applyAccent,
    stop() {
      stopped = true;
      if (intro) intro.finish();
      closeSheet();
      closeReview(false);
      root.empty();
      root.removeClass('fortnight', 'fn-blue', 'fn-phone', 'fn-locked');
      root.style.removeProperty('--fn-hsl');
      root.style.removeProperty('--fn-accent');
    },
  };
}

module.exports = { mountBoard, why };
