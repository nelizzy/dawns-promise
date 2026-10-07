# 📋 Jobs
```datacorejsx
const DAILY_FORMAT = "YYYY-MM-DD";   // match your daily note title format
const m = window.moment;
const iso = v => v?.toISODate?.() ?? String(v ?? "").slice(0, 10);
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

const STATUS_ICON = { Open: "🟢", Active: "🟡", Completed: "✅", Failed: "❌", Expired: "⌛", Rejected: "🚫" };
const CLOSED = ["Completed", "Failed", "Expired", "Rejected"];
const ORDER = ["Active", "Open", "Rejected", "Completed", "Failed", "Expired"];
const FILTERS = ["Open + Active", "All", ...ORDER];

function Chips({ items, icon }) {
  if (!items.length) return null;
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
    {items.map(i => (
      <span key={icon + i} style={{
        background: "var(--background-modifier-hover)",
        borderRadius: "10px", padding: "1px 8px", fontSize: "0.85em"
      }}>{icon ? icon + " " : ""}{i}</span>
    ))}
  </div>;
}

function Description({ path }) {
  const [text, setText] = dc.useState("");
  const [open, setOpen] = dc.useState(false);

  dc.useEffect(() => {
    let alive = true;
    const file = dc.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    dc.app.vault.cachedRead(file).then(raw => {
      if (!alive) return;
      setText(raw
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .replace(/^#\s.*\n?/m, "")
        .replace(/^>\s?/gm, "")
        .trim());
    });
    return () => { alive = false; };
  }, [path]);

  if (!text) return null;
  return <div
    onClick={() => setOpen(!open)}
    title={open ? "Click to collapse" : "Click to expand"}
    style={{
      fontSize: "0.85em", color: "var(--text-muted)", cursor: "pointer", whiteSpace: "pre-wrap",
      ...(open ? {} : {
        display: "-webkit-box", WebkitLineClamp: 10, WebkitBoxOrient: "vertical", overflow: "hidden",
      }),
    }}
  >{text}</div>;
}

function Card({ p, sessionDates }) {
  const v = k => p.value(k);
  const status = v("status") || "Open";
  const listed = m(iso(v("date_listed")), "YYYY-MM-DD", true);
  const closed = m(iso(v("date_closed")), "YYYY-MM-DD", true);
  const edited = m(iso(v("last_updated")), "YYYY-MM-DD", true);
  const isClosed = CLOSED.includes(status);

  // sessions after the listing day, up to the close date if there is one
  const sessions = listed.isValid()
    ? sessionDates.filter(d =>
        d.isAfter(listed, "day") && (!closed.isValid() || d.isSameOrBefore(closed, "day"))
      ).length
    : null;
  const plural = sessions === 1 ? "" : "s";
  const label = sessions === null ? null
    : isClosed && closed.isValid() ? `${sessions} session${plural} to close`
    : `${sessions} session${plural} ago`;

  return <div style={{
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "8px", padding: "12px",
    display: "flex", flexDirection: "column", gap: "8px",
    opacity: isClosed ? 0.7 : 1,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ fontWeight: "bold", fontSize: "1.1em" }}><dc.Link link={p.$link} /></span>
      <span style={{ fontSize: "0.85em", whiteSpace: "nowrap" }}>{STATUS_ICON[status] ?? "•"} {status}</span>
    </div>
    {v("sponsor") && <div style={{ fontSize: "0.85em" }}>🤝 {v("sponsor")}</div>}
    <Description path={p.$path} />
    {v("reward") && <div style={{ fontSize: "0.9em" }}>💰 {v("reward")}</div>}
    <Chips items={arr(v("job_tags"))} icon="" />
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "2px 12px",
      fontSize: "0.75em", color: "var(--text-muted)"
    }}>
      {listed.isValid() && <span>📅 Listed {listed.format("MMM DD, YY")}</span>}
      {isClosed && closed.isValid() && <span>🔒 Closed {closed.format("MMM DD, YY")}</span>}
      {edited.$mtime && <span>✏️ Edited {edited.format("MMM DD, YYY")}</span>}
            {label && <span>⏳ {label}</span>}
    </div>
  </div>;
}

return function View() {
  const [filter, setFilter] = dc.useState("All");
  const pages = dc.useQuery("@page and #job");
  const sessionDates = dc.useQuery("@page and #session")
    .map(s => m(s.$name, DAILY_FORMAT, true))
    .filter(d => d.isValid());

  const statusOf = p => p.value("status") || "Open";
  const shown = pages
    .filter(p => filter === "All" ? true
      : filter === "Open + Active" ? ["Open", "Active"].includes(statusOf(p))
      : statusOf(p) === filter)
    .sort((a, b) =>
      ORDER.indexOf(statusOf(a)) - ORDER.indexOf(statusOf(b)) ||
      iso(b.value("date_listed")).localeCompare(iso(a.value("date_listed"))));

  return <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
    <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: "fit-content" }}>
      {FILTERS.map(f => <option key={f} value={f}>{f}</option>)}
    </select>
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: "12px"
    }}>
      {shown.map(p => <Card key={p.$path} p={p} sessionDates={sessionDates} />)}
    </div>
  </div>;
}
```