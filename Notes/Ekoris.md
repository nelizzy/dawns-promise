---
tags:
  - location/world
---
# Ekoris
![](https://res.cloudinary.com/sk0qaemk/image/upload/v1791292640/s43bdgi18nybhngkadp7.jpg)

Many areas of the map are still blank - Partially because this is a world still in progress, and partially to leave space open for characters who do not fit into another established country.

Ekoris uses the Golarion pantheon for deities. 

There are other continents than Ekoris in the world, but they are largely out of the scope of this game.

A cold war has been maintained for nearly a century between the two main powers of [[The Hassan Dynasty]], [[The Bodin Union]], and their respective satellite states. 

Geography on Ekoris does not follow the same rules as they do in the real world. A region is hot, not because of the conditions of mountains & latitude, but because it had a stronger connection to the plane of fire. An area’s climate is determined by connection to each of the [[four elements]]. 

Additionally, the elements are not zero sum. It’s possible to have an area of high everything, or low everything. Extremes, both high and low, tend to be dangerous or lethal. These are all regional effects, typically shifting over the course of hundreds of miles.

| Element | High                                                                                                                           | Low                                                                                                                                                                                                                                                                                                                |
| :------ | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fire    | hot climate                                                                                                                    | cold climate                                                                                                                                                                                                                                                                                                       |
| Earth   | uneven terrain (more hills, mountains, things like that)                                                                       | flatlands, often plains / tundra / desert depending on factors. Gravity can grow unstable at extremely weak or strong earth                                                                                                                                                                                        |
| Water   | rains, rivers, natural water presence. (high earth + high water regions tend to have potentially massive high elevation lakes) | dry lands. evaporation can accelerate, in extreme cases, causing supernaturally swift dehydration.                                                                                                                                                                                                                 |
| Air     | high winds, higher chance of storms, tornados, and hurricanes.                                                                 | stillness. potentially deadly for sailors without effective oars. <br><br>extremely low air areas are dangerous, with supernaturally low circulation. air in some areas has little or no oxygen within. something like a released inhaled poison may last for hours, days, even years instead of mere moments.<br> |


```datacorejsx
const EMOJI = { d_maj: "🌟", d_min: "✨" };

const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

function Chips({ items, icon }) {
  if (!items.length) return null;
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
    {items.map(i => (
      <span key={icon + i} style={{
        background: "var(--background-modifier-hover)",
        borderRadius: "10px", padding: "1px 8px", fontSize: "0.85em"
      }}>{icon} {i}</span>
    ))}
  </div>;
}

function Description({ path }) {
  const [text, setText] = dc.useState("");

  dc.useEffect(() => {
    let alive = true;
    const file = dc.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    dc.app.vault.cachedRead(file).then(raw => {
      if (!alive) return;
      const body = raw
        .replace(/^---\n[\s\S]*?\n---\n?/, "")   // strip frontmatter
        .replace(/^#\s.*\n?/m, "")               // strip the "# Country" heading
        .replace(/^>\s?/gm, "")                  // unquote the Harath-style notes
        .trim();
      setText(body);
    });
    return () => { alive = false; };
  }, [path]);

  if (!text) return null;
  return <div
    style={{
      fontSize: "0.85em",
      color: "var(--text-muted)",
      cursor: "pointer",
      whiteSpace: "pre-wrap",
    }}
  >{text}</div>;
}

function Card({ p }) {
  const v = k => p.value(k);
  const elements = [["🔥", "fire"], ["💧", "water"], ["⛰️", "earth"], ["💨", "air"]];
  const deities = [ ...arr(v("deities_major")).map(d => "🌟 " + d), ...arr(v("deities_minor")).map(d => "✨ " + d), ];
  return <div style={{
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "8px", padding: "12px",
    display: "flex", flexDirection: "column", gap: "8px"
  }}>
    <div style={{ fontWeight: "bold", fontSize: "1.1em" }}>
      <dc.Link link={p.$link} />
    </div>
    <div style={{ display: "flex", gap: "2px 12px", fontSize: "0.85em" }}>
      {elements.map(([icon, key]) => (
        <span key={key}>{icon} {v(key) || "?"}</span>
      ))}
    </div>
    <Chips items={arr(v("races"))}/>
    <Chips items={deities} icon="" />
    <Description path={p.$path} />
  </div>;
}

return function View() {
  const pages = dc.useQuery("@page and #location/country");
  const sorted = [...pages].sort((a, b) => a.$name.localeCompare(b.$name));
  return <div style={{
    display: "grid",
    justifyContent: "center",
    gridTemplateColumns: "var(--file-line-width)",
    gap: "12px"
  }}>
    {sorted.map(p => <Card key={p.$path} p={p} />)}
  </div>;
}
```