# Dawn's Promise – published site

A custom static-site generator that turns this Obsidian vault into a website that looks like Obsidian
(Baseline theme + Style Settings, Advanced Multi Column layouts, callouts, properties, embeds), and runs
**Datacore** and **Bases** content in the browser.

```
cd .site
npm ci
npm run build      # -> .site/dist   (VAULT=.. by default)
npm run preview    # serve it locally
npm test           # unit + build tests (fixture vault in tests/fixture)
```

Publishing is automatic: pushing to `main` runs `.github/workflows/pages.yml` and deploys to GitHub Pages
(Settings → Pages → Source: *GitHub Actions*). Folders in `site.config.json → exclude` (Components, Templates, Noel Meta) are never published.
`library` lists excluded folders (here `Components`) that still hold shared Datacore code: their `.js/.jsx/.ts/.tsx` files and notes are shipped to the browser as data (invisible in navigation, search, graph and Bases) so `dc.require("Components/Foo.jsx")` works. Anything in a library folder is therefore downloadable by anyone who inspects the site's assets – keep secrets out of it.
`timezone` in the same file is the timezone dates in your notes are interpreted in.

## Navigation features

* **Backlinks / outgoing links / local graph** under every note (Obsidian-style, with the linking sentence as context).
* **Tags**: every `#tag` and `tags:` pill links to `/tags/<tag>/` (nested tags roll up); `/tags/` lists them all.
* **Search** (sidebar): full text over the published notes. Supports words, `"phrases"`, `-exclude`, `tag:x` / `#x`, `path:x`, `file:x`.
* **Graph view** (`/graph/`, icon next to the site title): force-directed, drag/zoom/pan, hover to highlight, click to open, filter box. It reads `.obsidian/graph.json` at build time, so your Obsidian graph settings carry over after the next push: colour groups (`tag:`, `path:`, `file:`, plain words, `-` negation; property queries are ignored), the base search filter, tags/orphans/arrows, node/line size, text fade and the force sliders.
* Wikilinks printed as plain text by Datacore scripts (e.g. note excerpts) are turned into real links.

## Datacore

Datacore blocks (`datacorejs`, `datacorejsx`, `datacorets`, `datacoretsx`) are executed by **Datacore's own
code** – the plugin's `main.js` is wrapped and run in the browser against a snapshot of the vault:

* The index is built at deploy time with Datacore's own importer (the same worker code Obsidian runs), so pages,
  sections, tasks/list items, tags, links and frontmatter are identical to what Datacore sees in Obsidian.
* Everything in the `dc` API works: `dc.useQuery`/`dc.query` (all of `@page`, `@section`, `@task`, `@list-item`,
  `@block`, …), `dc.Table`, `dc.List`, `dc.Card`, `dc.Callout`, `dc.Markdown`, `dc.Link`, hooks, `dc.require`
  (of `.js/.jsx/.ts/.tsx` files and of code blocks in notes), `dc.app.vault.cachedRead`, luxon, preact …
* `window.moment`, `window.app` (a read-only stand-in), `createEl`, `sleep` … exist for scripts that expect them.
* The plugin version is the one installed in `.obsidian/plugins/datacore`. If a future Datacore release changes
  its internals so much that it can no longer be wrapped, the build prints a warning and falls back to the pinned
  copy in `.site/vendor/datacore` (refresh it with `npm run vendor:datacore`); if neither works the build **fails**
  rather than publishing broken pages.
* Your `data.json` settings (page size, date formats, `renderNullAs`, …) are applied.

Not possible on a static site (these show an error or do nothing, never silently wrong data): anything that writes
to the vault (`app.fileManager`, `vault.modify`), Obsidian UI such as modals/notices, and plugins other than Datacore
that a script reaches through `app.plugins`.

## Bases

`.base` files get their own page (and a *base* tag in the file list), `![[Name.base]]` / `![[Name.base#View]]`
embeds and ```` ```base ```` code blocks render inline. Implemented from Obsidian's documented format:

* `filters` (global and per view; `and` / `or` / `not` and expression strings), `formulas`, `properties`
  (`displayName`), `summaries` (built-ins Average, Min, Max, Sum, Range, Median, Stddev, Earliest, Latest, Span,
  Checked, Unchecked, Empty, Filled, Unique, and custom formulas over `values`), `views`.
* Views: **table** (column order/width, sorting, grouping, limit, summary row), **cards** (image, image fit/aspect,
  card size), **list** (markers, separator, indent properties). A view switcher appears when a base has several views.
* Expressions: `file.*` (name, basename, path, folder, ext, size, ctime, mtime, tags, links, embeds, backlinks,
  properties), `note.*` / bare names, `formula.*`, `this` (the note a base is embedded in, or the base itself),
  operators, date arithmetic (`today() - "1w"`, `date + "1M"`), regular expressions, and the documented function set
  (`if`, `date`, `duration`, `now`, `today`, `link`, `file`, `list`, `number`, `min`, `max`, `html`, `image`, `icon`,
  string / number / list / date / link / file / object / regexp methods including `filter`, `map`, `reduce`).
* `file.ctime` / `mtime` come from git history (the workflow fetches full history).
* Property types come from `.obsidian/types.json` (e.g. a `date` property is a date in expressions).

Anything not implemented is reported on the page instead of being dropped: unknown view types, unknown settings,
unknown functions, formula cycles and invalid filters show a *Base error / Base notice* box; a failing cell shows
`Error` (hover for the message). Excluded folders are not part of the data a base can query.

Interpretation notes (Obsidian's Bases is closed source): `file.name` includes the extension while `file.basename`
does not; `file.tags` and `tags` are listed without `#`; empty lists are truthy.

## Other plugin blocks

If a note contains a ```` ```dataview ````, `tasks`, `meta-bind` … block **and** that plugin is enabled in
`community-plugins.json`, the site shows the source with a notice that it only runs inside Obsidian, and the build
logs a warning. Mermaid diagrams are currently shown as code.

## Tests

* `npm test` – expression engine, build output (using `tests/fixture`, a small vault exercising bases + datacore),
  engine selection/fallback.
* `tests/e2e.py` – browser checks against the built fixture (see the file header; needs Playwright).

## Layout

```
build.mjs            site generator
lib/                 Datacore importer + Obsidian metadata cache (build time), engine wrapper
src/client.js        sidebar, callouts, boots Datacore / Bases
src/datacore-boot.js real Datacore engine in the browser;  src/obsidian-shim.js  Obsidian API stand-in
src/bases/           Bases expression engine;  src/bases-boot.js  rendering
src/*.css            base layout, Bases, Multi Column dynamic settings
vendor/datacore/     pinned Datacore snapshot (fallback)
tests/               unit tests, fixture vault, e2e
```
