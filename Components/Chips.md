# Chips

Row of small rounded chips. `items` may be an array, a single value, or empty (renders nothing); `icon` is an optional prefix; `spoiler` blurs the chips until hovered (or focused / tapped on touch screens).

- `<Chips items={["a", "b"]} icon="🏷️" />`
- `<Chips items={["a", "b"]} spoiler />` – blurred until hovered

Import it from a Datacore view with `dc.require(dc.headerLink("Components/Chips.md", "Chips"))`. The code block below is what gets loaded.

```jsx
function Chips({ items, icon, spoiler = false }) {
  const list = items == null ? [] : Array.isArray(items) ? items : [items];
  if (!list.length) return null;
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
    {spoiler && <style>{`
      .dc-chip-spoiler { filter: blur(5px); transition: filter 0.15s; cursor: default; outline: none; }
      .dc-chip-spoiler:is(:hover, :focus) { filter: none; }
    `}</style>}
    {list.map(i => (
      <span key={String(i)} className={spoiler ? "dc-chip-spoiler" : undefined} tabIndex={spoiler ? 0 : undefined} style={{
        background: "var(--background-modifier-hover)",
        borderRadius: "10px", padding: "1px 8px", fontSize: "0.85em"
      }}>{icon ? icon + " " : ""}{i}</span>
    ))}
  </div>;
}

return { Chips };
```
