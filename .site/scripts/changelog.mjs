#!/usr/bin/env node
// Builds a Discord webhook payload listing the notes that were added, updated, renamed or
// removed between two commits. Run after `node build.mjs` so note URLs come from dist/assets/vault.json.
//
//   node scripts/changelog.mjs <since-sha> [until-sha=HEAD] [--out file.json]
//
// Env: SITE_URL (embed link), CHANGELOG_TITLE (default: site title from site.config.json).
// Writes nothing (and exits 0) when there are no published-note changes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [since, until = 'HEAD'] = args;
if (!since) { console.error('usage: changelog.mjs <since-sha> [until-sha] [--out file]'); process.exit(2); }

const config = JSON.parse(fs.readFileSync(path.join(HERE, 'site.config.json'), 'utf8'));
if (config.timezone) process.env.TZ = config.timezone;
const EXCLUDE = new Set(['.obsidian', '.git', '.github', '.site', '.trash', 'node_modules', ...(config.exclude || [])]);
const vault = JSON.parse(fs.readFileSync(path.join(process.env.OUT || path.join(HERE, 'dist'), 'assets', 'vault.json'), 'utf8'));
const pages = new Map(vault.pages.map(p => [p.path, p]));
const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');

// Same rule build.mjs uses: .md files outside excluded top-level folders and dot-folders.
const isPublished = p => p.endsWith('.md') && !p.split('/').some((seg, i) => seg.startsWith('.') || (i === 0 && EXCLUDE.has(seg)));
const nameOf = p => pages.get(p)?.name ?? path.basename(p, '.md');
const linkOf = p => {
  const pg = pages.get(p);
  // pg.url already includes the site's base path (e.g. /dawns-promise/...), so join it to the origin only
  return pg && siteUrl ? `[${pg.name}](${encodeURI(new URL(siteUrl).origin + pg.url)})` : nameOf(p);
};

const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', '-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });

// numstat: lines added/removed per (new) path
const stats = new Map();
{
  const f = git('diff', '--numstat', '-z', '-M', since, until, '--', '*.md').split('\0');
  for (let i = 0; i < f.length - 1;) {
    const [add, del, p] = f[i++].split('\t');
    const file = p === '' ? (i++, f[i++]) : p; // renames: "add\tdel\t\0old\0new"
    stats.set(file, { add: +add || 0, del: +del || 0 });
  }
}

const added = [], updated = [], renamed = [], removed = [];
{
  const f = git('diff', '--name-status', '-z', '-M', since, until, '--', '*.md').split('\0');
  for (let i = 0; i < f.length - 1;) {
    const status = f[i++];
    if (status[0] === 'R' || status[0] === 'C') {
      const from = f[i++], to = f[i++];
      const wasPub = isPublished(from), isPub = pages.has(to);
      if (wasPub && isPub) {
        if (nameOf(from) !== nameOf(to)) renamed.push({ from, to });
        else if ((stats.get(to)?.add || 0) + (stats.get(to)?.del || 0) > 0) updated.push(to); // moved between folders + edited
      } else if (isPub) added.push(to);
      else if (wasPub) removed.push(from);
      continue;
    }
    const p = f[i++];
    if (status === 'A' && pages.has(p)) added.push(p);
    else if (status === 'M' && pages.has(p)) updated.push(p);
    else if (status === 'D' && isPublished(p)) removed.push(p);
  }
}

const total = added.length + updated.length + renamed.length + removed.length;
if (!total) { console.log('No published notes changed – nothing to announce.'); process.exit(0); }

const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
const delta = p => { const s = stats.get(p); return s ? ` · +${s.add}/−${s.del}` : ''; };
const sections = [
  ['✨ New', added.sort(byName).map(p => `• ${linkOf(p)}`)],
  ['📝 Updated', updated.sort(byName).map(p => `• ${linkOf(p)}${delta(p)}`)],
  ['🔀 Renamed', renamed.sort((a, b) => byName(a.to, b.to)).map(r => `• ${nameOf(r.from)} → ${linkOf(r.to)}`)],
  ['🗑️ Removed', removed.sort(byName).map(p => `• ${nameOf(p)}`)],
].filter(([, lines]) => lines.length);

// Fit Discord's 4096-char embed description, cutting whole lines and noting what was left out.
const LIMIT = 4000;
let desc = '', dropped = 0;
for (const [title, lines] of sections) {
  const head = `${desc ? '\n' : ''}**${title}** (${lines.length})\n`;
  if (desc.length + head.length > LIMIT) { dropped += lines.length; continue; }
  desc += head;
  for (const l of lines) {
    if (desc.length + l.length + 1 > LIMIT) { dropped++; continue; }
    desc += l + '\n';
  }
}
if (dropped) desc += `\n…and ${dropped} more`;

const now = new Date();
const date = `${now.toLocaleString('en-US', { month: 'short' })} ${now.getDate()} ${now.getFullYear()}`;
const title = process.env.CHANGELOG_TITLE || config.title || 'Site';
const payload = {
  username: `${title} Changelog`,
  embeds: [{
    title: `${title} (${date})`,
    ...(siteUrl ? { url: siteUrl + '/' } : {}),
    description: desc.trim(),
    color: 0xE8A33D,
    footer: { text: `${total} note${total === 1 ? '' : 's'} changed` },
  }],
};
if (process.env.AVATAR_URL) payload.avatar_url = process.env.AVATAR_URL;

const json = JSON.stringify(payload, null, 2);
if (outFile) { fs.writeFileSync(outFile, json); console.log(`Changelog (${total} notes) written to ${outFile}`); }
else console.log(json);
