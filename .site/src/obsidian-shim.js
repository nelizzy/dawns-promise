// A small stand-in for the parts of the Obsidian API that Datacore's UI/engine touch, backed by the
// static vault snapshot (vault.json). It is what lets the real Datacore code run in a browser.
import MarkdownIt from 'markdown-it';
import markPlugin from 'markdown-it-mark';
import moment from 'moment';

// ---------- Obsidian's prototype augmentations ----------
export function installPolyfills() {
  const def = (proto, name, fn) => { if (!Object.prototype.hasOwnProperty.call(proto, name)) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true }); };
  def(Array.prototype, 'contains', function (x) { return this.includes(x); });
  def(Array.prototype, 'remove', function (x) { const i = this.indexOf(x); if (i >= 0) this.splice(i, 1); });
  def(Array.prototype, 'first', function () { return this[0]; });
  def(Array.prototype, 'last', function () { return this[this.length - 1]; });
  def(String.prototype, 'contains', function (x) { return this.includes(x); });
  def(Element.prototype, 'empty', function () { while (this.firstChild) this.removeChild(this.firstChild); });
  def(Element.prototype, 'addClass', function (...c) { this.classList.add(...c); });
  def(Element.prototype, 'addClasses', function (c) { this.classList.add(...c); });
  def(Element.prototype, 'removeClass', function (...c) { this.classList.remove(...c); });
  def(Element.prototype, 'toggleClass', function (c, on) { this.classList.toggle(c, on); });
  def(Element.prototype, 'hasClass', function (c) { return this.classList.contains(c); });
  def(Element.prototype, 'setText', function (t) { this.textContent = t; });
  def(Element.prototype, 'setAttr', function (k, v) { this.setAttribute(k, v); });
  def(Element.prototype, 'getAttr', function (k) { return this.getAttribute(k); });
  def(Element.prototype, 'setCssProps', function (p) { for (const [k, v] of Object.entries(p)) this.style.setProperty(k, v); });
  def(Node.prototype, 'instanceOf', function (T) { return this instanceof T; });
  def(Element.prototype, 'createEl', function (tag, o = {}, cb) {
    const el = document.createElement(tag);
    if (typeof o === 'string') o = { text: o };
    if (o.cls) (Array.isArray(o.cls) ? o.cls : String(o.cls).split(' ')).filter(Boolean).forEach(c => el.classList.add(c));
    if (o.text != null) el.textContent = o.text;
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
    if (o.href) el.setAttribute('href', o.href);
    if (o.type) el.setAttribute('type', o.type);
    this.appendChild(el); cb?.(el); return el;
  });
  def(Element.prototype, 'createDiv', function (o, cb) { return this.createEl('div', o, cb); });
  def(Element.prototype, 'createSpan', function (o, cb) { return this.createEl('span', o, cb); });
  // Obsidian globals that user scripts commonly rely on
  window.moment = moment;
  window.createEl = (tag, o, cb) => { const holder = document.createElement('div'); const el = holder.createEl(tag, o, cb); holder.removeChild(el); return el; };
  window.createDiv = o => { const d = document.createElement('div'); if (o) { if (o.cls) d.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls; if (o.text != null) d.textContent = o.text; } return d; };
  window.createSpan = o => { const d = document.createElement('span'); if (o?.cls) d.className = o.cls; if (o?.text != null) d.textContent = o.text; return d; };
  window.sleep = ms => new Promise(r => setTimeout(r, ms));
  window.nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  window.activeWindow = window; window.activeDocument = document;
}

// ---------- classes ----------
export class Events {
  constructor() { this._h = {}; }
  on(name, cb, ctx) { (this._h[name] ||= []).push({ cb, ctx }); return { e: this, name, cb, ctx }; }
  off(name, cb) { this._h[name] = (this._h[name] || []).filter(h => h.cb !== cb); }
  offref(ref) { this.off(ref.name, ref.cb); }
  trigger(name, ...args) { for (const h of [...(this._h[name] || [])]) { try { h.cb.apply(h.ctx, args); } catch (e) { console.error(e); } } }
}
export class Component {
  constructor() { this._children = []; this._loaded = false; this._cbs = []; }
  load() { if (this._loaded) return; this._loaded = true; this.onload?.(); for (const c of [...this._children]) c.load(); }
  onload() {}
  unload() { if (!this._loaded) return; this._loaded = false; for (const c of [...this._children]) c.unload(); for (const cb of this._cbs.splice(0)) { try { cb(); } catch (e) { console.error(e); } } this.onunload?.(); }
  onunload() {}
  addChild(c) { this._children.push(c); if (this._loaded) c.load(); return c; }
  removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.unload(); return c; }
  register(cb) { this._cbs.push(cb); }
  registerEvent(ref) { this._cbs.push(() => ref?.e?.offref?.(ref)); }
  registerDomEvent(el, type, cb, opts) { el.addEventListener(type, cb, opts); this._cbs.push(() => el.removeEventListener(type, cb, opts)); }
  registerInterval(id) { this._cbs.push(() => clearInterval(id)); return id; }
}
export class MarkdownRenderChild extends Component {
  constructor(containerEl) { super(); this.containerEl = containerEl; }
}
export class TAbstractFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.parent = null; } }
export class TFile extends TAbstractFile {
  constructor(path, stat = {}) {
    super(path);
    const dot = this.name.lastIndexOf('.');
    this.extension = dot < 0 ? '' : this.name.slice(dot + 1);
    this.basename = dot < 0 ? this.name : this.name.slice(0, dot);
    this.stat = { ctime: stat.ctime || 0, mtime: stat.mtime || 0, size: stat.size || 0 };
  }
}
export class TFolder extends TAbstractFile { constructor(path) { super(path); this.children = []; } isRoot() { return this.path === '/'; } }
class Noop { constructor() {} }
export const Plugin = class extends Component {};
export const PluginSettingTab = Noop, Setting = Noop, Modal = Noop, Notice = Noop;
export const debounce = (fn, ms = 0) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); d.run = fn; return d; };
export const normalizePath = p => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

// ---------- lucide icons (loaded lazily from assets/icons.json) ----------
let ICONS = {};
export function setIconData(map) { ICONS = map; }
export const setIcon = (el, name) => {
  el.empty?.();
  const svg = ICONS[String(name).replace(/^lucide-/, '')];
  if (svg) el.insertAdjacentHTML('beforeend', svg);
  else el.setAttribute('data-icon', name);
};

// ---------- markdown renderer ----------
export function makeRenderer(app) {
  const md = new MarkdownIt({ html: true, breaks: true, linkify: true }).use(markPlugin);
  const state = { source: '' };
  md.inline.ruler.before('link', 'wikilink', (st, silent) => {
    const src = st.src, start = st.pos, embed = src.charCodeAt(start) === 0x21, open = embed ? start + 1 : start;
    if (src.slice(open, open + 2) !== '[[') return false;
    const end = src.indexOf(']]', open + 2);
    if (end < 0) return false;
    const inner = src.slice(open + 2, end);
    if (!inner || inner.includes('\n')) return false;
    if (!silent) { const t = st.push('wikilink', '', 0); t.meta = { inner, embed }; }
    st.pos = end + 2; return true;
  });
  md.renderer.rules.wikilink = (tokens, i) => {
    const { inner, embed } = tokens[i].meta;
    const [targetFull, ...rest] = inner.replace(/\\\|/g, '|').split('|');
    const alias = rest.length ? rest.join('|') : null;
    const hash = targetFull.indexOf('#');
    const target = (hash >= 0 ? targetFull.slice(0, hash) : targetFull).trim();
    const sub = hash >= 0 ? targetFull.slice(hash + 1) : '';
    const file = target ? app.metadataCache.getFirstLinkpathDest(target, state.source) : app.vault.getAbstractFileByPath(state.source);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    if (embed && file && /^(png|jpe?g|gif|webp|svg|avif)$/i.test(file.extension)) {
      const dim = alias && /^\d+(x\d+)?$/.test(alias) ? alias.split('x') : [];
      return `<img alt="${esc(target)}" src="${app.vault.getResourcePath(file)}"${dim[0] ? ` width="${dim[0]}"` : ''}${dim[1] ? ` height="${dim[1]}"` : ''}>`;
    }
    const text = alias ?? (target + (sub ? ' > ' + sub : '')) ?? '';
    if (!file) return `<a class="internal-link is-unresolved" data-href="${esc(targetFull)}">${esc(text || sub)}</a>`;
    return `<a class="internal-link" data-href="${esc(targetFull)}" data-source="${esc(state.source)}">${esc(text || file.basename)}</a>`;
  };
  md.inline.ruler.before('emphasis', 'obstag', (st, silent) => {
    if (st.src.charCodeAt(st.pos) !== 0x23 || (st.pos > 0 && !/[\s(]/.test(st.src[st.pos - 1]))) return false;
    const m = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(st.src.slice(st.pos));
    if (!m) return false;
    if (!silent) { const t = st.push('obstag', '', 0); t.content = m[1]; }
    st.pos += m[0].length; return true;
  });
  md.renderer.rules.obstag = (t, i) => `<a class="tag" data-tag="${t[i].content}">#${t[i].content}</a>`;
  const defLink = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (t, i, o, e, s) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(t[i].attrGet('href') || '')) { t[i].attrJoin('class', 'external-link'); t[i].attrSet('target', '_blank'); t[i].attrSet('rel', 'noopener nofollow'); }
    return defLink(t, i, o, e, s);
  };
  return (text, sourcePath) => { state.source = sourcePath || ''; return md.render(text); };
}

// ---------- app ----------
export function makeApp(vault, { base }) {
  const files = new Map(); // path -> TFile / TFolder
  const root = new TFolder('/');
  files.set('/', root); files.set('', root);
  const folderOf = path => {
    const parts = path.split('/').slice(0, -1);
    let cur = root, acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      let f = files.get(acc);
      if (!f) { f = new TFolder(acc); f.parent = cur; cur.children.push(f); files.set(acc, f); }
      cur = f;
    }
    return cur;
  };
  const add = (path, stat, extra = {}) => {
    const f = new TFile(path, stat); Object.assign(f, extra);
    f.parent = folderOf(path); f.parent.children.push(f); files.set(path, f); return f;
  };
  const byLower = new Map();   // "name" lower -> file (notes first)
  const byPathLower = new Map();
  const register = f => {
    byPathLower.set(f.path.toLowerCase(), f);
    const key = (f.extension === 'md' ? f.basename : f.name).toLowerCase();
    if (!byLower.has(key)) byLower.set(key, f);
    if (f.extension !== 'md' && !byLower.has(f.basename.toLowerCase() + '.' + f.extension)) byLower.set(f.name.toLowerCase(), f);
  };
  const raw = new Map();
  for (const p of vault.pages) { const f = add(p.path, { ctime: p.ctime, mtime: p.mtime, size: p.size }, { url: p.url }); raw.set(p.path, p.raw); register(f); }
  for (const s of vault.scripts || []) { const f = add(s.path, s.stat, { url: null }); raw.set(s.path, s.text); if (!s.hidden) register(f); }
  for (const b of vault.bases || []) { const f = add(b.path, b.stat, { url: b.url }); raw.set(b.path, b.text); register(f); }
  for (const a of vault.attachments || []) { const f = add(a.path, a.stat, { url: a.url }); register(f); }

  const events = new Events();
  const vaultApi = Object.assign(new Events(), {
    getAbstractFileByPath: p => files.get(p) ?? null,
    getFileByPath: p => { const f = files.get(p); return f instanceof TFile ? f : null; },
    getFolderByPath: p => { const f = files.get(p); return f instanceof TFolder ? f : null; },
    getRoot: () => root,
    getFiles: () => [...files.values()].filter(f => f instanceof TFile),
    getMarkdownFiles: () => [...files.values()].filter(f => f instanceof TFile && f.extension === 'md'),
    getAllLoadedFiles: () => [...files.values()],
    cachedRead: async f => raw.get(f.path) ?? (await (await fetch(f.url)).text()),
    read: async f => raw.get(f.path) ?? (await (await fetch(f.url)).text()),
    getResourcePath: f => f.url || '',
    adapter: { exists: async p => files.has(p), read: async p => raw.get(p) ?? '' },
    getName: () => 'vault',
  });

  const metadataCache = Object.assign(new Events(), {
    getFirstLinkpathDest(linkpath, sourcePath) {
      let lp = String(linkpath ?? '').split('#')[0].trim();
      if (!lp) return sourcePath ? files.get(sourcePath) ?? null : null;
      const attempts = [lp, lp + '.md'];
      if (sourcePath && !lp.startsWith('/')) {
        const dir = sourcePath.split('/').slice(0, -1).join('/');
        if (dir) attempts.unshift(dir + '/' + lp, dir + '/' + lp + '.md');
      }
      for (const a of attempts) { const f = byPathLower.get(a.replace(/^\//, '').toLowerCase()); if (f) return f; }
      const name = lp.split('/').pop().toLowerCase();
      const noExt = name.replace(/\.md$/, '');
      return byLower.get(noExt) || byLower.get(name) || null;
    },
    fileToLinktext(file, sourcePath, omitMd = true) { return omitMd && file.extension === 'md' ? file.path.replace(/\.md$/, '') : file.path; },
    getFileCache(file) { const p = vault.pages.find(x => x.path === file.path); return p ? { frontmatter: p.fm } : null; },
    getCache() { return null; },
    resolvedLinks: {}, unresolvedLinks: {},
  });

  const app = { vault: vaultApi, metadataCache, fileManager: {}, keymap: {}, lastEvent: null };
  app.workspace = Object.assign(new Events(), {
    getActiveFile: () => null,
    openLinkText(linktext, sourcePath, newTab) {
      const f = metadataCache.getFirstLinkpathDest(linktext, sourcePath);
      if (!f || !f.url) return Promise.resolve();
      const hash = linktext.includes('#') ? '#' + slug(linktext.split('#').slice(1).join('#')) : '';
      if (newTab) window.open(f.url + hash, '_blank', 'noopener'); else location.href = f.url + hash;
      return Promise.resolve();
    },
    onLayoutReady: cb => cb(),
  });
  const render = makeRenderer(app);
  app.renderMarkdown = render;

  // markdown embeds for dc.LinkEmbed / dc.Embed
  class MarkdownEmbed extends Component {
    constructor(ctx, file, subpath) { super(); this.ctx = ctx; this.file = file; this.subpath = subpath; }
    async loadFile(file = this.file) {
      let text = (await vaultApi.cachedRead(file)).replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
      if (this.subpath) text = section(text, this.subpath.replace(/^#/, ''));
      this.ctx.containerEl.innerHTML = `<div class="markdown-embed"><div class="markdown-embed-content"><div class="markdown-preview-view markdown-rendered">${render(text, file.path)}</div></div></div>`;
    }
  }
  class ImageEmbed extends Component {
    constructor(ctx, file) { super(); this.ctx = ctx; this.file = file; }
    loadFile(file = this.file) { this.ctx.containerEl.innerHTML = `<img src="${vaultApi.getResourcePath(file)}" alt="${file.name}">`; }
  }
  app.embedRegistry = { getEmbedCreator: file => (/^(png|jpe?g|gif|webp|svg|avif)$/i.test(file.extension) ? ImageEmbed : MarkdownEmbed) };
  app.files = files;
  return app;
}

export const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
function section(body, sub) {
  const lines = body.split('\n'); const want = slug(sub);
  let start = -1, lvl = 0;
  for (let i = 0; i < lines.length; i++) { const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]); if (m && slug(m[2]) === want) { start = i; lvl = m[1].length; break; } }
  if (start < 0) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = /^(#{1,6})\s/.exec(lines[i]); if (m && m[1].length <= lvl) { end = i; break; } }
  return lines.slice(start, end).join('\n');
}

// ---------- MarkdownRenderer ----------
export function makeMarkdownRenderer(getApp) {
  const r = {
    async render(app, markdown, el, sourcePath, component) { el.innerHTML = (getApp().renderMarkdown)(markdown, sourcePath); },
    async renderMarkdown(markdown, el, sourcePath, component) { el.innerHTML = (getApp().renderMarkdown)(markdown, sourcePath); },
  };
  return r;
}
export { moment };
