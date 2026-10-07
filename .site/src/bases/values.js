// Value model for the Bases expression language. Plain JS values are used where they map cleanly
// (string, number, boolean, null, arrays, plain objects); the rest are small classes.
import moment from 'moment';

export class BDate {
  constructor(ms, hasTime = true) { this.ms = ms; this.hasTime = hasTime; }
  get d() { return new Date(this.ms); }
  valueOf() { return this.ms; }
}
// Calendar-aware duration: years/months are applied on the calendar, the rest is plain milliseconds.
export class BDuration {
  constructor(ms = 0, months = 0) { this.ms = ms; this.months = months; }
  get totalMs() { return this.ms + this.months * 30.4375 * 86400000; }
  valueOf() { return this.totalMs; }
}
export class BLink { constructor(path, display = null, sub = null, entry = null) { this.path = path; this.display = display; this.sub = sub; this.entry = entry; } }
export class BFile { constructor(entry) { this.entry = entry; } }
export class BHtml { constructor(html) { this.html = html; } }
export class BImage { constructor(src) { this.src = src; } }
export class BIcon { constructor(name) { this.name = name; } }
export class BRegExp { constructor(re) { this.re = re; } }
export class BaseError extends Error {}

export const typeOf = v => {
  if (v == null) return 'null';
  if (Array.isArray(v)) return 'list';
  if (v instanceof BDate) return 'date';
  if (v instanceof BDuration) return 'duration';
  if (v instanceof BLink) return 'link';
  if (v instanceof BFile) return 'file';
  if (v instanceof BHtml) return 'html';
  if (v instanceof BImage) return 'image';
  if (v instanceof BIcon) return 'icon';
  if (v instanceof BRegExp) return 'regexp';
  if (v instanceof RegExp) return 'regexp';
  return typeof v === 'object' ? 'object' : typeof v;
};

export const isTruthy = v => {
  switch (typeOf(v)) {
    case 'null': return false;
    case 'boolean': return v;
    case 'number': return v !== 0 && !Number.isNaN(v);
    case 'string': return v !== '';
    default: return true;
  }
};
export const isEmptyValue = v => {
  switch (typeOf(v)) {
    case 'null': return true;
    case 'string': return v === '';
    case 'list': return v.length === 0;
    case 'object': return Object.keys(v).length === 0;
    default: return false;
  }
};

// ---------- dates & durations ----------
const UNIT = { y: 'y', year: 'y', years: 'y', M: 'M', month: 'M', months: 'M', w: 'w', week: 'w', weeks: 'w', d: 'd', day: 'd', days: 'd', h: 'h', hour: 'h', hours: 'h', m: 'm', minute: 'm', minutes: 'm', min: 'm', mins: 'm', s: 's', second: 's', seconds: 's', sec: 's', secs: 's', ms: 'ms', millisecond: 'ms', milliseconds: 'ms' };
const UNIT_MS = { w: 7 * 86400000, d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };

export function parseDuration(str) {
  const s = String(str).trim();
  if (!s) return null;
  const re = /([+-]?\d+(?:\.\d+)?)\s*([A-Za-z]+)/y;
  let ms = 0, months = 0, m, pos = 0, any = false;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    const u = UNIT[m[2]] ?? UNIT[m[2].toLowerCase()];
    if (!u) return null;
    const n = parseFloat(m[1]);
    if (u === 'y') months += n * 12; else if (u === 'M') months += n; else ms += n * UNIT_MS[u];
    any = true; pos = re.lastIndex;
    while (s[pos] === ' ' || s[pos] === ',') { pos++; }
    re.lastIndex = pos;
  }
  return any && pos >= s.length ? new BDuration(ms, months) : null;
}

export function parseDate(str) {
  const s = String(str).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new BDate(new Date(+m[1], +m[2] - 1, +m[3]).getTime(), false);
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    if (m[8]) { const t = Date.parse(s.replace(' ', 'T')); if (!Number.isNaN(t)) return new BDate(t, true); }
    return new BDate(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? +m[7].slice(0, 3).padEnd(3, '0') : 0).getTime(), true);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new BDate(t, /\d:\d/.test(s));
}

export function addDuration(date, dur, sign = 1) {
  const d = new Date(date.ms);
  if (dur.months) d.setMonth(d.getMonth() + sign * dur.months);
  return new BDate(d.getTime() + sign * dur.ms, date.hasTime || dur.ms % 86400000 !== 0);
}

export const formatDate = (d, fmt) => moment(d.ms).format(fmt);
export const defaultDateString = d => moment(d.ms).format(d.hasTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD');

export function relativeTime(d, now = Date.now()) { return moment(d.ms).from(now); }

// ---------- generic conversions ----------
export function toStr(v) {
  switch (typeOf(v)) {
    case 'null': return '';
    case 'string': return v;
    case 'number': return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
    case 'boolean': return String(v);
    case 'date': return defaultDateString(v);
    case 'duration': return durationString(v);
    case 'list': return v.map(toStr).join(', ');
    case 'link': return v.display ?? v.path;
    case 'file': return v.entry.path;
    case 'html': return v.html;
    case 'object': return '{' + Object.entries(v).map(([k, x]) => `${k}: ${toStr(x)}`).join(', ') + '}';
    case 'regexp': return String(v.re ?? v);
    default: return String(v);
  }
}
export function durationString(d) {
  const parts = [];
  if (d.months) parts.push(`${d.months}M`);
  let ms = d.ms;
  for (const [u, n] of [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]]) { if (Math.abs(ms) >= n) { const k = Math.trunc(ms / n); parts.push(`${k}${u}`); ms -= k * n; } }
  if (ms) parts.push(`${ms}ms`);
  return parts.join(' ') || '0s';
}

export function toNumber(v) {
  switch (typeOf(v)) {
    case 'number': return v;
    case 'boolean': return v ? 1 : 0;
    case 'string': { const n = Number(v.trim()); if (v.trim() === '' || Number.isNaN(n)) throw new BaseError(`Cannot convert "${v}" to a number`); return n; }
    case 'date': return v.ms;
    case 'duration': return v.totalMs;
    case 'null': return 0;
    default: throw new BaseError(`Cannot convert ${typeOf(v)} to a number`);
  }
}

/** Total order used by sorting and comparison operators. */
export function compare(a, b) {
  const ta = typeOf(a), tb = typeOf(b);
  if (ta === 'null' || tb === 'null') return ta === tb ? 0 : ta === 'null' ? -1 : 1;
  if (ta === 'number' && tb === 'number') return a - b;
  if (ta === 'date' && tb === 'date') return a.ms - b.ms;
  if (ta === 'duration' && tb === 'duration') return a.totalMs - b.totalMs;
  if (ta === 'boolean' && tb === 'boolean') return a === b ? 0 : a ? 1 : -1;
  if (ta === 'list' && tb === 'list') { for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = compare(a[i], b[i]); if (c) return c; } return a.length - b.length; }
  const sa = toStr(a), sb = toStr(b);
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}
export function equals(a, b) {
  const ta = typeOf(a), tb = typeOf(b);
  if (ta !== tb) return false;
  switch (ta) {
    case 'null': return true;
    case 'date': return a.ms === b.ms;
    case 'duration': return a.totalMs === b.totalMs;
    case 'list': return a.length === b.length && a.every((x, i) => equals(x, b[i]));
    case 'link': return a.path === b.path;
    case 'file': return a.entry === b.entry;
    case 'object': { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => k in b && equals(a[k], b[k])); }
    default: return a === b;
  }
}
