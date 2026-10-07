import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatacoreSource, buildEngineBundle } from '../lib/datacore-engine.mjs';

const vendored = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vendor/datacore/main.js');

test('an incompatible installed Datacore falls back to the vendored snapshot, with a warning', () => {
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')), 'main.js');
  fs.writeFileSync(bad, 'var Something = 1; module.exports = {};');
  const warnings = [];
  const { label } = loadDatacoreSource([{ label: 'installed', file: bad }, { label: 'vendored', file: vendored }], m => warnings.push(m));
  assert.equal(label, 'vendored');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /installed is not usable/);
});
test('with nothing usable the build fails loudly', () => {
  assert.throws(() => loadDatacoreSource([{ label: 'none', file: '/nonexistent/main.js' }], () => {}), /No usable Datacore build/);
});
test('engine bundle exports the internals the browser needs', () => {
  const src = fs.readFileSync(vendored, 'utf8');
  const out = buildEngineBundle(src);
  assert.match(out, /return \{ Datastore, DatacoreApi, MarkdownPage, MarkdownListBlock, GenericFile, DEFAULT_SETTINGS, Link, Literals/);
});
