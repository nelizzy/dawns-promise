// Builds tests/fixture into a temp dir using the vault's real .obsidian (theme, plugins) plus the fixture's types.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
export function buildFixture({ out = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-fixture-')), base = '' } = {}) {
  const realObs = process.env.REAL_OBSIDIAN || path.resolve(SITE, '..', '.obsidian');
  const obs = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-obs-'));
  fs.cpSync(realObs, obs, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'fixture/.obsidian/types.json'), path.join(obs, 'types.json'));
  fs.writeFileSync(path.join(obs, 'graph.json'), JSON.stringify({ search: '', showArrow: true, colorGroups: [{ query: 'tag:#scifi', color: { a: 1, rgb: 16711680 } }] }));
  const stdout = execFileSync('node', ['build.mjs'], { cwd: SITE, encoding: 'utf8', env: { ...process.env, VAULT: path.join(HERE, 'fixture'), OUT: out, OBSIDIAN_DIR: obs, SITE_BASE: base, TZ: 'Europe/Copenhagen' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { out, stdout };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { out, stdout } = buildFixture({ out: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
  console.log(stdout.trim()); console.log('fixture built at', out);
}
