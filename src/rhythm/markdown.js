'use strict';
/* The markdown files ARE the database. Everything shown is derived from notes
   the user could have written by hand, so a hand-edited note must survive a
   round trip: the frontmatter reader models flat `key: value` lines and
   inline lists `[a, b]`, and passes EVERYTHING ELSE through verbatim (block
   sequences Obsidian's Properties panel writes, nested maps, comments).

   Pure — no DOM, no obsidian import. No lookbehind regex anywhere (a
   lookbehind LITERAL is a parse-time SyntaxError on iOS < 16.4 and kills
   the whole bundle at load). */

const FM_LAYOUT = Symbol.for('rv.fmLayout');
const FM_EOL = Symbol.for('rv.fmEol');

/* Which line ending the note already uses — preserved on write so a CRLF
   file never comes back with mixed endings. */
function detectEOL(text) {
  const i = (text || '').indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

/* An unquoted scalar's trailing ` # comment` is a YAML comment, not part of
   the value — but only OUTSIDE quotes, so `"3/week # was"` keeps its hash.
   Char-by-char (no lookbehind). */
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        if (quote === '"' && s[i - 1] === '\\') continue;
        if (quote === "'" && s[i + 1] === "'") { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#' && i > 0 && s[i - 1] === ' ') return s.slice(0, i - 1);
  }
  return s;
}

/* Strip outer quotes and undo yamlStr's escapes — but only when the final
   quote really is the terminator, so `"a" and "b"` keeps its delimiters.
   Handles both YAML quote styles: double-quoted (`\"` / `\\` escapes) and
   single-quoted (the only escape is a doubled `''` for a literal `'`). */
function unquote(s) {
  if (/^".*"$/.test(s)) {
    const inner = s.slice(1, -1);
    if (/(^|[^\\])"/.test(inner)) return s;
    return inner.replace(/\\(["\\])/g, '$1');
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    const inner = s.slice(1, -1);
    let ok = true;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "'") {
        if (inner[i + 1] === "'") { i++; continue; }
        ok = false; break;
      }
    }
    return ok ? inner.replace(/''/g, "'") : s;
  }
  return s;
}

/* Split an inline list on commas OUTSIDE quotes (char-by-char; no
   lookbehind). Tracks whichever quote character opened, single or double,
   so a comma or the other quote character inside it is not a delimiter. */
function splitListItems(inner) {
  const items = [];
  let cur = '', quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === quote) {
        if (quote === '"' && inner[i - 1] === '\\') continue;
        if (quote === "'" && inner[i + 1] === "'") { cur += inner[++i]; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ',') { items.push(cur); cur = ''; continue; }
    cur += ch;
  }
  items.push(cur);
  return items.map(s => unquote(s.trim())).filter(Boolean);
}

function parseScalar(val) {
  val = stripComment(val).trim();
  if (/^\[.*\]$/.test(val) && !/^\[\[[^\]]*\]\]$/.test(val)) {
    return splitListItems(val.slice(1, -1));
  }
  /* A bare number comes back as a NUMBER so it can be written back bare.
     Read as a string it would be re-quoted on the next save (yamlStr has
     to quote a numeric string, or a name like "2024" would become an int),
     and every edit would churn `minutes: 45` into `minutes: "45"`.
     Guarded on the canonical form so `007` and `1.50` stay strings. */
  if (/^-?\d+(\.\d+)?$/.test(val) && String(Number(val)) === val) return Number(val);
  return unquote(val);
}

/* Strip a leading `- ` (block-sequence item) marker and unquote what's
   left, single- or double-quoted. */
function unquoteBlockItem(line) {
  return unquote(line.replace(/^\s*-\s?/, '').trim());
}

function parseFrontmatter(rawText) {
  /* A leading BOM (Universal Clipboard / some external editors) must not
     stop the fence from matching — that would push the whole frontmatter
     block into the body instead of losing just the BOM. */
  const text = (rawText || '').replace(/^﻿/, '');
  const eol = detectEOL(text);
  /* The `(?:\r?\n)?` before the closing fence (rather than a required
     `\r?\n`) is what lets `---\n---` match at all: with a required
     newline on both sides of the capture, an EMPTY frontmatter block has
     nowhere for both to fit — they would need the same one `\n` twice. */
  const m = text.match(/^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/);
  const fm = {};
  const layout = [];
  if (m) {
    const lines = m[1] === '' ? [] : m[1].split(/\r?\n/);
    const raw = line => {
      const last = layout[layout.length - 1];
      if (last && last.kind === 'raw') last.lines.push(line);
      else layout.push({ kind: 'raw', lines: [line] });
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s/.test(line) || /^-\s/.test(line) || /^#/.test(line) || line.trim() === '') { raw(line); continue; }
      const ci = line.indexOf(':');
      if (ci <= 0) { raw(line); continue; }
      const key = line.slice(0, ci).trim();
      const rest = line.slice(ci + 1).trim();
      const next = lines[i + 1] ?? '';
      /* A block sequence — `key:` with nothing after it, followed by
         indented `- item` lines, the form Obsidian's own Properties panel
         writes for a list property. The WHOLE block (key line + every
         continuation line) collapses into ONE layout slot, so writing
         this key back replaces all of it — never leaves stray `- item`
         lines behind to form a duplicate key. */
      if (rest === '' && /^\s+-(\s|$)/.test(next)) {
        const items = [];
        let j = i + 1;
        while (j < lines.length && /^\s+-(\s|$)/.test(lines[j])) { items.push(unquoteBlockItem(lines[j])); j++; }
        fm[key] = items;
        layout.push({ kind: 'key', key });
        i = j - 1;
        continue;
      }
      if (rest === '' || rest === '>' || rest === '|' || /^\s+\S/.test(next)) { raw(line); continue; }
      fm[key] = parseScalar(rest);
      layout.push({ kind: 'key', key });
    }
  }
  Object.defineProperty(fm, FM_LAYOUT, { value: layout, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(fm, FM_EOL, { value: eol, enumerable: false, writable: true, configurable: true });
  const body = m ? text.slice(m[0].length).replace(/^(\r?\n)+/, '') : text;
  return { fm, body };
}

/* Quote a scalar for YAML only when it would otherwise change meaning. */
function yamlStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v).replace(/\r?\n/g, ' ').trim();
  /* Dates (2026-09-12) stay bare: Obsidian reads them as date properties.
     Bare numbers are quoted so a name like "2024" stays a string. */
  /* Any colon or hash gets quotes, not just one followed by a space: bare
     `05:30` is a sexagesimal number to a YAML 1.1 reader (330), and a bare
     `#` starts a comment. Obsidian's own Properties panel reads these
     files too, so the safe form is the right one. `{ } [ ] ,` are flow
     indicators and matter ANYWHERE in the scalar, not just at the start;
     `? ` `- ` and the remaining indicator characters only matter there. */
  const needsQuote = s === '' || /[{}[\]:#,]/.test(s) || /^[?\-]\s/.test(s)
    || /^[&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)
    || /^(true|false|null|yes|no|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
  if (!needsQuote) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function yamlVal(v) {
  if (Array.isArray(v)) return '[' + v.map(yamlStr).join(', ') + ']';
  return yamlStr(v);
}

/* Re-emit modelled keys in their original position, raw lines verbatim, and
   any NEW key (not in the layout) at the end. Keys set to undefined are
   dropped. */
function serializeFrontmatter(fm) {
  const layout = fm[FM_LAYOUT] || [];
  const eol = fm[FM_EOL] || '\n';
  const out = [];
  const seen = new Set();
  for (const part of layout) {
    if (part.kind === 'raw') { out.push(...part.lines); continue; }
    seen.add(part.key);
    if (fm[part.key] === undefined) continue;
    out.push(`${part.key}: ${yamlVal(fm[part.key])}`);
  }
  for (const [k, v] of Object.entries(fm)) {
    if (seen.has(k) || v === undefined) continue;
    out.push(`${k}: ${yamlVal(v)}`);
  }
  return `---${eol}${out.join(eol)}${eol}---${eol}`;
}

/* A note read as CRLF must be written back CRLF, never a mix of the two —
   the body is passed through verbatim (untouched, whatever endings it
   already has); only the separator between the fence and the body needs
   to match. */
function buildNote(fm, body) {
  const eol = fm[FM_EOL] || '\n';
  const b = (body || '').replace(/^(\r?\n)+/, '');
  return serializeFrontmatter(fm) + (b ? eol + b : '');
}

/* Patch keys in an existing note's frontmatter, leaving the body untouched. */
function patchFrontmatter(text, patch) {
  const { fm, body } = parseFrontmatter(text);
  for (const [k, v] of Object.entries(patch)) fm[k] = v;
  return buildNote(fm, body);
}

/* Windows/macOS-illegal filename characters folded to '-'. */
function safeName(s) {
  const cleaned = (s || '').toString().replace(/[\\/:*?"<>|#^\[\]]/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200).trim() || '-';
}

module.exports = { parseFrontmatter, serializeFrontmatter, buildNote, patchFrontmatter, yamlStr, safeName, FM_LAYOUT };
