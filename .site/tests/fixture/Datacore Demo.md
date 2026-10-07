# Datacore demo

## Pages table
```datacorejsx
return function Pages() {
  const pages = dc.useQuery('@page and path("Books")');
  return <dc.Table rows={pages} columns={[
    { id: "Name", value: p => p.$link },
    { id: "Year", value: p => p.value("year") },
    { id: "Status", value: p => p.value("status") },
  ]} />;
};
```

## Require + js
```datacorejs
const { shout } = await dc.require("scripts/helpers.js");
return dc.preact.h("div", { class: "dc-require-ok" }, shout("loaded"));
```

## Tasks
```datacorejsx
return function Tasks() {
  const tasks = dc.useQuery('@task and !$completed');
  return <dc.List rows={tasks} renderer={t => <span class="dc-task">{t.$text}</span>} />;
};
```

## Sections
```datacoretsx
return function Sections() {
  const secs: any[] = dc.useQuery('@section and $title = "Plot"');
  return <div class="dc-sections">{secs.length} section(s): {secs.map((s: any) => s.$title).join(", ")}</div>;
};
```

## Cards + current file + markdown
```datacorejsx
return function Mixed() {
  const me = dc.useCurrentFile();
  const pages = dc.useQuery('@page and #book');
  return <div>
    <p class="dc-me">{me.$name}</p>
    <dc.Markdown content="**bold** and [[Dune]]" />
    <dc.VanillaTable rows={pages} columns={[{ id: "Book", value: p => p.$name }]} />
  </div>;
};
```

## Failing block must say so
```datacorejsx
throw new Error("boom on purpose");
```

## Shared component from the unpublished Components folder
```datacorejsx
const { Badge } = await dc.require("Components/Badge.jsx");
const { Tag } = await dc.require(dc.headerLink("Components/Tag.md", "Tag"));
return function UsesBadge() { return <div class="dc-shared"><Badge text="shared" /><Tag text="md" /></div>; };
```
