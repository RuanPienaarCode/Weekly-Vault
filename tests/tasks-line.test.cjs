'use strict';
/* tasks-line: read a Tasks checkbox line, and edit ONE token of it without
   touching any other byte. Expected values are hand-written literals. */
const assert = require('node:assert');
const L = require('../src/tasks-line');

/* 1. a plain open line */
{
  const t = L.parseTask('- [ ] Call plumber');
  assert.strictEqual(t.status, ' ');
  assert.strictEqual(t.done, false);
  assert.strictEqual(t.cancelled, false);
  assert.strictEqual(t.text, 'Call plumber');
  assert.strictEqual(t.scheduled, '');
  assert.strictEqual(t.due, '');
  assert.strictEqual(t.start, '');
  assert.strictEqual(t.raw, '- [ ] Call plumber');
}

/* 2. a fully loaded line */
{
  const t = L.parseTask('- [ ] Pay rates 🔁 every month ⏳ 2026-09-30 📅 2026-10-02 🛫 2026-09-28 🆔 f3k9 ⏫ #admin');
  assert.strictEqual(t.text, 'Pay rates');
  assert.strictEqual(t.recurrence, 'every month');
  assert.strictEqual(t.scheduled, '2026-09-30');
  assert.strictEqual(t.due, '2026-10-02');
  assert.strictEqual(t.start, '2026-09-28');
  assert.strictEqual(t.id, 'f3k9');
  assert.strictEqual(t.priority, 'high');
  assert.deepStrictEqual(t.tags, ['#admin']);
  const d = L.parseTask('- [x] Filed tax ➕ 2026-09-01 ✅ 2026-09-20');
  assert.strictEqual(d.created, '2026-09-01');
  assert.strictEqual(d.doneDate, '2026-09-20');
  assert.strictEqual(d.priority, 'normal');
}

/* 3. not a checkbox line */
for (const raw of ['# Heading', '- plain bullet', 'Just text', '', '- [] no space in box']) {
  assert.strictEqual(L.parseTask(raw), null, raw);
}

/* 4. statuses */
{
  const done = L.parseTask('- [x] Done thing');
  assert.strictEqual(done.done, true);
  assert.strictEqual(L.parseTask('- [X] Done thing').done, true);
  const gone = L.parseTask('- [-] Dropped thing');
  assert.strictEqual(gone.cancelled, true);
  assert.strictEqual(gone.done, false);
  const doing = L.parseTask('- [/] Half done');
  assert.strictEqual(doing.done, false);
  assert.strictEqual(doing.cancelled, false);
  assert.strictEqual(L.isOpen(doing), true);
  assert.strictEqual(L.isOpen(done), false);
  assert.strictEqual(L.isOpen(gone), false);
}

/* 5. setting ⏳ on a line without one appends it */
assert.strictEqual(
  L.setField('- [ ] Call plumber', 'scheduled', '2026-09-30'),
  '- [ ] Call plumber ⏳ 2026-09-30');
assert.strictEqual(
  L.setField('- [ ] Call plumber 📅 2026-10-02', 'start', '2026-10-05'),
  '- [ ] Call plumber 📅 2026-10-02 🛫 2026-10-05');

/* 6. changing an existing ⏳ in a messy line touches only its date */
{
  const messy = '  - [ ] Fix  the #home gate 🎯 ⏳ 2026-09-30  📅 2026-10-02 🔁 every week #diy';
  assert.strictEqual(
    L.setField(messy, 'scheduled', '2026-10-01'),
    '  - [ ] Fix  the #home gate 🎯 ⏳ 2026-10-01  📅 2026-10-02 🔁 every week #diy');
  const t = L.parseTask(messy);
  assert.strictEqual(t.recurrence, 'every week');
  assert.strictEqual(t.due, '2026-10-02');
  assert.strictEqual(t.text, 'Fix the gate 🎯');
}

/* 6b. like Tasks, fields are read only from the END of the line: a date
   followed by ordinary words is part of the description */
{
  const mid = '- [ ] Read ⏳ 2026-09-30 notes';
  assert.strictEqual(L.parseTask(mid).scheduled, '');
  assert.strictEqual(L.parseTask(mid).text, 'Read ⏳ 2026-09-30 notes');
  assert.strictEqual(L.setField(mid, 'scheduled', '2026-10-01'), '- [ ] Read ⏳ 2026-09-30 notes ⏳ 2026-10-01');
  assert.strictEqual(L.parseTask('- [ ] Buy ⏳ timer').scheduled, '');
  /* an unknown emoji at the end hides the fields before it, as in Tasks */
  assert.strictEqual(L.parseTask('- [ ] Pay ⏳ 2026-09-30 🎯').scheduled, '');
}

/* 6c. two ⏳ in the field run: parse and edit agree on the same one */
{
  const two = '- [ ] A ⏳ 2026-09-01 ⏳ 2026-09-02';
  const edited = L.setField(two, 'scheduled', '2026-10-10');
  assert.strictEqual(L.parseTask(edited).scheduled, '2026-10-10');
  assert.strictEqual(L.parseTask(two).scheduled, L.parseTask(two).scheduled);
}

/* 6d. U+FE0F after the emoji, and the aliases Tasks accepts */
{
  const vs = '- [ ] A ⏳️ 2026-09-30';
  assert.strictEqual(L.parseTask(vs).scheduled, '2026-09-30');
  assert.strictEqual(L.setField(vs, 'scheduled', '2026-10-01'), '- [ ] A ⏳️ 2026-10-01');
  assert.strictEqual(L.setField(vs, 'scheduled', null), '- [ ] A');
  assert.strictEqual(L.parseTask('- [ ] A 📆 2026-10-02').due, '2026-10-02');
  assert.strictEqual(L.parseTask('- [ ] A 🗓 2026-10-02').due, '2026-10-02');
  assert.strictEqual(L.parseTask('- [ ] A ⌛ 2026-10-02').scheduled, '2026-10-02');
}

/* 7. the author's spelling of the marker is kept */
assert.strictEqual(
  L.setField('- [ ] Call plumber ⌛ 2026-09-30', 'scheduled', '2026-10-03'),
  '- [ ] Call plumber ⌛ 2026-10-03');

/* 8. clearing removes the token and one space before it, nothing else */
assert.strictEqual(
  L.setField('- [ ] Call plumber ⏳ 2026-09-30 📅 2026-10-02', 'scheduled', null),
  '- [ ] Call plumber 📅 2026-10-02');
assert.strictEqual(
  L.setField('- [ ] Call plumber ⏳ 2026-09-30', 'scheduled', null),
  '- [ ] Call plumber');
assert.strictEqual(
  L.setField('- [ ] Call plumber', 'start', null),
  '- [ ] Call plumber');
assert.strictEqual(
  L.setField('- [ ] Call plumber\t⏳ 2026-09-30\t📅 2026-10-02', 'scheduled', null),
  '- [ ] Call plumber\t📅 2026-10-02');

/* 9. a new token lands before a trailing block reference */
assert.strictEqual(
  L.setField('- [ ] Call plumber ^abc123', 'scheduled', '2026-09-30'),
  '- [ ] Call plumber ⏳ 2026-09-30 ^abc123');
assert.strictEqual(
  L.setField('- [ ] Call plumber ^abc123   ', 'id', 'f3k9'),
  '- [ ] Call plumber 🆔 f3k9 ^abc123   ');
assert.strictEqual(L.parseTask('- [ ] Call plumber ⏳ 2026-09-30 ^abc123').text, 'Call plumber');
assert.strictEqual(L.parseTask('- [ ] Call plumber ⏳ 2026-09-30 ^abc123').blockRef, 'abc123');
assert.strictEqual(L.parseTask('- [ ] ^abc123').blockRef, 'abc123');
assert.strictEqual(L.parseTask('- [ ] ^abc123').text, '');
assert.strictEqual(L.parseTask('- [ ] Call plumber ⏳ 2026-09-30 ^abc123').scheduled, '2026-09-30');

/* 10. indentation, list markers, blockquotes and callouts are kept */
for (const [before, after, text] of [
  ['    * [ ] Nested thing', '    * [ ] Nested thing ⏳ 2026-09-30', 'Nested thing'],
  ['+ [ ] Plus thing', '+ [ ] Plus thing ⏳ 2026-09-30', 'Plus thing'],
  ['1. [ ] Numbered thing', '1. [ ] Numbered thing ⏳ 2026-09-30', 'Numbered thing'],
  ['\t- [ ] Tabbed thing', '\t- [ ] Tabbed thing ⏳ 2026-09-30', 'Tabbed thing'],
  ['> - [ ] Quoted thing', '> - [ ] Quoted thing ⏳ 2026-09-30', 'Quoted thing'],
  ['> > - [ ] Callout thing', '> > - [ ] Callout thing ⏳ 2026-09-30', 'Callout thing'],
]) {
  assert.strictEqual(L.setField(before, 'scheduled', '2026-09-30'), after);
  assert.strictEqual(L.parseTask(before).text, text);
}

/* 10b. a line still carrying its CR (a CRLF file split on \n) */
assert.strictEqual(L.parseTask('- [ ] X ⏳ 2026-09-30\r').scheduled, '2026-09-30');
assert.strictEqual(L.setField('- [ ] X\r', 'scheduled', '2026-09-30'), '- [ ] X ⏳ 2026-09-30\r');

/* 11. setting the value it already has returns the identical line */
{
  const line = '- [ ] Call plumber  ⏳ 2026-09-30 ^abc123';
  assert.strictEqual(L.setField(line, 'scheduled', '2026-09-30'), line);
}

/* 12. setStatus changes only the box */
assert.strictEqual(L.setStatus('  - [ ] Call plumber ⏳ 2026-09-30', '-'), '  - [-] Call plumber ⏳ 2026-09-30');
assert.strictEqual(L.setStatus('1. [/] Half done', ' '), '1. [ ] Half done');
assert.strictEqual(L.setStatus('Just text', '-'), 'Just text');

/* 13. bad values are refused rather than written */
assert.throws(() => L.setField('- [ ] X', 'scheduled', ''), /date/);
assert.throws(() => L.setField('- [ ] X', 'scheduled', 'tomorrow'), /date/);
assert.throws(() => L.setField('- [ ] X', 'id', 'a b'), /id/);
assert.throws(() => L.setField('- [ ] X', 'due', '2026-09-30'), /cannot set/);
assert.throws(() => L.setStatus('- [ ] X', ''), /status/);
assert.throws(() => L.setStatus('- [ ] X', 'xx'), /status/);
assert.throws(() => L.setStatus('- [ ] X', ']'), /status/);

/* 14. addTag puts a tag at the end of the description — before the Tasks
       fields, so Tasks still reads them — and never twice */
assert.strictEqual(L.addTag('- [ ] Prepare slides', '#later'), '- [ ] Prepare slides #later');
assert.strictEqual(L.addTag('- [ ] File tax 📅 2026-10-20', '#later'), '- [ ] File tax #later 📅 2026-10-20');
assert.strictEqual(L.addTag('  - [ ] Paint #home 📅 2026-10-20 ^abc', '#later'), '  - [ ] Paint #later #home 📅 2026-10-20 ^abc');
assert.strictEqual(L.addTag('- [ ] Already #Later here', '#later'), '- [ ] Already #Later here');
assert.strictEqual(L.addTag('- [ ] X\r', '#later'), '- [ ] X #later\r');
assert.strictEqual(L.parseTask(L.addTag('- [ ] File tax 📅 2026-10-20', '#later')).due, '2026-10-20');

/* 15. removeTag takes the tag and one space before it, wherever it is,
       matching whole tags only (case-insensitive) */
assert.strictEqual(L.removeTag('- [ ] Prepare slides #later', '#later'), '- [ ] Prepare slides');
assert.strictEqual(L.removeTag('- [ ] File tax #Later 📅 2026-10-20', '#later'), '- [ ] File tax 📅 2026-10-20');
assert.strictEqual(L.removeTag('- [ ] Keep #laterish and #later/sub', '#later'), '- [ ] Keep #laterish and #later/sub');
assert.strictEqual(L.removeTag('- [ ] No tag', '#later'), '- [ ] No tag');
assert.strictEqual(L.hasTag('- [ ] X #LATER', '#later'), true);
assert.strictEqual(L.hasTag('- [ ] X #laterish', '#later'), false);

/* 16. every copy of the tag goes; "#later," is the tag, as Obsidian reads it */
assert.strictEqual(L.removeTag('- [ ] Read #later #later', '#later'), '- [ ] Read');
assert.strictEqual(L.hasTag('- [ ] Read #later, then write', '#later'), true);
assert.strictEqual(L.removeTag('- [ ] Read #later, then write', '#later'), '- [ ] Read, then write');

/* 17. A3: only SPACES between the list marker and the box, as Tasks' own
       reader needs: Obsidian counts "-<TAB>[ ]" as a task but Tasks does not,
       and its toggle then falls back to a crude replace that wrote
       "- [ ]<TAB>[ ] Send invoice" (real Tasks 8.4.0, lane A). Such a line is
       not read, so it can never be handed to Tasks. A tab in the INDENT is fine. */
for (const raw of ['-\t[ ] Send invoice', '- \t[ ] Send invoice', '1.\t[ ] Send invoice', '* \t[x] Send invoice']) {
  assert.strictEqual(L.parseTask(raw), null, JSON.stringify(raw));
}
assert.strictEqual(L.setStatus('-\t[ ] Send invoice', 'x'), '-\t[ ] Send invoice');
assert.strictEqual(L.parseTask('\t- [ ] Nested').text, 'Nested');
assert.strictEqual(L.parseTask('\t\t1. [ ] Deep').text, 'Deep');

/* 17b. A3: the box must be followed by a space, a tab or the end of the line —
        "- [ ]x" is not a task to Obsidian (it is a list item with text). */
for (const raw of ['- [ ]x', '- [x]done', '- [ ]⏳ 2026-10-01', '- [ ]#tag']) assert.strictEqual(L.parseTask(raw), null, raw);
assert.strictEqual(L.parseTask('- [ ]').text, '');
assert.strictEqual(L.parseTask('- [ ]\r').text, '');
assert.strictEqual(L.parseTask('- [ ]\tTabbed text').text, 'Tabbed text');
assert.strictEqual(L.parseTask('- [x] ').done, true);

/* 18. B8: ✅ is writable, so a tick without Tasks can still date itself */
assert.strictEqual(L.setField('- [x] Call plumber ⏳ 2026-10-01', 'doneDate', '2026-09-30'), '- [x] Call plumber ⏳ 2026-10-01 ✅ 2026-09-30');
assert.strictEqual(L.setField('- [x] Call plumber ✅ 2026-09-01', 'doneDate', '2026-09-30'), '- [x] Call plumber ✅ 2026-09-30');
assert.strictEqual(L.setField('- [x] Call plumber ✅ 2026-09-01', 'doneDate', null), '- [x] Call plumber');
assert.strictEqual(L.setField('- [x] Call plumber ^abc\r', 'doneDate', '2026-09-30'), '- [x] Call plumber ✅ 2026-09-30 ^abc\r');
assert.strictEqual(L.parseTask('- [x] Call plumber ✅ 2026-09-30').doneDate, '2026-09-30');
assert.throws(() => L.setField('- [x] X', 'doneDate', 'today'), /date/);

/* 19. C11/G6/A10: the task lines of a note's TEXT, the way Obsidian counts
       them: none inside front matter or a fenced code block (``` or ~~~, a
       fence closes only on the same character and at least as many), and the
       line is kept with its own \r. Expected line numbers are counted by hand. */
{
  const text = [
    '---', 'tags: [a]', '- [ ] in front matter', '---',          // 0-3
    '- [ ] real ⏳ 2026-10-01',                                   // 4
    '```js', '- [ ] in fence', '```',                             // 5-7
    '~~~', '- [ ] in tilde', '~~~~',                              // 8-10
    '- [ ] after tilde',                                          // 11
    '````', '```', '- [ ] still in a long fence', '```', '````',  // 12-16
    '- [ ] after long',                                           // 17
    '> ```', '> - [ ] quoted in fence', '> ```',                  // 18-20
    '- [ ] last',                                                 // 21
  ].join('\n');
  assert.deepStrictEqual(L.taskLines(text).map(t => t.line), [4, 11, 17, 21]);
  assert.deepStrictEqual(L.taskLines(text)[0], { line: 4, raw: '- [ ] real ⏳ 2026-10-01' });
}
/* a tilde fence is not closed by a backtick fence; an unclosed fence runs to the end */
assert.deepStrictEqual(L.taskLines('~~~\n- [ ] x\n```\n- [ ] y\n~~~\n- [ ] z').map(t => t.line), [5]);
assert.deepStrictEqual(L.taskLines('- [ ] a\n```\n- [ ] b\n- [ ] c').map(t => t.line), [0]);
/* backticks in a backtick fence's info string: that is inline code, not a fence */
assert.deepStrictEqual(L.taskLines('```x```\n- [ ] a').map(t => t.line), [1]);
/* front matter is only front matter at the very top, and only if it closes */
assert.deepStrictEqual(L.taskLines('- [ ] a\n---\n- [ ] b\n---\n- [ ] c').map(t => t.line), [0, 2, 4]);
assert.deepStrictEqual(L.taskLines('---\n- [ ] a\n- [ ] b').map(t => t.line), [1, 2]);
assert.deepStrictEqual(L.taskLines('﻿---\n- [ ] a\n---\n- [ ] b').map(t => t.line), [3]);
/* CRLF: the \r stays on the raw line, and a CRLF fence still closes */
assert.deepStrictEqual(L.taskLines('```\r\n- [ ] in\r\n```\r\n- [ ] out\r\n'), [{ line: 3, raw: '- [ ] out\r' }]);
/* not a task: no space after the box, a tab after the marker */
assert.deepStrictEqual(L.taskLines('- [ ]x\n-\t[ ] y\n- [ ] z').map(t => t.line), [2]);
/* the same scanner serves the quick-add heading search */
assert.deepStrictEqual(L.verbatimLines(['# a', '```', '# b', '```', '# c']), [false, true, true, true, false]);

/* 20. A4: Tasks' global filter — a line is a task to Tasks only when its text
       after the box contains the filter (Tasks' own includedIn on the body,
       block reference removed). The box and the list marker are not searched. */
assert.strictEqual(L.inFilter('- [ ] Buy milk #task', '#task'), true);
assert.strictEqual(L.inFilter('- [ ] Buy milk', '#task'), false);
assert.strictEqual(L.inFilter('- [ ] Buy milk', ''), true);
assert.strictEqual(L.inFilter('- [ ] Buy milk', undefined), true);
assert.strictEqual(L.inFilter('- [ ] #task ⏳ 2026-10-01 ^abc', '#task'), true);
assert.strictEqual(L.inFilter('- [x] Buy milk', 'x'), false);
assert.strictEqual(L.inFilter('- [ ] Buy milk ^task', '^task'), false);
assert.strictEqual(L.inFilter('not a task line', '#task'), false);

/* 21. G4: the tag matcher is compiled once per (tag, flags), not on every
       call — and two tags used alternately never get each other's matcher. */
{
  const Real = global.RegExp;
  let made = 0;
  global.RegExp = new Proxy(Real, { construct(target, args) { made++; return new target(...args); } });
  try {
    const rows = [
      ['- [ ] Read #later', '#later', true, '- [ ] Read'],
      ['- [ ] Read #someday', '#later', false, '- [ ] Read #someday'],
      ['- [ ] Read #someday', '#someday', true, '- [ ] Read'],
      ['- [ ] Read #later', '#someday', false, '- [ ] Read #later'],
      ['- [ ] Read #LATER, then #someday', '#later', true, '- [ ] Read, then #someday'],
      ['- [ ] Read #LATER, then #someday', '#someday', true, '- [ ] Read #LATER, then'],
    ];
    for (let round = 0; round < 50; round++) {
      for (const [raw, tag, has, removed] of rows) {
        assert.strictEqual(L.hasTag(raw, tag), has, `${raw} / ${tag}`);
        assert.strictEqual(L.removeTag(raw, tag), removed, `${raw} / ${tag}`);
      }
    }
    /* 600 calls, two tags, two flag sets: four compiles at most */
    assert.ok(made <= 4, `compiled ${made} times`);
  } finally { global.RegExp = Real; }
}

console.log('tasks-line OK');
