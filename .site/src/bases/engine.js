// Bases engine: parses .base definitions, evaluates filters/formulas/properties/summaries, and produces
// view results. DOM-free so it can be unit-tested in Node. Behaviour follows Obsidian's documented
// Bases syntax; anything we do not implement is reported in `warnings`/`errors` instead of being dropped.
import * as yaml from 'js-yaml';
import moment from 'moment';
import { parseExpression } from './expr.js';
import {
  BDate, BDuration, BLink, BFile, BHtml, BImage, BIcon, BRegExp, BaseError, typeOf, isTruthy, isEmptyValue, toStr, toNumber,
  compare, equals, parseDate, parseDuration, addDuration, formatDate, relativeTime,
} from './values.js';

class BNs { constructor(kind, entry) { this.kind = kind; this.entry = entry; } }

const FILE_FIELDS = ['name', 'basename', 'path', 'folder', 'ext', 'size', 'ctime', 'mtime', 'tags', 'links', 'embeds', 'backlinks', 'properties', 'file'];
const LAZY = new Set(['filter', 'map', 'reduce', 'if']);

// ---------------- environment ----------------
export class BasesEnv {
  /** entries: [{path,name,ext,folder,size,ctime,mtime,fm,tags,links,embeds,backlinks,url}] */
  constructor({ entries, propertyTypes = {}, now = () => Date.now() }) {
    this.entries = entries;
    this.propertyTypes = propertyTypes;
    this.now = now;
    this.byPath = new Map(entries.map(e => [e.path.toLowerCase(), e]));
    this.byName = new Map();
    for (const e of entries) {
      const k = (e.ext === 'md' ? e.basename : e.name).toLowerCase();
      if (!this.byName.has(k)) this.byName.set(k, e);
    }
  }
  resolve(linkpath, source) {
    let lp = String(linkpath ?? '').split('#')[0].trim();
    if (!lp) return null;
    const cands = [lp, lp + '.md'];
    if (source && !lp.startsWith('/')) { const dir = source.split('/').slice(0, -1).join('/'); if (dir) cands.unshift(dir + '/' + lp, dir + '/' + lp + '.md'); }
    for (const c of cands) { const e = this.byPath.get(c.replace(/^\//, '').toLowerCase()); if (e) return e; }
    const name = lp.split('/').pop().toLowerCase();
    return this.byName.get(name.replace(/\.md$/, '')) || this.byName.get(name) || null;
  }
}

// ---------------- evaluator ----------------
export class Evaluator {
  constructor(env, base) {
    this.env = env;
    this.base = base;
    this.formulaAst = new Map();
    this.formulaCache = new Map(); // entry -> Map(name -> value)
    this.stack = [];
  }

  // ----- property access -----
  coerce(v, key) {
    if (v == null) return null;
    if (typeof v === 'string') {
      const t = this.env.propertyTypes[key];
      const m = /^\[\[([^\]]+)\]\]$/.exec(v.trim());
      if (m) { const [target, ...rest] = m[1].split('|'); const [p, sub] = target.split('#'); return new BLink(p.trim(), rest.length ? rest.join('|') : null, sub ?? null, this.env.resolve(p, this.sourcePath)); }
      if (t === 'date' || t === 'datetime') return parseDate(v) ?? v;
      return v;
    }
    if (Array.isArray(v)) return v.map(x => this.coerce(x, key));
    if (v instanceof Date) return new BDate(v.getTime(), true);
    if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.coerce(x, key)]));
    return v;
  }
  noteProp(entry, key) {
    const fm = entry.fm || {};
    let v = key in fm ? fm[key] : undefined;
    if (v === undefined) { const lk = key.toLowerCase(); for (const k of Object.keys(fm)) if (k.toLowerCase() === lk) { v = fm[k]; break; } }
    const prevSource = this.sourcePath; this.sourcePath = entry.path;
    try {
      if (v === undefined) return key === 'tags' ? [...(entry.tags || [])] : null;
      return this.coerce(v, key);
    } finally { this.sourcePath = prevSource; }
  }
  fileField(entry, key) {
    const env = this.env;
    const asLink = p => new BLink(p, null, null, env.resolve(p, entry.path));
    switch (key) {
      case 'name': return entry.name;
      case 'basename': return entry.basename;
      case 'path': return entry.path;
      case 'folder': return entry.folder;
      case 'ext': return entry.ext;
      case 'size': return entry.size;
      case 'ctime': return new BDate(entry.ctime, true);
      case 'mtime': return new BDate(entry.mtime, true);
      case 'tags': return [...(entry.tags || [])];
      case 'links': return (entry.links || []).map(asLink);
      case 'embeds': return (entry.embeds || []).map(asLink);
      case 'backlinks': return (entry.backlinks || []).map(asLink);
      case 'properties': return Object.fromEntries(Object.keys(entry.fm || {}).map(k => [k, this.noteProp(entry, k)]));
      case 'file': return new BFile(entry);
      default: throw new BaseError(`Unknown file property "file.${key}"`);
    }
  }
  /** Resolves a property id such as `file.name`, `note.x`, `formula.y` or a bare name. */
  getProperty(entry, id, ctx = {}) {
    if (id.startsWith('file.')) return this.fileField(entry, id.slice(5));
    if (id.startsWith('formula.')) return this.formula(entry, id.slice(8), ctx);
    if (id.startsWith('note.')) return this.noteProp(entry, id.slice(5));
    return this.noteProp(entry, id);
  }
  formula(entry, name, ctx) {
    const src = this.base.formulas?.[name];
    if (src === undefined) throw new BaseError(`Unknown formula "${name}"`);
    let cache = this.formulaCache.get(entry);
    if (!cache) this.formulaCache.set(entry, cache = new Map());
    if (cache.has(name)) { const c = cache.get(name); if (c instanceof Error) throw c; return c; }
    const key = entry.path + '\0' + name;
    if (this.stack.includes(key)) throw new BaseError(`Circular formula reference: formula.${name}`);
    this.stack.push(key);
    try {
      let ast = this.formulaAst.get(name);
      if (!ast) this.formulaAst.set(name, ast = parseExpression(String(src)));
      const v = this.ev(ast, { entry, thisEntry: ctx.thisEntry, scope: {} });
      cache.set(name, v); return v;
    } catch (e) { cache.set(name, e); throw e; }
    finally { this.stack.pop(); }
  }

  // ----- evaluation -----
  evaluate(source, ctx) { return this.ev(parseExpression(source), ctx); }
  ev(n, ctx) {
    switch (n.t) {
      case 'lit': return n.v;
      case 're': return new BRegExp(new RegExp(n.src, n.flags));
      case 'arr': return n.items.map(x => this.ev(x, ctx));
      case 'obj': return Object.fromEntries(n.props.map(([k, x]) => [k, this.ev(x, ctx)]));
      case 'cond': return isTruthy(this.ev(n.c, ctx)) ? this.ev(n.a, ctx) : this.ev(n.b, ctx);
      case 'id': return this.ident(n.n, ctx);
      case 'mem': return this.member(this.ev(n.o, ctx), n.k, ctx);
      case 'idx': { const o = this.ev(n.o, ctx), k = this.ev(n.k, ctx); return Array.isArray(o) ? (o[toNumber(k)] ?? null) : this.member(o, toStr(k), ctx); }
      case 'un': { const v = this.ev(n.e, ctx); if (n.op === '!') return !isTruthy(v); if (n.op === '-') return v instanceof BDuration ? new BDuration(-v.ms, -v.months) : -toNumber(v); return toNumber(v); }
      case 'bin': return this.binary(n, ctx);
      case 'call': return this.call(n, ctx);
      default: throw new BaseError('Unknown expression node ' + n.t);
    }
  }
  ident(name, ctx) {
    if (ctx.scope && name in ctx.scope) return ctx.scope[name];
    switch (name) {
      case 'file': return new BFile(ctx.entry);
      case 'note': return new BNs('note', ctx.entry);
      case 'formula': return new BNs('formula', ctx.entry);
      case 'this': return new BNs('this', ctx.thisEntry ?? ctx.entry);
      default: return this.noteProp(ctx.entry, name);
    }
  }
  member(o, key, ctx) {
    if (o instanceof BNs) {
      if (o.kind === 'note') return this.noteProp(o.entry, key);
      if (o.kind === 'formula') return this.formula(o.entry, key, ctx);
      // this: file.* via `this.file.x`, note properties directly, and file fields as a convenience
      if (key === 'file') return new BFile(o.entry);
      if (key === 'note') return new BNs('note', o.entry);
      if (key === 'formula') return new BNs('formula', o.entry);
      if (o.entry.fm && key in o.entry.fm) return this.noteProp(o.entry, key);
      if (FILE_FIELDS.includes(key)) return this.fileField(o.entry, key);
      return null;
    }
    switch (typeOf(o)) {
      case 'null': return null;
      case 'file': { if (FILE_FIELDS.includes(key)) return this.fileField(o.entry, key); throw new BaseError(`Unknown file property "${key}"`); }
      case 'string': if (key === 'length') return [...o].length; break;
      case 'list': if (key === 'length') return o.length; break;
      case 'date': { const d = o.d; switch (key) { case 'year': return d.getFullYear(); case 'month': return d.getMonth() + 1; case 'day': return d.getDate(); case 'hour': return d.getHours(); case 'minute': return d.getMinutes(); case 'second': return d.getSeconds(); case 'millisecond': return d.getMilliseconds(); } break; }
      case 'duration': { const ms = o.totalMs; switch (key) { case 'milliseconds': return ms; case 'seconds': return ms / 1000; case 'minutes': return ms / 60000; case 'hours': return ms / 3600000; case 'days': return ms / 86400000; case 'weeks': return ms / (7 * 86400000); case 'months': return ms / (30.4375 * 86400000); case 'years': return ms / (365.25 * 86400000); } break; }
      case 'link': if (key === 'path') return o.path; if (key === 'display') return o.display; break;
      case 'object': if (key in o) return o[key]; return null;
      case 'image': case 'html': case 'icon': break;
    }
    // methods used without a call (e.g. `value.isEmpty`) are an error: be explicit
    return null;
  }

  binary(n, ctx) {
    const op = n.op;
    if (op === '&&') return isTruthy(this.ev(n.l, ctx)) && isTruthy(this.ev(n.r, ctx));
    if (op === '||') return isTruthy(this.ev(n.l, ctx)) || isTruthy(this.ev(n.r, ctx));
    let a = this.ev(n.l, ctx), b = this.ev(n.r, ctx);
    return applyOp(op, a, b);
  }

  call(n, ctx) {
    const f = n.f;
    if (f.t === 'id') {
      if (f.n === 'if') {
        const [c, a, b] = n.args;
        if (!c || !a) throw new BaseError('if() needs a condition and a value');
        return isTruthy(this.ev(c, ctx)) ? this.ev(a, ctx) : (b ? this.ev(b, ctx) : null);
      }
      const fn = GLOBALS[f.n];
      if (!fn) throw new BaseError(`Unknown function "${f.n}()"`);
      return fn.call(this, n.args.map(a => this.ev(a, ctx)), ctx);
    }
    if (f.t === 'mem') {
      const recv = this.ev(f.o, ctx);
      const name = f.k;
      if (LAZY.has(name) && Array.isArray(recv)) return this.listLazy(recv, name, n.args, ctx);
      const args = n.args.map(a => this.ev(a, ctx));
      return this.method(recv, name, args, ctx);
    }
    throw new BaseError('This expression cannot be called as a function');
  }
  listLazy(list, name, argNodes, ctx) {
    const withScope = (extra) => ({ ...ctx, scope: { ...(ctx.scope || {}), ...extra } });
    if (!argNodes.length) throw new BaseError(`${name}() needs an expression`);
    if (name === 'filter') return list.filter((value, index) => isTruthy(this.ev(argNodes[0], withScope({ value, index }))));
    if (name === 'map') return list.map((value, index) => this.ev(argNodes[0], withScope({ value, index })));
    if (name === 'reduce') {
      let acc = argNodes[1] ? this.ev(argNodes[1], ctx) : null;
      list.forEach((value, index) => { acc = this.ev(argNodes[0], withScope({ acc, value, index })); });
      return acc;
    }
    throw new BaseError(`Unsupported list method ${name}()`);
  }
  method(recv, name, args, ctx) {
    if (recv instanceof BNs) { if (recv.kind === 'this') return this.method(new BFile(recv.entry), name, args, ctx); throw new BaseError(`${recv.kind} has no method ${name}()`); }
    const t = typeOf(recv);
    const table = METHODS[t];
    const fn = (table && table[name]) || METHODS.any[name];
    if (!fn) throw new BaseError(`Unknown method ${name}() on a ${t} value`);
    return fn.call(this, recv, args, ctx);
  }
}

// ---------------- operators ----------------
function toDateMaybe(v) { return v instanceof BDate ? v : typeof v === 'string' ? parseDate(v) : null; }
function toDurMaybe(v) { return v instanceof BDuration ? v : typeof v === 'string' ? parseDuration(v) : typeof v === 'number' ? new BDuration(v) : null; }
export function applyOp(op, a, b) {
  const ta = typeOf(a), tb = typeOf(b);
  switch (op) {
    case '==': return equals(a, b);
    case '!=': return !equals(a, b);
    case '>': case '<': case '>=': case '<=': {
      let x = a, y = b;
      if (ta === 'date' && tb === 'string') y = parseDate(b) ?? b; else if (ta === 'string' && tb === 'date') x = parseDate(a) ?? a;
      if (typeOf(x) === 'null' || typeOf(y) === 'null') return false;
      const c = compare(x, y);
      return op === '>' ? c > 0 : op === '<' ? c < 0 : op === '>=' ? c >= 0 : c <= 0;
    }
    case '+':
      if (ta === 'date') { const d = toDurMaybe(b); if (!d) throw new BaseError('A date can only be added to a duration such as "1d"'); return addDuration(a, d); }
      if (ta === 'duration' && tb === 'duration') return new BDuration(a.ms + b.ms, a.months + b.months);
      if (ta === 'number' && tb === 'number') return a + b;
      if (ta === 'list' && tb === 'list') return [...a, ...b];
      if (ta === 'null' || tb === 'null') return a ?? b;
      if (ta === 'string' || tb === 'string') return toStr(a) + toStr(b);
      throw new BaseError(`Cannot add ${ta} and ${tb}`);
    case '-':
      if (ta === 'date' && tb === 'date') return new BDuration(a.ms - b.ms);
      if (ta === 'date') { const d = toDurMaybe(b); if (!d) throw new BaseError('A duration such as "1d" can be subtracted from a date'); return addDuration(a, d, -1); }
      if (ta === 'duration' && tb === 'duration') return new BDuration(a.ms - b.ms, a.months - b.months);
      return toNumber(a) - toNumber(b);
    case '*':
      if (ta === 'duration') return new BDuration(a.ms * toNumber(b), a.months * toNumber(b));
      return toNumber(a) * toNumber(b);
    case '/': return toNumber(a) / toNumber(b);
    case '%': return toNumber(a) % toNumber(b);
  }
  throw new BaseError('Unknown operator ' + op);
}

// ---------------- functions ----------------
const needArgs = (name, args, min, max = min) => { if (args.length < min || args.length > max) throw new BaseError(`${name}() takes ${min === max ? min : `${min}-${max}`} argument(s)`); };
const asRe = v => (v instanceof BRegExp ? v.re : v instanceof RegExp ? v : null);
const str = (v, what = 'a string') => { if (typeof v !== 'string') throw new BaseError(`Expected ${what} but got ${typeOf(v)}`); return v; };
const textOf = v => (v instanceof BLink ? (v.display ?? v.path) : toStr(v));

const GLOBALS = {
  now() { return new BDate(this.env.now(), true); },
  today() { const d = new Date(this.env.now()); return new BDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), false); },
  date(a) {
    needArgs('date', a, 1); const v = a[0];
    if (v instanceof BDate) return v;
    if (v instanceof BLink || v instanceof BFile) throw new BaseError('date() needs text or a date');
    const d = parseDate(toStr(v)); if (!d) throw new BaseError(`Cannot parse "${toStr(v)}" as a date`); return d;
  },
  duration(a) { needArgs('duration', a, 1); if (a[0] instanceof BDuration) return a[0]; const d = parseDuration(toStr(a[0])); if (!d) throw new BaseError(`Cannot parse "${toStr(a[0])}" as a duration`); return d; },
  number(a) { needArgs('number', a, 1); return toNumber(a[0]); },
  min(a) { const nums = a.flat().filter(x => x != null); return nums.length ? nums.reduce((m, x) => (compare(x, m) < 0 ? x : m)) : null; },
  max(a) { const nums = a.flat().filter(x => x != null); return nums.length ? nums.reduce((m, x) => (compare(x, m) > 0 ? x : m)) : null; },
  list(a) { needArgs('list', a, 1); return Array.isArray(a[0]) ? a[0] : [a[0]]; },
  link(a) {
    needArgs('link', a, 1, 2); const p = a[0];
    if (p instanceof BLink) return a[1] != null ? new BLink(p.path, toStr(a[1]), p.sub, p.entry) : p;
    if (p instanceof BFile) return new BLink(p.entry.path, a[1] != null ? toStr(a[1]) : null, null, p.entry);
    const s = toStr(p); const [path, sub] = s.split('#');
    return new BLink(path, a[1] != null ? toStr(a[1]) : null, sub ?? null, this.env.resolve(path, this.sourcePath));
  },
  file(a) { needArgs('file', a, 1); const p = a[0]; if (p instanceof BFile) return p; const e = p instanceof BLink ? p.entry : this.env.resolve(toStr(p)); return e ? new BFile(e) : null; },
  html(a) { needArgs('html', a, 1); return new BHtml(toStr(a[0])); },
  image(a) { needArgs('image', a, 1); return new BImage(a[0] instanceof BLink || a[0] instanceof BFile ? a[0] : toStr(a[0])); },
  icon(a) { needArgs('icon', a, 1); return new BIcon(toStr(a[0])); },
  escapeHTML(a) { needArgs('escapeHTML', a, 1); return toStr(a[0]).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
};

const sum = l => l.reduce((s, x) => s + toNumber(x), 0);
const nums = l => l.filter(x => x != null && x !== '').map(toNumber);
const median = l => { const s = [...l].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const stddev = l => { if (!l.length) return null; const mean = sum(l) / l.length; return Math.sqrt(l.reduce((s, x) => s + (x - mean) ** 2, 0) / l.length); };

const METHODS = {
  any: {
    isTruthy: v => isTruthy(v),
    isType: (v, [t]) => typeOf(v) === String(t),
    toString: v => toStr(v),
    isEmpty: v => isEmptyValue(v),
  },
  string: {
    contains: (s, [x]) => s.includes(toStr(x)),
    containsAll: (s, a) => a.flat().every(x => s.includes(toStr(x))),
    containsAny: (s, a) => a.flat().some(x => s.includes(toStr(x))),
    startsWith: (s, [x]) => s.startsWith(toStr(x)),
    endsWith: (s, [x]) => s.endsWith(toStr(x)),
    lower: s => s.toLowerCase(), upper: s => s.toUpperCase(),
    title: s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    trim: s => s.trim(),
    repeat: (s, [n]) => s.repeat(Math.max(0, toNumber(n))),
    reverse: s => [...s].reverse().join(''),
    slice: (s, [a, b]) => s.slice(toNumber(a), b == null ? undefined : toNumber(b)),
    split: (s, [sep, n]) => { const parts = asRe(sep) ? s.split(asRe(sep)) : s.split(toStr(sep)); return n == null ? parts : parts.slice(0, toNumber(n)); },
    replace: (s, [pat, rep]) => { const re = asRe(pat); return re ? s.replace(re, toStr(rep)) : s.split(toStr(pat)).join(toStr(rep)); },
    isEmpty: s => s === '',
  },
  number: {
    abs: n => Math.abs(n), ceil: n => Math.ceil(n), floor: n => Math.floor(n),
    round: (n, [d]) => { const k = 10 ** (d == null ? 0 : toNumber(d)); return Math.round(n * k) / k; },
    toFixed: (n, [d]) => n.toFixed(d == null ? 0 : toNumber(d)),
    isEmpty: () => false,
  },
  boolean: {},
  list: {
    contains: (l, [x]) => l.some(y => equals(y, x) || (typeof y === 'string' && typeof x === 'string' && y === x)),
    containsAll: (l, a) => a.flat().every(x => l.some(y => equals(y, x))),
    containsAny: (l, a) => a.flat().some(x => l.some(y => equals(y, x))),
    join: (l, [sep]) => l.map(toStr).join(sep == null ? ',' : toStr(sep)),
    flat() { return arguments[0].flat(Infinity); },
    reverse: l => [...l].reverse(),
    slice: (l, [a, b]) => l.slice(toNumber(a), b == null ? undefined : toNumber(b)),
    sort: l => [...l].sort(compare),
    unique: l => { const out = []; for (const x of l) if (!out.some(y => equals(x, y))) out.push(x); return out; },
    isEmpty: l => l.length === 0,
    // aggregates (handy in custom summaries)
    sum: l => sum(nums(l)), mean: l => { const n = nums(l); return n.length ? sum(n) / n.length : null; },
    average: l => { const n = nums(l); return n.length ? sum(n) / n.length : null; },
    median: l => median(nums(l)), min: l => (l.length ? l.reduce((m, x) => (compare(x, m) < 0 ? x : m)) : null), max: l => (l.length ? l.reduce((m, x) => (compare(x, m) > 0 ? x : m)) : null),
    stddev: l => stddev(nums(l)),
  },
  date: {
    format: (d, [f]) => formatDate(d, toStr(f)),
    date: d => new BDate(new Date(new Date(d.ms).setHours(0, 0, 0, 0)).getTime(), false),
    time: d => formatDate(d, 'HH:mm:ss'),
    relative: (d, _a) => relativeTime(d),
    isEmpty: () => false,
  },
  duration: { isEmpty: () => false },
  link: {
    asFile: l => (l.entry ? new BFile(l.entry) : null),
    linksTo(l, [f]) { const e = f instanceof BFile ? f.entry : f instanceof BLink ? f.entry : null; return !!(e && l.entry && (l.entry.links || []).includes(e.path)); },
  },
  file: {
    asLink: f => new BLink(f.entry.path, null, null, f.entry),
    hasLink(f, [x]) { const e = x instanceof BFile ? x.entry : x instanceof BLink ? x.entry : this.env.resolve(toStr(x)); return !!(e && (f.entry.links || []).includes(e.path)); },
    hasTag(f, tags) {
      const have = [...(f.entry.tags || [])].map(t => String(t).replace(/^#/, '').toLowerCase());
      return tags.flat().some(t => { const w = String(t).replace(/^#/, '').toLowerCase(); return have.some(h => h === w || h.startsWith(w + '/')); });
    },
    hasProperty: (f, [k]) => !!f.entry.fm && toStr(k) in f.entry.fm,
    inFolder(f, [folder]) { const fo = toStr(folder).replace(/^\/|\/$/g, ''); const cur = f.entry.folder || ''; return !fo || cur === fo || cur.startsWith(fo + '/'); },
    isEmpty: () => false,
  },
  object: { keys: o => Object.keys(o), values: o => Object.values(o), isEmpty: o => Object.keys(o).length === 0 },
  regexp: { matches: (r, [s]) => asRe(r).test(toStr(s)) },
  html: {}, image: {}, icon: {}, null: { isEmpty: () => true },
};

// ---------------- summaries ----------------
export const DEFAULT_SUMMARIES = {
  Average: v => { const n = nums(v.filter(x => typeOf(x) === 'number')); return n.length ? sum(n) / n.length : null; },
  Min: v => { const n = v.filter(x => typeOf(x) === 'number'); return n.length ? Math.min(...n) : null; },
  Max: v => { const n = v.filter(x => typeOf(x) === 'number'); return n.length ? Math.max(...n) : null; },
  Sum: v => { const n = v.filter(x => typeOf(x) === 'number'); return n.length ? sum(n) : null; },
  Range: v => { const n = v.filter(x => typeOf(x) === 'number'); return n.length ? Math.max(...n) - Math.min(...n) : null; },
  Median: v => median(v.filter(x => typeOf(x) === 'number')),
  Stddev: v => stddev(v.filter(x => typeOf(x) === 'number')),
  Earliest: v => { const d = v.filter(x => x instanceof BDate); return d.length ? d.reduce((m, x) => (x.ms < m.ms ? x : m)) : null; },
  Latest: v => { const d = v.filter(x => x instanceof BDate); return d.length ? d.reduce((m, x) => (x.ms > m.ms ? x : m)) : null; },
  Span: v => { const d = v.filter(x => x instanceof BDate); return d.length ? new BDuration(Math.max(...d.map(x => x.ms)) - Math.min(...d.map(x => x.ms))) : null; },
  Checked: v => v.filter(x => x === true).length,
  Unchecked: v => v.filter(x => x === false).length,
  Empty: v => v.filter(isEmptyValue).length,
  Filled: v => v.filter(x => !isEmptyValue(x)).length,
  Unique: v => { const out = []; for (const x of v) if (!out.some(y => equals(x, y))) out.push(x); return out.length; },
};

// ---------------- base definition ----------------
const TOP_KEYS = new Set(['filters', 'formulas', 'properties', 'summaries', 'views']);
const VIEW_KEYS = new Set(['type', 'name', 'filters', 'groupBy', 'order', 'sort', 'limit', 'columnSize', 'rowHeight', 'summaries', 'image', 'imageFit', 'imageAspectRatio', 'cardSize', 'indentProperties', 'markers', 'separator', 'sortOrder', 'wrap']);
export const SUPPORTED_VIEW_TYPES = new Set(['table', 'cards', 'list']);

export function parseBase(text) {
  const out = { filters: null, formulas: {}, properties: {}, summaries: {}, views: [], warnings: [], errors: [] };
  let doc;
  try { doc = yaml.load(text || '') ?? {}; } catch (e) { out.errors.push('This .base file is not valid YAML: ' + e.message.split('\n')[0]); return out; }
  if (typeof doc !== 'object' || Array.isArray(doc)) { out.errors.push('A .base file must be a YAML mapping.'); return out; }
  for (const k of Object.keys(doc)) if (!TOP_KEYS.has(k)) out.warnings.push(`Unknown top-level setting "${k}" was ignored`);
  out.filters = doc.filters ?? null;
  out.formulas = doc.formulas && typeof doc.formulas === 'object' ? doc.formulas : {};
  out.properties = doc.properties && typeof doc.properties === 'object' ? doc.properties : {};
  out.summaries = doc.summaries && typeof doc.summaries === 'object' ? doc.summaries : {};
  const views = Array.isArray(doc.views) ? doc.views : [];
  out.views = views.map((v, i) => {
    v = v && typeof v === 'object' ? v : {};
    for (const k of Object.keys(v)) if (!VIEW_KEYS.has(k)) out.warnings.push(`View "${v.name ?? i + 1}": unknown setting "${k}" was ignored`);
    return v;
  });
  if (!out.views.length) out.views = [{ type: 'table', name: 'Table' }];
  return out;
}

// ---------------- running a view ----------------
const dirMul = d => (String(d ?? 'ASC').toUpperCase() === 'DESC' ? -1 : 1);

export function propId(id) { return typeof id === 'string' ? id : String(id); }
export function propDisplayName(base, id) {
  const cfg = base.properties?.[id] ?? base.properties?.['note.' + id];
  if (cfg?.displayName) return cfg.displayName;
  if (id.startsWith('file.')) { const n = id.slice(5); return { name: 'Name', basename: 'Basename', path: 'Path', folder: 'Folder', ext: 'Extension', size: 'Size', ctime: 'Created time', mtime: 'Modified time', tags: 'File tags', links: 'Links', embeds: 'Embeds', backlinks: 'Backlinks' }[n] ?? n; }
  if (id.startsWith('formula.')) return id.slice(8);
  return id.startsWith('note.') ? id.slice(5) : id;
}

function evalFilterNode(ev, node, ctx) {
  if (node == null) return true;
  if (typeof node === 'string') return isTruthy(ev.evaluate(node, ctx));
  if (typeof node === 'boolean') return node;
  if (Array.isArray(node)) return node.every(x => evalFilterNode(ev, x, ctx));
  if (typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.length !== 1 || !['and', 'or', 'not'].includes(keys[0])) throw new BaseError(`Unsupported filter object (expected and / or / not): ${JSON.stringify(node)}`);
    const k = keys[0], list = Array.isArray(node[k]) ? node[k] : [node[k]];
    if (k === 'and') return list.every(x => evalFilterNode(ev, x, ctx));
    if (k === 'or') return list.some(x => evalFilterNode(ev, x, ctx));
    return !list.some(x => evalFilterNode(ev, x, ctx));
  }
  throw new BaseError('Unsupported filter: ' + JSON.stringify(node));
}

/**
 * Runs one view. Returns { columns, rows (flat, after sort/limit), groups: [{key, rows}] | null, errors, notes }.
 * Each row: { entry, cells: {propId: {value} | {error}} }
 */
export function runView(env, base, view, { thisEntry = null } = {}) {
  const ev = new Evaluator(env, base);
  const result = { view, columns: [], rows: [], groups: null, errors: [], notes: [] };
  const type = view.type ?? 'table';
  if (!SUPPORTED_VIEW_TYPES.has(type)) result.errors.push(`The "${type}" view type is not supported on the published site.`);

  const safe = (fn, fallback, label) => { try { return fn(); } catch (e) { result.errors.push(`${label}: ${e.message}`); return fallback; } };

  const ctxFor = entry => ({ entry, thisEntry: thisEntry ?? entry, scope: {} });
  // filters: base-level and view-level must both pass
  let entries = env.entries.filter(e => {
    const ctx = ctxFor(e);
    try { return evalFilterNode(ev, base.filters, ctx) && evalFilterNode(ev, view.filters, ctx); }
    catch (err) { if (!result._filterErr) { result._filterErr = true; result.errors.push('Filter error: ' + err.message); } return false; }
  });
  delete result._filterErr;

  // columns
  let order = Array.isArray(view.order) ? view.order.map(propId) : null;
  if (!order || !order.length) order = ['file.name'];
  result.columns = order.map(id => ({ id, name: propDisplayName(base, id), width: view.columnSize?.[id] ?? view.columnSize?.['note.' + id] ?? null }));

  // sort
  const sortSpec = (Array.isArray(view.sort) ? view.sort : []).map(s => ({ id: propId(s.property), dir: dirMul(s.direction) }));
  const valueOf = (entry, id) => { try { return ev.getProperty(entry, id, ctxFor(entry)); } catch { return null; } };
  const nameCmp = (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
  entries = [...entries].sort((a, b) => {
    for (const s of sortSpec) { const c = compare(valueOf(a, s.id), valueOf(b, s.id)) * s.dir; if (c) return c; }
    return nameCmp(a, b);
  });

  // group
  let groups = null;
  if (view.groupBy) {
    const gid = propId(typeof view.groupBy === 'string' ? view.groupBy : view.groupBy.property);
    const gdir = dirMul(typeof view.groupBy === 'string' ? 'ASC' : view.groupBy.direction);
    const map = new Map();
    for (const e of entries) {
      const v = valueOf(e, gid);
      const k = typeOf(v) === 'list' ? toStr(v) : toStr(v);
      if (!map.has(k)) map.set(k, { key: k, value: v, rows: [] });
      map.get(k).rows.push(e);
    }
    groups = [...map.values()].sort((a, b) => compare(a.value, b.value) * gdir);
    result.groupProperty = gid;
  }

  // limit
  if (view.limit != null && Number(view.limit) >= 0) {
    let left = Number(view.limit);
    if (groups) { groups = groups.map(g => { const rows = g.rows.slice(0, Math.max(0, left)); left -= rows.length; return { ...g, rows }; }).filter(g => g.rows.length); entries = groups.flatMap(g => g.rows); }
    else entries = entries.slice(0, left);
  }

  const makeRow = entry => {
    const cells = {};
    const ctx = ctxFor(entry);
    for (const c of result.columns) { try { cells[c.id] = { value: ev.getProperty(entry, c.id, ctx) }; } catch (e) { cells[c.id] = { error: e.message }; } }
    const out = { entry, cells };
    if (view.image) { try { out.image = ev.getProperty(entry, propId(view.image), ctx); } catch { out.image = null; } }
    return out;
  };
  const rowOf = new Map(entries.map(e => [e, makeRow(e)]));
  result.rows = entries.map(e => rowOf.get(e));
  if (groups) result.groups = groups.map(g => ({ key: g.key, value: g.value, rows: g.rows.map(e => rowOf.get(e)) }));
  result.total = result.rows.length;

  // summaries (table only)
  const summ = view.summaries && typeof view.summaries === 'object' ? view.summaries : {};
  result.summaries = {};
  for (const c of result.columns) {
    const name = summ[c.id] ?? summ['note.' + c.id] ?? (c.id.startsWith('note.') ? summ[c.id.slice(5)] : undefined);
    if (!name) continue;
    const values = result.rows.map(r => (r.cells[c.id].error ? null : r.cells[c.id].value));
    result.summaries[c.id] = safe(() => {
      if (DEFAULT_SUMMARIES[name]) return { name, value: DEFAULT_SUMMARIES[name](values) };
      if (base.summaries?.[name]) { const v = ev.ev(parseExpression(String(base.summaries[name])), { entry: result.rows[0]?.entry ?? env.entries[0], thisEntry, scope: { values } }); return { name, value: v }; }
      throw new BaseError(`Unknown summary "${name}"`);
    }, { name, error: true }, `Summary for ${c.name}`);
  }
  return result;
}

// ---------------- entries from the vault snapshot ----------------
export function entriesFromVault(vault) {
  const mk = (path, extra) => {
    const name = path.split('/').pop();
    const dot = name.lastIndexOf('.');
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    return { path, name, basename: dot < 0 ? name : name.slice(0, dot), ext: dot < 0 ? '' : name.slice(dot + 1).toLowerCase(), folder, fm: null, tags: [], links: [], embeds: [], backlinks: [], ...extra };
  };
  const out = [];
  for (const p of vault.pages) out.push(mk(p.path, { fm: p.fm || {}, tags: p.tags || [], links: p.links, embeds: p.embeds, backlinks: p.backlinks, ctime: p.ctime, mtime: p.mtime, size: p.size, url: p.url, isNote: true }));
  for (const a of vault.attachments || []) out.push(mk(a.path, { ctime: a.stat.ctime, mtime: a.stat.mtime, size: a.stat.size, url: a.url }));
  for (const b of vault.bases || []) out.push(mk(b.path, { ctime: b.stat.ctime, mtime: b.stat.mtime, size: b.stat.size, url: b.url }));
  for (const s of (vault.scripts || []).filter(x => !x.hidden)) out.push(mk(s.path, { ctime: s.stat.ctime, mtime: s.stat.mtime, size: s.stat.size }));
  return out;
}
