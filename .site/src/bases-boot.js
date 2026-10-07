// Renders Bases (.base files, ```base blocks, ![[x.base]] embeds) into the page.
import { BasesEnv, parseBase, runView, entriesFromVault, SUPPORTED_VIEW_TYPES, propDisplayName } from './bases/engine.js';
import { BDate, BDuration, BLink, BFile, BHtml, BImage, BIcon, typeOf, toStr, defaultDateString, durationString } from './bases/values.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const IMG = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

let ICONS = null;
async function loadIcons(BASE) { if (!ICONS) ICONS = await fetch(`${BASE}/assets/icons.json`).then(r => r.json()).catch(() => ({})); return ICONS; }

export async function mountBases(BASE, vault, specs, pagePath) {
  if (!specs.length) return;
  const icons = await loadIcons(BASE);
  const env = new BasesEnv({ entries: entriesFromVault(vault), propertyTypes: vault.propertyTypes || {} });
  for (const spec of specs) {
    const host = document.querySelector(`.base-block[data-base-id="${spec.id}"]`);
    if (!host) continue;
    try { renderBase(host, spec, env, vault, icons, BASE); }
    catch (e) { console.error('base failed', e); host.replaceChildren(banner('error', 'This base could not be rendered: ' + e.message)); }
  }
}

function banner(kind, text) {
  const b = el('div', `bases-notice bases-${kind} callout`);
  b.dataset.callout = kind === 'error' ? 'danger' : 'warning';
  const t = el('div', 'callout-title'); t.append(el('div', 'callout-title-inner', kind === 'error' ? 'Base error' : 'Base notice'));
  const c = el('div', 'callout-content'); c.append(el('p', null, text));
  b.append(t, c); return b;
}

function renderBase(host, spec, env, vault, icons, BASE) {
  let text = spec.text, entry = null;
  if (spec.kind === 'file') {
    const b = (vault.bases || []).find(x => x.path === spec.path);
    if (!b) { host.replaceChildren(banner('error', `Base file "${spec.path}" was not found.`)); return; }
    text = b.text;
    entry = spec.full ? env.byPath.get(b.path.toLowerCase()) : env.byPath.get((spec.source || '').toLowerCase());
  } else entry = env.byPath.get((spec.source || '').toLowerCase());
  const base = parseBase(text);
  const wrap = el('div', 'bases-embed' + (spec.full ? ' bases-page' : ''));
  host.replaceChildren(wrap);
  for (const e of base.errors) wrap.append(banner('error', e));
  if (base.errors.length) return;

  let views = base.views;
  let pinned = false;
  if (spec.view) {
    const v = views.find(x => (x.name || '').toLowerCase() === spec.view.toLowerCase());
    if (!v) { wrap.append(banner('error', `This base has no view named "${spec.view}".`)); return; }
    views = [v]; pinned = true;
  }
  let current = 0;
  const bodyHost = el('div', 'bases-view-host');
  const header = el('div', 'bases-header');
  const toolbar = el('div', 'bases-toolbar');
  header.append(toolbar);
  wrap.append(header, bodyHost);

  const draw = () => {
    const view = views[current];
    const res = runView(env, base, view, { thisEntry: entry });
    toolbar.replaceChildren();
    if (views.length > 1 && !pinned) {
      const sel = el('select', 'dropdown bases-toolbar-views');
      views.forEach((v, i) => { const o = el('option', null, v.name || `View ${i + 1}`); o.value = i; if (i === current) o.selected = true; sel.append(o); });
      sel.addEventListener('change', () => { current = Number(sel.value); draw(); });
      const item = el('div', 'bases-toolbar-item'); item.append(sel); toolbar.append(item);
    } else if (views.length >= 1) {
      toolbar.append(el('div', 'bases-toolbar-item bases-toolbar-view-name', views[current].name || 'Table'));
    }
    toolbar.append(el('div', 'bases-toolbar-item bases-toolbar-count', `${res.total ?? 0} result${res.total === 1 ? '' : 's'}`));
    bodyHost.replaceChildren();
    for (const e of res.errors) bodyHost.append(banner('error', e));
    for (const w of base.warnings) bodyHost.append(banner('warning', w));
    if (!SUPPORTED_VIEW_TYPES.has(view.type ?? 'table')) return;
    const bodyEl = el('div', 'bases-view');
    bodyEl.dataset.viewType = view.type ?? 'table';
    if (!res.rows.length) bodyEl.append(el('div', 'bases-empty', 'No entries match this view.'));
    else if ((view.type ?? 'table') === 'table') renderTable(bodyEl, res, view, base, env, icons);
    else if (view.type === 'cards') renderCards(bodyEl, res, view, base, env, icons);
    else renderList(bodyEl, res, view, base, env, icons);
    bodyHost.append(bodyEl);
  };
  draw();
}

// ---------- values ----------
function entryLink(entry, text) {
  if (entry && entry.url) { const a = el('a', 'internal-link', text); a.href = entry.url; a.dataset.href = entry.path; return a; }
  return el('span', 'internal-link is-unresolved', text);
}
function nameFor(entry) { return entry.ext === 'md' ? entry.basename : entry.name; }
const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export function renderValue(parent, v, ctx) {
  const t = typeOf(v);
  switch (t) {
    case 'null': return;
    case 'boolean': { const i = el('input', 'bases-checkbox'); i.type = 'checkbox'; i.checked = v; i.disabled = true; parent.append(i); return; }
    case 'number': case 'string': {
      const s = toStr(v);
      if (t === 'string' && s.includes('[[')) { // wikilinks inside text
        let last = 0, m; WIKI.lastIndex = 0;
        while ((m = WIKI.exec(s))) { parent.append(document.createTextNode(s.slice(last, m.index))); const e = ctx.env.resolve(m[1], ctx.entry?.path); parent.append(e ? entryLink(e, m[2] ?? nameFor(e)) : el('span', 'internal-link is-unresolved', m[2] ?? m[1])); last = m.index + m[0].length; }
        parent.append(document.createTextNode(s.slice(last))); return;
      }
      parent.append(document.createTextNode(s)); return;
    }
    case 'date': parent.append(document.createTextNode(defaultDateString(v))); return;
    case 'duration': parent.append(document.createTextNode(durationString(v))); return;
    case 'link': { const e = v.entry; const text = v.display ?? (e ? nameFor(e) : v.path); parent.append(e ? entryLink(e, text) : el('span', 'internal-link is-unresolved', text)); return; }
    case 'file': parent.append(entryLink(v.entry, nameFor(v.entry))); return;
    case 'list': {
      const isTags = ctx.id === 'file.tags' || ctx.id === 'tags' || ctx.id === 'note.tags';
      const box = el('span', 'bases-list-value' + (isTags ? ' multi-select-container' : ''));
      v.forEach((x, i) => {
        if (isTags && typeof x === 'string') { const t = x.replace(/^#/, ''); const p = el('a', 'multi-select-pill tag'); p.href = (document.body.dataset.base || '') + '/tags/' + t.split('/').map(seg => seg.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('/') + '/'; p.append(el('span', 'multi-select-pill-content', t)); box.append(p); return; }
        if (i) box.append(document.createTextNode(', '));
        renderValue(box, x, { ...ctx, id: null });
      });
      parent.append(box); return;
    }
    case 'object': parent.append(document.createTextNode(toStr(v))); return;
    case 'html': { const d = el('span', 'bases-html'); d.innerHTML = String(v.html).replace(/<script[\s\S]*?<\/script>/gi, ''); parent.append(d); return; }
    case 'image': { const src = imageSrc(v.src, ctx); if (src) { const i = el('img'); i.src = src; i.loading = 'lazy'; parent.append(i); } return; }
    case 'icon': { const holder = el('span', 'bases-icon'); holder.innerHTML = ctx.icons[String(v.name).replace(/^lucide-/, '')] || ''; parent.append(holder); return; }
    default: parent.append(document.createTextNode(toStr(v)));
  }
}
function imageSrc(v, ctx) {
  if (Array.isArray(v)) v = v[0];
  if (v == null) return null;
  if (v instanceof BImage) return imageSrc(v.src, ctx);
  if (v instanceof BFile) return v.entry.url || null;
  if (v instanceof BLink) return v.entry?.url || null;
  const s = toStr(v).trim().replace(/^!?\[\[|\]\]$/g, '').split('|')[0];
  if (/^(https?:)?\/\//.test(s) || s.startsWith('data:')) return s;
  const e = ctx.env.resolve(s, ctx.entry?.path);
  return e && IMG.test(e.name) ? e.url : null;
}

function cell(parent, row, col, ctx) {
  const c = row.cells[col.id];
  if (c.error) { const s = el('span', 'bases-cell-error', 'Error'); s.title = c.error; parent.append(s); return; }
  if (col.id === 'file.name') { parent.append(entryLink(row.entry, nameFor(row.entry))); return; }
  renderValue(parent, c.value, { ...ctx, entry: row.entry, id: col.id });
}

// ---------- table ----------
function renderTable(host, res, view, base, env, icons) {
  const ctx = { env, icons };
  const container = el('div', 'bases-table-container');
  const table = el('div', 'bases-table');
  const cols = res.columns.map((c, i) => (c.width ? `${c.width}px` : i === 0 ? 'minmax(160px, 2fr)' : 'minmax(100px, 1fr)')).join(' ');
  table.style.setProperty('--bases-cols', cols);
  const thead = el('div', 'bases-thead'), htr = el('div', 'bases-tr');
  for (const c of res.columns) {
    const td = el('div', 'bases-td'), h = el('div', 'bases-table-header');
    h.append(el('span', 'bases-table-header-name', c.name)); td.append(h); htr.append(td);
  }
  thead.append(htr); table.append(thead);
  const tbody = el('div', 'bases-tbody');
  const addRow = row => {
    const tr = el('div', 'bases-tr');
    for (const c of res.columns) { const td = el('div', 'bases-td'); const tc = el('div', 'bases-table-cell'); cell(tc, row, c, ctx); td.append(tc); tr.append(td); }
    tbody.append(tr);
  };
  if (res.groups) {
    for (const g of res.groups) {
      const tr = el('div', 'bases-tr bases-group-row'), td = el('div', 'bases-td bases-group-cell'), h = el('div', 'bases-group-heading');
      h.append(el('span', 'bases-group-heading-property', propDisplayName(base, res.groupProperty) + ': '));
      const val = el('span', 'bases-group-heading-value'); renderValue(val, g.value, { ...ctx, id: res.groupProperty }); if (!val.childNodes.length) val.textContent = 'Empty';
      h.append(val, el('span', 'bases-group-heading-count', ` ${g.rows.length}`)); td.append(h); tr.append(td); tbody.append(tr);
      g.rows.forEach(addRow);
    }
  } else res.rows.forEach(addRow);
  table.append(tbody);
  if (Object.keys(res.summaries || {}).length) {
    const tf = el('div', 'bases-tfoot'), tr = el('div', 'bases-tr bases-summary-row');
    for (const c of res.columns) {
      const td = el('div', 'bases-td'), s = res.summaries[c.id];
      if (s) { const box = el('div', 'bases-table-summary'); box.append(el('span', 'bases-summary-label', s.name + ' ')); if (s.error) box.append(el('span', 'bases-cell-error', 'Error')); else { const v = el('span', 'bases-summary-value'); renderValue(v, typeof s.value === 'number' ? Math.round(s.value * 1e4) / 1e4 : s.value, { ...ctx, id: c.id }); box.append(v); } td.append(box); }
      tr.append(td);
    }
    tf.append(tr); table.append(tf);
  }
  container.append(table); host.append(container);
}

// ---------- cards ----------
function renderCards(host, res, view, base, env, icons) {
  const ctx = { env, icons };
  const size = Number(view.cardSize) || 200;
  const box = el('div', 'bases-cards-container');
  box.style.setProperty('--bases-cards-min', size + 'px');
  const addCard = row => {
    const card = el('div', 'bases-cards-item');
    const imgProp = view.image ? String(view.image) : null;
    if (imgProp) {
      const cover = el('div', 'bases-cards-cover');
      let src = null; try { src = imageSrc(row.image, { env, entry: row.entry }); } catch { /* ignore */ }
      if (src) { cover.style.backgroundImage = `url("${src}")`; cover.style.backgroundSize = view.imageFit === 'contain' ? 'contain' : 'cover'; }
      if (view.imageAspectRatio) cover.style.aspectRatio = String(view.imageAspectRatio);
      card.append(cover);
    }
    const [first, ...rest] = res.columns;
    if (first) { const lab = el('div', 'bases-cards-label'); cell(lab, row, first, ctx); card.append(lab); }
    for (const c of rest) { const line = el('div', 'bases-cards-line'); line.title = c.name; cell(line, row, c, ctx); if (line.childNodes.length) card.append(line); }
    return card;
  };
  if (res.groups) {
    for (const g of res.groups) {
      const h = el('div', 'bases-group-heading bases-cards-group-heading');
      h.append(el('span', 'bases-group-heading-property', propDisplayName(base, res.groupProperty) + ': '));
      const v = el('span', 'bases-group-heading-value'); renderValue(v, g.value, { ...ctx, id: res.groupProperty }); if (!v.childNodes.length) v.textContent = 'Empty';
      h.append(v); box.append(h);
      const grid = el('div', 'bases-cards-grid'); g.rows.forEach(r => grid.append(addCard(r))); box.append(grid);
    }
  } else { const grid = el('div', 'bases-cards-grid'); res.rows.forEach(r => grid.append(addCard(r))); box.append(grid); }
  host.append(box);
}
// ---------- list ----------
function renderList(host, res, view, base, env, icons) {
  const ctx = { env, icons };
  const marker = view.markers ?? 'bullet';
  const sep = view.separator ?? ', ';
  const tag = marker === 'number' ? 'ol' : 'ul';
  const makeList = rows => {
    const list = el(tag, 'bases-list' + (marker === 'none' ? ' bases-list-nomarker' : ''));
    for (const row of rows) {
      const li = el('li', 'bases-list-item');
      const [first, ...rest] = res.columns;
      if (first) { const s = el('span', 'bases-list-title'); cell(s, row, first, ctx); li.append(s); }
      const indent = view.indentProperties;
      const parts = rest.map(c => { const s = el('span', 'bases-list-property'); cell(s, row, c, ctx); s.title = c.name; return s; }).filter(s => s.childNodes.length);
      if (parts.length && !indent) { li.append(document.createTextNode(': ')); parts.forEach((p, i) => { if (i) li.append(document.createTextNode(sep)); li.append(p); }); }
      else if (parts.length) { const sub = el('div', 'bases-list-sub'); parts.forEach(p => { const d = el('div'); d.append(p); sub.append(d); }); li.append(sub); }
      list.append(li);
    }
    return list;
  };
  if (res.groups) {
    for (const g of res.groups) {
      const h = el('div', 'bases-group-heading');
      h.append(el('span', 'bases-group-heading-property', propDisplayName(base, res.groupProperty) + ': '));
      const v = el('span', 'bases-group-heading-value'); renderValue(v, g.value, { ...ctx, id: res.groupProperty }); if (!v.childNodes.length) v.textContent = 'Empty';
      h.append(v); host.append(h, makeList(g.rows));
    }
  } else host.append(makeList(res.rows));
}
