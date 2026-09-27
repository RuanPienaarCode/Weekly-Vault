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

/* Strip outer quotes and undo yamlStr's escapes — but only when the final
   quote really is the terminator, so `"a" and "b"` keeps its delimiters. */
function unquote(s) {
  if (!/^".*"$/.test(s)) return s;
  const inner = s.slice(1, -1);
  if (/(^|[^\\])"/.test(inner)) return s;
  return inner.replace(/\\(["\\])/g, '$1');
}

/* Split an inline list on commas OUTSIDE quotes (char-by-char; no lookbehind). */
function splitListItems(inner) {
  const items = [];
  let cur = '', inQ = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && inner[i - 1] !== '\\') { inQ = !inQ; cur += ch; }
    else if (ch === ',' && !inQ) { items.push(cur); cur = ''; }
    else cur += ch;
  }
  items.push(cur);
  return items.map(s => unquote(s.trim())).filter(Boolean);
}

function parseScalar(val) {
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

function parseFrontmatter(text) {
  const m = (text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  const layout = [];
  if (m) {
    const lines = m[1].split(/\r?\n/);
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
      if (rest === '' || rest === '>' || rest === '|' || /^\s+\S/.test(next)) { raw(line); continue; }
      fm[key] = parseScalar(rest);
      layout.push({ kind: 'key', key });
    }
  }
  Object.defineProperty(fm, FM_LAYOUT, { value: layout, enumerable: false, writable: true, configurable: true });
  const body = m ? text.slice(m[0].length).replace(/^(\r?\n)+/, '') : (text || '');
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
     files too, so the safe form is the right one. */
  const needsQuote = s === '' || /^[\[\]{}&*!|>'"%@`#,]/.test(s) || /[:#]|^\s|\s$|^-\s|,/.test(s)
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
  return `---\n${out.join('\n')}\n---\n`;
}

function buildNote(fm, body) {
  const b = (body || '').replace(/^(\r?\n)+/, '');
  return serializeFrontmatter(fm) + (b ? '\n' + b : '');
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
