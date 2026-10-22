'use strict';
/* The pure helpers behind the board view (src/board-helpers.js): the theme
   accent's contrast clamp, tidy settings paths, the redraw signature and the
   "added but not on the board" wording. Expectations are literals. */
const assert = require('node:assert');
const H = require('../src/board-helpers');

const approx = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ~${b}, got ${a}`);

/* ---- parseColor ---------------------------------------------------------- */
assert.deepStrictEqual(H.parseColor('#a882ff'), [168, 130, 255]);
assert.deepStrictEqual(H.parseColor('#FFF'), [255, 255, 255]);
assert.deepStrictEqual(H.parseColor('rgb(30, 30, 30)'), [30, 30, 30]);
assert.deepStrictEqual(H.parseColor('rgba(30, 31, 32, 0.5)'), [30, 31, 32]);
assert.deepStrictEqual(H.parseColor('rgb(1 2 3 / 50%)'), [1, 2, 3]);
/* Obsidian's own accent is hsl(var(--accent-h), …) → hsl(258, 88%, 66%) once substituted. */
const hsl = H.parseColor('hsl(258, 88%, 66%)').map(Math.round);
assert.deepStrictEqual(hsl, [138, 92, 245], 'hsl(258,88%,66%) is rgb(138, 92, 245), by hand: C=.5984, X=.1795, m=.3608');
assert.deepStrictEqual(H.parseColor('hsl(0, 100%, 50%)').map(Math.round), [255, 0, 0]);
assert.strictEqual(H.parseColor('oklch(0.7 0.2 300)'), null, 'oklch is left to the canvas fallback');
assert.strictEqual(H.parseColor(''), null);

/* ---- contrast: the WCAG definition -------------------------------------- */
approx(H.contrast([255, 255, 255], [0, 0, 0]), 21, 0.001, 'white on black');
approx(H.contrast([255, 255, 255], [255, 255, 255]), 1, 0.001, 'same colour');
/* Lane C measured these two on white paper. */
approx(H.contrast([168, 130, 255], [255, 255, 255]), 2.88, 0.01, '#a882ff on white');
approx(H.contrast([152, 115, 247], [255, 255, 255]), 3.42, 0.02, 'stock #9873f7 on white');
assert.strictEqual(H.contrast([10, 20, 30], [200, 210, 220]), H.contrast([200, 210, 220], [10, 20, 30]), 'order does not matter');

/* ---- clampAccent --------------------------------------------------------- */
const WHITE = [255, 255, 255];
const DARK = [30, 30, 30];
/* Fortnight's own blue is already fine on paper: left alone. */
assert.strictEqual(H.clampAccent([51, 80, 196], WHITE), null, '#3350c4 passes');
/* A pale purple on white is lowered, same hue and saturation, to the FIRST lightness that passes. */
const fixed = H.clampAccent([168, 130, 255], WHITE);
assert.strictEqual(fixed, '258, 100%, 63%', 'pale purple on white (independent check: 5.17:1 on paper, 4.61:1 on its wash)');
const rgb = H.parseColor(`hsl(${fixed})`);
assert.ok(H.contrast(rgb, WHITE) >= 4.5, 'now readable on the paper');
const wash = rgb.map(v => v * 0.08 + 255 * 0.92);
assert.ok(H.contrast(rgb, wash) >= 4.5, 'and on the paper under its own wash');
/* One percent lighter would not have passed — it is the least change, not an arbitrary dark. */
const lighter = H.parseColor('hsl(258, 100%, 64%)');
assert.ok(H.contrast(lighter, lighter.map(v => v * 0.08 + 255 * 0.92)) < 4.5, 'one step lighter fails on the wash (4.45:1)');
/* A dark paper moves it the other way: a deep purple lightens. */
const lifted = H.clampAccent([59, 42, 143], DARK);
assert.strictEqual(lifted, '250, 55%, 69%', 'deep purple on near-black (68% is 4.51 on the wash, short of 4.5 + the margin)');
assert.ok(H.contrast(H.parseColor(`hsl(${lifted})`), DARK) >= 4.5);
/* A pale accent on a dark paper is fine as it is. */
assert.strictEqual(H.clampAccent([168, 130, 255], DARK), null);
/* Grey accents keep to grey (no hue invented). */
assert.strictEqual(H.clampAccent([200, 200, 200], WHITE), '0, 0%, 43%');

/* ---- settings paths ------------------------------------------------------ */
const norm = p => { const s = p.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, ''); return s === '' ? '/' : s; };
assert.strictEqual(H.tidyPath('  Planning//Fortnight.md ', norm), 'Planning/Fortnight.md');
assert.strictEqual(H.tidyPath('\\Planning\\Fortnight', norm), 'Planning/Fortnight', 'one kind of slash, none at the ends');
assert.strictEqual(H.tidyPath('', norm), '');
assert.strictEqual(H.tidyPath('   ', norm), '');
assert.strictEqual(H.tidyPath('/', norm), '', 'the vault root is no path');
assert.strictEqual(H.tidyPath('Planning/', norm, true), 'Planning/', 'the planner note: a trailing slash still means "this folder"');
assert.strictEqual(H.tidyPath('Reviews/', norm), 'Reviews', 'anywhere else it goes');
assert.deepStrictEqual(H.folderLines('Projects\n  /Templates/ \n\n/\nProjects\nArchive//Old', norm), ['Projects', 'Templates', 'Archive/Old']);
assert.deepStrictEqual(H.folderLines('', norm), []);

/* ---- the redraw signature ------------------------------------------------ */
const board = { today: '2026-10-07', days: [{ date: '2026-10-07', cards: [{ key: 'a:1', raw: '- [ ] A ⏳ 2026-10-07' }], done: [] }], slipped: [], later: [], tray: [], nextWeek: { start: '2026-10-12', days: [], anyDay: [] } };
const copy = JSON.parse(JSON.stringify(board));
assert.strictEqual(H.signature(board, [false, 'x']), H.signature(copy, [false, 'x']), 'same board, same ui: same signature');
copy.days[0].cards[0].raw = '- [ ] A ⏳ 2026-10-08';
assert.notStrictEqual(H.signature(board, [false, 'x']), H.signature(copy, [false, 'x']), 'a changed card changes it');
assert.notStrictEqual(H.signature(board, [false, 'x']), H.signature(board, [true, 'x']), 'so does a changed layout');
const loop = {}; loop.self = loop;
assert.strictEqual(H.signature(loop, []), null, 'an unserialisable board is never "unchanged"');

/* ---- is the added line on the board? ------------------------------------ */
const withCards = {
  today: '2026-10-07',
  days: [{ cards: [{ raw: '- [ ] On a day ⏳ 2026-10-07' }], done: [{ raw: '- [x] Done one ✅ 2026-10-07' }] }],
  slipped: [{ raw: '- [ ] Slipped ⏳ 2026-10-01\r' }],
  later: [{ raw: '- [ ] In Later' }],
  nextWeek: { start: '2026-10-12', anyDay: [{ raw: '- [ ] Any day 🛫 2026-10-12' }], days: [{ cards: [{ raw: '- [ ] Monday ⏳ 2026-10-12' }], done: [] }] },
};
for (const raw of ['- [ ] On a day ⏳ 2026-10-07', '- [x] Done one ✅ 2026-10-07', '- [ ] Slipped ⏳ 2026-10-01', '- [ ] In Later', '- [ ] Any day 🛫 2026-10-12', '- [ ] Monday ⏳ 2026-10-12']) {
  assert.ok(H.boardHasRaw(withCards, raw), `finds ${raw}`);
}
assert.ok(H.boardHasRaw(withCards, '- [ ] Slipped ⏳ 2026-10-01\r'), 'with or without the CR');
assert.ok(!H.boardHasRaw(withCards, '- [ ] Pay the deposit 📅 2026-12-01'), 'a card that is not there');
assert.ok(!H.boardHasRaw({ days: [] }, '- [ ] x'), 'a nearly empty board does not throw');

/* ---- what to tell the user ----------------------------------------------- */
assert.strictEqual(
  H.addedNotice('- [ ] Pay the deposit 📅 2026-12-01', withCards, 'Planning/Fortnight.md'),
  'Fortnight: added "Pay the deposit" to Planning/Fortnight.md, but it isn\'t on the board yet — its date (Tue 1 Dec) is beyond next week. It will show once that day is within the two weeks.',
);
assert.strictEqual(
  H.addedNotice('- [ ] Water the plants', withCards, 'Templates/Fortnight.md'),
  'Fortnight: added "Water the plants" to Templates/Fortnight.md, but it isn\'t on the board. If that note is inside an excluded folder (Fortnight\'s settings), its to-dos never show.',
);

/* A date that doesn't exist (a line can say ⏳ 2026-09-31) gets no invented weekday. */
assert.strictEqual(
  H.addedNotice('- [ ] Odd one ⏳ 2026-09-31', withCards, 'Planning/Fortnight.md'),
  'Fortnight: added "Odd one" to Planning/Fortnight.md, but it isn\'t on the board. If that note is inside an excluded folder (Fortnight\'s settings), its to-dos never show.',
);

console.log('board helpers OK');
