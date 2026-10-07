/*
  Discord job grabber – run in the browser console (or as a DevTools "Snippet") on discord.com/channels/...

  1. Select some text inside the job post (or just leave nothing selected: it then takes the newest
     message in view that mentions "Offered Reward").
  2. Run this script.
  3. It copies "Posted: YYYY-MM-DD" + the message as Markdown to your clipboard. Paste that into the
     Job template's prompt.

  It only reads the page and calls DevTools' copy(); nothing is sent anywhere.
  If a message is split over several consecutive messages, select across all of them.
*/
(() => {
  const DISCORD_EPOCH = 1420070400000n;

  const msgs = [...document.querySelectorAll('li[id^="chat-messages-"]')];
  let picked = [];

  const sel = getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const r = sel.getRangeAt(0);
    picked = msgs.filter(li => r.intersectsNode(li));
  }
  if (!picked.length) {
    const m = [...msgs].reverse().find(li => /offered reward/i.test(li.innerText));
    if (m) picked = [m];
  }
  if (!picked.length) return console.warn("Job grabber: no message found. Select some text in the job post first.");

  // Discord DOM -> Markdown
  const md = n => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return "";
    const tag = n.tagName;
    if (tag === "BR") return "\n";
    if (tag === "TIME") return "";                       // the "(edited)" marker
    if (tag === "IMG") return n.alt || "";               // emoji
    const inner = () => [...n.childNodes].map(md).join("");
    const cls = String(n.className || "");
    if (/spoiler/i.test(cls) && !/spoiler/i.test(String(n.parentElement?.className || ""))) return `||${inner()}||`;
    switch (tag) {
      case "STRONG": return `**${inner()}**`;
      case "EM": return `*${inner()}*`;
      case "U": return `__${inner()}__`;
      case "S": case "DEL": return `~~${inner()}~~`;
      case "CODE": return "`" + inner() + "`";
      case "H1": return `# ${inner()}\n`;
      case "H2": return `## ${inner()}\n`;
      case "H3": return `### ${inner()}\n`;
      case "LI": return `- ${inner()}\n`;
      default: return inner();
    }
  };

  const text = picked
    .map(li => li.querySelector('[id^="message-content-"]'))
    .filter(Boolean)
    .map(el => md(el).replace(/​/g, "").replace(/\n{3,}/g, "\n\n").trim())
    .filter(Boolean)
    .join("\n\n");

  // posted date from the message id (a Discord snowflake), in your local time zone
  const id = picked[0].id.split("-").pop();
  const ms = Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
  const posted = new Date(ms).toLocaleDateString("sv-SE");   // YYYY-MM-DD

  const out = `Posted: ${posted}\n\n${text}`;
  copy(out);
  console.log(out);
  console.info(`Job grabber: copied ${picked.length} message(s), posted ${posted}.`);
})();
