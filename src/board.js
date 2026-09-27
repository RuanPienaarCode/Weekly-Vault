'use strict';
/* The board (desktop, read-only for now): this week's days as columns in
   the Grouped look. Rendering only — what goes where is planBoard's call. */

const { setIcon } = require('obsidian');
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
  let lastTasks = [];
  let lastRhythm = null;
  const SLIPPED_PREVIEW = 5;

  function renderCard(list, card, board, slipped) {
    const li = list.createEl('li', { cls: [`is-${card.source}`, slipped ? 'is-slipped' : ''] });
    const row = li.createEl('button', { cls: 'fn-row', attr: { type: 'button', title: `Open in ${card.path}` } });
    row.addEventListener('click', () => plugin.openTask(card));
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
    if (!day.cards.length) {
      card.createDiv({ cls: 'fn-empty-day', text: 'Nothing planned' });
      return;
    }
    const list = card.createEl('ul', { cls: 'fn-list' });
    for (const c of day.cards) renderCard(list, c, board);
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
    }
  }

  function render(tasks, rhythm) {
    lastTasks = tasks;
    lastRhythm = rhythm;
    const board = planBoard({ today: D.todayISO(), tasks, rhythm, settings: plugin.settings });
    lastBoard = board;
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
