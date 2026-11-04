<%*
const dow = Number(tp.date.now("d"));   // 0 = Sunday
const sundayOffset = -dow;              // days back to the most recent Sunday
const options = [];
for (let k = 0; k <= 8; k++) {
  options.push(tp.date.now("YYYY-MM-DD", sundayOffset + k * 7));
}
const date = (await tp.system.suggester(options, options, false, "Session date")) || options[1];

// Next session number = highest existing "S<n> ..." in Sessions/ + 1
let max = 0;
for (const f of app.vault.getMarkdownFiles()) {
  if (!f.path.startsWith("Sessions/") || f === tp.config.target_file) continue;
  const m = f.basename.match(/^S(\d+)\b/);
  if (m) max = Math.max(max, Number(m[1]));
}
const n = max + 1;
const name = `S${n} ${date}`;
await tp.file.rename(name);
await tp.file.move("Sessions/" + name);
-%>
---
aliases:
  - "Session <% n %>"
  - "<% date %>"
  - "S<% n %>"
---
# <% name %>
#session
