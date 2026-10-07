// Runs Datacore's own importer (the inline web worker bundled in its main.js) in Node, so the pages
// we index are byte-for-byte what Datacore would have produced inside Obsidian.
import vm from 'node:vm';

function extractInlineWorker(src) {
  const key = "inlineWorker('";
  const start = src.indexOf(key);
  if (start < 0) throw new Error('Datacore bundle has no inlineWorker(...) importer; unsupported Datacore version');
  let i = start + key.length;
  const from = i;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === "'") break;
    i++;
  }
  // The literal is a regular single-quoted JS string; let JS decode its escapes.
  return new Function('return ' + "'" + src.slice(from, i) + "'")();
}

export function createDatacoreImporter(mainJsSource) {
  const code = extractInlineWorker(mainJsSource);
  let result = null;
  const sandbox = {
    postMessage: m => { result = m; },
    console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, performance,
  };
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: 'datacore-importer.worker.js' });
  if (typeof ctx.onmessage !== 'function') throw new Error('Datacore importer did not register onmessage');
  return async function importMarkdown(path, contents, metadata, stat) {
    result = null;
    await ctx.onmessage({ data: { type: 'markdown', path, contents, metadata, stat } });
    if (!result) throw new Error('importer produced no result for ' + path);
    if (result.$error) throw new Error(result.$error);
    return result.result;
  };
}
