// Refreshes the pinned Datacore snapshot from the copy installed in the vault.
// The build prefers the vault's installed plugin and falls back to this snapshot if that build is incompatible.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatacoreSource } from '../lib/datacore-engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(HERE, '..', '..', '.obsidian/plugins/datacore/main.js');
const to = path.resolve(HERE, '..', 'vendor/datacore/main.js');
const { src } = loadDatacoreSource([{ label: 'installed plugin', file: from }]);
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.writeFileSync(to, src);
const manifest = path.resolve(path.dirname(from), 'manifest.json');
if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.resolve(path.dirname(to), 'manifest.json'));
console.log('vendored Datacore ->', path.relative(process.cwd(), to));
