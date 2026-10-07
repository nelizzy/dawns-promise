// Picks a Datacore build and wraps it so the *real* plugin code (query engine, hooks, Table/Card/...
// components, JSX transpiler, dc.require) runs in the browser against our Obsidian shim.
import fs from 'node:fs';
import { createDatacoreImporter } from './datacore-worker.mjs';

// Top-level names of the bundle that the browser runtime needs.
export const REQUIRED_NAMES = ['Datastore', 'DatacoreApi', 'MarkdownPage', 'MarkdownListBlock', 'GenericFile', 'DEFAULT_SETTINGS', 'Link', 'Literals'];
const OPTIONAL_NAMES = ['Canvas', 'CanvasTextCard', 'INDEXABLE_EXTENSIONS'];

function check(src) {
  const missing = REQUIRED_NAMES.filter(n => !new RegExp(`^(?:var|let|const|class|function)\\s+${n}\\b`, 'm').test(src));
  if (missing.length) throw new Error('missing internals: ' + missing.join(', '));
  createDatacoreImporter(src); // throws if the worker importer cannot be extracted/run
}

/** candidates: [{label, file}] in priority order; returns {src, label}. */
export function loadDatacoreSource(candidates, warn = console.warn) {
  const errors = [];
  for (const c of candidates) {
    if (!fs.existsSync(c.file)) continue;
    const src = fs.readFileSync(c.file, 'utf8');
    try { check(src); return { src, label: c.label }; } catch (e) { errors.push(`${c.label}: ${e.message}`); warn(`[datacore] ${c.label} is not usable (${e.message}); trying next candidate`); }
  }
  throw new Error('No usable Datacore build found. ' + errors.join(' | '));
}

/** Browser bundle: the plugin's main.js inside a function, plus an export epilogue. */
export function buildEngineBundle(src) {
  const names = [...REQUIRED_NAMES, ...OPTIONAL_NAMES.filter(n => new RegExp(`^(?:var|let|const|class|function)\\s+${n}\\b`, 'm').test(src))];
  const epilogue = `\nreturn { ${names.join(', ')} };\n`;
  return `window.__datacoreEngine = function (require) {\nvar module = { exports: {} }, exports = module.exports;\n${src}\n${epilogue}};\n`;
}
