'use strict';
/* The board (desktop): this week's days as columns in the Grouped look.
   What goes where is planBoard's call; moving a card is the store's. */

const { setIcon, Menu, Notice } = require('obsidian');
const { planBoard } = require('./plan');
const { introScreens, shouldShowIntro } = require('./intro');
const D = require('./dates');

const { DOW, dayNum, short } = D;
const noteName = path => path.split('/').pop().replace(/\.md$/, '');

function mountBoard(view) {
  const plugin = view.plugin;
  const root = view.contentEl;
  root.empty();
  root.addClass('fortnight');
  /* The board redraws inside main; the welcome lies over it, untouched by
     a redraw underneath. */
  const main = root.createDiv({ cls: 'fn-main' });
  let intro = null;
  let lastBoard = null;
  let loading = null;
  let again = false;
  let showAllSlipped = false;
  /* Days whose Done group is open, by date. */
  const openDone = new Set();
  let lastTasks = [];
  let lastRhythm = null;
  const SLIPPED_PREVIEW = 5;
  /* Cards on screen by key, for drag and drop and the Move menu. */
  let byKey = new Map();
  const DRAG_TYPE = 'text/x-fortnight-card';

  /* Move a card and redraw. A refusal (the note changed underneath, or the
     card is fixed) is said plainly and the board reloads from the vault. */
  async function moveTo(card, date) {
    let r;
    try { r = await plugin.store.move(card, date); }
    catch (e) { console.error('Fortnight: move failed', e); r = { ok: false, reason: 'error' }; }
    if (!r.ok && r.reason !== 'busy') {
      console.warn('Fortnight: move refused', r.reason, card);
      new Notice(`Fortnight: couldn't move "${card.text}": ${REASON[r.reason] || 'something went wrong (see the console)'}.`);
    }
    await refresh();
  }

  /* Why a write was refused, in words. 'busy' (a double click) is silent. */
  const REASON = {
    changed: 'it changed in its note — the board has been refreshed',
    locked: 'events are fixed',
    repeat: "Nudge couldn't work out its next date",
    'done-today': "it's already done today — that promise is kept for its day",
    missing: 'its note no longer exists',
    'no-nudge': "Nudge isn't available",
    'no-rhythm': "Rhythm isn't available",
  };

  /* Tick a card done; the store routes it to Tasks, Nudge or Rhythm. */
  async function tickCard(card) {
    let r;
    try { r = await plugin.store.tick(card, D.todayISO()); }
    catch (e) { console.error('Fortnight: tick failed', e); r = { ok: false, reason: 'error' }; }
    if (!r.ok && r.reason !== 'busy') {
      console.warn('Fortnight: tick refused', r.reason, card);
      new Notice(`Fortnight: couldn't tick "${card.text}": ${REASON[r.reason] || 'something went wrong (see the console)'}.`);
    }
    if (r.plain && !plugin._toldPlainTick) {
      plugin._toldPlainTick = true;
      new Notice('Fortnight: ticked as a plain [x]. Install the Tasks plugin to get ✅ dates and repeating to-dos.', 8000);
    }
    await refresh();
  }

  /* The days a card can still go to: today and the days ahead on the board. */
  const openDays = board => board.days.filter(d => !d.past);

  function moveMenu(e, card, board) {
    const menu = new Menu();
    for (const d of openDays(board)) {
      menu.addItem(i => i
        .setTitle(d.isToday ? `Today (${DOW[D.weekday(d.date)]})` : `${DOW[D.weekday(d.date)]} ${short(d.date)}`)
        .setIcon('calendar')
        .setDisabled(d.date === card.date && !card.fromTray)
        .onClick(() => moveTo(card, d.date)));
    }
    menu.showAtMouseEvent(e);
  }

  function makeDraggable(el, card, board) {
    if (card.source === 'event') return;
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData(DRAG_TYPE, card.key);
      e.dataTransfer.effectAllowed = 'move';
      el.addClass('is-dragging');
    });
    el.addEventListener('dragend', () => el.removeClass('is-dragging'));
    el.addEventListener('contextmenu', e => { e.preventDefault(); moveMenu(e, card, board); });
  }

  function makeDropTarget(el, date) {
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.addClass('is-drop');
    });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.removeClass('is-drop'); });
    el.addEventListener('drop', e => {
      el.removeClass('is-drop');
      const card = byKey.get(e.dataTransfer.getData(DRAG_TYPE));
      if (!card) return;
      e.preventDefault();
      if (card.date === date && !card.fromTray) return;
      moveTo(card, date);
    });
  }

  function renderCard(list, card, board, slipped) {
    const li = list.createEl('li', { cls: [`is-${card.source}`, slipped ? 'is-slipped' : '', card.done ? 'is-done' : ''] });
    /* The tick sits beside the row, not inside it: a button can't hold a
       button. Events are fixed, done cards are done. */
    if (card.source !== 'event' && !card.done) {
      const tick = li.createEl('button', { cls: 'fn-tick', attr: { type: 'button', 'aria-label': `Mark "${card.text}" done` } });
      setIcon(tick, 'circle');
      tick.addEventListener('click', e => {
        e.stopPropagation();
        if (tick.disabled) return;
        tick.disabled = true;
        tick.addClass('is-ticking');
        setIcon(tick, 'check-circle-2');
        tickCard(card);
      });
    }
    const row = li.createEl('button', { cls: 'fn-row', attr: { type: 'button', title: `Open in ${card.path}` } });
    row.addEventListener('click', () => plugin.openTask(card));
    byKey.set(card.key, card);
    if (!card.done) makeDraggable(row, card, board);
    if (card.source === 'event') {
      /* A fixed appointment: time in front, a lock — it can't be dragged. */
      row.createSpan({ cls: 'fn-evtime', text: card.time || 'All day' });
    }
    const body = row.createDiv({ cls: 'fn-body' });
    body.createSpan({ cls: 'fn-title', text: card.text || '(untitled)' });
    if (card.source === 'event') {
      const lock = row.createSpan({ cls: 'fn-ic fn-lock', attr: { 'aria-label': 'Fixed event' } });
      setIcon(lock, 'lock');
    }
    const meta = body.createDiv({ cls: 'fn-meta' });
    if (slipped) meta.createSpan({ cls: 'fn-slip-from', text: `from ${DOW[D.weekday(card.date)]} ${short(card.date)}` });
    if (card.time && card.source !== 'event') meta.createSpan({ cls: 'fn-time', text: card.time });
    /* A due date only earns a label when it adds something: a deadline-only
       card, or a planned card due on another day. */
    if (card.due && (card.deadlineOnly || card.due !== card.date || slipped)) {
      /* On its due day a deadline-only card just says so; a planned card
         that is due later says when. */
      const text = card.deadlineOnly ? 'Deadline'
        : card.due === board.today ? 'Due today' : `Due ${DOW[D.weekday(card.due)]} ${dayNum(card.due)}`;
      meta.createSpan({ cls: card.due <= board.today ? ['fn-due', 'is-now'] : 'fn-due', text });
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
      meta.createSpan({ cls: 'fn-from', text: noteName(card.path) });
    }
  }

  function renderDay(boardEl, day, board) {
    const lead = day.date < board.weekStart && !day.past;
    const col = boardEl.createDiv({ cls: 'fn-col' + (day.isToday ? ' is-today' : '') + (day.past ? ' is-past' : '') + (lead ? ' is-lead' : '') });
    const head = col.createDiv({ cls: 'fn-colhead' });
    head.createSpan({ cls: 'fn-dow', text: DOW[D.weekday(day.date)] });
    head.createSpan({ cls: 'fn-date', text: dayNum(day.date) });
    if (day.dailyCount && !day.past) {
      const daily = head.createSpan({ cls: 'fn-daily', attr: { title: `${day.dailyCount} daily practices in Rhythm` } });
      setIcon(daily.createSpan({ cls: 'fn-ic' }), 'sun');
      daily.createSpan({ text: `${day.dailyCount} daily` });
    }
    if (day.past) {
      /* What was left open here has moved up into Slipped. */
      col.createDiv({ cls: 'fn-pastcard', attr: { title: short(day.date) } });
      return;
    }
    if (day.isToday && board.slipped.length) renderSlipped(col, board);
    const card = col.createDiv({ cls: 'fn-card' });
    makeDropTarget(col, day.date);
    if (!day.cards.length) {
      card.createDiv({ cls: 'fn-empty-day', text: day.done.length ? 'All done' : 'Nothing planned' });
      renderDone(card, day, board);
      return;
    }
    const list = card.createEl('ul', { cls: 'fn-list' });
    for (const c of day.cards) renderCard(list, c, board);
    renderDone(card, day, board);
  }

  /* What you got through: collapsed under the day, a tap to open. */
  function renderDone(card, day, board) {
    if (!day.done.length) return;
    const open = openDone.has(day.date);
    const toggle = card.createEl('button', {
      cls: 'fn-done', attr: { type: 'button', 'aria-expanded': String(open) },
      text: `Done · ${day.done.length}`,
    });
    toggle.addEventListener('click', () => {
      if (open) openDone.delete(day.date); else openDone.add(day.date);
      render(lastTasks, lastRhythm);
    });
    if (!open) return;
    const list = card.createEl('ul', { cls: ['fn-list', 'fn-donelist'] });
    for (const c of day.done) renderCard(list, c, board);
  }

  /* Still open from a day gone by: oldest first, a few at a time. */
  function renderSlipped(col, board) {
    const all = board.slipped;
    col.createDiv({ cls: ['fn-gh', 'fn-gh-slip'], text: `Slipped · ${all.length}` });
    const card = col.createDiv({ cls: ['fn-card', 'fn-slipcard'] });
    const list = card.createEl('ul', { cls: 'fn-list' });
    const shown = showAllSlipped ? all : all.slice(0, SLIPPED_PREVIEW);
    for (const c of shown) renderCard(list, c, board, true);
    if (all.length > SLIPPED_PREVIEW) {
      const more = card.createEl('button', {
        cls: 'fn-more', attr: { type: 'button' },
        text: showAllSlipped ? 'Show fewer' : `Show all ${all.length}`,
      });
      /* Redraw from what is already loaded — no vault re-read — and keep
         keyboard focus on the toggle. */
      more.addEventListener('click', () => {
        showAllSlipped = !showAllSlipped;
        render(lastTasks, lastRhythm);
        const again = main.querySelector('.fn-more');
        if (again) again.focus();
      });
    }
    col.createDiv({ cls: 'fn-gh', text: 'Today' });
  }

  /* Weekly practices still looking for a day, per Rhythm. */
  function renderTray(board) {
    const tray = main.createDiv({ cls: 'fn-tray' });
    tray.createDiv({ cls: 'fn-gh', text: 'Practices owed' });
    const card = tray.createDiv({ cls: 'fn-tray-card' });
    for (const t of board.tray) {
      const chip = card.createEl('button', {
        cls: 'fn-chip', attr: { type: 'button', title: `Open ${t.name} in Rhythm` },
      });
      setIcon(chip.createSpan({ cls: 'fn-ic' }), 'repeat');
      chip.createSpan({ text: t.name });
      chip.createSpan({ cls: 'fn-chip-n', text: t.target > 1 ? `${t.need} of ${t.target} left` : 'to place' });
      chip.addEventListener('click', () => plugin.openTask({ path: t.path, line: 0 }));
      /* Drag a practice onto a day to promise it there, in Rhythm's log. */
      const pc = { key: `tray:${t.name}`, source: 'practice', fromTray: true, text: t.name, path: t.path };
      byKey.set(pc.key, pc);
      makeDraggable(chip, pc, board);
    }
  }

  function render(tasks, rhythm) {
    lastTasks = tasks;
    lastRhythm = rhythm;
    const board = planBoard({ today: D.todayISO(), tasks, rhythm, settings: plugin.settings });
    lastBoard = board;
    byKey = new Map();
    if (intro) intro.update(board);
    /* A redraw keeps the reader where they were on a wide board. */
    const prev = main.querySelector('.fn-board');
    const scrollLeft = prev ? prev.scrollLeft : 0;
    main.empty();
    const top = main.createDiv({ cls: 'fn-top' });
    top.createSpan({ cls: 'fn-range', text: `${short(board.weekStart)} – ${short(D.addDays(board.weekStart, 6))}` });
    /* Installed but unreadable: say so quietly, once, above the board. */
    if (plugin.store.problems().includes('nudge')) {
      top.createSpan({ cls: 'fn-problem', text: 'Nudge reminders could not be read — they are missing from this board.' });
    }
    if (board.tray.length) renderTray(board);
    const boardEl = main.createDiv({ cls: 'fn-board' });
    for (const day of board.days) renderDay(boardEl, day, board);
    boardEl.scrollLeft = scrollLeft;
  }

  /* One load at a time. A change that arrives mid-load is not dropped: it
     earns exactly one more load once this one finishes. */
  async function refresh() {
    if (loading) { again = true; return loading; }
    loading = (async () => {
      try {
        do {
          again = false;
          const [tasks, rhythm] = await Promise.all([plugin.store.load(), plugin.store.loadRhythm()]);
          render(tasks, rhythm);
        } while (again);
      } finally { loading = null; }
    })();
    return loading;
  }

  /* The daily welcome: greeting → "Plan the week" / "Plan today" → the
     board, each fading into the next. A tap moves on at once. */
  const WELCOME_MS = 1200;
  const PLAN_MS = 2200;
  const FADE_MS = 450;

  function showIntro() {
    if (!lastBoard || intro) return;
    const now = new Date();
    const nowAt = { date: D.todayISO(now), hour: now.getHours() };
    const screens = introScreens(lastBoard, nowAt, plugin.settings);
    /* role=status: announced politely, never a focus trap. It takes focus
       only so Escape / Enter / Space can dismiss it. */
    const el = root.createDiv({ cls: 'fn-intro', attr: { role: 'status', 'aria-live': 'polite', tabindex: '-1' } });
    /* Cover what is on screen, even on a board scrolled down. */
    el.style.top = `${root.scrollTop}px`;
    el.style.height = `${root.clientHeight}px`;
    const one = el.createDiv({ cls: 'fn-intro-screen' });
    one.createDiv({ cls: 'fn-intro-title', text: screens.welcome.title });
    one.createDiv({ cls: 'fn-intro-sub', text: screens.welcome.sub });
    const two = el.createDiv({ cls: 'fn-intro-screen' });
    two.createDiv({ cls: 'fn-intro-title', text: screens.plan.title });
    const summary = two.createDiv({ cls: 'fn-intro-sub', text: screens.plan.summary });
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
      window.clearTimeout(timer);
      if (n === 0) { one.addClass('is-in'); timer = window.setTimeout(() => go(1), WELCOME_MS); }
      else if (n === 1) { one.removeClass('is-in'); two.addClass('is-in'); timer = window.setTimeout(() => go(2), PLAN_MS); }
      else if (n === 2) { el.addClass('is-out'); timer = window.setTimeout(() => go(3), FADE_MS); }
      else finish();
    };
    function finish() {
      window.clearTimeout(timer);
      if (frame != null) window.cancelAnimationFrame(frame);
      el.remove();
      intro = null;
    }
    el.addEventListener('click', () => go(stage + 1));
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') go(3);
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(stage + 1); }
    });
    intro = {
      finish,
      /* The board may finish loading after the welcome appears (at startup,
         before the vault is indexed): keep the summary true to it. */
      update(board) { summary.setText(introScreens(board, nowAt, plugin.settings).plan.summary); },
    };
    el.focus();
    /* Next frame, so the greeting fades in rather than appearing. */
    frame = window.requestAnimationFrame(() => { frame = null; go(0); });
  }

  /* First open of the day: remember it at once (without redrawing), so a
     second tab or a reload doesn't greet you twice. */
  async function start() {
    await refresh();
    const today = D.todayISO();
    if (shouldShowIntro(plugin.settings, today)) {
      plugin.settings.lastWelcome = today;
      if (plugin.saveData) await plugin.saveData(plugin.settings);
      showIntro();
    }
  }

  return {
    start, refresh, showIntro,
    stop() { if (intro) intro.finish(); root.empty(); },
  };
}

module.exports = { mountBoard };
