// Canvas force-directed graph (global graph page + per-note local graph). No dependencies.
let dataPromise = null;
const loadGraph = BASE => (dataPromise ||= fetch(`${BASE}/assets/graph.json`).then(r => r.json()));

const cssColor = (() => {
  let probe;
  return (name, fallback) => {
    probe ||= Object.assign(document.createElement('span'), { style: 'display:none' });
    if (!probe.isConnected) document.body.appendChild(probe);
    probe.style.color = '';
    probe.style.color = `var(${name}, ${fallback})`;
    return getComputedStyle(probe).color || fallback;
  };
})();
const withAlpha = (rgb, a) => { const m = /rgba?\(([^)]+)\)/.exec(rgb); if (!m) return rgb; const [r, g, b] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return `rgba(${r},${g},${b},${a})`; };

export async function mountGraph(host, { BASE, focus = null, local = false }) {
  const data = await loadGraph(BASE);
  const cfg = data.settings || {};
  let nodes = data.nodes, edges = data.edges;
  // Obsidian-style query (as used by graph filters and colour groups): words, "phrases", -x, tag:#x, path:x, file:x
  const parseQ = q => { const out = []; const re = /(-?)(?:(tag|path|file):)?(?:"([^"]+)"|(\S+))/g; let m; while ((m = re.exec(q || ''))) { const v = (m[3] ?? m[4]).toLowerCase().replace(/^#(?=.)/, ''); if (v) out.push({ neg: !!m[1], kind: m[2] || 'word', v }); } return out; };
  const matches = (n, terms) => terms.every(t => { let ok; if (t.kind === 'tag') ok = n.tags.some(x => { x = x.toLowerCase(); return x === t.v || x.startsWith(t.v + '/'); }); else if (t.kind === 'path') ok = n.id.toLowerCase().includes(t.v); else ok = n.name.toLowerCase().includes(t.v) || (t.kind === 'file' ? false : n.id.toLowerCase().includes(t.v)); return t.neg ? !ok : ok; });
  const baseFilter = parseQ(cfg.search);
  const groups = (cfg.colorGroups || []).map(g => ({ terms: parseQ(g.query), color: g.color })).filter(g => g.terms.length);
  nodes = nodes.filter(n => matches(n, baseFilter));
  const kids = new Set(nodes.map(n => n.id)); edges = edges.filter(([a, b]) => kids.has(a) && kids.has(b));
  if (cfg.showTags) {
    const tagSet = new Map();
    for (const n of nodes) for (const t of n.tags) { if (!tagSet.has(t)) tagSet.set(t, { id: '#' + t, name: '#' + t, url: `${BASE}/tags/${t.split('/').map(seg => seg.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('/')}/`, folder: '#tags', tags: [], isTag: true }); edges = [...edges, [n.id, '#' + t]]; }
    nodes = [...nodes, ...tagSet.values()];
  }
  if (local) {
    const nb = new Set([focus]);
    for (const [a, b] of edges) { if (a === focus) nb.add(b); if (b === focus) nb.add(a); }
    if (nb.size < 2) { host.remove(); return; }
    nodes = nodes.filter(n => nb.has(n.id));
    edges = edges.filter(([a, b]) => nb.has(a) && nb.has(b));
  }

  host.classList.add('site-graph');
  host.replaceChildren();
  let controls = null, filterInput, orphanBox, folderBox;
  if (!local) {
    controls = document.createElement('div'); controls.className = 'site-graph-controls';
    filterInput = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Filter notes, tag:name, path:folder…', className: 'site-graph-filter' });
    const mk = (label) => { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; l.append(c, ' ' + label); controls.append(l); return c; };
    controls.append(filterInput);
    orphanBox = mk('Orphans'); orphanBox.checked = cfg.showOrphans !== false;
    folderBox = mk('Color by folder');
    host.append(controls);
  }
  const canvas = document.createElement('canvas'); canvas.className = 'site-graph-canvas';
  const tip = document.createElement('div'); tip.className = 'site-graph-tip';
  host.append(canvas, tip);
  const ctx = canvas.getContext('2d');

  const linkLen = Math.max(30, 55 * ((cfg.linkDistance ?? 250) / 250));
  let W = 0, H = 0, dpr = window.devicePixelRatio || 1;
  const view = { k: 1, x: 0, y: 0 };
  let sim = [], links = [], byId = new Map(), alpha = 1, raf = 0, hover = null, drag = null, colors = {};
  const readColors = () => {
    colors = {
      node: cssColor('--graph-node', '#999'), focus: cssColor('--graph-node-focused', '#7c5cff'), line: cssColor('--graph-line', '#888'),
      text: cssColor('--graph-text', '#ddd'), tag: cssColor('--graph-node-tag', '#6c6'),
    };
  };
  const folderHue = (() => { const m = new Map(); return f => { if (!m.has(f)) m.set(f, (m.size * 67) % 360); return m.get(f); }; })();

  function build() {
    const q = filterInput ? filterInput.value.trim().toLowerCase() : '';
    let list = nodes;
    if (q) {
      const terms = parseQ(q);
      list = list.filter(n => matches(n, terms));
    }
    const ids = new Set(list.map(n => n.id));
    links = edges.filter(([a, b]) => ids.has(a) && ids.has(b));
    const deg = new Map();
    for (const [a, b] of links) { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
    if (orphanBox && !orphanBox.checked) list = list.filter(n => deg.get(n.id));
    const old = new Map(sim.map(n => [n.id, n]));
    sim = list.map((n, i) => {
      const o = old.get(n.id);
      const a = (i / Math.max(1, list.length)) * Math.PI * 2, r = 40 + Math.sqrt(list.length) * 14;
      return { ...n, deg: deg.get(n.id) || 0, x: o ? o.x : Math.cos(a) * r + (Math.random() - .5) * 10, y: o ? o.y : Math.sin(a) * r + (Math.random() - .5) * 10, vx: 0, vy: 0, r: (3 + Math.sqrt(deg.get(n.id) || 0) * 1.6) * (cfg.nodeSizeMultiplier || 1) };
    });
    for (const n of sim) n.color = n.isTag ? null : (groups.find(g => matches(n, g.terms)) || {}).color || null;
    byId = new Map(sim.map(n => [n.id, n]));
    links = links.filter(([a, b]) => byId.has(a) && byId.has(b)).map(([a, b]) => [byId.get(a), byId.get(b)]);
    alpha = 1; fitted = false; kick();
  }

  function tick() {
    const n = sim.length;
    for (let i = 0; i < n; i++) {
      const a = sim[i];
      for (let j = i + 1; j < n; j++) {
        const b = sim[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 160000 * (linkLen / 55) ** 2) continue;
        if (d2 < 25) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 25; }
        const f = (1600 * ((cfg.repelStrength ?? 10) / 10) / d2) * alpha, d = Math.sqrt(d2);
        dx = (dx / d) * f; dy = (dy / d) * f;
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
    }
    for (const [a, b] of links) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - linkLen) * 0.04 * (cfg.linkStrength ?? 1) * alpha, fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const a of sim) {
      a.vx -= a.x * 0.04 * (cfg.centerStrength ?? 0.3) * alpha; a.vy -= a.y * 0.04 * (cfg.centerStrength ?? 0.3) * alpha;
      if (a === drag?.node) { a.vx = a.vy = 0; continue; }
      a.vx *= 0.82; a.vy *= 0.82; a.x += a.vx; a.y += a.vy;
    }
    alpha = Math.max(0, alpha * 0.975);
    if (alpha < 0.08 && !fitted) fit();
  }
  let fitted = false;
  function fit() {
    fitted = true;
    if (!sim.length) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const n of sim) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    const k = Math.min(W / (x1 - x0 + 120), H / (y1 - y0 + 120), local ? 2.2 : 2.5);
    view.k = Math.max(0.2, k); view.x = -((x0 + x1) / 2) * view.k; view.y = -((y0 + y1) / 2) * view.k;
  }

  const toWorld = (px, py) => ({ x: (px - W / 2 - view.x) / view.k, y: (py - H / 2 - view.y) / view.k });
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y); ctx.scale(view.k, view.k);
    const hl = hover || null, nbrs = new Set();
    if (hl) for (const [a, b] of links) { if (a === hl) nbrs.add(b); if (b === hl) nbrs.add(a); }
    ctx.lineWidth = (cfg.lineSizeMultiplier || 1) / view.k;
    for (const [a, b] of links) {
      const on = hl && (a === hl || b === hl);
      ctx.strokeStyle = withAlpha(on ? colors.focus : colors.line, on ? 0.9 : hl ? 0.08 : 0.3);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (cfg.showArrow && !b.isTag) { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, tx = b.x - ux * (b.r + 1), ty = b.y - uy * (b.r + 1), s = 5 / Math.max(view.k, 0.6); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - ux * s - uy * s * 0.5, ty - uy * s + ux * s * 0.5); ctx.lineTo(tx - ux * s + uy * s * 0.5, ty - uy * s - ux * s * 0.5); ctx.fill(); }
    }
    const showAll = view.k > 1.6 * Math.pow(2, cfg.textFadeMultiplier || 0) || sim.length < 25;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of sim) {
      const isFocus = n.id === focus, on = n === hl || nbrs.has(n);
      const dim = hl && !on && !isFocus;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.2832);
      ctx.fillStyle = isFocus || n === hl ? colors.focus : folderBox?.checked ? `hsl(${folderHue(n.folder)} 55% 60%)` : n.color || (n.isTag ? colors.tag : colors.node);
      ctx.globalAlpha = dim ? 0.25 : 1; ctx.fill(); ctx.globalAlpha = 1;
      if (isFocus || on || (showAll && !dim)) {
        ctx.font = `${12 / Math.max(view.k, 0.8)}px var(--font-interface, sans-serif)`;
        ctx.fillStyle = withAlpha(colors.text, dim ? 0.3 : 0.9); ctx.fillText(n.name, n.x, n.y + n.r + 2);
      }
    }
  }
  function frame() {
    raf = 0;
    if (alpha > 0.004) tick();
    draw();
    if (alpha > 0.004 || drag) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(200, Math.round(canvas.getBoundingClientRect().width || r.width)); H = Math.max(160, Math.round(canvas.getBoundingClientRect().height || 300));
    dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; draw();
  }
  new ResizeObserver(resize).observe(canvas);

  const pick = (px, py) => {
    const w = toWorld(px, py); let best = null, bd = 1e9;
    for (const n of sim) { const d = Math.hypot(n.x - w.x, n.y - w.y); const lim = n.r + 5 / view.k; if (d < lim && d < bd) { best = n; bd = d; } }
    return best;
  };
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let moved = 0;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId); const [x, y] = pos(e); moved = 0;
    const n = pick(x, y);
    drag = n ? { node: n } : { pan: true, sx: x, sy: y, vx: view.x, vy: view.y };
    if (n) { alpha = Math.max(alpha, 0.3); kick(); }
  });
  canvas.addEventListener('pointermove', e => {
    const [x, y] = pos(e);
    if (drag) {
      moved++;
      if (drag.node) { const w = toWorld(x, y); drag.node.x = w.x; drag.node.y = w.y; alpha = Math.max(alpha, 0.2); }
      else { view.x = drag.vx + (x - drag.sx); view.y = drag.vy + (y - drag.sy); }
      kick(); return;
    }
    const n = pick(x, y);
    if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; kick(); draw(); }
    tip.style.display = n ? 'block' : 'none';
    if (n) { tip.textContent = n.name; tip.style.left = x + 12 + 'px'; tip.style.top = y + 12 + (controls ? controls.offsetHeight : 0) + 'px'; }
  });
  canvas.addEventListener('pointerup', e => {
    const wasNode = drag?.node; const click = moved < 4;
    drag = null;
    if (wasNode && click) { const [x, y] = pos(e); const n = pick(x, y); if (n) location.href = n.url; }
    kick();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.style.display = 'none'; draw(); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = pos(e), before = toWorld(x, y);
    view.k = Math.min(6, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
    view.x = x - W / 2 - before.x * view.k; view.y = y - H / 2 - before.y * view.k;
    draw();
  }, { passive: false });
  if (!local) { filterInput.addEventListener('input', build); orphanBox.addEventListener('change', build); folderBox.addEventListener('change', draw); }

  readColors(); resize(); build();
  // re-read colours if the theme variables change (they do not at runtime, but be safe after fonts/styles load)
  setTimeout(() => { readColors(); draw(); }, 400);
}
