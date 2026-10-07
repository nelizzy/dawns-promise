// Boots the real Datacore engine in the browser against the static vault snapshot and mounts code blocks.
import * as shim from './obsidian-shim.js';
import { render as preactRender } from 'preact';

const obsidianModule = {
  Setting: shim.Setting, TFile: shim.TFile, TFolder: shim.TFolder, TAbstractFile: shim.TAbstractFile, Component: shim.Component,
  MarkdownRenderChild: shim.MarkdownRenderChild, debounce: shim.debounce, setIcon: shim.setIcon, Events: shim.Events,
  Plugin: shim.Plugin, PluginSettingTab: shim.PluginSettingTab, Modal: shim.Modal, Notice: shim.Notice, normalizePath: shim.normalizePath,
  moment: shim.moment, MarkdownRenderer: null, // filled in below
};

const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed to load ' + src));
  document.head.appendChild(s);
});
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });

export function makeStatus(el, title, err) {
  el.classList.add('datacore-failed');
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'callout site-unsupported';
  box.dataset.callout = 'warning';
  const t = document.createElement('div'); t.className = 'callout-title';
  t.innerHTML = '<div class="callout-title-inner"></div>'; t.querySelector('.callout-title-inner').textContent = title;
  const c = document.createElement('div'); c.className = 'callout-content';
  const p = document.createElement('p'); p.textContent = String(err?.message ?? err ?? '');
  c.appendChild(p); box.append(t, c); el.appendChild(box);
}

let bootPromise = null;
/** Resolves to { app, api, engine, core, vault, root } */
export function bootDatacore(BASE, vaultData) {
  return (bootPromise ||= (async () => {
    shim.installPolyfills();
    const [icons, index] = await Promise.all([getJSON(`${BASE}/assets/icons.json`).catch(() => ({})), getJSON(`${BASE}/assets/datacore-index.json`), loadScript(`${BASE}/assets/datacore-engine.js`)]);
    shim.setIconData(icons);
    const app = shim.makeApp(vaultData, { base: BASE });
    window.app = app;
    obsidianModule.MarkdownRenderer = shim.makeMarkdownRenderer(() => app);
    const engine = window.__datacoreEngine(name => {
      if (name === 'obsidian') return obsidianModule;
      throw new Error(`Datacore asked for unsupported module "${name}"`);
    });
    const { Datastore, MarkdownPage, MarkdownListBlock, GenericFile, DEFAULT_SETTINGS, DatacoreApi } = engine;
    const settings = Object.assign({}, DEFAULT_SETTINGS, index.settings || {});
    const datastore = new Datastore(app.vault, app.metadataCache, settings);
    const events = new shim.Events();
    const core = {
      app, vault: app.vault, metadataCache: app.metadataCache, settings, datastore, events, version: 'site', initialized: true,
      get revision() { return datastore.revision; },
      read: file => app.vault.cachedRead(file),
      on: (e, cb, ctx) => events.on(e, cb, ctx), off: (e, cb) => events.off(e, cb), offref: r => events.offref(r), trigger: (e, ...a) => events.trigger(e, ...a),
      persister: { storeFile() {}, loadFile: async () => null, synchronize() {}, recreate: async () => {} },
      storeMarkdown(data) {
        datastore.store(data, (object, store) => {
          store(object.$sections, (section, store2) => {
            store2(section.$blocks, (block, store3) => {
              if (block instanceof MarkdownListBlock) {
                const rec = (item, store4) => store4(item.$elements, rec);
                store3(block.$elements, rec);
              }
            });
          });
        });
      },
    };
    // index: markdown pages from the build-time importer, plain files for everything else (scripts, images, bases)
    for (const json of index.pages) {
      try {
        const parsed = MarkdownPage.from(json, link => {
          const r = app.metadataCache.getFirstLinkpathDest(link.path, json.$path);
          return r ? link.withPath(r.path) : link;
        });
        core.storeMarkdown(parsed);
      } catch (e) { console.warn('[datacore] could not load page', json?.$path, e); }
    }
    const api = new DatacoreApi(core);
    const DT = api.luxon.DateTime;
    for (const f of app.vault.getFiles()) {
      if (f.extension === 'md') continue;
      datastore.store(new GenericFile(f.path, DT.fromMillis(f.stat.ctime), DT.fromMillis(f.stat.mtime), f.stat.size));
    }
    datastore.touch();
    window.datacore = api;
    return { app, api, engine, core };
  })());
}

const LANG_FN = { datacorejs: 'executeJs', datacorejsx: 'executeJsx', datacorets: 'executeTs', datacoretsx: 'executeTsx' };

export async function mountDatacoreBlocks(BASE, vaultData, blocks) {
  if (!blocks.length) return;
  let rt;
  try { rt = await bootDatacore(BASE, vaultData); }
  catch (e) {
    console.error('datacore boot failed', e);
    for (const b of blocks) { const el = document.querySelector(`.datacore-block[data-dc-id="${b.id}"]`); if (el) makeStatus(el, 'Datacore could not start on this page', e); }
    return;
  }
  const root = new shim.Component(); root.load();
  installLinkFixer(rt.app, blocks[0] && blocks[0].path);
  installWikilinkRenderer(rt.app, blocks[0] && blocks[0].path);
  for (const b of blocks) {
    const el = document.querySelector(`.datacore-block[data-dc-id="${b.id}"]`);
    if (!el) continue;
    try {
      const fn = LANG_FN[b.lang];
      if (!fn) throw new Error('Unsupported language ' + b.lang);
      el.classList.add('datacore-rendered');
      rt.api[fn](b.code, el, root, b.path);
    } catch (e) { console.error('datacore block failed', e); makeStatus(el, 'This Datacore view could not be rendered', e); }
  }
}

// Datacore renders links with vault-relative hrefs; make them real, middle-clickable URLs.
function installLinkFixer(app, fallbackSource) {
  const fix = a => {
    const target = a.getAttribute('data-href');
    if (!target || a.dataset.siteFixed) return;
    a.dataset.siteFixed = '1';
    const f = app.metadataCache.getFirstLinkpathDest(target, fallbackSource);
    if (!f || !f.url) { a.classList.add('is-unresolved'); return; }
    const hash = target.includes('#') ? '#' + shim.slug(target.split('#').slice(1).join('#')) : '';
    a.setAttribute('href', f.url + hash);
    a.removeAttribute('target');
  };
  const scan = root => root.querySelectorAll?.('a.internal-link[data-href]').forEach(fix);
  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) { if (n.nodeType === 1) { if (n.matches?.('a.internal-link[data-href]')) fix(n); scan(n); } } })
    .observe(document.body, { childList: true, subtree: true });
  scan(document);
}

// Plain-text [[wikilinks]] that scripts print (e.g. note excerpts) become real links inside Datacore views.
const WIKI_RE = /!?\[\[([^\]\n]+?)\]\]/g;
const SKIP = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON']);
function installWikilinkRenderer(app, source) {
  const convert = text => {
    const frag = document.createDocumentFragment(); let last = 0, m; WIKI_RE.lastIndex = 0;
    while ((m = WIKI_RE.exec(text.data))) {
      if (m.index > last) frag.append(text.data.slice(last, m.index));
      const [targetFull, ...rest] = m[1].replace(/\\\|/g, '|').split('|');
      const [target, ...sub] = targetFull.split('#');
      const f = target.trim() ? app.metadataCache.getFirstLinkpathDest(target.trim(), source) : null;
      const label = rest.length ? rest.join('|') : (f ? f.basename : target.trim()) + (sub.length ? ' > ' + sub.join('#') : '');
      const a = document.createElement('a'); a.className = 'internal-link'; a.dataset.href = targetFull; a.dataset.siteFixed = '1'; a.textContent = label;
      if (f && f.url) a.href = f.url + (sub.length ? '#' + shim.slug(sub.join('#')) : ''); else a.classList.add('is-unresolved');
      frag.append(a); last = m.index + m[0].length;
    }
    if (last < text.data.length) frag.append(text.data.slice(last));
    text.replaceWith(frag);
  };
  const scan = root => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.data.includes('[[') && !SKIP.has(n.parentElement?.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const found = []; while (w.nextNode()) found.push(w.currentNode);
    found.forEach(convert);
  };
  let queued = false;
  const run = () => { queued = false; document.querySelectorAll('.datacore-block').forEach(scan); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
  run();
}
