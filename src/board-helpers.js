'use strict';
/* Small pure helpers behind the board view: colour contrast for the theme
   accent, tidy folder/path settings, the "did anything change" signature and
   the "added but not on the board" wording. No DOM, no Obsidian — board.js
   and settings-tab.js call them, and tests/board-helpers.test.cjs drives
   them with literals. */

const D = require('./dates');
const L = require('./tasks-line');

/* ---- colour ------------------------------------------------------------ */

/* "#rgb" / "#rrggbb" / "rgb(r, g, b)" / "rgb(r g b / a)" / "hsl(h, s%, l%)"
   → [r, g, b] (0-255), or null for anything else (oklch, named colours, …:
   the caller falls back to a canvas for those). */
function parseColor(input) {
  const t = String(input == null ? '' : input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
  if (m) return [+m[1], +m[2], +m[3]];
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(t);
  if (m) return hslToRgb(+m[1], +m[2], +m[3]);
  return null;
}

/* h in degrees, s and l in percent → [r, g, b] (not rounded). */
function hslToRgb(h, s, l) {
  const S = s / 100, Lt = l / 100;
  const k = n => (n + h / 30) % 12;
  const a = S * Math.min(Lt, 1 - Lt);
  const f = n => Lt - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/* [r, g, b] → [h (degrees), s (percent), l (percent)]. */
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/* WCAG contrast ratio, 1 to 21. */
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* `over` laid on `under` at opacity a. */
const mix = (over, under, a) => over.map((v, i) => v * a + under[i] * (1 - a));

/* The tint Fortnight lays under accent text: the accent washes in its
   gradients (styles.css). They peak at .16-.2 in a page corner and fade out
   from there; accent text sits well away from the corner, so .08 stands for
   where it really is. (Testing at the .2 peak would also "fix" Obsidian's own
   default dark accent, which reads fine on every card.) */
const WASH = 0.08;
const MARGIN = 0.05;

/* The accent as ink must be readable on the paper AND on the paper under its
   own wash. If the theme's accent already is (>= min), return null — leave it
   alone. Else keep its hue and saturation and move the lightness (down on a
   light paper, up on a dark one) a percent at a time until it is; return the
   "h, s%, l%" string Fortnight writes into --fn-hsl. null too when nothing
   passes (a mid-grey paper no lightness can serve). */
function clampAccent(accent, paper, min = 4.5) {
  const need = min + MARGIN;
  const passes = rgb => contrast(rgb, paper) >= need && contrast(rgb, mix(rgb, paper, WASH)) >= need;
  if (passes(accent)) return null;
  const [h0, s0, l0] = rgbToHsl(accent);
  const h = Math.round(h0), s = Math.round(s0);
  const darker = luminance(paper) > 0.18;
  for (let step = 1; step <= 100; step++) {
    const l = Math.round(l0) + (darker ? -step : step);
    if (l < 0 || l > 100) break;
    const rgb = hslToRgb(h, s, l).map(Math.round);
    if (passes(rgb)) return `${h}, ${s}%, ${l}%`;
  }
  return null;
}

/* ---- settings ---------------------------------------------------------- */

/* A path typed in settings, tidied by `normalize` (Obsidian's normalizePath).
   Blank stays blank; a bare "/" (the vault root) is no path. keepSlash: the
   planner note takes a trailing slash to mean "this folder" (the default file
   name inside it), so there it stays; everywhere else it goes. */
function tidyPath(value, normalize, keepSlash) {
  const t = String(value == null ? '' : value).trim();
  if (!t) return '';
  const n = String(normalize(t));
  if (n === '/' || n === '') return '';
  return keepSlash && /[\\/]$/.test(t) ? `${n.replace(/\/+$/, '')}/` : n;
}

/* One folder per line → a clean list: each line normalised, blanks, the
   vault root and repeats dropped. */
function folderLines(text, normalize) {
  const out = [];
  for (const line of String(text == null ? '' : text).split('\n')) {
    const dir = tidyPath(line, normalize);
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}

/* ---- the board --------------------------------------------------------- */

/* Everything the DOM depends on, as one string. Two draws with the same
   signature would build the same DOM, so the second is skipped. null (never
   equal to anything) if it can't be made. */
function signature(board, ui) {
  try { return JSON.stringify([board, ui]); } catch (e) { return null; }
}

/* Every card on the board, wherever it sits. */
function allCards(board) {
  const out = [];
  const push = list => { for (const c of list || []) out.push(c); };
  for (const d of board.days || []) { push(d.cards); push(d.done); }
  push(board.slipped);
  push(board.later);
  push(board.doneToday);
  const nw = board.nextWeek;
  if (nw) { push(nw.anyDay); for (const d of nw.days || []) { push(d.cards); push(d.done); } }
  return out;
}

const bare = s => String(s == null ? '' : s).replace(/\r$/, '');

/* Is there a card for exactly this line? (A CRLF note's cards carry the CR.) */
function boardHasRaw(board, raw) {
  const want = bare(raw);
  return allCards(board).some(c => bare(c.raw) === want);
}

/* A to-do was written to `path` but no card for it is on the board: say what
   it is and why. */
function addedNotice(raw, board, path) {
  const t = L.parseTask(bare(raw));
  const name = t && t.text ? t.text : bare(raw);
  const date = t ? (t.scheduled || t.due) : '';
  const real = D.isDate(date);
  const lastDay = board && board.nextWeek ? D.addDays(board.nextWeek.start, 6) : '';
  const head = `Fortnight: added "${name}" to ${path}, but it isn't on the board`;
  if (real && lastDay && date > lastDay) {
    return `${head} yet — its date (${D.DOW[D.weekday(date)]} ${D.short(date)}) is beyond next week. It will show once that day is within the two weeks.`;
  }
  return `${head}. If that note is inside an excluded folder (Fortnight's settings), its to-dos never show.`;
}

module.exports = { parseColor, hslToRgb, rgbToHsl, contrast, clampAccent, tidyPath, folderLines, signature, allCards, boardHasRaw, addedNotice };
