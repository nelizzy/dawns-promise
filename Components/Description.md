# Description

Shows the body text of a note rendered as Markdown (so wikilinks work). Frontmatter, the first `# Title` heading and leading `>` quote marks are removed. Whole-note embeds (`![[Note]]`) are inlined under a small heading rather than using Obsidian's embed styling. Folding is opt-in.

- `<Description path={p.$path} />` – always fully shown
- `<Description path={p.$path} foldable />` – clamped; click to expand / collapse
- `<Description path={p.$path} foldable lines={6} />` – fold after 6 lines (default 10)
- `<Description path={p.$path} foldable defaultOpen />` – start expanded

Import it from a Datacore view with `dc.require(dc.headerLink("Components/Description.md", "Description"))`. The code block below is what gets loaded.

```jsx
// Frontmatter, the first "# Title" heading and leading ">" quote marks are removed.
const clean = raw => raw
  .replace(/^---\n[\s\S]*?\n---\n?/, "")
  .replace(/^#\s.*\n?/m, "")
  .replace(/^>\s?/gm, "")
  .trim();

// Whole-note embeds (![[Note]] on a line of their own) are inlined as the note's text under a small
// heading, so they take on this component's size and colour instead of Obsidian's embed styling.
// Anything else (images, .base files, ![[Note#Section]]) is left for Markdown to render as usual.
async function expandEmbeds(text, sourcePath, depth = 0, seen = [sourcePath]) {
  if (depth > 3) return text;
  const found = [...text.matchAll(/^[ \t]*!\[\[([^\]|#]+)(?:\|[^\]]*)?\]\][ \t]*$/gm)];
  let out = text;
  for (const [whole, target] of found) {
    const f = dc.app.metadataCache.getFirstLinkpathDest(target.trim(), sourcePath);
    if (!f || f.extension !== "md" || seen.includes(f.path)) continue;
    const body = await expandEmbeds(clean(await dc.app.vault.cachedRead(f)), f.path, depth + 1, [...seen, f.path]);
    out = out.replace(whole, () => "### " + f.basename + "\n\n" + body);
  }
  return out;
}

function Description({ path, foldable = false, lines = 10, defaultOpen = false }) {
  const [text, setText] = dc.useState("");
  const [open, setOpen] = dc.useState(defaultOpen);

  dc.useEffect(() => {
    let alive = true;
    const file = dc.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    dc.app.vault.cachedRead(file)
      .then(raw => expandEmbeds(clean(raw), path))
      .then(t => { if (alive) setText(t); });
    return () => { alive = false; };
  }, [path]);

  if (!text) return null;
  const folded = foldable && !open;
  return <div
    className="dc-description"
    onClick={foldable ? () => setOpen(!open) : undefined}
    title={foldable ? (open ? "Click to collapse" : "Click to expand") : undefined}
    style={{
      fontSize: "0.85em", color: "var(--text-muted)",
      cursor: foldable ? "pointer" : "default",
      ...(folded ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" } : {}),
    }}
  >
    <style>{`
      .dc-description > span { display: block; }
      .dc-description p { margin: 0 0 0.6em; }
      .dc-description p:last-child { margin-bottom: 0; }
      .dc-description :is(h1, h2, h3, h4, h5, h6) { font-size: 1em; font-weight: 600; margin: 0.6em 0 0.2em; color: var(--text-normal); }
    `}</style>
    <dc.Markdown content={text} sourcePath={path} inline={false} />
  </div>;
}

return { Description };
```
