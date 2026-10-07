<%*
const raw = await tp.system.prompt("Paste country block", "", true, true);

// drop blank lines, "_ _" separators, and markdown bold/italic markers
const lines = raw
  .replace(/\*\*/g, "")
  .split("\n")
  .map(l => l.trim())
  .filter(l => l && !/^[_\s*-]+$/.test(l));

const keyRe = /^(elements|major deities|minor deities|population|dominant|prominent|minor)\s*:\s*(.*)$/i;

// first line is "Name: first paragraph"
const first = lines.shift();
const i0 = first.indexOf(":");
const name = first.slice(0, i0).trim();
const paras = [first.slice(i0 + 1).trim()];

// remaining lines: known keys go into f, anything before the first key is more description
const f = {};
for (const l of lines) {
  const m = l.match(keyRe);
  if (m) f[m[1].toLowerCase()] = m[2].trim();
  else if (Object.keys(f).length === 0) paras.push(l);
}

const clean = s => s.split(",").map(x => x.trim()).filter(Boolean);

// deities: "None – explanation" -> [] plus a note; "Unknown" -> []
const notes = [];
const deities = s => {
  if (!s) return [];
  const [main, ...rest] = s.split(/\s+[–—-]\s+/);
  if (rest.length) notes.push(rest.join(" - ").trim());
  return clean(main).filter(x => !/^(none|unknown)$/i.test(x));
};

// "Very Low Fire, Medium Water, ..." -> {fire: "Very Low", water: "Med", ...}
const el = {};
for (const part of (f.elements || "").split(",")) {
  const m = part.trim().match(/^(.*?)\s+(fire|water|earth|air)$/i);
  if (m) el[m[2].toLowerCase()] = m[1].replace(/^medium/i, "Med").replace(/\bmedium\b/i, "Med");
}

const major = deities(f["major deities"]);
const minor = deities(f["minor deities"]);

// "30-35% Orc, 25-30% Half Orc, 8-12% each Goblin, Hobgoblin, Human, 10-15% Other"
// -> ["Orc 30-35%", "Half Orc 25-30%", "Goblin 8-12%", ..., "Other 10-15%"]
const parseRaces = s => {
  const out = [];
  const re = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%\s*(?:each\s+)?(.*?)(?=\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*%|$)/gi;
  for (const m of (s || "").matchAll(re)) {
    const lo = parseFloat(m[1]);
    const hi = m[2] ? parseFloat(m[2]) : lo;
    const pct = m[2] ? `${m[1]}-${m[2]}%` : `${m[1]}%`;
    for (const r of m[3].split(",").map(x => x.trim()).filter(Boolean))
      out.push({ r, mid: (lo + hi) / 2, pct });
  }
  // sort by midpoint of the range, highest first; "Other" always last
  out.sort((a, b) => (a.r === "Other") - (b.r === "Other") || b.mid - a.mid);
  return out.map(o => `${o.r} ${o.pct}`);
};
const races = parseRaces(f.population);

// await tp.file.rename(name);
await tp.file.move("Notes/" + name);  // or reuse your auto-folder logic
-%>
---
fire: <% JSON.stringify(el.fire ?? "") %>
water: <% JSON.stringify(el.water ?? "") %>
earth: <% JSON.stringify(el.earth ?? "") %>
air: <% JSON.stringify(el.air ?? "") %>
deities_major: <% JSON.stringify(major) %>
deities_minor: <% JSON.stringify(minor) %>
population: <% JSON.stringify(f.population ?? "") %>
races: <% JSON.stringify(races) %>
population: <% JSON.stringify(races.length ? "" : (f.population ?? "")) %>
tags:
  - location/country
---
# Country

<% paras.join("\n\n") %>
<% notes.length ? "\n> " + notes.join("\n> ") + "\n" : "" %>