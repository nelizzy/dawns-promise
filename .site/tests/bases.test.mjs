import test from 'node:test';
import assert from 'node:assert/strict';
import { BasesEnv, Evaluator, parseBase, runView, entriesFromVault } from '../src/bases/engine.js';
import { BDate, BDuration, toStr } from '../src/bases/values.js';

const day = s => new Date(s + 'T00:00:00').getTime();
const vault = {
  pages: [
    { path: 'Books/Dune.md', fm: { author: '[[Frank Herbert]]', year: 1965, tags: ['book', 'scifi'], read: true, finished: '2024-02-10', price: 9.5, status: 'done' }, tags: ['book', 'scifi'], links: ['People/Frank Herbert.md'], embeds: [], backlinks: [], ctime: day('2024-01-01'), mtime: day('2024-03-01'), size: 100, url: '/dune/' },
    { path: 'Books/Emma.md', fm: { author: 'Jane Austen', year: 1815, tags: ['book'], read: false, price: 4, status: 'todo' }, tags: ['book'], links: [], embeds: [], backlinks: [], ctime: day('2024-01-02'), mtime: day('2024-01-02'), size: 50, url: '/emma/' },
    { path: 'Books/Neuromancer.md', fm: { author: 'William Gibson', year: 1984, tags: ['book', 'scifi'], read: true, finished: '2023-12-25', price: 12, status: 'done' }, tags: ['book', 'scifi'], links: [], embeds: [], backlinks: [], ctime: day('2024-01-03'), mtime: day('2024-01-03'), size: 70, url: '/neuromancer/' },
    { path: 'People/Frank Herbert.md', fm: { born: '1920-10-08' }, tags: ['person'], links: [], embeds: [], backlinks: ['Books/Dune.md'], ctime: day('2023-01-01'), mtime: day('2023-01-01'), size: 10, url: '/frank/' },
    { path: 'Home.md', fm: {}, tags: [], links: ['Books/Dune.md'], embeds: [], backlinks: [], ctime: day('2023-01-01'), mtime: day('2023-01-01'), size: 10, url: '/' },
  ],
};
const NOW = new Date('2024-06-15T12:00:00').getTime();
const mkEnv = () => new BasesEnv({ entries: entriesFromVault(vault), propertyTypes: { finished: 'date', born: 'date' }, now: () => NOW });
const run = (yamlText, opts = {}) => { const env = mkEnv(); const base = parseBase(yamlText); assert.deepEqual(base.errors, []); return { base, res: runView(env, base, base.views[0], opts), env }; };
const names = res => res.rows.map(r => r.entry.basename);
const evalExpr = (src, entryPath = 'Books/Dune.md', thisPath = null) => { const env = mkEnv(); const ev = new Evaluator(env, { formulas: {} }); const entry = env.byPath.get(entryPath.toLowerCase()); return ev.evaluate(src, { entry, thisEntry: thisPath ? env.byPath.get(thisPath.toLowerCase()) : entry, scope: {} }); };

test('filters: and / or / not and string expressions', () => {
  const { res } = run(`filters:\n  and:\n    - file.inFolder("Books")\n    - or:\n        - read == true\n        - price < 5\n    - not:\n        - file.name == "Emma.md"\nviews:\n  - type: table\n    name: T\n    order: [file.name]\n`);
  assert.deepEqual(names(res), ['Dune', 'Neuromancer']);
});
test('tags and links helpers', () => {
  assert.equal(evalExpr('file.hasTag("scifi")'), true);
  assert.equal(evalExpr('file.hasTag("fantasy")'), false);
  assert.equal(evalExpr('file.hasLink("Frank Herbert")'), true);
  assert.equal(evalExpr('author.asFile().path'), 'People/Frank Herbert.md');
});
test('arithmetic, strings, numbers', () => {
  assert.equal(evalExpr('price * 2 + 1'), 20);
  assert.equal(evalExpr('"a" + 1'), 'a1');
  assert.equal(evalExpr('(2.555).round(2)'), 2.56);
  assert.equal(evalExpr('"Hello World".lower().contains("world")'), true);
  assert.equal(evalExpr('"a,b,c".split(",").length'), 3);
  assert.equal(evalExpr('"abc".replace(/b/, "X")'), 'aXc');
  assert.equal(evalExpr('"hello world".title()'), 'Hello World');
  assert.equal(evalExpr('if(read, "yes", "no")'), 'yes');
  assert.equal(evalExpr('if(read == false, "yes")', 'Books/Emma.md'), 'yes');
});
test('lists: filter/map/reduce/sort/unique', () => {
  assert.deepEqual(evalExpr('[1,2,3,4].filter(value % 2 == 0)'), [2, 4]);
  assert.deepEqual(evalExpr('[1,2,3].map(value * index)'), [0, 2, 6]);
  assert.equal(evalExpr('[1,2,3].reduce(acc + value, 0)'), 6);
  assert.deepEqual(evalExpr('[3,1,2,1].unique().sort()'), [1, 2, 3]);
  assert.equal(evalExpr('tags.contains("scifi")'), true);
  assert.equal(evalExpr('tags.join(" | ")'), 'book | scifi');
});
test('dates and durations', () => {
  const d = evalExpr('finished');
  assert.ok(d instanceof BDate && !d.hasTime);
  assert.equal(evalExpr('finished.format("YYYY/MM/DD")'), '2024/02/10');
  assert.equal(evalExpr('finished.year'), 2024);
  assert.equal(evalExpr('(today() - finished).days.round()'), 126);
  assert.equal(evalExpr('finished + "1M" == date("2024-03-10")'), true);
  assert.equal(evalExpr('now() > finished'), true);
  assert.equal(evalExpr('date("2024-01-01") < "2024-06-01"'), true);
  assert.ok(evalExpr('today() - "1w"') instanceof BDate);
  assert.equal(toStr(evalExpr('duration("1d 2h")')), '1d 2h');
});
test('formulas, circular detection, unknown functions are errors not silence', () => {
  const { res } = run(`formulas:\n  double: price * 2\n  label: 'file.basename + " (" + year + ")"'\n  loop: formula.loop2\n  loop2: formula.loop\n  bad: nope(1)\nproperties:\n  formula.double:\n    displayName: Twice\nviews:\n  - type: table\n    name: T\n    filters: 'file.inFolder("Books")'\n    order: [formula.label, formula.double, formula.loop, formula.bad]\n`);
  assert.equal(res.columns[1].name, 'Twice');
  const dune = res.rows.find(r => r.entry.basename === 'Dune');
  assert.equal(dune.cells['formula.double'].value, 19);
  assert.equal(dune.cells['formula.label'].value, 'Dune (1965)');
  assert.match(dune.cells['formula.loop'].error, /Circular/);
  assert.match(dune.cells['formula.bad'].error, /Unknown function "nope\(\)"/);
});
test('sort, group, limit', () => {
  const { res } = run(`filters: 'file.inFolder("Books")'\nviews:\n  - type: table\n    name: T\n    order: [file.name, year]\n    sort:\n      - property: year\n        direction: DESC\n    groupBy:\n      property: status\n      direction: ASC\n    limit: 2\n`);
  assert.deepEqual(res.groups.map(g => g.key), ['done', 'todo'].slice(0, res.groups.length));
  assert.equal(res.total, 2);
  assert.deepEqual(names(res), ['Neuromancer', 'Dune']);
});
test('summaries: built-in and custom', () => {
  const { res } = run(`filters: 'file.inFolder("Books")'\nsummaries:\n  total: values.sum()\nviews:\n  - type: table\n    name: T\n    order: [price, year, read]\n    summaries:\n      price: Average\n      year: total\n      read: Checked\n`);
  assert.equal(res.summaries.price.value, (9.5 + 4 + 12) / 3);
  assert.equal(res.summaries.year.value, 1965 + 1815 + 1984);
  assert.equal(res.summaries.read.value, 2);
});
test('this context: backlinks to the embedding note', () => {
  const { res } = run(`filters: 'file.hasLink(this.file)'\nviews:\n  - type: list\n    name: L\n`, { thisEntry: mkEnv().byPath.get('books/dune.md') });
  assert.deepEqual(names(res), ['Home']);
});
test('unsupported view types and unknown settings are reported', () => {
  const base = parseBase(`futureThing: 1\nviews:\n  - type: calendar\n    name: C\n    wibble: 2\n`);
  assert.ok(base.warnings.some(w => /futureThing/.test(w)));
  assert.ok(base.warnings.some(w => /wibble/.test(w)));
  const res = runView(mkEnv(), base, base.views[0]);
  assert.ok(res.errors.some(e => /calendar/.test(e)));
});
test('filter errors are surfaced', () => {
  const base = parseBase(`filters: 'file.nope('\nviews: [{type: table, name: T}]\n`);
  const res = runView(mkEnv(), base, base.views[0]);
  assert.ok(res.errors.length > 0);
});
