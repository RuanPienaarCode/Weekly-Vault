'use strict';
/* CSS tripwires for the real mobile floor (iOS 15.6 WebKit) and the Obsidian
   host cascade. ios-hazards.test.cjs scans src/*.js; nothing scanned the
   stylesheet, so a host-colliding class or a rule the phone can't parse
   shipped silently. Plain node, no CSS parser: a small brace walker is
   enough for this file, and it is itself proven below against bad samples.

   1. src/styles.css has no color-mix(), :has(), container queries, `inset`
      property, or !important, and no stray comment delimiter.
   2. It reads no host variable that Obsidian 1.14.4 defines with
      color-mix() — on iOS 15.6 the whole declaration goes invalid.
   3. Every selector sits under .fortnight.
   4. No plugin class collides with a host body class: not compounded onto
      .fortnight in CSS, not added to any element from src/*.js. (Obsidian's
      own `.is-phone{--view-top-spacing:0}` hit our root once and pushed the
      whole board under the notch.)
   5. The contract classes the UI toggles are styled, focus rings survive the
      resets, and the rules that must beat the host's padding/overflow rules
      outrank them. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');

/* ---- scanners (pure; proven against bad samples at the bottom) ------------ */

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* Host variables Obsidian 1.14.4 defines with color-mix(in oklch, …): read
   through var(), they are valid tokens that turn invalid at computed-value
   time on Safari < 16.2, and no var() fallback applies. Derived from the
   host's app.css (`--name: color-mix(`); extend when a new host adds more. */
const COLOR_MIX_HOST_VARS = [
  '--background-modifier-active-hover', '--background-modifier-hover', '--background-modifier-message',
  '--bases-embed-border-color', '--bases-table-border-color', '--bases-table-header-background-hover',
  '--blur-background', '--embed-actions-background', '--indentation-guide-color', '--indentation-guide-color-active',
  '--link-unresolved-decoration-color', '--nav-collapse-icon-color', '--nav-collapse-icon-color-collapsed',
  '--nav-item-background-selected', '--scrollbar-active-thumb-bg', '--scrollbar-thumb-bg', '--table-border-color',
  '--table-selection', '--tag-background', '--tag-background-hover', '--tag-border-color', '--tag-border-color-hover',
  '--text-selection', '--workspace-background-translucent',
  '--highlight-background-blue', '--highlight-background-green', '--highlight-background-orange',
  '--highlight-background-purple', '--highlight-background-red', '--highlight-background-yellow',
  '--color-secondary-2', '--color-secondary-3', '--color-secondary-4', '--color-secondary-5', '--color-secondary-6',
];

/* Classes Obsidian puts on <body> / the app shell. A plugin element carrying
   one inherits (or triggers) host rules written for the whole app. Only the
   host-reserved state classes: Fortnight's own `is-focused` (on one add row)
   and `is-dragging` (on a card) are descendants no host rule reaches, and
   `mod-cta` is the deliberate button modifier, so none of those are listed. */
const HOST_BODY_CLASSES = [
  'is-phone', 'is-mobile', 'is-tablet', 'is-ios', 'is-android', 'is-floating-nav', 'is-hidden-nav',
  'is-translucent', 'is-popout-window', 'is-fullscreen', 'is-frameless', 'auto-full-screen', 'emulate-mobile',
  'mod-macos', 'mod-windows', 'mod-linux', 'theme-dark', 'theme-light',
];

const CSS_HAZARDS = [
  ['color-mix()', /color-mix\s*\(/i],
  [':has()', /:has\s*\(/i],
  ['container query', /@container\b|\bcontainer-type\s*:|\bcontainer-name\s*:/i],
  ['inset property', /(?:^|[\s;{])inset(?:-[a-z]+)*\s*:/i],
  ['!important', /!\s*important/i],
];

/* Rules as { sel, body } in source order, nested inside @media/@supports
   included; @keyframes frames and at-rule preludes are not selectors. */
function rulesOf(css) {
  const text = stripComments(css);
  const out = [];
  const stack = [];
  let start = 0;
  let bodyStart = -1;
  let open = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      const prelude = text.slice(start, i).trim();
      stack.push(prelude);
      start = i + 1;
      if (!prelude.startsWith('@') && !stack.some(p => /^@(?:-[a-z]+-)?keyframes/i.test(p))) {
        open = { sel: prelude, body: '' };
        bodyStart = i + 1;
      }
    } else if (ch === '}') {
      if (open) { open.body = text.slice(bodyStart, i); out.push(open); open = null; }
      stack.pop();
      start = i + 1;
    } else if (ch === ';' && !open) {
      start = i + 1;
    }
  }
  return out;
}

/* Split a selector list on commas outside parentheses. */
function selectorList(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/* [ids, classes+attributes+pseudo-classes, types+pseudo-elements] — enough to
   compare two plain selectors; no :not()/:is() in this stylesheet. */
function specificity(sel) {
  const s = sel.replace(/\[[^\]]*\]/g, '.a').replace(/::?[a-z-]+\([^)]*\)/gi, ':p');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const pseudoEls = (s.match(/::[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length + (s.match(/(?:^|[^:]):(?!:)[\w-]+/g) || []).length;
  const types = (s.replace(/[.#:][\w-]+/g, ' ').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length + pseudoEls;
  return [ids, classes, types];
}
const outranks = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

function cssViolations(css) {
  const text = stripComments(css);
  const bad = [];
  if (/\/\*|\*\//.test(text)) bad.push('stray comment delimiter (a "*/" inside a comment ends it early)');
  for (const [name, re] of CSS_HAZARDS) if (re.test(text)) bad.push(`${name} — not safe on the iOS 15.6 floor / banned in this plugin`);
  for (const v of COLOR_MIX_HOST_VARS) {
    if (new RegExp(`var\\(\\s*${v}(?![\\w-])`).test(text)) bad.push(`reads host ${v}, which is color-mix() in Obsidian 1.14.4`);
  }
  for (const { sel } of rulesOf(css)) {
    for (const one of selectorList(sel)) {
      if (!/\.fortnight(?![\w-])/.test(one)) bad.push(`selector not under .fortnight: ${one}`);
      for (const compound of one.split(/[\s>+~]+/)) {
        if (!/\.fortnight(?![\w-])/.test(compound)) continue;
        for (const cls of HOST_BODY_CLASSES) {
          if (new RegExp(`\\.${cls}(?![\\w-])`).test(compound)) bad.push(`.fortnight compounded with host class .${cls}: ${one}`);
        }
      }
    }
  }
  return bad;
}

/* A line that is only a comment can't be a class addition; inline comments are
   left (stripping /* … *\/ anywhere would eat glob strings like 'a/*'). */
function stripLineComments(js) {
  return js.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
}

/* Class additions: addClass/toggleClass/classList.add|toggle, `cls:` and
   `class:` options, className =. Reads (hasClass, closest, querySelector,
   Platform.isPhone) are fine and not matched. */
const ADD_CLASS = /(?:\b(?:addClass|toggleClass)\s*\(|\bclassList\s*\.\s*(?:add|toggle)\s*\(|\bcls\s*:|\bclass\s*:|\bclassName\s*=)/g;
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function jsViolations(name, js) {
  const text = stripLineComments(js);
  const bad = [];
  let m;
  ADD_CLASS.lastIndex = 0;
  while ((m = ADD_CLASS.exec(text))) {
    let window = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const stop = window.search(/;|\n\s*\n/);
    if (stop >= 0) window = window.slice(0, stop);
    let q;
    QUOTED.lastIndex = 0;
    while ((q = QUOTED.exec(window))) {
      for (const tok of q[2].split(/\s+/)) {
        if (HOST_BODY_CLASSES.includes(tok)) bad.push(`${name}: adds host body class "${tok}" — pick an fn- name`);
      }
    }
  }
  return bad;
}

/* Every .js under src/, vendored subfolders included (they ship in the bundle). */
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)).map(f => path.join(e.name, f)) : [e.name]);

/* ---- the scanners catch what they claim to (negative controls) ----------- */
{
  const has = (arr, needle) => arr.some(x => x.includes(needle));
  assert.ok(has(cssViolations('.fortnight a { color: color-mix(in srgb, red, blue); }'), 'color-mix'));
  assert.ok(has(cssViolations('.fortnight a:has(b) { top: 0; }'), ':has()'));
  assert.ok(has(cssViolations('@container (min-width: 1px) { .fortnight a { top: 0; } }'), 'container'));
  assert.ok(has(cssViolations('.fortnight a { container-type: inline-size; }'), 'container'));
  assert.ok(has(cssViolations('.fortnight a { position: absolute; inset: 0; }'), 'inset'));
  assert.ok(has(cssViolations('.fortnight a { padding: 0 !important; }'), '!important'));
  assert.ok(has(cssViolations('.fortnight a { padding: 0 ! important; }'), '!important'));
  assert.ok(has(cssViolations('.fortnight a { background: var(--background-modifier-hover, red); }'), '--background-modifier-hover'));
  assert.ok(has(cssViolations('.fortnight a { top: 0; } /* a */ b */'), 'stray comment'));
  assert.ok(has(cssViolations('.card { top: 0; }'), 'selector not under .fortnight'));
  assert.ok(has(cssViolations('.fortnight a, .other b { top: 0; }'), 'selector not under .fortnight: .other b'));
  assert.ok(has(cssViolations('@media (max-width: 1px) { button { top: 0; } }'), 'selector not under .fortnight'));
  assert.ok(has(cssViolations('.fortnight.is-phone a { top: 0; }'), 'host class .is-phone'));
  assert.ok(has(cssViolations('.theme-dark .fortnight.is-mobile a { top: 0; }'), 'host class .is-mobile'));
  assert.ok(has(jsViolations('x.js', "root.toggleClass('is-phone', on);"), 'is-phone'));
  assert.ok(has(jsViolations('x.js', "el.addClass('fn-a is-tablet');"), 'is-tablet'));
  assert.ok(has(jsViolations('x.js', "document.body.classList.add('is-ios');"), 'is-ios'));
  assert.ok(has(jsViolations('x.js', "parent.createDiv({ cls: ['a', 'is-mobile'], text: 'x' });"), 'is-mobile'));
  assert.ok(has(jsViolations('x.js', "const e = createEl('div', {\n  cls: ['fn-x',\n    'theme-dark'],\n});"), 'theme-dark'));

  /* …and leave alone what is fine. */
  assert.deepStrictEqual(cssViolations('/* color-mix() :has( !important inset: */\n.fortnight a { box-shadow: inset 0 0 0 1px red; top: 0; }'), []);
  assert.deepStrictEqual(cssViolations('.fortnight.fn-phone .fn-main { padding-bottom: var(--view-bottom-spacing, 0px); }'), []);
  assert.deepStrictEqual(cssViolations('.is-phone .fortnight .fn-x { top: 0; }'), [], 'reading host state from an ancestor is not a collision');
  assert.deepStrictEqual(cssViolations('.theme-dark .fortnight a { top: 0; }\n@keyframes spin { from { top: 0; } to { top: 1px; } }'), []);
  assert.deepStrictEqual(cssViolations('@media (hover: none) { .fortnight .a, .fortnight .b { top: 0; } }'), []);
  assert.deepStrictEqual(jsViolations('x.js', "// root.toggleClass('is-phone', on);\nif (Platform.isPhone || body.hasClass('is-phone')) go();"), []);
  assert.deepStrictEqual(jsViolations('x.js', "root.toggleClass('fn-phone', on); b.createEl('button', { cls: ['fn-sh-row', 'is-drop'] });"), []);
  assert.deepStrictEqual(jsViolations('x.js', "row.toggleClass('is-focused', on); card.addClass('is-dragging'); b.addClass('mod-cta');"), []);

  assert.deepStrictEqual(specificity('.workspace-leaf-content .view-content.fortnight'), [0, 3, 0]);
  assert.deepStrictEqual(specificity('.fortnight button.fn-row:hover'), [0, 3, 1]);
  assert.deepStrictEqual(specificity('.workspace-split.mod-primary-split .view-content'), [0, 3, 0]);
  assert.deepStrictEqual(specificity('button:focus-visible'), [0, 1, 1]);
  assert.ok(outranks([0, 4, 0], [0, 3, 0]) && !outranks([0, 3, 0], [0, 3, 0]) && !outranks([0, 2, 5], [0, 3, 0]));
}

/* ---- the real stylesheet -------------------------------------------------- */
const cssPath = path.join(srcDir, 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');
const found = cssViolations(css);
assert.deepStrictEqual(found, [], `src/styles.css:\n  ${found.join('\n  ')}`);

/* ---- the real source: no plugin element carries a host body class --------- */
for (const f of walk(srcDir).filter(f => f.endsWith('.js'))) {
  const hit = jsViolations(`src/${f}`, fs.readFileSync(path.join(srcDir, f), 'utf8'));
  assert.deepStrictEqual(hit, [], hit.join('\n'));
}

/* ---- contract pins: the classes the UI toggles are styled ----------------- */
const rules = rulesOf(css);
const withSel = re => rules.filter(r => selectorList(r.sel).some(s => re.test(s)));
for (const cls of ['fn-phone', 'fn-locked', 'fn-cardmore']) {
  assert.ok(withSel(new RegExp(`\\.${cls}(?![\\w-])`)).length > 0, `no rule styles .${cls}`);
}

/* The "more" button: out of sight until the card is hovered or focused, always
   there on a touch screen, absent on the phone. */
assert.ok(withSel(/\.fn-phone\b.*\.fn-cardmore/).some(r => /display\s*:\s*none/.test(r.body)), '.fn-cardmore must be hidden under .fn-phone');
assert.ok(withSel(/li:hover > button\.fn-cardmore/).some(r => /opacity\s*:\s*1/.test(r.body)), '.fn-cardmore must show on card hover');
assert.ok(withSel(/li:focus-within > button\.fn-cardmore/).some(r => /opacity\s*:\s*1/.test(r.body)), '.fn-cardmore must show on card focus-within');
assert.match(stripComments(css).replace(/\s+/g, ' '), /@media \(hover: none\) \{ \.fortnight button\.fn-cardmore \{[^}]*opacity: 1/,
  '.fn-cardmore must stay visible under @media (hover: none)');

/* Focus: Obsidian's own ring is a box-shadow on button:focus-visible, which
   these flat buttons reset away; without our outline a keyboard user sees
   nothing. */
const ring = withSel(/^\.fortnight button:focus-visible$/)
  .find(r => /outline\s*:\s*[^;]*\bsolid\b/.test(r.body) && /outline-offset/.test(r.body));
assert.ok(ring, 'no `.fortnight button:focus-visible { outline: … solid; outline-offset }` rule');
assert.ok(withSel(/^\.fortnight input:focus-visible$/).some(r => /outline\s*:\s*[^;]*\bsolid\b/.test(r.body)), 'inputs need a focus-visible outline too');

/* The root is Obsidian's own .view-content: its rule
   `.workspace-leaf-content .view-content { padding; overflow: auto }` is
   (0,2,0) and `.workspace-split.mod-primary-split .view-content` (0,3,0).
   Our padding reset and the scroll lock must outrank those without !important. */
const HOST_PADDING = [0, 2, 0];
const HOST_SPLIT = [0, 3, 0];
const flush = rules.find(r => /^padding\s*:\s*0\s*;?$/.test(r.body.trim()) && selectorList(r.sel).every(s => /\.view-content\.fortnight(?![\w-])/.test(s)));
assert.ok(flush, 'the root padding reset must target `.view-content.fortnight` (outranking the host), not bare .fortnight');
assert.ok(selectorList(flush.sel).every(s => outranks(specificity(s), HOST_PADDING)), 'root padding reset does not outrank the host .view-content padding rule');
const locked = withSel(/\.fn-locked(?![\w-])/).filter(r => /overflow\s*:\s*hidden/.test(r.body));
assert.ok(locked.length, '.fn-locked must set overflow: hidden');
assert.ok(locked.every(r => selectorList(r.sel).every(s => outranks(specificity(s), HOST_SPLIT))),
  '.fn-locked must outrank the host split rule `.workspace-split.mod-primary-split .view-content` (a board in a sidebar would not lock)');

/* The phone keeps the host's bottom spacing (the floating navbar covers the
   last ~86px): read through var(), with a fallback. */
assert.ok(withSel(/^\.fortnight\.fn-phone \.fn-main$/).some(r => /padding-bottom\s*:[^;]*--view-bottom-spacing/.test(r.body)),
  '.fortnight.fn-phone .fn-main must pad its bottom by var(--view-bottom-spacing)');

/* The hover wash is a fixed colour per theme. */
for (const re of [/^\.fortnight$/, /^\.theme-dark \.fortnight$/]) {
  const r = withSel(re).find(x => /--fn-hover\s*:/.test(x.body));
  assert.ok(r, `${re} must define --fn-hover`);
  assert.match(r.body.match(/--fn-hover\s*:\s*([^;]*);/)[1], /^rgba\(/, '--fn-hover must be a fixed rgba(), not a host variable');
}

console.log('css guard OK');
