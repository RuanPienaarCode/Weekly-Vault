'use strict';
/* The board (desktop, read-only for now): this week's days as columns in
   the Grouped look. Rendering only — what goes where is planBoard's call. */

const { setIcon } = require('obsidian');
const { planBoard } = require('./plan');
const D = require('./dates');

const { DOW, dayNum, short } = D;
const noteName = path => path.split('/').pop().replace(/\.md$/, '');

function mountBoard(view) {
  const plugin = view.plugin;
  const root = view.contentEl;
  let loading = null;
  let again = false;
  let showAllSlipped = false;
  let lastTasks = [];
  const SLIPPED_PREVIEW = 5;

  function renderCard(list, card, board, slipped) {
    const li = list.createEl('li', { cls: [card.source === 'nudge' ? 'is-nudge' : '', slipped ? 'is-slipped' : ''].filter(Boolean) });
    const row = li.createEl('button', { cls: 'fn-row', attr: { type: 'button', title: `Open in ${card.path}` } });
    row.addEventListener('click', () => plugin.openTask(card));
    const body = row.createDiv({ cls: 'fn-body' });
    body.createSpan({ cls: 'fn-title', text: card.text || '(untitled)' });
    const meta = body.createDiv({ cls: 'fn-meta' });
    if (slipped) meta.createSpan({ cls: 'fn-slip-from', text: `from ${DOW[D.weekday(card.date)]} ${short(card.date)}` });
    if (card.time) meta.createSpan({ cls: 'fn-time', text: card.time });
    /* A due date only earns a label when it adds something: a deadline-only
       card, or a planned card due on another day. */
    if (card.due && (card.deadlineOnly || card.due !== card.date || slipped)) {
      /* On its due day a deadline-only card just says so; a planned card
         that is due later says when. */
      const text = card.deadlineOnly ? 'Deadline'
        : card.due === board.today ? 'Due today' : `Due ${DOW[D.weekday(card.due)]} ${dayNum(card.due)}`;
      meta.createSpan({ cls: card.due <= board.today ? ['fn-due', 'is-now'] : 'fn-due', text });
    }
    if (card.source === 'nudge') {
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
        render(lastTasks);
        const again = root.querySelector('.fn-more');
        if (again) again.focus();
      });
    }
    col.createDiv({ cls: 'fn-gh', text: 'Today' });
  }

  function render(tasks) {
    lastTasks = tasks;
    const board = planBoard({ today: D.todayISO(), tasks, settings: plugin.settings });
    /* A redraw keeps the reader where they were on a wide board. */
    const prev = root.querySelector('.fn-board');
    const scrollLeft = prev ? prev.scrollLeft : 0;
    root.empty();
    root.addClass('fortnight');
    const top = root.createDiv({ cls: 'fn-top' });
    top.createSpan({ cls: 'fn-range', text: `${short(board.weekStart)} – ${short(D.addDays(board.weekStart, 6))}` });
    /* Installed but unreadable: say so quietly, once, above the board. */
    if (plugin.store.problems().includes('nudge')) {
      top.createSpan({ cls: 'fn-problem', text: 'Nudge reminders could not be read — they are missing from this board.' });
    }
    const boardEl = root.createDiv({ cls: 'fn-board' });
    for (const day of board.days) renderDay(boardEl, day, board);
    boardEl.scrollLeft = scrollLeft;
  }

  /* One load at a time. A change that arrives mid-load is not dropped: it
     earns exactly one more load once this one finishes. */
  async function refresh() {
    if (loading) { again = true; return loading; }
    loading = (async () => {
      try {
        do { again = false; render(await plugin.store.load()); } while (again);
      } finally { loading = null; }
    })();
    return loading;
  }

  return { start: refresh, refresh, stop() { root.empty(); } };
}

module.exports = { mountBoard };
