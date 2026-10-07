import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildFixture } from './build-fixture.mjs';

const { out, stdout } = buildFixture();
const read = p => fs.readFileSync(path.join(out, p), 'utf8');
const pageData = html => JSON.parse(/window\.__PAGE=(\{.*?\});<\/script>/s.exec(html)[1].replace(/\\u003c/g, '<'));

test('build succeeds and uses a Datacore engine', () => {
  assert.match(stdout, /\[datacore\] engine:/);
  assert.match(stdout, /Built 6 notes, 2 bases/);
});
test('vault.json carries file metadata, bases and scripts', () => {
  const v = JSON.parse(read('assets/vault.json'));
  assert.equal(v.bases.length, 2);
  assert.equal(v.scripts.length, 4); // helpers.js + 3 hidden library files
  assert.equal(v.propertyTypes.finished, 'date');
  const dune = v.pages.find(p => p.path === 'Books/Dune.md');
  assert.ok(dune.ctime > 0 && dune.size > 0);
  assert.deepEqual(dune.links, ['People/Frank Herbert.md']);
  const frank = v.pages.find(p => p.path === 'People/Frank Herbert.md');
  assert.ok(frank.backlinks.includes('Books/Dune.md'));
});
test('datacore index is produced by the real importer', () => {
  const idx = JSON.parse(read('assets/datacore-index.json'));
  assert.equal(idx.pages.length, 8); // 6 notes + 2 library notes
  const dune = idx.pages.find(p => p.$path === 'Books/Dune.md');
  assert.ok(dune.$sections.length >= 1);
  assert.ok(fs.statSync(path.join(out, 'assets/datacore-engine.js')).size > 500000);
});
test('base blocks and embeds are emitted with specs; missing ones are loud', () => {
  const data = pageData(read('home/index.html'));
  assert.equal(data.bases.length, 4); // 3 embeds + 1 inline
  assert.deepEqual(data.bases.map(b => b.kind), ['file', 'file', 'file', 'inline']);
  assert.equal(data.bases[0].view, 'Table');
  assert.match(read('home/index.html'), /is-unresolved">Nope\.base/);
  assert.match(stdout + '', /./); // build output exists
});
test('.base files get their own pages and nav entries', () => {
  assert.ok(fs.existsSync(path.join(out, 'books-base/index.html')));
  assert.match(read('home/index.html'), /nav-file-tag">base</);
});
test('datacore blocks keep their raw source for the real engine', () => {
  const data = pageData(read('datacore-demo/index.html'));
  assert.equal(data.dc.length, 7);
  assert.ok(data.dc.some(b => b.lang === 'datacoretsx' && /any\[\]/.test(b.code)));
  assert.ok(data.dc.every(b => b.path === 'Datacore Demo.md'));
});

test('body carries the Style Settings root class so Baseline colour rules apply', () => {
  assert.match(read('home/index.html'), /<body class="css-settings-manager /);
});

test('accent colour scale and pointer tags are in the stylesheet', () => {
  const css = read('assets/site.css');
  assert.match(css, /\.tree-item-self \{ position: relative; \}/);
  assert.match(css, /a\.internal-link\.is-unresolved[^{]*\{[^}]*color-mix\(in oklch, currentColor 75%, var\(--text-accent\) 25%\)/);
  assert.match(css, /--color-accent: hsl\(var\(--accent-h/);
  assert.match(css, /a\.tag[^{]*\{[^}]*cursor: pointer/);
});

test('tags, backlinks, graph and tag links are published', () => {
  assert.ok(fs.existsSync(path.join(out, 'tags/index.html')));
  assert.match(read('tags/scifi/index.html'), /Dune/);
  assert.match(read('tags/scifi/index.html'), /Neuromancer/);
  assert.match(read('frank-herbert/index.html'), /site-links-pane[\s\S]*Backlinks[\s\S]*Dune/);
  assert.match(read('dune/index.html'), /href="\/tags\/important\/" class="tag"/);
  const g = JSON.parse(read('assets/graph.json'));
  assert.equal(g.nodes.length, 6);
  assert.ok(g.edges.some(([a, b]) => a === 'Books/Dune.md' && b === 'People/Frank Herbert.md'));
  assert.ok(fs.existsSync(path.join(out, 'graph/index.html')));
  assert.deepEqual(g.settings.colorGroups, [{ query: 'tag:#scifi', color: 'rgba(255, 0, 0, 1)' }]);
  assert.equal(g.settings.showArrow, true);
});

test('Components/ is unpublished but its scripts ship for dc.require', () => {
  assert.ok(!fs.existsSync(path.join(out, 'secret-component-notes')));
  const v = JSON.parse(read('assets/vault.json'));
  assert.ok(!v.pages.some(p => p.path.startsWith('Components/')));
  const g = JSON.parse(read('assets/graph.json'));
  assert.ok(!g.nodes.some(n => n.id.startsWith('Components/')));
  const badge = v.scripts.find(s => s.path === 'Components/Badge.jsx');
  assert.ok(badge && badge.hidden);
  assert.ok(!read('home/index.html').includes('Components/'));
  const idx = JSON.parse(read('assets/datacore-index.json'));
  assert.ok(idx.pages.some(p => p.$path === 'Components/Secret.md'));
});
