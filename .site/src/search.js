// Sidebar full-text search over vault.json: words, "phrases", -exclude, tag:x / #x, path:x, file:x.
let vaultPromise = null;
const loadVault = BASE => (vaultPromise ||= fetch(`${BASE}/assets/vault.json`).then(r => r.json()));

function parse(q) {
  const out = { words: [], not: [], tags: [], paths: [], files: [] };
  const re = /(-?)(?:(tag|path|file):)?(?:"([^"]+)"|(\S+))/g; let m;
  while ((m = re.exec(q))) {
    const val = (m[3] ?? m[4]).toLowerCase();
    if (!val) continue;
    if (m[2] === 'tag' || (!m[2] && val.startsWith('#') && val.length > 1)) out.tags.push(val.replace(/^#/, ''));
    else if (m[2] === 'path') out.paths.push(val);
    else if (m[2] === 'file') out.files.push(val);
    else if (m[1]) out.not.push(val);
    else out.words.push(val);
  }
  return out;
}

export async function search(BASE, q) {
  const vault = await loadVault(BASE);
  const p = parse(q);
  const results = [];
  for (const page of vault.pages) {
    const plain = (page._plain ||= page.raw.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*_`#>]/g, ''));
    const name = page.name.toLowerCase(), pathL = page.path.toLowerCase(), body = (page._lower ||= plain.toLowerCase());
    if (p.tags.some(t => !page.tags.some(x => { x = x.toLowerCase(); return x === t || x.startsWith(t + '/'); }))) continue;
    if (p.paths.some(x => !pathL.includes(x))) continue;
    if (p.files.some(x => !name.includes(x))) continue;
    if (p.not.some(x => body.includes(x) || name.includes(x))) continue;
    let score = 0, ok = true;
    for (const w of p.words) {
      const inName = name.includes(w), inBody = body.includes(w);
      if (!inName && !inBody) { ok = false; break; }
      score += (inName ? 5 : 0) + (name === w ? 5 : 0) + (inBody ? 1 : 0);
    }
    if (!ok) continue;
    let snippet = null;
    if (p.words.length) {
      const i = body.indexOf(p.words.find(w => body.includes(w)) ?? p.words[0]);
      if (i >= 0) { const s = Math.max(0, i - 40); snippet = { text: plain.slice(s, i + 110).replace(/\s+/g, ' '), start: i - s, len: (p.words.find(w => body.includes(w)) ?? '').length, lead: s > 0 }; }
    }
    results.push({ page, score, snippet });
  }
  results.sort((a, b) => b.score - a.score || a.page.name.localeCompare(b.page.name));
  return { results, words: p.words };
}

export function renderResults(host, { results, words }) {
  host.replaceChildren();
  if (!results.length) { const d = document.createElement('div'); d.className = 'search-empty-state'; d.textContent = 'No matches found.'; host.append(d); return; }
  const c = document.createElement('div'); c.className = 'site-search-count'; c.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`; host.append(c);
  for (const { page, snippet } of results.slice(0, 80)) {
    const item = document.createElement('div'); item.className = 'tree-item search-result';
    const a = document.createElement('a'); a.className = 'tree-item-self search-result-file-title is-clickable'; a.href = page.url;
    const inner = document.createElement('div'); inner.className = 'tree-item-inner'; inner.textContent = page.name; a.append(inner); item.append(a);
    if (page.path.includes('/')) { const f = document.createElement('div'); f.className = 'search-result-folder'; f.textContent = page.path.slice(0, page.path.lastIndexOf('/')); item.append(f); }
    if (snippet) {
      const m = document.createElement('div'); m.className = 'search-result-file-match';
      m.append(document.createTextNode((snippet.lead ? '…' : '') + snippet.text.slice(0, snippet.start)));
      const mk = document.createElement('mark'); mk.textContent = snippet.text.slice(snippet.start, snippet.start + snippet.len); m.append(mk, document.createTextNode(snippet.text.slice(snippet.start + snippet.len)));
      item.append(m);
    }
    host.append(item);
  }
}
