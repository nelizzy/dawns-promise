// Browser runtime: sidebar behaviour, callout folding, Datacore (real engine) and Bases.
import { mountDatacoreBlocks } from './datacore-boot.js';
import { mountBases } from './bases-boot.js';
import { mountGraph } from './graph.js';
import { search, renderResults } from './search.js';

const BASE = document.body.dataset.base || '';
let vaultPromise = null;
const loadVault = () => (vaultPromise ||= fetch(`${BASE}/assets/vault.json`).then(r => r.json()));

function mountGraphs() {
  const root = document.getElementById('graph-root');
  if (root) mountGraph(root, { BASE, focus: new URLSearchParams(location.search).get('focus') }).catch(e => console.error(e));
  document.querySelectorAll('.site-local-graph').forEach(h => mountGraph(h, { BASE, focus: h.dataset.graphFocus, local: true }).catch(e => console.error(e)));
}

async function mountBlocks() {
  const page = window.__PAGE;
  if (!page) return;
  const vault = await loadVault();
  await Promise.all([
    mountDatacoreBlocks(BASE, vault, page.dc || []),
    mountBases(BASE, vault, page.bases || [], page.path),
  ]);
}

// ---------------- sidebar, search, misc ----------------
function initNav() {
  const active = document.querySelector('.nav-file-title.is-active');
  for (let n = active; n; n = n.parentElement) {
    if (n.classList?.contains('nav-folder')) { n.classList.remove('is-collapsed'); n.querySelector(':scope > .nav-folder-title .collapse-icon')?.classList.remove('is-collapsed'); }
  }
  active?.scrollIntoView({ block: 'center' });
  document.querySelectorAll('.nav-folder-title').forEach(t => t.addEventListener('click', () => {
    const f = t.parentElement; const c = f.classList.toggle('is-collapsed');
    t.querySelector('.collapse-icon')?.classList.toggle('is-collapsed', c);
  }));
  const input = document.getElementById('site-search');
  const clear = document.querySelector('.search-input-clear-button');
  const navBox = document.querySelector('.nav-files-container');
  const results = document.createElement('div'); results.className = 'nav-files-container site-search-results'; results.style.display = 'none';
  navBox.after(results);
  let seq = 0;
  const apply = async () => {
    const q = input.value.trim();
    clear?.classList.toggle('is-visible', !!q);
    if (!q) { results.style.display = 'none'; navBox.style.display = ''; return; }
    const mine = ++seq;
    const r = await search(BASE, q);
    if (mine !== seq) return;
    renderResults(results, r); results.style.display = ''; navBox.style.display = 'none';
  };
  let timer;
  input?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 120); });
  clear?.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) { input.value = initial; apply(); }
  const sb = document.body;
  document.getElementById('site-menu')?.addEventListener('click', () => sb.classList.toggle('site-nav-open'));
  document.getElementById('site-scrim')?.addEventListener('click', () => sb.classList.remove('site-nav-open'));
}
function initCallouts() {
  document.addEventListener('click', e => {
    const t = e.target.closest?.('.callout.is-collapsible > .callout-title');
    if (t) { const c = t.parentElement; const col = c.classList.toggle('is-collapsed'); t.querySelector('.callout-fold')?.classList.toggle('is-collapsed', col); }
  });
}

initNav();
initCallouts();
mountGraphs();
mountBlocks().catch(e => console.error(e));
