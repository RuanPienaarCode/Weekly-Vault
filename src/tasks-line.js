'use strict';
/* A Tasks checkbox line, read and edited IN PLACE.

   Fortnight edits lines it does not own — a to-do typed by hand in any note.
   So it never re-serialises a line: an edit replaces, inserts or removes one
   token and leaves every other byte exactly as the author wrote it.

   Fields are read the way Tasks reads them: only from the END of the line,
   one at a time, walking backwards until something that is not a field
   stops the walk. So "Read ⏳ 2026-09-30 notes" has no scheduled date — to
   Tasks that date is part of the description, and the board must agree with
   Tasks queries. Reading and editing share ONE scanner, so they can never
   pick different tokens. */

/* Tasks' own task line: indent (blockquote/callout marks allowed), list
   marker, SPACES (Obsidian also counts a tab there, but Tasks does not and its
   toggle then mangles the line), the box, then a space or tab — or the end of
   the line. "- [ ]x" is a list item with text, not a task. Group 4 is the text
   after the separator; group 5 is what is left when the box ends the line (a
   bare CR from a CRLF file). */
const LINE_RE = /^([\s>]*)([-*+]|\d+[.)]) +\[([^\]\n])\](?:[ \t]([^\n]*)|(\r?))$/;

const DATE = '(\\d{4}-\\d{2}-\\d{2})';
/* Each field as Tasks spells it (optional U+FE0F, spaces, value), anchored
   to the end of the text scanned so far. The u flag keeps each emoji whole. */
const field = (name, emoji, value) => ({ name, re: new RegExp(`(${emoji})\\uFE0F? *${value}$`, 'u') });
const FIELDS = [
  field('scheduled', '⏳|⌛', DATE),
  field('due', '📅|📆|🗓', DATE),
  field('start', '🛫', DATE),
  field('doneDate', '✅', DATE),
  field('created', '➕', DATE),
  field('cancelledDate', '❌', DATE),
  field('recurrence', '🔁', '([a-zA-Z0-9, !]+)'),
  field('id', '🆔', '([a-zA-Z0-9_-]+)'),
  field('dependsOn', '⛔', '([a-zA-Z0-9_-]+(?: *, *[a-zA-Z0-9_-]+ *)*)'),
  field('onCompletion', '🏁', '([a-zA-Z]+)'),
  { name: 'priority', re: /(🔺|⏫|🔼|🔽|⏬)️?()$/u },
  /* A trailing tag is stepped over like a field, as Tasks does. No
     lookbehind (iOS 15): the leading boundary is captured instead. */
  { name: 'tag', re: /(^|\s)(#[^\s!@#$%^&*(),.?":{}|<>]+)$/u },
];
const PRIORITY = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };
/* Sort weight, highest first; a line with no priority emoji is 'normal'. */
const PRIORITY_RANK = { highest: 5, high: 4, medium: 3, normal: 2, low: 1, lowest: 0 };
const TAG_ANYWHERE = /(^|\s)(#[^\s!@#$%^&*(),.?":{}|<>]+)/gu;
/* The line's tail: an optional block reference (^id) and trailing space
   (including a CR left by a CRLF file). New tokens go in front of it, so
   [[note#^id]] links keep resolving. */
const TAIL_RE = /(?:(?:^|\s)\^([A-Za-z0-9-]+))?\s*$/;

/* The emoji Fortnight writes when it adds a field the line doesn't have, and
   what each writable field accepts. */
const WRITE_MARK = { scheduled: '⏳', start: '🛫', id: '🆔', cancelledDate: '❌', doneDate: '✅' };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID = { scheduled: ISO_DATE, start: ISO_DATE, id: /^[A-Za-z0-9_-]+$/, cancelledDate: ISO_DATE, doneDate: ISO_DATE };

/* Split a line into its parts, with every field token's position in raw.
   Walking back from the end, the first hit is the rightmost token; when a
   field appears twice, the LAST one found (leftmost) is the one that counts,
   for reading and editing alike. */
function scan(raw) {
  const m = LINE_RE.exec(raw);
  if (!m) return null;
  const [, indent, marker, status] = m;
  const rest = m[4] !== undefined ? m[4] : m[5];
  const base = raw.length - rest.length;
  const tail = TAIL_RE.exec(rest);
  const tokens = {};
  let end = tail.index;
  for (;;) {
    let e = end;
    while (e > 0 && /\s/.test(rest[e - 1])) e--;
    const head = rest.slice(0, e);
    let hit = null;
    for (const f of FIELDS) {
      const g = f.re.exec(head);
      if (g) { hit = { f, g }; break; }
    }
    if (!hit) break;
    const { f, g } = hit;
    const start = f.name === 'tag' ? g.index + g[1].length : g.index;
    if (f.name !== 'tag') {
      tokens[f.name] = { start: base + start, end: base + e, valueStart: base + e - g[2].length, mark: g[1] };
    }
    end = start;
  }
  return { indent, marker, status, rest, textEnd: end, textEndAt: base + end, tailAt: base + tail.index, blockRef: tail[1] || '', tokens };
}

function parseTask(raw) {
  const s = String(raw == null ? '' : raw);
  const p = scan(s);
  if (!p) return null;
  const value = name => (p.tokens[name] ? s.slice(p.tokens[name].valueStart, p.tokens[name].end) : '');
  const tags = [];
  p.rest.replace(TAG_ANYWHERE, (all, pre, tag) => { tags.push(tag); return all; });
  const pr = p.tokens.priority;
  return {
    raw: s, indent: p.indent, marker: p.marker, status: p.status,
    done: p.status === 'x' || p.status === 'X',
    cancelled: p.status === '-',
    text: p.rest.slice(0, p.textEnd).replace(TAG_ANYWHERE, '$1').replace(/\s+/g, ' ').trim(),
    scheduled: value('scheduled'), start: value('start'), due: value('due'),
    doneDate: value('doneDate'), created: value('created'),
    id: value('id'), recurrence: value('recurrence').trim(),
    priority: pr ? PRIORITY[pr.mark] : 'normal',
    tags, blockRef: p.blockRef,
  };
}

/* Change ONE field of a line and nothing else. value null removes it. */
function setField(raw, name, value) {
  if (!WRITE_MARK[name]) throw new Error(`tasks-line: cannot set ${name}`);
  if (value != null && !VALID[name].test(value)) {
    throw new Error(name === 'id' ? `tasks-line: bad id "${value}"` : `tasks-line: ${name} needs a YYYY-MM-DD date, got "${value}"`);
  }
  const s = String(raw);
  const p = scan(s);
  if (!p) return s;
  const tok = p.tokens[name];
  if (value == null) {
    if (!tok) return s;
    /* Take one space or tab before the token with it, so no gap is left. */
    const prev = s[tok.start - 1];
    const from = prev === ' ' || prev === '\t' ? tok.start - 1 : tok.start;
    return s.slice(0, from) + s.slice(tok.end);
  }
  if (tok) return s.slice(0, tok.valueStart) + value + s.slice(tok.end);
  const at = p.tailAt;
  const before = /\s/.test(s[at - 1] || '') ? '' : ' ';
  const after = s[at] && !/\s/.test(s[at]) ? ' ' : '';
  return s.slice(0, at) + before + WRITE_MARK[name] + ' ' + value + after + s.slice(at);
}

/* One whole tag, case-insensitive: "#later" but never "#laterish" or
   "#later/sub". A lookahead (not lookbehind) is fine on iOS 15.
   Compiled once per (tag, flags): the board asks about the same one or two
   tags for every card on every redraw. A global matcher keeps a lastIndex, so
   it is only ever used through String.replace (which resets it), never .test. */
const TAG_RES = new Map();
function tagRe(tag, flags) {
  const key = `${flags}\u0000${tag}`;
  let re = TAG_RES.get(key);
  if (!re) {
    /* The tag comes from a setting: a handful at most, but never unbounded. */
    if (TAG_RES.size >= 32) TAG_RES.clear();
    re = new RegExp(`(^|[ \\t])(${String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[ \\t\\r,.;:!?)\\]]|$)`, flags);
    TAG_RES.set(key, re);
  }
  return re;
}

const hasTag = (raw, tag) => tagRe(tag, 'i').test(String(raw));

/* Add a tag at the end of the description — before the Tasks fields, so
   Tasks still reads every one of them. Never twice. */
function addTag(raw, tag) {
  const s = String(raw);
  const p = scan(s);
  if (!p || hasTag(s, tag)) return s;
  let at = p.textEndAt;
  while (at > 0 && (s[at - 1] === ' ' || s[at - 1] === '\t')) at--;
  return s.slice(0, at) + ' ' + tag + s.slice(at);
}

/* Remove a tag (and the one space before each copy), wherever it sits. */
function removeTag(raw, tag) {
  const s = String(raw);
  if (!scan(s)) return s;
  return s.replace(tagRe(tag, 'gi'), '');
}

/* Change only the character inside the box. Drop writes '-' (cancelled).
   Ticking done goes through Tasks itself; this writes a plain 'x' only when
   Tasks isn't installed. */
function setStatus(raw, ch) {
  if (typeof ch !== 'string' || ch.length !== 1 || ch === ']' || ch === '[' || ch === '\n') {
    throw new Error(`tasks-line: bad status "${ch}"`);
  }
  const s = String(raw);
  const m = LINE_RE.exec(s);
  if (!m) return s;
  const at = s.indexOf('[', m[1].length + m[2].length) + 1;
  return s.slice(0, at) + ch + s.slice(at + 1);
}

/* Open means still to do: [ ], [/] in progress, and any status character
   Fortnight doesn't know. Done is [x]/[X]; cancelled is [-]. */
const isOpen = t => !!t && !t.done && !t.cancelled;

/* ---- reading a note's text -------------------------------------------------

   Obsidian's metadata cache can lag a write (a line number from it may point
   at the wrong line for a moment), so the store reads the note's TEXT and
   finds the task lines itself — with the same rules Obsidian counts them by:
   nothing inside front matter or a fenced code block. The same scanner tells
   quick-add which "#" lines are really headings. */

/* An opening or closing fence: up to a quote mark or indent, then 3+ backticks
   or tildes, then whatever follows on the line. */
const FENCE_RE = /^[\s>]*(`{3,}|~{3,})(.*)$/;

/* One flag per line: true for front matter and fenced code (the fence lines
   themselves included) — text that is not the note's markdown body. A fence
   closes on the same character with at least as many marks and nothing else;
   one that never closes runs to the end of the note. A backtick fence cannot
   have backticks in its info string (that is inline code). Front matter is a
   "---" first line (a BOM before it is ignored) closed by a later "---" or
   "..." line; without a closing line the first line is just a rule. */
function verbatimLines(lines) {
  const flags = new Array(lines.length).fill(false);
  const bare = i => String(lines[i]).replace(/\r$/, '');
  let from = 0;
  if (lines.length && bare(0).replace(/^﻿/, '').trimEnd() === '---') {
    for (let i = 1; i < lines.length; i++) {
      const l = bare(i).trimEnd();
      if (l === '---' || l === '...') { for (let j = 0; j <= i; j++) flags[j] = true; from = i + 1; break; }
    }
  }
  let open = null;
  for (let i = from; i < lines.length; i++) {
    const m = FENCE_RE.exec(bare(i));
    if (open) {
      flags[i] = true;
      if (m && m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === '') open = null;
    } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      open = { ch: m[1][0], len: m[1].length };
      flags[i] = true;
    }
  }
  return flags;
}

/* Every task line of a note's text as { line, raw } (raw keeps its own \r). */
function taskLines(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const skip = verbatimLines(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) if (!skip[i] && LINE_RE.test(lines[i])) out.push({ line: i, raw: lines[i] });
  return out;
}

/* Tasks' global filter: a line is a task to Tasks only if the text after the
   box (block reference taken off) contains the filter. Empty = every line. */
function inFilter(raw, filter) {
  if (!filter) return true;
  const m = LINE_RE.exec(String(raw));
  if (!m) return false;
  const body = (m[4] !== undefined ? m[4] : m[5]).trim().replace(/ \^[a-zA-Z0-9-]+$/, '').trim();
  return body.includes(filter);
}

module.exports = { parseTask, isOpen, setField, setStatus, addTag, removeTag, hasTag, taskLines, verbatimLines, inFilter, PRIORITY_RANK };
