'use strict';
/* Local-date helpers on ISO 'YYYY-MM-DD' strings — the same rules as
   Rhythm's dates.js. Pure; never parses an ISO string with the Date
   constructor (that reads it as UTC and shifts the day). */

const pad = n => (n < 10 ? '0' : '') + n;

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

const todayISO = now => toISO(now instanceof Date ? now : new Date());

function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/* 0 = Sunday … 6 = Saturday. */
const weekday = iso => fromISO(iso).getDay();

/* Monday-start by default; start = 0 for Sunday. */
function weekStart(iso, start = 1) {
  return addDays(iso, -((weekday(iso) - start + 7) % 7));
}

/* Display: "Wed", "30", "30 Sep". */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = iso => String(+iso.slice(8, 10));
const short = iso => `${dayNum(iso)} ${MON[+iso.slice(5, 7) - 1]}`;

module.exports = { toISO, fromISO, todayISO, addDays, weekday, weekStart, DOW, dayNum, short };
