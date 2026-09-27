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

  function renderCard(list, card, board) {
    const li = list.createEl('li', { cls: card.source === 'nudge' ? 'is-nudge' : '' });
    const row = li.createEl('button', { cls: 'fn-row', attr: { type: 'button', title: `Open in ${card.path}` } });
    row.addEventListener('click', () => plugin.openTask(card));
    const body = row.createDiv({ cls: 'fn-body' });
    body.createSpan({ cls: 'fn-title', text: card.text || '(untitled)' });
    const meta = body.createDiv({ cls: 'fn-meta' });
    if (card.time) meta.createSpan({ cls: 'fn-time', text: card.time });
    /* A due date only earns a label when it adds something: a deadline-only
       card, or a planned card due on another day. */
    if (card.due && (card.deadlineOnly || card.due !== card.date)) {
      /* On its due day a deadline-only card just says so; a planned card
         that is due later says when. */
      const text = card.deadlineOnly ? 'Deadline'
        : card.due === board.today ? 'Due today' : `Due ${DOW[D.weekday(card.due)]} ${dayNum(card.due)}`;
      meta.createSpan({ cls: 'fn-due' + (card.due <= board.today ? ' is-now' : ''), text });
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
      const strip = col.createDiv({ cls: 'fn-pastcard', attr: { title: `${day.cards.length} open on ${short(day.date)}` } });
      strip.createSpan({ text: String(day.cards.length) });
      return;
    }
    const card = col.createDiv({ cls: 'fn-card' });
    if (!day.cards.length) {
      card.createDiv({ cls: 'fn-empty-day', text: 'Nothing planned' });
      return;
    }
    const list = card.createEl('ul', { cls: 'fn-list' });
    for (const c of day.cards) renderCard(list, c, board);
  }

  function render(tasks) {
    const board = planBoard({ today: D.todayISO(), tasks, settings: plugin.settings });
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
