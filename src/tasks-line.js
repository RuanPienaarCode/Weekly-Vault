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

const LINE_RE = /^([\s>]*)([-*+]|\d+[.)])[ \t]+\[([^\]\n])\][ \t]?([^\n]*)$/;

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
const TAG_ANYWHERE = /(^|\s)(#[^\s!@#$%^&*(),.?":{}|<>]+)/gu;
/* The line's tail: an optional block reference (^id) and trailing space
   (including a CR left by a CRLF file). New tokens go in front of it, so
   [[note#^id]] links keep resolving. */
const TAIL_RE = /(?:(?:^|\s)\^([A-Za-z0-9-]+))?\s*$/;

/* The emoji Fortnight writes when it adds a field the line doesn't have, and
   what each writable field accepts. */
const WRITE_MARK = { scheduled: '⏳', start: '🛫', id: '🆔' };
const VALID = { scheduled: /^\d{4}-\d{2}-\d{2}$/, start: /^\d{4}-\d{2}-\d{2}$/, id: /^[A-Za-z0-9_-]+$/ };

/* Split a line into its parts, with every field token's position in raw.
   Walking back from the end, the first hit is the rightmost token; when a
   field appears twice, the LAST one found (leftmost) is the one that counts,
   for reading and editing alike. */
function scan(raw) {
  const m = LINE_RE.exec(raw);
  if (!m) return null;
  const [, indent, marker, status, rest] = m;
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
  return { indent, marker, status, rest, textEnd: end, tailAt: base + tail.index, blockRef: tail[1] || '', tokens };
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

/* Change only the character inside the box. Drop writes '-' (cancelled);
   ticking done goes through Tasks itself, never through here. */
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

module.exports = { parseTask, isOpen, setField, setStatus };
