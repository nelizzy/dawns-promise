<%*
const raw = await tp.system.prompt("Paste job block", "", true, true);
const lines = raw.replace(/\*\*/g, "").split("\n").map(l => l.trim()).filter(Boolean);

// "Sponsor: ...", "Offered Reward: ...", "Tags ||A, B||" (the colon is optional only before ||)
const keyRe = /^(sponsor|offered reward|tags)\s*(?::|(?=\|\|))\s*(.*)$/i;

// first line is "Name: first paragraph"
const firstLine = lines.shift();
const i0 = firstLine.indexOf(":");
const name = firstLine.slice(0, i0).trim().replace(/[\\/:*?"<>|#^\[\]]/g, "");
const paras = [firstLine.slice(i0 + 1).trim()];

const f = {};
for (const l of lines) {
  const m = l.match(keyRe);
  if (m) f[m[1].toLowerCase()] = m[2].trim();
  else if (!Object.keys(f).length) paras.push(l);
}

// ~~old tiers~~ are dropped, so only the current reward is kept
const reward = (f["offered reward"] || "").replace(/~~.*?~~/g, "").replace(/\s+/g, " ").trim();
const jobTags = (f.tags || "").replace(/\|\|/g, "").split(/[,/]/).map(x => x.trim()).filter(Boolean);

const statuses = ["Open", "Active", "Completed", "Failed", "Expired"];
const status = (await tp.system.suggester(statuses, statuses, false, "Status")) ?? "Open";

const today = tp.date.now("YYYY-MM-DD");
const closed = ["Completed", "Failed", "Expired"].includes(status);

// await tp.file.rename(name);
await tp.file.move("Notes/" + name);  // or reuse your auto-folder logic
-%>
---
status: <% JSON.stringify(status) %>
reward: <% JSON.stringify(reward) %>
job_tags: <% JSON.stringify(jobTags) %>
date_listed: <% today %>
date_closed: <% closed ? today : "" %>
last_updated: <% today %>
tags:
  - job
---
# <% name %>

<% f.sponsor ? "Sponsored by " + f.sponsor : "" %>

<% paras.join("\n\n") %>