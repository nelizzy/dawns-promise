// Builds an Obsidian-style CachedMetadata object (sections, headings, list items, links, tags, ...)
// from markdown text. Datacore's importer is fed with this, exactly as Obsidian's metadataCache would.
import MarkdownIt from 'markdown-it';
import * as yaml from 'js-yaml';

const md = new MarkdownIt({ html: true, linkify: false });
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const WIKI_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const BLOCK_ID_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

export function buildCache(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const offsets = []; let off = 0;
  for (const l of lines) { offsets.push(off); off += l.length + 1; }
  const loc = (line, col) => ({ line, col, offset: (offsets[line] ?? text.length) + col });
  const pos = (sl, sc, el, ec) => ({ start: loc(sl, sc), end: loc(el, ec) });
  const lineEnd = l => lines[l]?.length ?? 0;

  const cache = { sections: [], headings: [], listItems: [], links: [], embeds: [], tags: [] };

  // frontmatter
  let bodyStartLine = 0;
  const fm = FM_RE.exec(text);
  if (fm) {
    const fmLines = fm[0].replace(/\n$/, '').split('\n').length;
    bodyStartLine = fmLines;
    try {
      const data = yaml.load(fm[1], { schema: yaml.CORE_SCHEMA });
      if (data && typeof data === 'object' && !Array.isArray(data)) cache.frontmatter = data;
    } catch { /* invalid frontmatter */ }
    cache.frontmatterPosition = pos(0, 0, fmLines - 1, lineEnd(fmLines - 1));
    cache.sections.push({ type: 'yaml', position: cache.frontmatterPosition });
    if (cache.frontmatter) {
      cache.frontmatterLinks = [];
      const walk = (v, key) => {
        if (typeof v === 'string') for (const m of v.matchAll(/\[\[([^\]\n]+?)\]\]/g)) {
          const [target, alias] = m[1].split('|');
          cache.frontmatterLinks.push({ key, link: target.trim(), original: m[0], displayText: (alias ?? target).trim() });
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${key}.${i}`));
      };
      for (const [k, v] of Object.entries(cache.frontmatter)) walk(v, k);
    }
  }

  // which lines are code (fenced / indented) so links & tags are not read there
  const codeLines = new Set();
  const body = lines.slice(bodyStartLine).join('\n');
  const tokens = md.parse(body, {});
  const shift = bodyStartLine;
  const itemsStack = [];
  let listFirstLine = [];

  const lastIdOf = (a, b) => { const m = BLOCK_ID_RE.exec(lines[b] ?? ''); return m ? m[1] : undefined; };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'fence' || t.type === 'code_block') for (let l = t.map[0] + shift; l < t.map[1] + shift; l++) codeLines.add(l);
    if (t.level === 0 && t.nesting !== -1 && t.map) {
      const s = t.map[0] + shift, e = t.map[1] + shift - 1;
      let type = null;
      switch (t.type) {
        case 'heading_open': type = 'heading'; break;
        case 'paragraph_open': type = 'paragraph'; break;
        case 'bullet_list_open': case 'ordered_list_open': type = 'list'; break;
        case 'fence': case 'code_block': type = 'code'; break;
        case 'table_open': type = 'table'; break;
        case 'blockquote_open': type = /^>\s*\[![\w-]+\]/.test(lines[s] ?? '') ? 'callout' : 'blockquote'; break;
        case 'hr': type = 'thematicBreak'; break;
        case 'html_block': type = 'html'; break;
      }
      if (type) {
        const section = { type, position: pos(s, 0, e, lineEnd(e)) };
        const id = lastIdOf(s, e); if (id) section.id = id;
        // %% comments %% are their own section type in Obsidian
        if (type === 'paragraph' && /^\s*%%[\s\S]*%%\s*$/.test(lines.slice(s, e + 1).join('\n'))) section.type = 'comment';
        cache.sections.push(section);
      }
    }
    if (t.type === 'heading_open') {
      const s = t.map[0] + shift;
      const inline = tokens[i + 1];
      cache.headings.push({ heading: inline.content.trim(), level: Number(t.tag.slice(1)), position: pos(s, 0, s, lineEnd(s)) });
    }
    // lists
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') listFirstLine.push(t.map[0] + shift);
    if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') listFirstLine.pop();
    if (t.type === 'list_item_open') {
      const s = t.map[0] + shift;
      // own content ends before the first nested list begins
      let end = t.map[1] + shift - 1;
      for (let j = i + 1, depth = 1; j < tokens.length && depth > 0; j++) {
        const u = tokens[j];
        if (u.type === 'list_item_open') depth++;
        if (u.type === 'list_item_close') { depth--; if (depth === 0) break; }
        if ((u.type === 'bullet_list_open' || u.type === 'ordered_list_open') && u.level === t.level + 1) { end = u.map[0] + shift - 1; break; }
      }
      while (end > s && !(lines[end] ?? '').trim()) end--;
      const parent = itemsStack.length ? itemsStack[itemsStack.length - 1] : -(listFirstLine[listFirstLine.length - 1]);
      const m = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s/.exec(lines[s] ?? '');
      const item = { position: pos(s, (lines[s]?.match(/^\s*/)?.[0].length) ?? 0, end, lineEnd(end)), parent };
      if (m) item.task = m[1];
      const id = lastIdOf(s, end); if (id) item.id = id;
      cache.listItems.push(item);
      itemsStack.push(s);
    }
    if (t.type === 'list_item_close') itemsStack.pop();
  }

  // block ids
  cache.blocks = {};
  for (const s of cache.sections) if (s.id) cache.blocks[s.id.toLowerCase()] = { id: s.id, position: s.position };

  // links / embeds / tags (line based, skipping code)
  for (let l = bodyStartLine; l < lines.length; l++) {
    if (codeLines.has(l)) continue;
    const line = lines[l];
    if (!line) continue;
    const noInlineCode = line.replace(/`[^`\n]*`/g, m => ' '.repeat(m.length));
    for (const m of noInlineCode.matchAll(WIKI_RE)) {
      const inner = m[2].replace(/\\\|/g, '|');
      const [target, ...rest] = inner.split('|');
      const entry = { link: target.trim(), original: m[0], displayText: (rest.length ? rest.join('|') : target).trim(), position: pos(l, m.index, l, m.index + m[0].length) };
      (m[1] ? cache.embeds : cache.links).push(entry);
    }
    for (const m of noInlineCode.matchAll(MDLINK_RE)) {
      const href = m[3];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
      let link = href; try { link = decodeURIComponent(href); } catch { /* keep */ }
      const entry = { link: link.replace(/\.md$/, ''), original: m[0], displayText: m[2], position: pos(l, m.index, l, m.index + m[0].length) };
      (m[1] ? cache.embeds : cache.links).push(entry);
    }
    const noLinks = noInlineCode.replace(WIKI_RE, m => ' '.repeat(m.length)).replace(MDLINK_RE, m => ' '.repeat(m.length));
    for (const m of noLinks.matchAll(TAG_RE)) {
      const col = m.index + m[1].length;
      cache.tags.push({ tag: '#' + m[2], position: pos(l, col, l, col + m[2].length + 1) });
    }
  }
  return cache;
}
