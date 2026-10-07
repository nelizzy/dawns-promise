# Card

Bordered card shell with a bold linked title; children are the body. `aside` sits at the right of the title row (the title link's hover/click area stretches across the whole row, behind `aside`), `dim` fades the card.

- `<Card link={p.$link} aside={<span>🟢 Open</span>} dim={isClosed}> … </Card>`

Import it from a Datacore view with `dc.require(dc.headerLink("Components/Card.md", "Card"))`. The code block below is what gets loaded.

```jsx
function Card({ link, aside, dim = false, children }) {
  return <div style={{
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "8px", padding: "12px",
    display: "flex", flexDirection: "column", gap: "8px",
    opacity: dim ? 0.7 : 1,
  }}>
    <div className="dc-card-title" style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: "8px" }}>
      <style>{`
        .dc-card-title a::after { content: ""; position: absolute; inset: 0; }
        .dc-card-title .dc-card-aside { position: relative; z-index: 1; }
      `}</style>
      <span style={{ fontWeight: "bold", fontSize: "1.1em" }}><dc.Link link={link} /></span>
      {aside != null ? <span className="dc-card-aside">{aside}</span> : null}
    </div>
    {children}
  </div>;
}

return { Card };
```
