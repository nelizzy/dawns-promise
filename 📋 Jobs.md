# 📋 Jobs
```datacorejsx
const DAILY_FORMAT = "YYYY-MM-DD";   // match your daily note title format
const m = window.moment;
const iso = v => v?.toISODate?.() ?? String(v ?? "").slice(0, 10);
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

const STATUS_ICON = { Open: "🟢", Active: "🟡", Completed: "✔️", Failed: "❌", Expired: "⌛", Rejected: "🚫" };
const CLOSED = ["Completed", "Failed", "Expired", "Rejected"];
const ORDER = ["Active", "Open", "Rejected", "Completed", "Failed", "Expired"];
const FILTERS = ["Open + Active", "All", ...ORDER];

const { Card } = await dc.require(dc.headerLink("Components/Card.md", "Card"));
const { Chips } = await dc.require(dc.headerLink("Components/Chips.md", "Chips"));
const { Description } = await dc.require(dc.headerLink("Components/Description.md", "Description"));

function JobCard({ p, sessionDates }) {
  const v = k => p.value(k);
  const status = v("status") || "Open";
  const listed = m(iso(v("date_listed")), "YYYY-MM-DD", true);
  const closed = m(iso(v("date_closed")), "YYYY-MM-DD", true);
  const isClosed = CLOSED.includes(status);

  // number of headings starting with "Update" (e.g. "## Update 1")
  const updates = (p.$sections ?? []).filter(s => /^update\b/i.test(String(s.$title ?? "").trim())).length;

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

  return <Card link={p.$link} dim={isClosed}
    aside={<span style={{ fontSize: "0.85em", whiteSpace: "nowrap" }}>{STATUS_ICON[status] ?? "•"} {status}</span>}>
    {v("sponsor") && <div style={{ fontSize: "0.85em" }}>🤝 {v("sponsor")}</div>}
    <Description path={p.$path} foldable />
    {v("reward") && <div style={{ fontSize: "0.9em" }}>💰 {v("reward")}</div>}
    <Chips items={arr(v("job_tags"))} icon="" spoiler />
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "2px 12px",
      fontSize: "0.75em", color: "var(--text-muted)"
    }}>
      {listed.isValid() && <span>📅 Listed {listed.format("MMM DD, YY")}</span>}
      {isClosed && closed.isValid() && <span>🔒 Closed {closed.format("MMM DD, YY")}</span>}
      {updates > 0 && <span>📝 {updates} update{updates === 1 ? "" : "s"}</span>}
            {label && <span>⏳ {label}</span>}
    </div>
  </Card>;
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
      gridTemplateColumns: "repeat(auto-fill, minmax(30ch, 1fr))",
      gap: "12px"
    }}>
      {shown.map(p => <JobCard key={p.$path} p={p} sessionDates={sessionDates} />)}
    </div>
  </div>;
}
```