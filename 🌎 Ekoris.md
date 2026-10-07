---
tags:
  - location/world
---
# 🌎 Ekoris
![](https://res.cloudinary.com/sk0qaemk/image/upload/v1791292640/s43bdgi18nybhngkadp7.jpg)

Many areas of the map are still blank - Partially because this is a world still in progress, and partially to leave space open for characters who do not fit into another established country.

Ekoris uses the Golarion pantheon for deities. 

There are other continents than Ekoris in the world, but they are largely out of the scope of this game.

A cold war has been maintained for nearly a century between the two main powers of [[The Hassan Dynasty]], [[The Bodin Union]], and their respective satellite states. 

# Geography and the Four Elements

Geography on Ekoris does not follow the same rules as they do in the real world. A region is hot, not because of the conditions of mountains & latitude, but because it had a stronger connection to the plane of fire. An area’s climate is determined by connection to each of the [[four elements]]. 

Additionally, the elements are not zero sum. It’s possible to have an area of high everything, or low everything. Extremes, both high and low, tend to be dangerous or lethal. These are all regional effects, typically shifting over the course of hundreds of miles.

| Element | High                                                                                                                           | Low                                                                                                                                                                                                                                                                                                                |
| :------ | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fire    | hot climate                                                                                                                    | cold climate                                                                                                                                                                                                                                                                                                       |
| Earth   | uneven terrain (more hills, mountains, things like that)                                                                       | flatlands, often plains / tundra / desert depending on factors. Gravity can grow unstable at extremely weak or strong earth                                                                                                                                                                                        |
| Water   | rains, rivers, natural water presence. (high earth + high water regions tend to have potentially massive high elevation lakes) | dry lands. evaporation can accelerate, in extreme cases, causing supernaturally swift dehydration.                                                                                                                                                                                                                 |
| Air     | high winds, higher chance of storms, tornados, and hurricanes.                                                                 | stillness. potentially deadly for sailors without effective oars. <br><br>extremely low air areas are dangerous, with supernaturally low circulation. air in some areas has little or no oxygen within. something like a released inhaled poison may last for hours, days, even years instead of mere moments.<br> |

# Regions

```datacorejsx
const EMOJI = { d_maj: "🌟", d_min: "✨" };

const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

const { Card } = await dc.require(dc.headerLink("Components/Card.md", "Card"));
const { Chips } = await dc.require(dc.headerLink("Components/Chips.md", "Chips"));
const { Description } = await dc.require(dc.headerLink("Components/Description.md", "Description"));

function CountryCard({ p }) {
  const v = k => p.value(k);
  const elements = [["🔥", "fire"], ["💧", "water"], ["⛰️", "earth"], ["💨", "air"]];
  const deities = [ ...arr(v("deities_major")).map(d => "🌟 " + d), ...arr(v("deities_minor")).map(d => "✨ " + d), ];
  return <Card link={p.$link}>
    <div style={{ display: "flex", gap: "2px 12px", fontSize: "0.85em" }}>
      {elements.map(([icon, key]) => (
        <span key={key}>{icon} {v(key) || "?"}</span>
      ))}
    </div>
    <Chips items={arr(v("races"))}/>
    <Chips items={deities} icon="" />
    <Description path={p.$path} foldable={true}/>
  </Card>;
}

return function View() {
  const pages = dc.useQuery("@page and #location/country");
  const sorted = [...pages].sort((a, b) => a.$name.localeCompare(b.$name));
  return <div style={{
    display: "grid",
    justifyContent: "center",
    gridTemplateColumns: "repeat(auto-fill, minmax(35ch, 1fr))",
    gap: "12px"
  }}>
    {sorted.map(p => <CountryCard key={p.$path} p={p} />)}
  </div>;
}
```

# Races
```datacorejsx
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

const { Card } = await dc.require(dc.headerLink("Components/Card.md", "Card"));
const { Description } = await dc.require(dc.headerLink("Components/Description.md", "Description"));

// "group" may be plain text, a [[link]] or empty
function groupOf(p) {
  const x = arr(p.value("group"))[0];
  if (x == null || x === "") return null;
  return (typeof x === "string" ? x : (x.display ?? x.path ?? String(x))).replace(/\.md$/, "").trim() || null;
}

function RaceCard({ p }) {
  const playable = p.value("playable") !== false;
  const aside = playable ? null : <span style={{
    background: "var(--background-modifier-hover)",
    borderRadius: "10px", padding: "1px 8px", alignSelf: "center", fontSize: "0.85em", whiteSpace: "nowrap",
  }}>🚫 Not playable</span>;
  return <Card link={p.$link} aside={aside} dim={!playable}>
    <Description path={p.$path} foldable={true} />
  </Card>;
}

const grid = {
  display: "grid",
  justifyContent: "center",
  gridTemplateColumns: "repeat(auto-fill, minmax(35ch, 1fr))",
  gap: "12px",
};

return function View() {
  // any race note that sets `playable` (true or false); unplayable ones are shown, marked as such
  const all = dc.useQuery("#race and @page");
  const pages = all.filter(p => p.value("playable") != null);

  // sort by group (or the race's own name when it has none), then by name within the group,
  // so e.g. Drow, Sun Elves and Wild Elves all land where "Elves" would
  const key = p => (groupOf(p) ?? p.$name).toLowerCase();
  const sorted = [...pages].sort((a, b) =>
    key(a).localeCompare(key(b)) || a.$name.localeCompare(b.$name));

  return <div style={grid}>
    {sorted.map(p => <RaceCard key={p.$path} p={p} />)}
  </div>;
}
```
