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

console.log('tasks-line OK');
