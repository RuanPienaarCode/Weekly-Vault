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
  const applyAccent = () => root.toggleClass('fn-blue', plugin.settings.accent !== 'theme');
  applyAccent();
  /* The board redraws inside main; the welcome lies over it, untouched by
     a redraw underneath. */
  const main = root.createDiv({ cls: 'fn-main' });
  let intro = null;
  let lastBoard = null;
  let loading = null;
  let again = false;
  let showAllSlipped = false;
  /* The day whose add field had focus, so it keeps it across a redraw and
     several to-dos can be typed in a row. */
  let addingOn = null;
  /* What is typed in each day's add field, kept across redraws (a sync or
     the previous add landing mid-typing must not wipe it). */
  const drafts = new Map();
  /* Next week shown as its seven days (else one summary column). */
  let nextOpen = false;
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
    'needs-day': 'reminders and practices need a day — drop it on one',
    'has-deadline': 'it has a 📅 deadline — put it on a day instead, or remove the deadline in its note',
    'due-sooner': "it's due before next week — put it on a day this week instead",
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

  /* Where a card or a new to-do can go: a day, Next week ("any day"), or
     Later. key is what drafts and focus are remembered by. */
  const dayDest = date => ({ key: date, date, label: `${DOW[D.weekday(date)]} ${short(date)}` });
  const nextDest = board => ({ key: 'nextWeek', slot: 'nextWeek', monday: board.nextWeek.start, label: 'Next week' });
  const LATER = { key: 'later', slot: 'later', label: 'Later' };

  async function parkTo(card, dest) {
    let r;
    try { r = await plugin.store.park(card, dest.slot, dest.monday); }
    catch (e) { console.error('Fortnight: move failed', e); r = { ok: false, reason: 'error' }; }
    if (!r.ok && r.reason !== 'busy') {
      console.warn('Fortnight: move refused', r.reason, card);
      const why = r.reason === 'due-sooner' && r.due
        ? `it's due ${DOW[D.weekday(r.due)]} ${short(r.due)} — put it on a day before then instead`
        : REASON[r.reason] || 'something went wrong (see the console)';
      new Notice(`Fortnight: couldn't move "${card.text}" to ${dest.label}: ${why}.`);
    }
    /* Tagged in its own note: say where, and offer to take it back. */
    if (r.ok && r.tagged) undoNotice(card, r);
    await refresh();
  }

  function undoNotice(card, r) {
    const tag = plugin.settings.laterTag || '#later';
    const frag = document.createDocumentFragment();
    const msg = document.createElement('span');
    msg.textContent = `"${card.text}" is in Later — tagged ${tag} in ${card.path.replace(/\.md$/, '')}. `;
    const undo = document.createElement('button');
    undo.textContent = 'Undo';
    undo.className = 'mod-cta';
    frag.append(msg, undo);
    const notice = new Notice(frag, 8000);
    undo.addEventListener('click', async ev => {
      ev.stopPropagation();
      const back = await plugin.store.revert(card, r.after, r.before);
      if (notice && notice.hide) notice.hide();
      if (!back.ok) new Notice(`Fortnight: couldn't undo — the line changed in ${card.path}.`);
      await refresh();
    });
  }

  const sendTo = (card, dest) => (dest.date ? moveTo(card, dest.date) : parkTo(card, dest));

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
    if (card.source === 'tasks') {
      /* Same rules as the store: a deadline due before next week can't be
         parked there, and Later takes no dated card. */
      const dueSooner = card.due && card.due >= board.today && card.due < board.nextWeek.start;
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Next week (any day)').setIcon('calendar-range').setDisabled(dueSooner || (card.slot === 'nextWeek' && !card.date)).onClick(() => parkTo(card, nextDest(board))));
      if (!card.due) menu.addItem(i => i.setTitle('Later').setIcon('inbox').setDisabled(card.slot === 'later').onClick(() => parkTo(card, LATER)));
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
      const card = byKey.get(e.dataTransfer.getData(DRAG_TYPE));
      if (!card) return;
      e.preventDefault();
      if (dest.date && card.date === dest.date && !card.fromTray) return;
      if (!dest.date && card.slot === dest.slot && !card.date) return;
      sendTo(card, dest);
    });
  }

  function renderCard(list, card, board, slipped) {
    const li = list.createEl('li', { cls: [`is-${card.source}`, slipped ? 'is-slipped' : '', card.done ? 'is-done' : ''] });
    /* The tick sits beside the row, not inside it: a button can't hold a
       button. Events are fixed, done cards are done. */
    if (card.source !== 'event' && !card.done) {
      const tick = li.createEl('button', { cls: 'fn-tick', attr: { type: 'button', 'aria-label': `Mark "${card.text}" done` } });
      tick.createSpan({ cls: 'fn-ring' });
      tick.addEventListener('click', e => {
        e.stopPropagation();
        if (tick.disabled) return;
        tick.disabled = true;
        tick.addClass('is-ticking');
        tickCard(card);
      });
    }
    const row = li.createEl('button', { cls: 'fn-row', attr: { type: 'button', title: `Open in ${card.path}` } });
    row.addEventListener('click', () => plugin.openTask(card));
    byKey.set(card.key, card);
    if (!card.done) makeDraggable(row, card, board);
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
    if (slipped) meta.createSpan({ cls: 'fn-slip-from', text: `from ${DOW[D.weekday(card.date)]} ${short(card.date)}` });
    if (card.time && card.source !== 'event') meta.createSpan({ cls: 'fn-time', text: card.time });
    /* A due date only earns a label when it adds something: a deadline-only
       card, or a planned card due on another day. */
    if (card.due && (card.deadlineOnly || card.due !== card.date || slipped)) {
      /* On its due day a deadline-only card just says so; a planned card
         that is due later says when. */
      const text = card.deadlineOnly ? 'Deadline'
        : card.due === board.today ? 'Due today' : `Due ${DOW[D.weekday(card.due)]} ${dayNum(card.due)}`;
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
  }

  function renderDay(boardEl, day, board) {
    const lead = day.date < board.weekStart && !day.past;
    const col = boardEl.createDiv({ cls: 'fn-col' + (day.isToday ? ' is-today' : '') + (day.past ? ' is-past' : '') + (lead ? ' is-lead' : '') });
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
      const list = card.createEl('ul', { cls: 'fn-list' });
      for (const c of day.cards) renderCard(list, c, board);
    }
    renderAdd(card, dayDest(day.date));
    renderDone(card, day, board);
  }

  /* Next week: "any day" cards, a line per day saying how much is there,
     and a button to open it out into its seven days. */
  function renderNextWeek(boardEl, board) {
    const nw = board.nextWeek;
    const col = boardEl.createDiv({ cls: ['fn-col', 'fn-next'] });
    const head = col.createDiv({ cls: 'fn-head' });
    head.createSpan({ cls: 'fn-coltitle', text: 'Next week' });
    head.createDiv({ cls: 'fn-dowline', text: `${short(nw.start)} – ${short(D.addDays(nw.start, 6))}` });
    const card = col.createDiv({ cls: 'fn-card' });
    makeDropTarget(col, nextDest(board));
    card.createDiv({ cls: 'fn-subhead', text: nw.anyDay.length ? `Any day · ${nw.anyDay.length}` : 'Any day' });
    if (nw.anyDay.length) {
      const list = card.createEl('ul', { cls: 'fn-list' });
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
    const toggle = card.createEl('button', {
      cls: 'fn-more', attr: { type: 'button', 'aria-expanded': String(nextOpen) },
      text: nextOpen ? 'Hide the days' : 'Show 7 days',
    });
    toggle.addEventListener('click', () => { nextOpen = !nextOpen; render(lastTasks, lastRhythm); });
    if (nextOpen) {
      for (const d of nw.days) {
        renderDay(boardEl, Object.assign({ past: false, isToday: false }, d), board);
        boardEl.lastChild.addClass('is-nextweek');
      }
    }
  }

  /* Later: undated to-dos waiting for a week. */
  function renderLater(boardEl, board) {
    const col = boardEl.createDiv({ cls: ['fn-col', 'fn-later'] });
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
      const list = card.createEl('ul', { cls: 'fn-list' });
      for (const c of own) renderCard(list, c, board);
    }
    if (tagged.length) {
      card.createDiv({ cls: 'fn-subhead', text: `Tagged ${plugin.settings.laterTag || '#later'} · ${tagged.length}` });
      const list = card.createEl('ul', { cls: 'fn-list' });
      for (const c of tagged) renderCard(list, c, board);
    }
    renderAdd(card, LATER);
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
    input.value = drafts.get(dest.key) || '';
    input.addEventListener('input', () => { if (input.value) drafts.set(dest.key, input.value); else drafts.delete(dest.key); });
    input.addEventListener('focus', () => { addingOn = dest.key; row.addClass('is-focused'); });
    input.addEventListener('blur', () => { row.removeClass('is-focused'); window.setTimeout(() => { if (addingOn === dest.key && !root.contains(document.activeElement)) addingOn = null; }, 0); });
    input.addEventListener('keydown', async e => {
      if (e.key === 'Escape') { input.value = ''; drafts.delete(dest.key); input.blur(); addingOn = null; return; }
      /* keyCode 229: WebKit's Enter that only confirms an IME word. */
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const text = input.value;
      if (!text.trim() || input.disabled) return;
      input.disabled = true;
      let r;
      try { r = await plugin.store.add(dest.date ? { text, date: dest.date } : { text, slot: dest.slot, monday: dest.monday }); }
      catch (err) { console.error('Fortnight: add failed', err); r = { ok: false, reason: 'error' }; }
      if (!r.ok) {
        input.disabled = false;
        new Notice(`Fortnight: couldn't add that to-do (${r.reason === 'error' ? 'see the console' : r.reason}).`);
        return;
      }
      /* Only what was sent is cleared; anything typed since stays. */
      if (drafts.get(dest.key) === text) drafts.delete(dest.key);
      addingOn = dest.key;
      await refresh();
    });
    if (addingOn === dest.key) window.setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
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
    window.requestAnimationFrame(countHidden);
    for (const t of board.tray) {
      const chip = card.createEl('button', {
        cls: 'fn-chip', attr: { type: 'button', title: `Open ${t.name} in Rhythm` },
      });
      chip.createSpan({ cls: 'fn-grip', attr: { 'aria-hidden': 'true' } });
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
    applyAccent();
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
    const title = top.createDiv({ cls: 'fn-titlebox' });
    title.createDiv({ cls: 'fn-kicker', text: board.weekStart > board.today ? 'Today, then the week' : 'This week' });
    title.createDiv({ cls: 'fn-range', text: `${short(board.weekStart)} – ${short(D.addDays(board.weekStart, 6))}` });
    /* Installed but unreadable: say so quietly, once, above the board. */
    if (plugin.store.problems().includes('nudge')) {
      top.createSpan({ cls: 'fn-problem', text: 'Nudge reminders could not be read — they are missing from this board.' });
    }
    if (board.tray.length) renderTray(top, board);
    const boardEl = main.createDiv({ cls: 'fn-board' });
    for (const day of board.days) renderDay(boardEl, day, board);
    renderNextWeek(boardEl, board);
    renderLater(boardEl, board);
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
  const WELCOME_MS = 1900;
  const PLAN_MS = 2800;
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
      update(board) { drawStats(introScreens(board, nowAt, plugin.settings).plan); },
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
