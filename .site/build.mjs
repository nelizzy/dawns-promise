// Static site generator for an Obsidian vault.
// Renders notes with Obsidian-style DOM and reuses the vault's own theme / Style Settings /
// plugin CSS, and runs Datacore (datacorejsx) blocks in the browser via a small `dc` shim.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import markPlugin from 'markdown-it-mark';
import footnotePlugin from 'markdown-it-footnote';
import * as yaml from 'js-yaml';
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createDatacoreImporter } from './lib/datacore-worker.mjs';
import { buildCache } from './lib/obsidian-cache.mjs';
import { loadDatacoreSource, buildEngineBundle } from './lib/datacore-engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.VAULT || path.join(HERE, '..'));
const OUT = path.resolve(process.env.OUT || path.join(HERE, 'dist'));
const config = JSON.parse(fs.readFileSync(path.join(HERE, 'site.config.json'), 'utf8'));
if (config.timezone) process.env.TZ = config.timezone; // dates in notes are parsed in the author's timezone
const BASE = (process.env.SITE_BASE ?? config.base ?? '').replace(/\/+$/, '');
const OBS = path.resolve(process.env.OBSIDIAN_DIR || path.join(ROOT, '.obsidian'));

const EXCLUDE = new Set(['.obsidian', '.git', '.github', '.site', '.trash', 'node_modules', ...(config.exclude || [])]);
const ATTACH_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'pdf', 'mp3', 'mp4', 'webm', 'ogg', 'wav']);
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);

const readJSON = (p, d = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- icons (lucide) ----------
const ICON_DIR = path.join(HERE, 'node_modules/lucide-static/icons');
const iconCache = {};
function icon(name, cls = '') {
  const key = name + cls;
  if (iconCache[key] !== undefined) return iconCache[key];
  let svg = '';
  try {
    svg = fs.readFileSync(path.join(ICON_DIR, name + '.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
    svg = svg.replace(/class="[^"]*"/, `class="svg-icon lucide-${name}${cls ? ' ' + cls : ''}"`).replace(/ width="24" height="24"/, '');
  } catch { /* missing icon */ }
  return (iconCache[key] = svg);
}

// ---------- vault scan ----------
const notes = [];       // markdown notes
const attachments = []; // other files
const bases = [];       // .base files
const scripts = [];     // js/jsx/ts/tsx files (dc.require targets)
const SCRIPT_EXT = new Set(['js', 'jsx', 'ts', 'tsx']);
// Library folders (config.library) are never published, but their scripts/notes ship to the browser as data
// so Datacore's dc.require() can load shared components from them.
const LIBRARY = new Set(config.library || []);
const libraryFiles = [];
function walkLibrary(dir, rel) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const r = rel + '/' + ent.name;
    if (ent.isDirectory()) { walkLibrary(path.join(dir, ent.name), r); continue; }
    const ext = path.extname(ent.name).slice(1).toLowerCase();
    if (ext === 'md' || SCRIPT_EXT.has(ext)) libraryFiles.push({ path: r, ext, hidden: true });
  }
}
function walk(dir, rel = '') {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      if (!rel && EXCLUDE.has(ent.name)) { if (LIBRARY.has(ent.name)) walkLibrary(path.join(dir, ent.name), ent.name); continue; }
      walk(path.join(dir, ent.name), r);
    } else {
      const ext = path.extname(ent.name).slice(1).toLowerCase();
      if (ext === 'md') notes.push({ path: r });
      else if (ext === 'base') bases.push({ path: r });
      else if (SCRIPT_EXT.has(ext)) scripts.push({ path: r, ext });
      else if (ATTACH_EXT.has(ext)) attachments.push({ path: r, ext });
    }
  }
}
walk(ROOT);

const slugify = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const usedSlugs = new Set(['assets', 'attachments', 'data', 'graph', 'tags']);
function uniqueSlug(base) {
  let s = slugify(base) || 'note', n = 2, c = s;
  while (usedSlugs.has(c)) c = `${s}-${n++}`;
  usedSlugs.add(c);
  return c;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const INLINE_TAG_RE = /(^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

for (const n of notes) {
  n.raw = fs.readFileSync(path.join(ROOT, n.path), 'utf8').replace(/\r\n/g, '\n');
  n.name = path.basename(n.path, '.md');
  n.folder = path.dirname(n.path) === '.' ? '' : path.dirname(n.path);
  const m = FM_RE.exec(n.raw);
  n.fm = {};
  n.body = n.raw;
  if (m) {
    try { n.fm = yaml.load(m[1], { schema: yaml.CORE_SCHEMA }) || {}; } catch (e) { console.warn('bad frontmatter', n.path, e.message.split('\n')[0]); }
    if (typeof n.fm !== 'object' || Array.isArray(n.fm)) n.fm = {};
    n.body = n.raw.slice(m[0].length);
  }
  n.slug = n.name === config.home ? '' : uniqueSlug(n.name);
  n.url = BASE + '/' + (n.slug ? n.slug + '/' : '');
  n.mtime = (() => { try { return fs.statSync(path.join(ROOT, n.path)).mtimeMs; } catch { return 0; } })();
  const tags = new Set();
  let ft = n.fm.tags ?? n.fm.tag;
  if (typeof ft === 'string') ft = ft.split(/[,\s]+/);
  for (const t of Array.isArray(ft) ? ft : []) if (t != null && String(t).trim()) tags.add(String(t).replace(/^#/, ''));
  const stripped = n.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').replace(/%%[\s\S]*?%%/g, '');
  for (const mm of stripped.matchAll(INLINE_TAG_RE)) tags.add(mm[2]);
  n.tags = [...tags];
  let al = n.fm.aliases ?? n.fm.alias;
  if (typeof al === 'string') al = [al];
  n.aliases = Array.isArray(al) ? al.map(String) : [];
}
for (const a of attachments) {
  a.name = path.basename(a.path);
  a.url = BASE + '/attachments/' + a.path.split('/').map(encodeURIComponent).join('/');
}

// ---------- link resolution ----------
const byName = new Map(), byPath = new Map(), attByName = new Map(), attByPath = new Map();
for (const n of notes) {
  byName.set(n.name.toLowerCase(), byName.get(n.name.toLowerCase()) || n);
  byPath.set(n.path.toLowerCase().replace(/\.md$/, ''), n);
}
for (const a of attachments) { attByName.set(a.name.toLowerCase(), a); attByPath.set(a.path.toLowerCase(), a); }
function resolveNote(target) {
  const t = target.trim().replace(/\.md$/i, '').toLowerCase();
  if (!t) return null;
  if (t.includes('/')) { const p = byPath.get(t); if (p) return p; return byName.get(t.split('/').pop()) || null; }
  return byName.get(t) || null;
}
function resolveBase(target) {
  const t = target.trim().toLowerCase();
  return bases.find(b => b.path.toLowerCase() === t) || bases.find(b => b.name.toLowerCase() + '.base' === t.split('/').pop());
}
function resolveAttachment(target) {
  const t = target.trim().toLowerCase();
  return attByPath.get(t) || attByName.get(t.split('/').pop()) || null;
}
function parseTarget(s) {
  let [target, ...rest] = s.replace(/\\\|/g, '|').split('|');
  let alias = rest.length ? rest.join('|').trim() : null;
  let sub = null;
  const hi = target.indexOf('#');
  if (hi >= 0) { sub = target.slice(hi + 1).trim(); target = target.slice(0, hi); }
  return { target: target.trim(), sub, alias, raw: s };
}
const headingSlug = s => slugify(s.replace(/[\[\]]/g, '')) || 'section';

// ---------- tags ----------
const tagPath = t => String(t).replace(/^#/, '').split('/').map(slugify).filter(Boolean).join('/');
const tagHref = t => `${BASE}/tags/${tagPath(t)}/`;
const tagMap = new Map(); // tag (any level) -> Set(note)
function indexTags() {
  for (const n of notes) for (const t of n.tags) {
    const parts = t.split('/');
    for (let i = 1; i <= parts.length; i++) { const k = parts.slice(0, i).join('/'); if (!tagMap.has(k)) tagMap.set(k, new Set()); tagMap.get(k).add(n); }
  }
}

// ---------- file times (git history when available) ----------
function gitTimes() {
  const out = {};
  try {
    const shallow = execFileSync('git', ['-C', ROOT, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
    if (shallow) console.warn('[times] shallow git clone: file.ctime/mtime will be inaccurate (use fetch-depth: 0)');
    const txt = execFileSync('git', ['-c', 'core.quotepath=false', '-C', ROOT, 'log', '--relative', '--format=%x01%at', '--name-only', '--no-renames'], { encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] });
    let t = 0;
    for (const line of txt.split('\n')) {
      if (line.startsWith('\x01')) t = Number(line.slice(1)) * 1000;
      else if (line) { const e = (out[line] ||= { m: t, c: t }); e.c = t; }
    }
  } catch { /* not a git checkout */ }
  return out;
}
const GIT_TIMES = gitTimes();
function statOf(rel) {
  let st = { birthtimeMs: 0, mtimeMs: 0, size: 0 };
  try { st = fs.statSync(path.join(ROOT, rel)); } catch { /* ignore */ }
  const g = GIT_TIMES[rel];
  return { ctime: Math.round(g?.c ?? (st.birthtimeMs || st.mtimeMs)), mtime: Math.round(g?.m ?? st.mtimeMs), size: st.size };
}
for (const n of notes) { n.stat = statOf(n.path); n.mtime = n.stat.mtime; }
for (const a of attachments) a.stat = statOf(a.path);
for (const b of bases) { b.stat = statOf(b.path); b.text = fs.readFileSync(path.join(ROOT, b.path), 'utf8'); b.name = path.basename(b.path, '.base'); b.folder = path.dirname(b.path) === '.' ? '' : path.dirname(b.path); b.slug = uniqueSlug(b.name + ' base'); b.url = BASE + '/' + b.slug + '/'; b.isBase = true; }
for (const sc of [...scripts, ...libraryFiles]) { sc.stat = statOf(sc.path); sc.text = fs.readFileSync(path.join(ROOT, sc.path), 'utf8').replace(/\r\n/g, '\n'); }
const libraryNotes = libraryFiles.filter(f => f.ext === 'md').map(f => ({ path: f.path, raw: f.text, stat: f.stat, meta: buildCache(f.text) }));

// ---------- links / backlinks (Obsidian-style metadata, shared by Bases and Datacore) ----------
const pushUnique = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
for (const n of notes) { n.meta = buildCache(n.raw); n.links = []; n.embeds = []; n.backlinks = []; n.linkRefs = []; }
for (const n of notes) {
  const res = l => { const t = parseTarget(l.link).target; const sub = parseTarget(l.link).sub; const f = t ? (resolveNote(t) || resolveAttachment(t)) : n; return f ? f.path : null; };
  for (const l of n.meta.links || []) { const p = res(l); pushUnique(n.links, p); if (p) n.linkRefs.push({ path: p, line: l.position?.start?.line ?? null }); }
  for (const l of n.meta.embeds || []) pushUnique(n.embeds, res(l));
  for (const l of n.meta.frontmatterLinks || []) pushUnique(n.links, res(l));
}
for (const n of notes) for (const p of n.links) { const t = byPath.get(p.toLowerCase().replace(/\.md$/, '')); if (t && t !== n) pushUnique(t.backlinks, n.path); }

// ---------- theme / style settings ----------
function buildStyleSettings() {
  const appearance = readJSON(path.join(OBS, 'appearance.json'));
  const themeName = appearance.cssTheme;
  const out = { classes: ['theme-dark'], vars: '', css: '', accent: appearance.accentColor };
  let themeCSS = '';
  if (themeName) {
    try { themeCSS = fs.readFileSync(path.join(OBS, 'themes', themeName, 'theme.css'), 'utf8'); } catch { /* none */ }
  }
  out.css = themeCSS;
  const data = readJSON(path.join(OBS, 'plugins/obsidian-style-settings/data.json'));
  const m = themeCSS.match(/\/\*\s*@settings\s*([\s\S]*?)\*\//);
  if (!m) return out;
  let doc;
  try { doc = yaml.load(m[1].replace(/\t/g, '    ')); } catch (e) { console.warn('style settings parse failed:', e.message.split('\n')[0]); return out; }
  const sec = doc.id;
  const classes = new Set(['theme-dark']);
  let vars = '';
  const hexRgb = h => { const x = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(h); if (!x) return null; const n = parseInt(x[1], 16); return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`; };
  for (const s of doc.settings || []) {
    const key = `${sec}@@${s.id}`;
    switch (s.type) {
      case 'class-toggle': {
        const v = key in data ? data[key] : s.default;
        if (v) classes.add(s.id);
        break;
      }
      case 'class-select': {
        const v = key in data ? data[key] : s.default;
        if (v && v !== 'none') classes.add(v);
        break;
      }
      case 'variable-number': case 'variable-number-slider': {
        if (key in data) vars += `--${s.id}:${data[key]}${s.format || ''};`;
        break;
      }
      case 'variable-text': case 'variable-select': {
        if (key in data) vars += `--${s.id}:${data[key]};`;
        break;
      }
      case 'variable-themed-color': {
        const v = data[`${key}@@dark`];
        if (v && v !== '#') {
          vars += `--${s.id}:${v};`;
          for (const alt of s['alt-format'] || []) {
            if (alt.format === 'rgb-values') { const r = hexRgb(v); if (r) vars += `--${alt.id}:${r};`; }
          }
        }
        break;
      }
    }
  }
  out.classes = [...classes];
  out.vars = vars;
  return out;
}
const theme = buildStyleSettings();

// ---------- callouts ----------
const CALLOUT_ICONS = {
  note: 'pencil', abstract: 'clipboard-list', summary: 'clipboard-list', tldr: 'clipboard-list', info: 'info', todo: 'circle-check',
  tip: 'flame', hint: 'flame', important: 'flame', success: 'check', check: 'check', done: 'check', question: 'circle-help', help: 'circle-help', faq: 'circle-help',
  warning: 'triangle-alert', caution: 'triangle-alert', attention: 'triangle-alert', failure: 'x', fail: 'x', missing: 'x', danger: 'zap', error: 'zap',
  bug: 'bug', example: 'list', quote: 'quote', cite: 'quote',
};

// ---------- markdown rendering ----------
const state = { stack: [], dcBlocks: [], baseBlocks: [], page: null };

const DC_LANGS = new Set(['datacorejs', 'datacorejsx', 'datacorets', 'datacoretsx']);
const UNSUPPORTED_LANGS = {
  dataview: { plugin: 'dataview', label: 'Dataview' }, dataviewjs: { plugin: 'dataview', label: 'Dataview' },
  tasks: { plugin: 'obsidian-tasks-plugin', label: 'Tasks' }, 'meta-bind': { plugin: 'obsidian-meta-bind-plugin', label: 'Meta Bind' },
  'meta-bind-js-view': { plugin: 'obsidian-meta-bind-plugin', label: 'Meta Bind' }, button: { plugin: 'buttons', label: 'Buttons' },
  templater: { plugin: 'templater-obsidian', label: 'Templater' }, mermaid: null,
};
const INSTALLED_PLUGINS = new Set(readJSON(path.join(OBS, 'community-plugins.json'), []));
const warnings = [];
function warn(msg) { warnings.push(msg); console.warn('[warn] ' + msg); }
function baseBlockHTML(spec) {
  const id = state.baseBlocks.length;
  state.baseBlocks.push({ id, source: state.page?.path ?? '', ...spec });
  return `<div class="block-language-base bases-embed-block base-block" data-base-id="${id}"></div>\n`;
}

function makeMd() {
  const md = new MarkdownIt({ html: true, breaks: true, linkify: true });
  md.use(markPlugin).use(footnotePlugin);

  // wikilinks and image/inline embeds
  md.inline.ruler.before('link', 'wikilink', (st, silent) => {
    const src = st.src, start = st.pos;
    const isEmbed = src.charCodeAt(start) === 0x21;
    const open = isEmbed ? start + 1 : start;
    if (src.slice(open, open + 2) !== '[[') return false;
    const end = src.indexOf(']]', open + 2);
    if (end < 0) return false;
    const inner = src.slice(open + 2, end);
    if (!inner || inner.includes('\n') || inner.includes('[[')) return false;
    if (!silent) {
      const t = st.push('wikilink', '', 0);
      t.meta = { ...parseTarget(inner), embed: isEmbed };
    }
    st.pos = end + 2;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, i) => renderWikilink(tokens[i].meta);

  // inline #tags
  md.inline.ruler.before('emphasis', 'obstag', (st, silent) => {
    if (st.src.charCodeAt(st.pos) !== 0x23) return false;
    if (st.pos > 0 && !/[\s(]/.test(st.src[st.pos - 1])) return false;
    const m = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(st.src.slice(st.pos));
    if (!m) return false;
    if (!silent) { const t = st.push('obstag', '', 0); t.content = m[1]; }
    st.pos += m[0].length;
    return true;
  });
  md.renderer.rules.obstag = (tokens, i) => `<a href="${tagHref(tokens[i].content)}" class="tag" data-tag="${esc(tokens[i].content)}">#${esc(tokens[i].content)}</a>`;

  // block-level note embeds: a line that is only ![[Note]]
  md.block.ruler.before('paragraph', 'wikiembed', (st, startLine, endLine, silent) => {
    const pos = st.bMarks[startLine] + st.tShift[startLine], max = st.eMarks[startLine];
    if (st.sCount[startLine] - st.blkIndent >= 4) return false;
    const m = /^!\[\[([^\]]+)\]\]\s*$/.exec(st.src.slice(pos, max));
    if (!m) return false;
    const t = parseTarget(m[1]);
    if (/\.base$/i.test(t.target)) {
      const b = resolveBase(t.target);
      if (silent) return true;
      const tok = st.push('html_block', '', 0);
      tok.content = b ? baseBlockHTML({ kind: 'file', path: b.path, view: t.sub || null, title: t.alias || null }) : `<div class="internal-embed is-unresolved">${esc(t.target)}</div>\n`;
      if (!b) warn(`${state.page?.path}: embed ![[${t.target}]] points at a missing .base file`);
      tok.map = [startLine, startLine + 1];
      st.line = startLine + 1;
      return true;
    }
    const note = t.target ? resolveNote(t.target) : state.page;
    if (!note) return false;
    if (silent) return true;
    const tok = st.push('html_block', '', 0);
    tok.content = renderEmbed(note, t) + '\n';
    tok.map = [startLine, startLine + 1];
    st.line = startLine + 1;
    return true;
  });

  // external vs internal links
  const defLinkOpen = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
    const href = tokens[i].attrGet('href') || '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      tokens[i].attrJoin('class', 'external-link');
      tokens[i].attrSet('target', '_blank');
      tokens[i].attrSet('rel', 'noopener nofollow');
    }
    return defLinkOpen(tokens, i, opts, env, self);
  };

  // code fences
  md.renderer.rules.fence = (tokens, i) => {
    const tok = tokens[i];
    const lang = (tok.info || '').trim().split(/\s+/)[0];
    if (DC_LANGS.has(lang)) {
      const id = state.dcBlocks.length;
      state.dcBlocks.push({ id, lang, code: tok.content, path: state.page?.path });
      return `<div class="block-language-${lang} datacore-block" data-dc-id="${id}"></div>\n`;
    }
    if (lang === 'base') return baseBlockHTML({ kind: 'inline', text: tok.content });
    const need = UNSUPPORTED_LANGS[lang.toLowerCase()];
    if (need && INSTALLED_PLUGINS.has(need.plugin)) {
      warn(`${state.page?.path}: \`\`\`${lang} block needs the "${need.plugin}" plugin, which the published site cannot run`);
      return `<div class="site-unsupported callout" data-callout="warning"><div class="callout-title"><div class="callout-icon">${icon('triangle-alert')}</div><div class="callout-title-inner">Not available on the published site</div></div><div class="callout-content"><p>This <code>${esc(lang)}</code> block needs the ${esc(need.label)} plugin, which can only run inside Obsidian.</p></div></div>\n<pre class="language-${esc(lang)}"><code class="language-${esc(lang)}">${esc(tok.content)}</code></pre>\n`;
    }
    return `<pre class="language-${esc(lang || 'none')}"><code class="language-${esc(lang || 'none')}">${esc(tok.content)}</code></pre>\n`;
  };
  md.renderer.rules.code_block = (tokens, i) => `<pre><code>${esc(tokens[i].content)}</code></pre>\n`;

  // headings: data-heading + id
  md.renderer.rules.heading_open = (tokens, i) => {
    const t = tokens[i], inline = tokens[i + 1];
    const text = inline.content.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*_`]/g, '');
    return `<${t.tag} data-heading="${esc(text)}" dir="auto" class="heading" id="${esc(headingSlug(text))}">`;
  };

  // tables / task lists / callouts / top-level wrappers
  md.core.ruler.push('obsidian', st => {
    const toks = st.tokens;
    // task lists
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== 'inline' || i < 2 || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue;
      const m = /^\[(.)\][ \t]+/.exec(t.content);
      if (!m) continue;
      const done = m[1] !== ' ';
      toks[i - 2].attrJoin('class', 'task-list-item');
      toks[i - 2].attrSet('data-task', m[1]);
      if (done) toks[i - 2].attrJoin('class', 'is-checked');
      t.content = t.content.slice(m[0].length);
      if (t.children?.[0]?.type === 'text') t.children[0].content = t.children[0].content.replace(/^\[.\][ \t]+/, '');
      const cb = new st.Token('html_inline', '', 0);
      cb.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${done ? ' checked' : ''}> `;
      t.children.unshift(cb);
    }
    // callouts
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'blockquote_open') continue;
      const p = toks[i + 1], inl = toks[i + 2];
      if (!p || p.type !== 'paragraph_open' || !inl || inl.type !== 'inline') continue;
      const m = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/.exec(inl.content);
      if (!m) continue;
      const type = m[1].toLowerCase(), fold = m[2];
      const titleText = m[3].trim() || type.charAt(0).toUpperCase() + type.slice(1);
      const rest = inl.content.slice(m[0].length);
      // find matching close
      let depth = 0, close = -1;
      for (let j = i; j < toks.length; j++) {
        if (toks[j].type === 'blockquote_open') depth++;
        else if (toks[j].type === 'blockquote_close' && --depth === 0) { close = j; break; }
      }
      if (close < 0) continue;
      const bq = toks[i];
      bq.tag = 'div'; toks[close].tag = 'div';
      bq.attrSet('class', `callout${fold ? ' is-collapsible' : ''}${fold === '-' ? ' is-collapsed' : ''}`);
      bq.attrSet('data-callout', type);
      if (fold) bq.attrSet('data-callout-fold', fold);
      const head = new st.Token('html_block', '', 0);
      head.content = `<div class="callout-title"><div class="callout-icon">${icon(CALLOUT_ICONS[type] || 'pencil')}</div><div class="callout-title-inner">${esc(titleText)}</div>${fold ? `<div class="callout-fold${fold === '-' ? ' is-collapsed' : ''}">${icon('chevron-down')}</div>` : ''}</div><div class="callout-content">`;
      const tail = new st.Token('html_block', '', 0);
      tail.content = '</div>';
      if (rest.trim()) {
        inl.content = rest;
        inl.children = [];
        st.md.inline.parse(rest, st.md, st.env, inl.children);
        toks.splice(i + 1, 0, head);
      } else {
        // drop the title-only paragraph
        toks.splice(i + 1, 3, head);
        close -= 3;
      }
      const ci = rest.trim() ? close + 1 : close - 2;
      toks.splice(ci, 0, tail);
    }
    // top-level wrappers (el-*)
    const out = [];
    let level = 0;
    for (const t of toks) {
      if (t.nesting === 1 && t.level === 0) {
        const kind = t.tag === 'table' ? 'table' : t.type === 'heading_open' ? t.tag : t.tag || 'p';
        const w = new st.Token('html_block', '', 0);
        w.content = `<div class="el-${kind}${t.type === 'heading_open' ? ' heading-wrapper' : ''}">`;
        out.push(w, t); level = 1;
      } else if (t.nesting === -1 && t.level === 0) {
        out.push(t);
        const w = new st.Token('html_block', '', 0);
        w.content = '</div>';
        out.push(w);
      } else if (t.nesting === 0 && t.level === 0 && (t.type === 'hr' || t.type === 'fence' || t.type === 'code_block' || t.type === 'html_block')) {
        const kind = t.type === 'hr' ? 'hr' : t.type === 'html_block' ? 'html' : 'pre';
        if (t.type === 'html_block' && /^<div class="el-/.test(t.content)) { out.push(t); continue; }
        const a = new st.Token('html_block', '', 0), b = new st.Token('html_block', '', 0);
        a.content = `<div class="el-${kind}">`; b.content = '</div>';
        out.push(a, t, b);
      } else out.push(t);
    }
    st.tokens = out;
  });
  return md;
}
const md = makeMd();

function renderWikilink(t) {
  const { target, sub, alias, embed } = t;
  if (embed) {
    const ext = path.extname(target).slice(1).toLowerCase();
    if (ATTACH_EXT.has(ext)) {
      const att = resolveAttachment(target);
      if (!att) return `<span class="internal-embed image-embed is-unresolved" src="${esc(target)}">${esc(target)}</span>`;
      if (IMG_EXT.has(ext)) {
        const size = alias && /^\d+(x\d+)?$/.test(alias) ? alias : null;
        const [w, h] = size ? size.split('x') : [];
        return `<span class="internal-embed image-embed is-loaded" src="${esc(target)}" alt="${esc(target)}"><img alt="${esc(target)}" src="${att.url}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}></span>`;
      }
      if (ext === 'pdf') return `<span class="internal-embed pdf-embed is-loaded" src="${esc(target)}"><iframe src="${att.url}" style="width:100%;height:600px;border:0"></iframe></span>`;
      if (['mp4', 'webm'].includes(ext)) return `<span class="internal-embed media-embed is-loaded"><video controls src="${att.url}"></video></span>`;
      return `<span class="internal-embed media-embed is-loaded"><audio controls src="${att.url}"></audio></span>`;
    }
    // inline (mid-paragraph) note embed: fall back to a link
  }
  const note = target ? resolveNote(target) : state.page;
  const label = alias ?? (target ? target + (sub ? ' > ' + sub : '') : sub || '');
  if (!note) return `<a class="internal-link is-unresolved" data-href="${esc(target)}">${esc(label)}</a>`;
  let href = note.url + (sub && !sub.startsWith('^') ? '#' + headingSlug(sub) : '');
  return `<a href="${href}" class="internal-link" data-href="${esc(target)}">${esc(label)}</a>`;
}

// Extract the section under a heading from a note body
function sectionOf(body, sub) {
  const lines = body.split('\n');
  const want = headingSlug(sub);
  let start = -1, lvl = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (m && headingSlug(m[2]) === want) { start = i; lvl = m[1].length; break; }
  }
  if (start < 0) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= lvl) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

function renderEmbed(note, t) {
  if (state.stack.includes(note.path) || state.stack.length >= 5) {
    return `<div class="markdown-embed"><a href="${note.url}" class="internal-link">${esc(note.name)}</a></div>`;
  }
  let body = note.body;
  if (t.sub && !t.sub.startsWith('^')) body = sectionOf(body, t.sub);
  const prevPage = state.page;
  state.stack.push(note.path);
  state.page = note;
  let html;
  try { html = renderBody(body); } finally { state.stack.pop(); state.page = prevPage; }
  const title = esc(t.alias || note.name);
  return `<div class="internal-embed markdown-embed inline-embed is-loaded" src="${esc(note.name)}" alt="${esc(note.name)}">` +
    `<div class="embed-title markdown-embed-title">${title}</div>` +
    `<div class="markdown-embed-content"><div class="markdown-preview-view markdown-rendered"><div class="markdown-preview-sizer markdown-preview-section">${html}</div></div></div>` +
    `<div class="markdown-embed-link" aria-label="Open link"><a href="${note.url}" aria-label="Open ${esc(note.name)}">${icon('link')}</a></div></div>`;
}

// ---------- Advanced Multi Column ----------
const COL_START = /^%%\s*col-start(?:\s*:(.*?))?\s*%%$/;
const COL_BREAK = /^%%\s*col-break(?:\s*:(.*?))?\s*%%$/;
const COL_END = /^%%\s*col-end\s*%%$/;
const BG = {
  transparent: 'var(--amc-bg-transparent, transparent)', primary: 'var(--amc-bg-primary, var(--background-primary))',
  secondary: 'var(--amc-bg-secondary, var(--background-secondary))', alt: 'var(--amc-bg-alt, var(--background-primary-alt))',
  'accent-soft': 'var(--amc-bg-accent-soft, color-mix(in srgb, var(--interactive-accent) 14%, transparent))',
  'red-soft': 'var(--amc-bg-red-soft, rgba(239, 68, 68, 0.14))', 'orange-soft': 'var(--amc-bg-orange-soft, rgba(245, 158, 11, 0.14))',
  'yellow-soft': 'var(--amc-bg-yellow-soft, rgba(234, 179, 8, 0.14))', 'green-soft': 'var(--amc-bg-green-soft, rgba(34, 197, 94, 0.14))',
  'cyan-soft': 'var(--amc-bg-cyan-soft, rgba(6, 182, 212, 0.14))', 'blue-soft': 'var(--amc-bg-blue-soft, rgba(59, 130, 246, 0.14))',
  'pink-soft': 'var(--amc-bg-pink-soft, rgba(236, 72, 153, 0.14))',
};
const FG = {
  gray: 'var(--amc-color-gray, var(--background-modifier-border))', accent: 'var(--amc-color-accent, var(--interactive-accent))',
  muted: 'var(--amc-color-muted, var(--text-muted))', text: 'var(--amc-color-text, var(--text-normal))',
  secondary: 'var(--amc-color-secondary, var(--background-secondary))', red: 'var(--amc-color-red, #ef4444)', orange: 'var(--amc-color-orange, #f59e0b)',
  yellow: 'var(--amc-color-yellow, #eab308)', green: 'var(--amc-color-green, #22c55e)', cyan: 'var(--amc-color-cyan, #06b6d4)',
  blue: 'var(--amc-color-blue, #3b82f6)', pink: 'var(--amc-color-pink, #ec4899)',
};
const truthy = v => ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()) ? true : ['0', 'false', 'no', 'off'].includes(String(v).toLowerCase()) ? false : null;
function parseStyle(parts) {
  const st = {};
  for (const e of parts) {
    const i = e.indexOf(':'); if (i <= 0) continue;
    const k = e.slice(0, i).trim().toLowerCase(), v = e.slice(i + 1).trim(); if (!v) continue;
    switch (k) {
      case 'b': if (BG[v]) st.background = v; break;
      case 'bc': if (FG[v]) st.borderColor = v; break;
      case 't': case 'tc': if (FG[v]) st.textColor = v; break;
      case 'sb': { const b = truthy(v); if (b !== null) st.showBorder = b; break; }
      case 'h': case 'hd': { const b = truthy(v); if (b !== null) st.horizontalDividers = b; break; }
      case 'sep': { const b = truthy(v); if (b !== null) st.separator = b; break; }
      case 'sc': if (FG[v]) st.separatorColor = v; break;
      case 'ss': if (['solid', 'dashed', 'dotted', 'double', 'custom'].includes(v)) st.separatorStyle = v; break;
      case 'sw': { const n = parseInt(v, 10); if (n >= 1 && n <= 8) st.separatorWidth = n; break; }
      case 'sx': if (v.length <= 3) st.separatorCustomChar = v; break;
      case 'lb': { const b = truthy(v); if (b !== null) st.leftBorder = b; break; }
    }
  }
  return Object.keys(st).length ? st : undefined;
}
function parseBreakOpts(s) {
  if (!s) return { width: 0 };
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  let width = 0, stacked, first = false; const rest = [];
  for (const p of parts) {
    if (!first) {
      first = true;
      if (/^\d+$/.test(p)) { width = Math.min(100, parseInt(p, 10)); continue; }
      if (p.startsWith('w:')) { const n = parseInt(p.slice(2), 10); if (n > 0) { width = Math.min(100, n); continue; } }
    }
    if (p.startsWith('stk:')) { const v = p.slice(4), b = truthy(v); if (b !== null) stacked = b ? 1 : 0; else { const n = parseInt(v, 10); if (n >= 0) stacked = n; } continue; }
    rest.push(p);
  }
  const o = { width, style: parseStyle(rest) };
  if (stacked) o.stacked = stacked;
  return o;
}
function parseStartOpts(s) {
  if (!s) return {};
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  let layout; const rest = [];
  for (const p of parts) {
    if (p.startsWith('l:')) { const v = p.slice(2).trim(); if (v === 'row' || v === 'stack') layout = v; }
    else if (p.startsWith('moc:')) { /* MOC not supported */ }
    else rest.push(p);
  }
  return { containerStyle: parseStyle(rest), layout };
}
function styleVars(style, kind) {
  if (!style) return '';
  const v = {};
  if (kind === 'col') {
    if (style.background) v['--columns-col-bg'] = BG[style.background];
    if (style.textColor) v['--columns-col-text'] = FG[style.textColor];
    if (style.showBorder !== undefined || style.horizontalDividers !== undefined || style.borderColor !== undefined) {
      v['--columns-col-border-color'] = FG[style.borderColor ?? 'gray'];
      v['--columns-col-border-width'] = (style.showBorder ?? (style.borderColor !== undefined)) ? '1px' : '0px';
      if (style.horizontalDividers) v['--columns-col-horizontal-width'] = '1px';
    }
    if (style.separator) {
      v['--columns-col-sep-color'] = FG[style.separatorColor ?? 'gray'];
      v['--columns-col-sep-width'] = `${style.separatorWidth ?? 1}px`;
      if (style.separatorStyle && style.separatorStyle !== 'custom') v['--columns-col-sep-style'] = style.separatorStyle;
    }
  } else {
    if (style.background) v['--columns-block-bg'] = BG[style.background];
    if (style.textColor) v['--columns-block-text'] = FG[style.textColor];
    if (style.borderColor) v['--columns-block-border-color'] = FG[style.borderColor];
    const sb = style.showBorder ?? (style.borderColor !== undefined ? true : undefined);
    if (sb !== undefined) v['--columns-block-border-width'] = sb ? 'max(1px, var(--amc-container-border-width, 1px))' : '0px';
    if (style.horizontalDividers) v['--columns-block-horizontal-width'] = '1px';
  }
  return Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');
}
function separatorHTML(style) {
  if (!style?.separator) return '';
  const color = FG[style.separatorColor ?? 'gray'];
  if (style.separatorStyle === 'custom' && style.separatorCustomChar) {
    return `<div class="column-separator-custom" style="--sep-color:${color};${style.separatorWidth ? `--sep-size:${style.separatorWidth * 6 + 6}px` : ''}">${esc(style.separatorCustomChar)}</div>`;
  }
  return `<div class="column-separator-visual" style="--sep-color:${color};${style.separatorWidth ? `--sep-width:${style.separatorWidth}px;` : ''}${style.separatorStyle && style.separatorStyle !== 'custom' ? `--sep-style:${style.separatorStyle}` : ''}"></div>`;
}
// Find top-level column blocks in text (supports nesting)
function findColumnBlocks(text) {
  const lines = text.split('\n'), blocks = [];
  let i = 0;
  const isInFence = (() => { let f = false; return line => { if (/^\s{0,3}(```|~~~)/.test(line)) f = !f; return f; }; })();
  const fenced = lines.map(l => isInFence(l));
  while (i < lines.length) {
    const m = !fenced[i] && COL_START.exec(lines[i].trim());
    if (!m) { i++; continue; }
    let depth = 0, end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (fenced[j]) continue;
      const s = lines[j].trim();
      if (COL_START.test(s)) depth++;
      else if (COL_END.test(s)) { if (depth === 0) { end = j; break; } depth--; }
    }
    if (end < 0) { i++; continue; }
    blocks.push({ from: i, to: end, opts: m[1] });
    i = end + 1;
  }
  return { lines, blocks };
}
function splitColumns(inner) {
  // inner: lines strictly between col-start and col-end
  const cols = []; let cur = null, depth = 0;
  for (const line of inner) {
    const s = line.trim();
    if (COL_START.test(s)) depth++;
    else if (COL_END.test(s)) depth--;
    const mb = depth === 0 ? COL_BREAK.exec(s) : null;
    if (mb) { if (cur) cols.push(cur); cur = { opts: mb[1], lines: [] }; }
    else if (cur) cur.lines.push(line);
  }
  if (cur) cols.push(cur);
  return cols;
}
function renderColumnBlock(lines, blk, level) {
  const inner = lines.slice(blk.from + 1, blk.to);
  const cols = splitColumns(inner).map(c => ({ ...parseBreakOpts(c.opts), content: c.lines.join('\n').trim() }));
  if (!cols.length) return '';
  const total = cols.reduce((a, c) => a + c.width, 0);
  if (total > 100) cols.forEach(c => (c.width = 0));
  const { containerStyle, layout } = parseStartOpts(blk.opts);
  const stack = layout === 'stack';
  const groups = [];
  for (let k = 0; k < cols.length;) {
    const s = cols[k].stacked;
    if (s && s > 0) { const a = k; while (k < cols.length && cols[k].stacked === s) k++; groups.push({ idx: Array.from({ length: k - a }, (_, x) => a + x), isStack: true }); }
    else { groups.push({ idx: [k], isStack: false }); k++; }
  }
  const useGroups = stack ? [{ idx: cols.map((_, x) => x), isStack: true }] : groups;
  const cvars = styleVars(containerStyle, 'block');
  let html = `<div class="columns-container columns-ui columns-reading${stack ? ' columns-stacked' : ''}${containerStyle ? ' columns-custom-style' : ''}${level > 0 ? ' columns-nested' : ''}"${cvars ? ` style="${cvars}"` : ''}>`;
  let prevLast = null, prevNoDivider = false;
  useGroups.forEach((g, gi) => {
    if (gi > 0) {
      const sep = separatorHTML(prevLast?.style);
      html += sep;
      prevNoDivider = prevLast?.style?.separator === false;
    }
    const wrapStack = g.isStack && !stack && g.idx.length > 0;
    if (wrapStack) {
      const maxW = Math.max(...g.idx.map(x => cols[x].width));
      const flex = maxW > 0 ? ` style="flex:0 1 calc(${maxW}% - ${(((useGroups.length - 1) * 8) / useGroups.length).toFixed(1)}px)"` : '';
      html += `<div class="columns-stack-group${prevNoDivider ? ' amc-no-divider-before' : ''}"${flex}>`;
    }
    g.idx.forEach((x, wi) => {
      const c = cols[x];
      if (wi > 0 && g.isStack) html += separatorHTML(cols[g.idx[wi - 1]].style);
      const vars = styleVars(c.style, 'col');
      let flex = '';
      if (!g.isStack && !stack && c.width > 0) flex = `flex:0 1 calc(${c.width}% - ${(((useGroups.length - 1) * 8) / useGroups.length).toFixed(1)}px)`;
      const style = [vars, flex].filter(Boolean).join(';');
      html += `<div class="column-item${c.style ? ' columns-custom-style' : ''}${c.style?.leftBorder ? ' columns-left-border' : ''}${wi === 0 && !wrapStack && gi > 0 && prevNoDivider ? ' amc-no-divider-before' : ''}" data-col-index="${x}"${style ? ` style="${style}"` : ''}>`;
      html += `<div class="column-preview markdown-rendered">${c.content ? renderWithColumns(c.content, level + 1) : ''}</div></div>`;
    });
    if (wrapStack) html += '</div>';
    prevLast = cols[g.idx[g.idx.length - 1]];
  });
  return html + '</div>';
}
function renderWithColumns(text, level = 0) {
  const { lines, blocks } = findColumnBlocks(text);
  if (!blocks.length || level > 8) return renderPlain(text);
  let html = '', cursor = 0;
  for (const b of blocks) {
    const before = lines.slice(cursor, b.from).join('\n');
    if (before.trim()) html += renderPlain(before);
    html += `<div class="columns-rv-wrapper">${renderColumnBlock(lines, b, level)}</div>`;
    cursor = b.to + 1;
  }
  const after = lines.slice(cursor).join('\n');
  if (after.trim()) html += renderPlain(after);
  return html;
}
function renderPlain(text) {
  // strip %% comments %%
  text = text.replace(/%%[\s\S]*?%%/g, '');
  return md.render(text);
}
function renderBody(body) { return renderWithColumns(body, 0); }

// ---------- properties ----------
const propTypes = readJSON(path.join(OBS, 'types.json')).types || {};
function propertiesHTML(fm) {
  const keys = Object.keys(fm);
  if (!keys.length) return '';
  const rows = keys.map(k => {
    const v = fm[k];
    let type = propTypes[k];
    if (!type) type = Array.isArray(v) ? 'multitext' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'checkbox' : /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? 'date' : 'text';
    const iconName = { tags: 'tags', aliases: 'forward', multitext: 'list', number: 'binary', checkbox: 'check-square', date: 'calendar', text: 'align-left' }[type] || 'align-left';
    let value;
    if (type === 'tags' || type === 'aliases' || type === 'multitext') {
      const arr = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String);
      value = `<div class="multi-select-container">${arr.map(x => type === 'tags' ? `<a class="multi-select-pill tag" href="${tagHref(x)}"><span class="multi-select-pill-content"><span>${esc(String(x).replace(/^#/, ''))}</span></span></a>` : `<div class="multi-select-pill"><div class="multi-select-pill-content"><span>${esc(x)}</span></div></div>`).join('')}</div>`;
    } else if (type === 'checkbox') {
      value = `<input class="metadata-input-checkbox" type="checkbox" disabled${v ? ' checked' : ''}>`;
    } else {
      value = `<div class="metadata-input-longtext mod-truncate">${esc(v ?? '')}</div>`;
    }
    return `<div class="metadata-property" data-property-key="${esc(k)}" data-property-type="${type}"><div class="metadata-property-key"><span class="metadata-property-icon">${icon(iconName)}</span><input class="metadata-property-key-input" type="text" value="${esc(k)}" readonly></div><div class="metadata-property-value">${value}</div></div>`;
  });
  return `<div class="mod-header mod-ui"><div class="metadata-container is-collapsed"><div class="metadata-properties-heading"><div class="collapse-indicator collapse-icon">${icon('chevron-down')}</div><div class="metadata-properties-title">Properties</div></div><div class="metadata-content"><div class="metadata-properties">${rows.join('')}</div></div></div></div>`;
}

// ---------- nav ----------
function buildNavTree() {
  const root = { folders: new Map(), files: [] };
  for (const n of [...notes, ...bases]) {
    const parts = n.folder ? n.folder.split('/') : [];
    let cur = root;
    for (const p of parts) { if (!cur.folders.has(p)) cur.folders.set(p, { folders: new Map(), files: [] }); cur = cur.folders.get(p); }
    cur.files.push(n);
  }
  const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const render = (node, name, depth) => {
    let h = '';
    for (const [fname, sub] of [...node.folders].sort((a, b) => cmp(a[0], b[0]))) {
      h += `<div class="tree-item nav-folder is-collapsed" data-folder="${esc(fname)}"><div class="tree-item-self is-clickable mod-collapsible nav-folder-title"><div class="tree-item-icon collapse-icon nav-folder-collapse-indicator is-collapsed">${icon('chevron-right')}</div><div class="tree-item-inner nav-folder-title-content">${esc(fname)}</div></div><div class="tree-item-children nav-folder-children">${render(sub, fname, depth + 1)}</div></div>`;
    }
    for (const n of [...node.files].sort((a, b) => cmp(a.name, b.name))) {
      h += `<div class="tree-item nav-file" data-path="${esc(n.path)}"><a class="tree-item-self is-clickable nav-file-title" href="${n.url}"><div class="tree-item-inner nav-file-title-content">${esc(n.name)}</div>${n.isBase ? '<div class="nav-file-tag">base</div>' : ''}</a></div>`;
    }
    return h;
  };
  return render(root, '', 0);
}
const navHTML = buildNavTree();

// ---------- page template ----------
function accentToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(((h * 60) + 360) % 360);
  return { h, s: Math.round(sat * 100), l: Math.round(l * 100) };
}
const hsl = accentToHsl(theme.accent);
const accentVars = hsl ? `body{--accent-h:${hsl.h};--accent-s:${hsl.s}%;--accent-l:${hsl.l}%;}` : '';
const siteTitle = config.title || 'Notes';
const bodyClasses = ['css-settings-manager', ...theme.classes, 'is-mobile-no', 'mod-linux'].join(' ');
function descriptionOf(n) {
  const t = n.body.replace(/```[\s\S]*?```/g, '').replace(/%%[\s\S]*?%%/g, '').replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 200);
}
function pageHTML(n, bodyHtml, dcScripts, baseSpecs) {
  const hasDc = dcScripts.length > 0 || baseSpecs.length > 0;
  const crumbs = n.folder ? n.folder.split('/').map(f => `<span class="view-header-breadcrumb">${esc(f)}</span><span class="view-header-breadcrumb-separator">/</span>`).join('') : '';
  const needle = `<div class="tree-item nav-file" data-path="${esc(n.path)}"><a class="tree-item-self is-clickable nav-file-title"`;
  const nav = navHTML.split(needle).join(`<div class="tree-item nav-file" data-path="${esc(n.path)}"><a class="tree-item-self is-clickable nav-file-title is-active"`);
  const title = n.slug === '' ? siteTitle : `${n.name} · ${siteTitle}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(descriptionOf(n))}">
<meta property="og:title" content="${esc(n.name)}">
<meta property="og:site_name" content="${esc(siteTitle)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8C%85%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${BASE}/assets/site.css">
<style id="css-settings-manager">body.theme-dark{${theme.vars}}${accentVars}</style>
</head>
<body class="${bodyClasses}" data-base="${BASE}">
<div class="app-container">
<div class="horizontal-main-container">
<div class="workspace is-left-sidedock-open">
<div class="workspace-split mod-vertical mod-left-split site-sidebar" id="site-sidebar">
<div class="workspace-tabs mod-top mod-top-left-space"><div class="workspace-leaf mod-active"><div class="workspace-leaf-content" data-type="file-explorer">
<div class="nav-header"><div class="site-title"><a href="${BASE}/">${esc(siteTitle)}</a><div class="site-title-tools"><a class="clickable-icon" href="${BASE}/graph/" aria-label="Graph view">${icon('git-fork')}</a><a class="clickable-icon" href="${BASE}/tags/" aria-label="Tags">${icon('tags')}</a></div></div>
<div class="search-input-container"><input id="site-search" type="search" placeholder="Search notes..." enterkeyhint="search" spellcheck="false" autocomplete="off"><div class="search-input-clear-button" aria-label="Clear search"></div></div></div>
<div class="nav-files-container node-insert-event">${nav}</div>
</div></div></div></div>
<div class="workspace-split mod-vertical mod-root">
<div class="workspace-tabs mod-top mod-active"><div class="workspace-leaf mod-active"><div class="workspace-leaf-content" data-type="markdown" data-mode="preview" data-state-title="${esc(n.name)}">
<div class="view-header view-header-always-show"><button class="clickable-icon site-menu-button" id="site-menu" aria-label="Toggle navigation">${icon('panel-left')}</button><div class="view-header-title-container mod-at-start"><div class="view-header-title-parent">${crumbs}</div><div class="view-header-title">${esc(n.name)}</div></div></div>
<div class="view-content"><div class="markdown-reading-view"><div class="markdown-preview-view markdown-rendered is-readable-line-width allow-fold-headings allow-fold-lists show-indentation-guide"><div class="markdown-preview-sizer markdown-preview-section">${propertiesHTML(n.fm)}${bodyHtml}</div></div></div></div>
</div></div></div></div>
</div></div></div>
<div class="site-scrim" id="site-scrim"></div>
${hasDc ? `<script>window.__PAGE=${JSON.stringify({ path: n.path, dc: dcScripts, bases: baseSpecs }).replace(/</g, '\\u003c')};</script>` : ''}
<script src="${BASE}/assets/app.js" defer></script>
</body></html>`;
}

// ---------- build ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

indexTags();
const plain = t => t.replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~=>#]/g, '').replace(/^\s*[-+]\s+(\[.\]\s+)?/, '').replace(/%%.*?%%/g, '').trim();
const noteByPath = new Map(notes.map(n => [n.path, n]));
function linksPane(n) {
  const back = n.backlinks.map(p => noteByPath.get(p)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const out = n.links.map(p => noteByPath.get(p) || bases.find(b => b.path === p)).filter(Boolean);
  const item = (t, snippet) => `<div class="tree-item search-result"><a class="tree-item-self search-result-file-title is-clickable" href="${t.url}"><div class="tree-item-inner">${esc(t.name)}</div></a>${snippet ? `<div class="search-result-file-matches"><div class="search-result-file-match">${esc(snippet.slice(0, 220))}</div></div>` : ''}</div>`;
  const backHtml = back.map(b => {
    const ref = b.linkRefs.find(r => r.path === n.path && r.line != null);
    const line = ref ? plain(b.raw.split('\n')[ref.line] || '') : '';
    return item(b, line);
  }).join('');
  const outHtml = out.map(o => item(o)).join('');
  const sec = (title, count, body, open) => `<details class="tree-item site-links-section"${open ? ' open' : ''}><summary class="tree-item-self is-clickable"><span class="tree-item-icon collapse-icon">${icon('chevron-down')}</span><span class="tree-item-inner">${title}</span><span class="tree-item-flair-outer"><span class="tree-item-flair">${count}</span></span></summary><div class="tree-item-children">${body || '<div class="search-empty-state">None</div>'}</div></details>`;
  const tags = n.tags.length ? `<div class="site-links-tags">${n.tags.map(t => `<a class="tag" href="${tagHref(t)}">#${esc(t)}</a>`).join(' ')}</div>` : '';
  return `<div class="site-links-pane"><div class="site-links-title">${icon('link')} Links</div>${sec('Backlinks', back.length, backHtml, false)}${sec('Outgoing links', out.length, outHtml, false)}<div class="site-local-graph" data-graph-focus="${esc(n.path)}"></div>${tags}</div>`;
}

const page = async n => {
  state.page = n; state.stack = [n.path]; state.dcBlocks = []; state.baseBlocks = [];
  const body = renderBody(n.body) + linksPane(n);
  const html = pageHTML(n, body, state.dcBlocks.map(b => ({ id: b.id, lang: b.lang, code: b.code, path: b.path })), state.baseBlocks.slice());
  const dir = path.join(OUT, n.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
};
const basePage = b => {
  state.page = b; state.stack = [b.path]; state.dcBlocks = []; state.baseBlocks = [];
  const body = baseBlockHTML({ kind: 'file', path: b.path, view: null, full: true });
  const html = pageHTML({ ...b, fm: {}, body: '' }, body, [], state.baseBlocks.slice());
  const dir = path.join(OUT, b.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
};
for (const n of notes) await page(n);
for (const b of bases) basePage(b);

// tag pages
const sitePage = (slug, name, folder, body, extraBodyClass) => {
  const html = pageHTML({ name, slug, path: '', folder, fm: {}, body: '' }, body, [], []);
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
};
{
  const allTags = [...tagMap.keys()].sort((a, b) => a.localeCompare(b));
  const noteLink = n => `<li><a class="internal-link" href="${n.url}">${esc(n.name)}</a>${n.folder ? ` <span class="site-faint">${esc(n.folder)}</span>` : ''}</li>`;
  const tagLink = t => `<a class="tag" href="${tagHref(t)}">#${esc(t)}</a>`;
  for (const t of allTags) {
    const list = [...tagMap.get(t)].sort((a, b) => a.name.localeCompare(b.name));
    const subs = allTags.filter(x => x.startsWith(t + '/') && !x.slice(t.length + 1).includes('/'));
    const body = `<h1>#${esc(t)}</h1><p class="site-faint">${list.length} note${list.length === 1 ? '' : 's'}</p>${subs.length ? `<p>Sub-tags: ${subs.map(tagLink).join(' ')}</p>` : ''}<ul>${list.map(noteLink).join('')}</ul><p><a href="${BASE}/tags/">All tags</a></p>`;
    sitePage('tags/' + tagPath(t), '#' + t, 'Tags', body);
  }
  const rows = allTags.map(t => `<li>${tagLink(t)} <span class="site-faint">${tagMap.get(t).size}</span></li>`).join('');
  sitePage('tags', 'Tags', '', `<h1>Tags</h1>${allTags.length ? `<ul class="site-tag-list">${rows}</ul>` : '<p>No tags yet.</p>'}`);
  // graph
  sitePage('graph', 'Graph view', '', `<div id="graph-root" class="site-graph-page"></div>`);
}

// 404
fs.writeFileSync(path.join(OUT, '404.html'), pageHTML({ name: 'Not found', slug: 'x', path: '', folder: '', fm: {}, body: '' }, '<h1>Page not found</h1><p>That note is not published. <a href="' + BASE + '/">Back to the start</a>.</p>', [], []));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// attachments
for (const a of attachments) {
  const dest = path.join(OUT, 'attachments', a.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, a.path), dest);
}

// ---------- vault data for the in-browser runtime (Datacore engine + Bases) ----------
const types = readJSON(path.join(OBS, 'types.json'), {});
const propertyTypes = types.types || types;
const publicUrl = a => a.url;
fs.writeFileSync(path.join(OUT, 'assets', 'vault.json'), JSON.stringify({
  base: BASE,
  propertyTypes,
  pages: notes.map(n => ({ path: n.path, name: n.name, url: n.url, tags: n.tags, aliases: n.aliases, fm: n.fm, raw: n.raw, ctime: n.stat.ctime, mtime: n.stat.mtime, size: n.stat.size, links: n.links, embeds: n.embeds, backlinks: n.backlinks, headings: (n.meta.headings || []).map(h => ({ heading: h.heading, level: h.level })) })),
  scripts: [...scripts, ...libraryFiles].map(x => ({ path: x.path, stat: x.stat, text: x.text, hidden: x.hidden || undefined })),
  bases: bases.map(b => ({ path: b.path, name: b.name, url: b.url, stat: b.stat, text: b.text })),
  attachments: attachments.map(a => ({ path: a.path, url: publicUrl(a), stat: a.stat })),
}));

const graphCfg = readJSON(path.join(OBS, 'graph.json'), {});
const rgbCss = c => { const v = c?.rgb ?? 0; return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${c?.a ?? 1})`; };
const graphSettings = {
  search: String(graphCfg.search || '').trim(),
  colorGroups: (graphCfg.colorGroups || []).map(g => ({ query: String(g.query || '').trim(), color: rgbCss(g.color) })),
  showTags: !!graphCfg.showTags, showOrphans: graphCfg.showOrphans !== false, showArrow: !!graphCfg.showArrow,
  textFadeMultiplier: graphCfg.textFadeMultiplier ?? 0, nodeSizeMultiplier: graphCfg.nodeSizeMultiplier ?? 1, lineSizeMultiplier: graphCfg.lineSizeMultiplier ?? 1,
  centerStrength: graphCfg.centerStrength ?? 0.3, repelStrength: graphCfg.repelStrength ?? 10, linkStrength: graphCfg.linkStrength ?? 1, linkDistance: graphCfg.linkDistance ?? 250,
};
fs.writeFileSync(path.join(OUT, 'assets', 'graph.json'), JSON.stringify({
  settings: graphSettings,
  nodes: notes.map(n => ({ id: n.path, name: n.name, url: n.url, folder: n.folder, tags: n.tags })),
  edges: notes.flatMap(n => n.links.filter(p => noteByPath.has(p) && p !== n.path).map(p => [n.path, p])),
}));

// ---------- Datacore: real engine + build-time index ----------
{
  const { src, label } = loadDatacoreSource([
    { label: 'the vault\'s installed Datacore plugin', file: path.join(OBS, 'plugins/datacore/main.js') },
    { label: 'the vendored Datacore snapshot', file: path.join(HERE, 'vendor/datacore/main.js') },
  ], warn);
  console.log(`[datacore] engine: ${label}`);
  const importer = createDatacoreImporter(src);
  const dcPages = [];
  for (const n of [...notes, ...libraryNotes]) {
    try { dcPages.push(await importer(n.path, n.raw, n.meta, n.stat)); }
    catch (e) { warn(`datacore could not index ${n.path}: ${e.message}`); }
  }
  const dcSettings = readJSON(path.join(OBS, 'plugins/datacore/data.json'), {});
  fs.writeFileSync(path.join(OUT, 'assets', 'datacore-index.json'), JSON.stringify({ engine: label, settings: dcSettings, pages: dcPages }));
  fs.writeFileSync(path.join(OUT, 'assets', 'datacore-engine.js'), buildEngineBundle(src));
}

// lucide icons used by Datacore/Bases (setIcon) – fetched lazily by the browser
{
  const names = fs.readdirSync(ICON_DIR).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4));
  const map = {};
  for (const nm of names) map[nm] = icon(nm);
  fs.writeFileSync(path.join(OUT, 'assets', 'icons.json'), JSON.stringify(map));
}

// client bundle
await esbuild.build({
  entryPoints: [path.join(HERE, 'src/client.js')], bundle: true, minify: true, format: 'iife', target: 'es2020',
  outfile: path.join(OUT, 'assets', 'app.js'),
});

// css: base -> theme -> plugins -> snippets -> overrides
const cssParts = [];
const addCss = (label, p) => { try { cssParts.push(`/* ${label} */\n` + fs.readFileSync(p, 'utf8')); } catch { console.warn('missing css', p); } };
addCss('base', path.join(HERE, 'src/base.css'));
cssParts.push('/* theme */\n' + theme.css);
addCss('advanced-multi-column', path.join(OBS, 'plugins/advanced-multi-column/styles.css'));
addCss('advanced-multi-column settings', path.join(HERE, 'src/amc-dynamic.css'));
addCss('datacore', path.join(OBS, 'plugins/datacore/styles.css'));
const appearance = readJSON(path.join(OBS, 'appearance.json'));
for (const s of appearance.enabledCssSnippets || []) addCss('snippet ' + s, path.join(OBS, 'snippets', s + '.css'));
addCss('bases', path.join(HERE, 'src/bases.css'));
addCss('site', path.join(HERE, 'src/site.css'));
fs.writeFileSync(path.join(OUT, 'assets', 'site.css'), cssParts.join('\n\n'));

if (warnings.length) console.warn(`\n${warnings.length} warning(s) – see above.`);
console.log(`Built ${notes.length} notes, ${bases.length} bases, ${attachments.length} attachments -> ${path.relative(process.cwd(), OUT)} (base "${BASE}")`);
