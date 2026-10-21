<%*
const dow = Number(tp.date.now("d"));   // 0 = Sunday
const sundayOffset = -dow;              // days back to the most recent Sunday
const options = [];
for (let k = 0; k <= 8; k++) {
  options.push(tp.date.now("YYYY-MM-DD", sundayOffset + k * 7));
}
const name = (await tp.system.suggester(options, options, false, "Session date")) || options[1];
await tp.file.rename(name);
await tp.file.move("Sessions/" + name);
-%>
# <% name %>
#session