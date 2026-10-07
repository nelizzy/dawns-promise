var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TextToolsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");

// src/settings.ts
var DEFAULT_SETTINGS = {
  lineNumberSeparator: ". ",
  padLineNumbers: false,
  caseSensitiveFiltering: false,
  filterHistory: [],
  insertUppercaseGuids: false,
  defaultPadString: " ",
  textSlots: ["", "", "", "", ""]
};

// src/settings-tab.ts
var import_obsidian = require("obsidian");
var TextToolsSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  // Obsidian 1.13.0+ renders from these definitions, which also makes the
  // settings appear in Obsidian's global settings search.
  getSettingDefinitions() {
    return [
      {
        type: "group",
        heading: "Line numbers",
        items: [
          {
            name: "Separator",
            desc: 'String between the line number and the line text. Default: ". "',
            control: {
              type: "text",
              key: "lineNumberSeparator",
              placeholder: ". "
            }
          },
          {
            name: "Pad with leading zeros",
            desc: "Align numbers with leading zeros (01, 02 \u2026 10).",
            control: {
              type: "toggle",
              key: "padLineNumbers"
            }
          }
        ]
      },
      {
        type: "group",
        heading: "Filter lines",
        items: [
          {
            name: "Case-sensitive filtering",
            desc: "When on, filter commands match case exactly.",
            control: {
              type: "toggle",
              key: "caseSensitiveFiltering"
            }
          }
        ]
      },
      {
        type: "group",
        heading: "Guids",
        items: [
          {
            name: "Uppercase hex digits",
            desc: "Insert guids using uppercase hex digits.",
            control: {
              type: "toggle",
              key: "insertUppercaseGuids"
            }
          }
        ]
      },
      {
        type: "group",
        heading: "Padding",
        items: [
          {
            name: "Default pad character",
            desc: "Character used when padding lines (default: space).",
            control: {
              type: "text",
              key: "defaultPadString",
              placeholder: " ",
              validate: (value) => value.length > 0 ? void 0 : "Enter a pad character."
            }
          }
        ]
      }
    ];
  }
};

// src/utils.ts
var import_obsidian2 = require("obsidian");
function normalizeRange(anchor, head) {
  const anchorFirst = anchor.line < head.line || anchor.line === head.line && anchor.ch <= head.ch;
  return {
    from: anchorFirst ? anchor : head,
    to: anchorFirst ? head : anchor
  };
}
function transformSelections(editor, transform) {
  const selections = editor.listSelections();
  const hasSelection = selections.some(
    (s) => s.anchor.line !== s.head.line || s.anchor.ch !== s.head.ch
  );
  if (!hasSelection) {
    new import_obsidian2.Notice("Select some text first.");
    return false;
  }
  for (let i = selections.length - 1; i >= 0; i--) {
    const { from, to } = normalizeRange(
      selections[i].anchor,
      selections[i].head
    );
    if (from.line === to.line && from.ch === to.ch) continue;
    editor.replaceRange(transform(editor.getRange(from, to)), from, to);
  }
  return true;
}

// src/transforms/case.ts
function splitWords(line) {
  return line.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[-_./\\]+/g, " ").split(/\s+/).filter((w) => w.length > 0);
}
function perLine(text, fn) {
  return text.split("\n").map(fn).join("\n");
}
function toCamelCase(text) {
  return perLine(text, (line) => {
    const words = splitWords(line);
    if (words.length === 0) return line;
    return words[0].toLowerCase() + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  });
}
function toPascalCase(text) {
  return perLine(
    text,
    (line) => splitWords(line).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("")
  );
}
function toConstantCase(text) {
  return perLine(
    text,
    (line) => splitWords(line).map((w) => w.toUpperCase()).join("_")
  );
}
function toDashCase(text) {
  return perLine(
    text,
    (line) => splitWords(line).map((w) => w.toLowerCase()).join("-")
  );
}
function toSnakeCase(text) {
  return perLine(
    text,
    (line) => splitWords(line).map((w) => w.toLowerCase()).join("_")
  );
}
function toDotCase(text) {
  return perLine(
    text,
    (line) => splitWords(line).map((w) => w.toLowerCase()).join(".")
  );
}
function toTitleCase(text) {
  return perLine(
    text,
    (line) => line.replace(
      /[\p{L}\p{N}]+/gu,
      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
  );
}
function toSpongeCase(text) {
  let upper = false;
  return text.split("").map((char) => {
    if (char === " " || char === "\n" || char === "	") return char;
    const result = upper ? char.toUpperCase() : char.toLowerCase();
    upper = !upper;
    return result;
  }).join("");
}
function swapCase(text) {
  return text.split("").map(
    (char) => char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()
  ).join("");
}
function separateWithSpaces(text) {
  return perLine(text, (line) => splitWords(line).join(" "));
}
function separateWithSlashes(text) {
  return perLine(text, (line) => splitWords(line).join("/"));
}
function separateWithBackslashes(text) {
  return perLine(text, (line) => splitWords(line).join("\\"));
}
function reverseLines(text) {
  return perLine(text, (line) => line.split("").reverse().join(""));
}
function latinize(text) {
  return text.normalize("NFD").replace(/[^\p{L}\p{N}_\s]+/gu, "");
}
function slugify(text) {
  return perLine(
    text,
    (line) => latinize(line).toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "")
  );
}

// src/transforms/lines.ts
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function getLines(text) {
  return normalizeLineEndings(text).split("\n");
}
function joinLines(lines) {
  return lines.join("\n");
}
function withPreservedTrailingNewline(text, processor) {
  const normalized = normalizeLineEndings(text);
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const result = joinLines(processor(lines));
  return hasTrailingNewline ? result + "\n" : result;
}
function removeDuplicateLines(text) {
  const seen = /* @__PURE__ */ new Set();
  return joinLines(
    getLines(text).filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
  );
}
function removeAdjacentDuplicateLines(text) {
  return joinLines(
    getLines(text).filter((line, i, arr) => i === 0 || line !== arr[i - 1])
  );
}
function keepOnlyDuplicateLines(text) {
  var _a;
  const counts = /* @__PURE__ */ new Map();
  for (const line of getLines(text)) {
    counts.set(line, ((_a = counts.get(line)) != null ? _a : 0) + 1);
  }
  const seen = /* @__PURE__ */ new Set();
  return joinLines(
    getLines(text).filter((line) => {
      var _a2;
      if (((_a2 = counts.get(line)) != null ? _a2 : 0) > 1 && !seen.has(line)) {
        seen.add(line);
        return true;
      }
      return false;
    })
  );
}
function removeBlankLines(text) {
  return joinLines(getLines(text).filter((line) => line.trim() !== ""));
}
function removeEmptyLines(text) {
  return joinLines(getLines(text).filter((line) => line.length > 0));
}
function removeSurplusBlankLines(text) {
  const lines = getLines(text);
  const result = [];
  let prevBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) continue;
    result.push(line);
    prevBlank = isBlank;
  }
  return joinLines(result);
}
function sorted(lines, dir, key = (l) => l) {
  return [...lines].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
    return dir === "asc" ? cmp : -cmp;
  });
}
function sortLinesCaseSensitive(text, dir) {
  return withPreservedTrailingNewline(text, (lines) => sorted(lines, dir));
}
function sortLinesCaseInsensitive(text, dir) {
  return withPreservedTrailingNewline(text, (lines) => sorted(lines, dir, (l) => l.toLowerCase()));
}
function sortLinesByLength(text, dir) {
  return withPreservedTrailingNewline(text, (lines) => sorted(lines, dir, (l) => l.length));
}
function sortLinesByWordCount(text, dir) {
  return withPreservedTrailingNewline(
    text,
    (lines) => sorted(lines, dir, (l) => l.trim().split(/\s+/).filter(Boolean).length)
  );
}
function shuffleLines(text) {
  return withPreservedTrailingNewline(text, (lines) => {
    for (let i = lines.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lines[i], lines[j]] = [lines[j], lines[i]];
    }
    return lines;
  });
}
function trimLines(text) {
  return joinLines(getLines(text).map((l) => l.trim()));
}
function trimLinesStart(text) {
  return joinLines(getLines(text).map((l) => l.trimStart()));
}
function trimLinesEnd(text) {
  return joinLines(getLines(text).map((l) => l.trimEnd()));
}
function removeWhitespace(text) {
  return text.replace(/\s/g, "");
}
function replaceNewlinesWithSpace(text) {
  return text.replace(/\n/g, " ");
}
function collapseWhitespace(text) {
  return joinLines(
    getLines(text).map((l) => l.replace(/\s+/g, " ").trim())
  );
}
function prefixLines(text, prefix) {
  return joinLines(getLines(text).map((l) => prefix + l));
}
function suffixLines(text, suffix) {
  return joinLines(getLines(text).map((l) => l + suffix));
}
function wrapLines(text, prefix, suffix) {
  return joinLines(getLines(text).map((l) => prefix + l + suffix));
}
function splitLines(text, delimiter) {
  return joinLines(
    getLines(text).flatMap((l) => l.split(delimiter))
  );
}
function joinAllLines(text, glue) {
  return getLines(text).join(glue);
}
function joinEveryNLines(text, n, glue) {
  const lines = getLines(text);
  const chunks = [];
  for (let i = 0; i < lines.length; i += n) {
    chunks.push(lines.slice(i, i + n).join(glue));
  }
  return joinLines(chunks);
}
function countLineOccurrences(text) {
  var _a;
  const counts = /* @__PURE__ */ new Map();
  const order = [];
  for (const line of getLines(text)) {
    if (!counts.has(line)) order.push(line);
    counts.set(line, ((_a = counts.get(line)) != null ? _a : 0) + 1);
  }
  return joinLines(
    order.sort((a, b) => {
      var _a2, _b;
      return ((_a2 = counts.get(b)) != null ? _a2 : 0) - ((_b = counts.get(a)) != null ? _b : 0);
    }).map((line) => `${counts.get(line)}	${line}`)
  );
}
function padLinesStart(text, length, padChar) {
  return joinLines(
    getLines(text).map((l) => l.padStart(length, padChar || " "))
  );
}
function padLinesEnd(text, length, padChar) {
  return joinLines(
    getLines(text).map((l) => l.padEnd(length, padChar || " "))
  );
}

// src/transforms/encode.ts
function urlEncode(text) {
  return encodeURIComponent(text);
}
function urlDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch (e) {
    return text;
  }
}
var HTML_ENCODE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};
var HTML_DECODE_MAP = Object.fromEntries(
  Object.entries(HTML_ENCODE_MAP).map(([k, v]) => [v, k])
);
function htmlEncode(text) {
  return text.replace(/[&<>"']/g, (ch) => {
    var _a;
    return (_a = HTML_ENCODE_MAP[ch]) != null ? _a : ch;
  });
}
function htmlDecode(text) {
  return text.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) => {
      var _a;
      return (_a = HTML_DECODE_MAP[entity]) != null ? _a : entity;
    }
  );
}
function base64Encode(text) {
  const bytes = new TextEncoder().encode(text);
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binStr);
}
function base64Decode(text) {
  try {
    const binStr = atob(text.trim());
    const bytes = Uint8Array.from(binStr, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    return text;
  }
}
function jsonEscape(text) {
  return JSON.stringify(text);
}
function jsonUnescape(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    return text;
  } catch (e) {
    return text;
  }
}
function decimalToHex(text) {
  return text.replace(/\b\d+\b/g, (n) => parseInt(n, 10).toString(16).toUpperCase());
}
function hexToDecimal(text) {
  return text.replace(
    /\b(?:0x)?([0-9a-fA-F]+)\b/g,
    (_, hex) => parseInt(hex, 16).toString(10)
  );
}

// src/transforms/numbers.ts
function shiftNumbers(text, delta) {
  return text.replace(/-?\d+/g, (n) => String(parseInt(n, 10) + delta));
}

// src/transforms/generate.ts
function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
function generateGuid(format, uppercase) {
  const raw = uuid();
  const u = uppercase ? raw.toUpperCase() : raw.toLowerCase();
  switch (format) {
    case "nodashes":
      return u.replace(/-/g, "");
    case "braces":
      return `{${u}}`;
    case "csharp":
      return `new Guid("${u}")`;
    default:
      return u;
  }
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomFloat(min, max, decimals = 4) {
  return (Math.random() * (max - min) + min).toFixed(decimals);
}
function randomHex(min, max, uppercase) {
  const n = randomInt(min, max);
  return uppercase ? n.toString(16).toUpperCase() : n.toString(16);
}
var LOREM_WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "ad",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "aliquip",
  "ex",
  "ea",
  "commodo",
  "consequat",
  "duis",
  "aute",
  "irure",
  "in",
  "reprehenderit",
  "voluptate",
  "velit",
  "esse",
  "cillum",
  "eu",
  "fugiat",
  "nulla",
  "pariatur",
  "excepteur",
  "sint",
  "occaecat",
  "cupidatat",
  "non",
  "proident",
  "sunt",
  "culpa",
  "qui",
  "officia",
  "deserunt",
  "mollit",
  "anim",
  "id",
  "est",
  "laborum"
];
function randomLoremWord() {
  return LOREM_WORDS[Math.floor(Math.random() * LOREM_WORDS.length)];
}
function loremSentence() {
  const len = randomInt(8, 16);
  const words = [];
  for (let i = 0; i < len; i++) words.push(randomLoremWord());
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ") + ".";
}
function loremParagraph() {
  const count = randomInt(4, 7);
  const sentences = [];
  for (let i = 0; i < count; i++) sentences.push(loremSentence());
  return sentences.join(" ");
}
var UPPERCASE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
var LOWERCASE_LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
var NATO = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliet",
  "Kilo",
  "Lima",
  "Mike",
  "November",
  "Oscar",
  "Papa",
  "Quebec",
  "Romeo",
  "Sierra",
  "Tango",
  "Uniform",
  "Victor",
  "Whiskey",
  "X-ray",
  "Yankee",
  "Zulu"
];
var MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
var MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
var DAYS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];
var DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var SEQUENCES = {
  "uppercase-letters": UPPERCASE_LETTERS,
  "lowercase-letters": LOWERCASE_LETTERS,
  "nato": NATO,
  "months-long": MONTHS_LONG,
  "months-short": MONTHS_SHORT,
  "days-long": DAYS_LONG,
  "days-short": DAYS_SHORT
};
function getSequenceItem(type, index) {
  const seq = SEQUENCES[type];
  return seq[index % seq.length];
}
function timestampLocal() {
  return (/* @__PURE__ */ new Date()).toLocaleString();
}
function timestampUTC() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function timestampUnix() {
  return Math.floor(Date.now() / 1e3).toString();
}

// src/modals/InputModal.ts
var import_obsidian3 = require("obsidian");
var InputModal = class extends import_obsidian3.Modal {
  constructor(app, options) {
    var _a, _b, _c;
    super(app);
    this.value = "";
    this.titleEl.setText(options.title);
    this.label = options.label;
    this.placeholder = (_a = options.placeholder) != null ? _a : "";
    this.defaultValue = (_b = options.defaultValue) != null ? _b : "";
    this.onSubmit = options.onSubmit;
    this.onCancel = (_c = options.onCancel) != null ? _c : () => {
    };
  }
  submitAndCatch(value) {
    const result = this.onSubmit(value);
    if (result instanceof Promise) {
      result.catch((error) => {
        console.error("Text Tools: error in submit handler", error);
        new import_obsidian3.Notice("An error occurred. See the developer console for details.");
      });
    }
  }
  onOpen() {
    const { contentEl } = this;
    this.value = this.defaultValue;
    new import_obsidian3.Setting(contentEl).setName(this.label).addText((text) => {
      text.setPlaceholder(this.placeholder).setValue(this.defaultValue).onChange((v) => {
        this.value = v;
      });
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.close();
          this.submitAndCatch(this.value);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.close();
          this.onCancel();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 50);
    });
    new import_obsidian3.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("OK").setCta().onClick(() => {
        this.close();
        this.submitAndCatch(this.value);
      })
    ).addButton(
      (btn) => btn.setButtonText("Cancel").onClick(() => {
        this.close();
        this.onCancel();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/modals/TwoInputModal.ts
var import_obsidian4 = require("obsidian");
var TwoInputModal = class extends import_obsidian4.Modal {
  constructor(app, options) {
    var _a, _b;
    super(app);
    this.value1 = "";
    this.value2 = "";
    this.titleEl.setText(options.title);
    this.value1 = (_a = options.default1) != null ? _a : "";
    this.value2 = (_b = options.default2) != null ? _b : "";
    this.onSubmit = options.onSubmit;
    const { contentEl } = this;
    new import_obsidian4.Setting(contentEl).setName(options.label1).addText((t) => {
      var _a2;
      t.setPlaceholder((_a2 = options.placeholder1) != null ? _a2 : "").setValue(this.value1).onChange((v) => this.value1 = v);
      window.setTimeout(() => t.inputEl.focus(), 50);
    });
    new import_obsidian4.Setting(contentEl).setName(options.label2).addText(
      (t) => {
        var _a2;
        return t.setPlaceholder((_a2 = options.placeholder2) != null ? _a2 : "").setValue(this.value2).onChange((v) => this.value2 = v);
      }
    );
    new import_obsidian4.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("OK").setCta().onClick(() => {
        this.close();
        this.onSubmit(this.value1, this.value2);
      })
    ).addButton(
      (btn) => btn.setButtonText("Cancel").onClick(() => this.close())
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// main.ts
var TextToolsPlugin = class extends import_obsidian5.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TextToolsSettingTab(this.app, this));
    this.registerCaseCommands();
    this.registerLineCommands();
    this.registerFilterCommands();
    this.registerEncodeCommands();
    this.registerNumberCommands();
    this.registerGenerateCommands();
    this.registerAdvancedCommands();
    this.registerLineNumberCommands();
    this.registerTextSlotCommands();
  }
  // =========================================================================
  // Case / format
  // =========================================================================
  registerCaseCommands() {
    const cmds = [
      ["uppercase", "Upper case", (t) => t.toUpperCase()],
      ["lowercase", "Lower case", (t) => t.toLowerCase()],
      ["camelcase", "camelCase", toCamelCase],
      ["pascalcase", "PascalCase", toPascalCase],
      ["constantcase", "CONSTANT_CASE", toConstantCase],
      ["dashcase", "Dash case (kebab-case)", toDashCase],
      ["snakecase", "Snake case", toSnakeCase],
      ["dotcase", "Dot case", toDotCase],
      ["titlecase", "Title case", toTitleCase],
      ["spongecase", "sPoNgE cAsE", toSpongeCase],
      ["swapcase", "Swap case", swapCase],
      ["separate-spaces", "Separate words with spaces", separateWithSpaces],
      ["separate-slashes", "Separate words with slashes", separateWithSlashes],
      ["separate-backslash", "Separate words with backslashes", separateWithBackslashes],
      ["reverse-lines", "Reverse characters on each line", reverseLines],
      ["slugify", "Slugify", slugify],
      ["latinize", "Latinize (remove diacritics)", latinize]
    ];
    for (const [id, name, fn] of cmds) {
      this.addCommand({
        id,
        name,
        editorCallback: (editor) => {
          if (!transformSelections(editor, fn)) {
            new import_obsidian5.Notice("Select some text first.");
          }
        }
      });
    }
  }
  // =========================================================================
  // Line operations
  // =========================================================================
  registerLineCommands() {
    const simple = [
      ["remove-duplicate-lines", "Remove duplicate lines", removeDuplicateLines],
      ["remove-adjacent-duplicate-lines", "Remove adjacent duplicate lines", removeAdjacentDuplicateLines],
      ["keep-only-duplicate-lines", "Keep only duplicate lines", keepOnlyDuplicateLines],
      ["remove-blank-lines", "Remove blank lines", removeBlankLines],
      ["remove-empty-lines", "Remove empty lines", removeEmptyLines],
      ["remove-surplus-blank-lines", "Remove surplus blank lines", removeSurplusBlankLines],
      ["shuffle-lines", "Shuffle lines", shuffleLines],
      ["sort-lines-cs-asc", "Sort lines (case sensitive, A\u2192Z)", (t) => sortLinesCaseSensitive(t, "asc")],
      ["sort-lines-cs-desc", "Sort lines (case sensitive, Z\u2192A)", (t) => sortLinesCaseSensitive(t, "desc")],
      ["sort-lines-ci-asc", "Sort lines (case insensitive, A\u2192Z)", (t) => sortLinesCaseInsensitive(t, "asc")],
      ["sort-lines-ci-desc", "Sort lines (case insensitive, Z\u2192A)", (t) => sortLinesCaseInsensitive(t, "desc")],
      ["sort-lines-length-asc", "Sort lines by length (shortest first)", (t) => sortLinesByLength(t, "asc")],
      ["sort-lines-length-desc", "Sort lines by length (longest first)", (t) => sortLinesByLength(t, "desc")],
      ["sort-lines-wordcount-asc", "Sort lines by word count (fewest first)", (t) => sortLinesByWordCount(t, "asc")],
      ["sort-lines-wordcount-desc", "Sort lines by word count (most first)", (t) => sortLinesByWordCount(t, "desc")],
      ["trim-lines", "Trim leading and trailing whitespace", trimLines],
      ["trim-lines-start", "Trim leading whitespace", trimLinesStart],
      ["trim-lines-end", "Trim trailing whitespace", trimLinesEnd],
      ["remove-whitespace", "Remove all whitespace characters", removeWhitespace],
      ["replace-newlines-space", "Replace newlines with a space", replaceNewlinesWithSpace],
      ["collapse-whitespace", "Collapse whitespace to single space", collapseWhitespace],
      ["count-occurrences", "Count line occurrences", countLineOccurrences]
    ];
    for (const [id, name, fn] of simple) {
      this.addCommand({
        id,
        name,
        editorCallback: (editor) => {
          if (!transformSelections(editor, fn)) {
            new import_obsidian5.Notice("Select some text first.");
          }
        }
      });
    }
    this.addCommand({
      id: "prefix-lines",
      name: "Prefix lines",
      editorCallback: (editor) => {
        new InputModal(this.app, {
          title: "Prefix lines",
          label: "Prefix",
          placeholder: ">> ",
          onSubmit: (prefix) => transformSelections(editor, (t) => prefixLines(t, prefix))
        }).open();
      }
    });
    this.addCommand({
      id: "suffix-lines",
      name: "Suffix lines",
      editorCallback: (editor) => {
        new InputModal(this.app, {
          title: "Suffix lines",
          label: "Suffix",
          placeholder: ";",
          onSubmit: (suffix) => transformSelections(editor, (t) => suffixLines(t, suffix))
        }).open();
      }
    });
    this.addCommand({
      id: "wrap-lines",
      name: "Wrap lines",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Wrap lines",
          label1: "Prefix",
          label2: "Suffix",
          placeholder1: "**",
          placeholder2: "**",
          onSubmit: (p, s) => transformSelections(editor, (t) => wrapLines(t, p, s))
        }).open();
      }
    });
    this.addCommand({
      id: "split-lines",
      name: "Split lines by delimiter",
      editorCallback: (editor) => {
        new InputModal(this.app, {
          title: "Split lines",
          label: "Delimiter",
          placeholder: ",",
          onSubmit: (delim) => {
            if (delim === "") return;
            transformSelections(editor, (t) => splitLines(t, delim));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "join-lines",
      name: "Join all lines with a glue string",
      editorCallback: (editor) => {
        new InputModal(this.app, {
          title: "Join lines",
          label: "Glue (leave empty to join bare)",
          placeholder: ", ",
          onSubmit: (glue) => transformSelections(editor, (t) => joinAllLines(t, glue))
        }).open();
      }
    });
    this.addCommand({
      id: "join-n-lines",
      name: "Join every n lines",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Join every n lines",
          label1: "Number of lines per group",
          label2: "Glue",
          placeholder1: "2",
          placeholder2: " ",
          onSubmit: (nStr, glue) => {
            const n = parseInt(nStr, 10);
            if (!n || n < 1) {
              new import_obsidian5.Notice("Enter a positive integer.");
              return;
            }
            transformSelections(editor, (t) => joinEveryNLines(t, n, glue));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "pad-start",
      name: "Pad lines at start",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Pad lines at start",
          label1: "Target length",
          label2: "Pad character",
          placeholder1: "10",
          placeholder2: this.settings.defaultPadString,
          default2: this.settings.defaultPadString,
          onSubmit: (lenStr, padChar) => {
            const len = parseInt(lenStr, 10);
            if (isNaN(len)) {
              new import_obsidian5.Notice("Enter a valid number.");
              return;
            }
            transformSelections(editor, (t) => padLinesStart(t, len, padChar));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "pad-end",
      name: "Pad lines at end",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Pad lines at end",
          label1: "Target length",
          label2: "Pad character",
          placeholder1: "10",
          placeholder2: this.settings.defaultPadString,
          default2: this.settings.defaultPadString,
          onSubmit: (lenStr, padChar) => {
            const len = parseInt(lenStr, 10);
            if (isNaN(len)) {
              new import_obsidian5.Notice("Enter a valid number.");
              return;
            }
            transformSelections(editor, (t) => padLinesEnd(t, len, padChar));
          }
        }).open();
      }
    });
  }
  // =========================================================================
  // Filter lines
  // =========================================================================
  registerFilterCommands() {
    const runFilter = (text, query, filterMode, matchMode, caseSensitive) => {
      const lines = text.split("\n");
      return lines.filter((line) => {
        let matches;
        if (matchMode === "regex") {
          try {
            const flags = caseSensitive ? "" : "i";
            matches = new RegExp(query, flags).test(line);
          } catch (e) {
            new import_obsidian5.Notice("Invalid regular expression.");
            matches = false;
          }
        } else {
          matches = caseSensitive ? line.includes(query) : line.toLowerCase().includes(query.toLowerCase());
        }
        return filterMode === "include" ? matches : !matches;
      }).join("\n");
    };
    const makeFilterCommand = (id, name, filterMode, matchMode, toNewNote) => {
      this.addCommand({
        id,
        name,
        editorCallback: (editor) => {
          var _a;
          const history = this.settings.filterHistory.slice(0, 10);
          new InputModal(this.app, {
            title: name,
            label: matchMode === "regex" ? "Regular expression" : "Filter string",
            placeholder: matchMode === "regex" ? "^error" : "error",
            defaultValue: (_a = history[0]) != null ? _a : "",
            onSubmit: async (query) => {
              if (!query) return;
              this.settings.filterHistory = [
                query,
                ...this.settings.filterHistory.filter((h) => h !== query)
              ].slice(0, 10);
              await this.saveSettings();
              const cs = this.settings.caseSensitiveFiltering;
              if (toNewNote) {
                const selections = editor.listSelections();
                const results = [];
                for (const sel of selections) {
                  const { from, to } = normalizeRange(sel.anchor, sel.head);
                  if (from.line === to.line && from.ch === to.ch) continue;
                  results.push(runFilter(editor.getRange(from, to), query, filterMode, matchMode, cs));
                }
                if (results.length === 0) {
                  new import_obsidian5.Notice("No selection to filter.");
                  return;
                }
                const newFile = await this.app.vault.create(
                  `Filter result ${Date.now()}.md`,
                  results.join("\n\n---\n\n")
                );
                await this.app.workspace.openLinkText(newFile.path, "", true);
              } else {
                transformSelections(
                  editor,
                  (t) => runFilter(t, query, filterMode, matchMode, cs)
                );
              }
            }
          }).open();
        }
      });
    };
    makeFilterCommand("filter-include-string", "Filter lines: keep matching string", "include", "string", false);
    makeFilterCommand("filter-exclude-string", "Filter lines: remove matching string", "exclude", "string", false);
    makeFilterCommand("filter-include-regex", "Filter lines: keep matching regex", "include", "regex", false);
    makeFilterCommand("filter-exclude-regex", "Filter lines: remove matching regex", "exclude", "regex", false);
    makeFilterCommand("filter-include-string-new", "Filter lines into new note: keep matching string", "include", "string", true);
    makeFilterCommand("filter-exclude-string-new", "Filter lines into new note: remove matching string", "exclude", "string", true);
    makeFilterCommand("filter-include-regex-new", "Filter lines into new note: keep matching regex", "include", "regex", true);
    makeFilterCommand("filter-exclude-regex-new", "Filter lines into new note: remove matching regex", "exclude", "regex", true);
  }
  // =========================================================================
  // Encoding / conversion
  // =========================================================================
  registerEncodeCommands() {
    const cmds = [
      ["url-encode", "URL encode", urlEncode],
      ["url-decode", "URL decode", urlDecode],
      ["html-encode", "HTML entity encode", htmlEncode],
      ["html-decode", "HTML entity decode", htmlDecode],
      ["base64-encode", "Base64 encode", base64Encode],
      ["base64-decode", "Base64 decode", base64Decode],
      ["json-escape", "JSON escape (to string)", jsonEscape],
      ["json-unescape", "JSON unescape", jsonUnescape],
      ["decimal-to-hex", "Convert decimal to hex", decimalToHex],
      ["hex-to-decimal", "Convert hex to decimal", hexToDecimal]
    ];
    for (const [id, name, fn] of cmds) {
      this.addCommand({
        id,
        name,
        editorCallback: (editor) => {
          if (!transformSelections(editor, fn)) {
            new import_obsidian5.Notice("Select some text first.");
          }
        }
      });
    }
  }
  // =========================================================================
  // Numbers: increase / decrease
  // =========================================================================
  registerNumberCommands() {
    this.addCommand({
      id: "increase-numbers",
      name: "Increase numbers by 1",
      editorCallback: (editor) => transformSelections(editor, (t) => shiftNumbers(t, 1))
    });
    this.addCommand({
      id: "decrease-numbers",
      name: "Decrease numbers by 1",
      editorCallback: (editor) => transformSelections(editor, (t) => shiftNumbers(t, -1))
    });
    this.addCommand({
      id: "increase-numbers-by",
      name: "Increase numbers by custom step",
      editorCallback: (editor) => {
        new InputModal(this.app, {
          title: "Increase numbers",
          label: "Step",
          placeholder: "10",
          onSubmit: (s) => {
            const n = parseInt(s, 10);
            if (isNaN(n)) {
              new import_obsidian5.Notice("Enter a valid integer.");
              return;
            }
            transformSelections(editor, (t) => shiftNumbers(t, n));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "decrease-numbers-by",
      name: "Decrease numbers by custom step",
      editorCallback: (editor) => {
        new InputModal(this.app, {
          title: "Decrease numbers",
          label: "Step",
          placeholder: "10",
          onSubmit: (s) => {
            const n = parseInt(s, 10);
            if (isNaN(n)) {
              new import_obsidian5.Notice("Enter a valid integer.");
              return;
            }
            transformSelections(editor, (t) => shiftNumbers(t, -n));
          }
        }).open();
      }
    });
  }
  // =========================================================================
  // Generate / insert
  // =========================================================================
  registerGenerateCommands() {
    const guidFormats = [
      ["dashes", "Insert GUID (with dashes)"],
      ["nodashes", "Insert GUID (no dashes)"],
      ["braces", "Insert GUID (with braces)"],
      ["csharp", "Insert GUID (C# constructor)"]
    ];
    for (const [format, name] of guidFormats) {
      this.addCommand({
        id: `insert-guid-${format}`,
        name,
        editorCallback: (editor) => this.insertAtEachSelection(
          editor,
          () => generateGuid(format, this.settings.insertUppercaseGuids)
        )
      });
    }
    this.addCommand({
      id: "random-int",
      name: "Insert random integer from range",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Random integer",
          label1: "Min",
          label2: "Max",
          placeholder1: "1",
          placeholder2: "100",
          onSubmit: (minS, maxS) => {
            const [min, max] = [parseInt(minS, 10), parseInt(maxS, 10)];
            if (isNaN(min) || isNaN(max)) {
              new import_obsidian5.Notice("Enter valid numbers.");
              return;
            }
            this.insertAtEachSelection(editor, () => String(randomInt(min, max)));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "random-float",
      name: "Insert random real number from range",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Random real number",
          label1: "Min",
          label2: "Max",
          placeholder1: "0",
          placeholder2: "1",
          onSubmit: (minS, maxS) => {
            const [min, max] = [parseFloat(minS), parseFloat(maxS)];
            if (isNaN(min) || isNaN(max)) {
              new import_obsidian5.Notice("Enter valid numbers.");
              return;
            }
            this.insertAtEachSelection(editor, () => randomFloat(min, max));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "random-hex",
      name: "Insert random hexadecimal number from range",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Random hex number",
          label1: "Min (decimal)",
          label2: "Max (decimal)",
          placeholder1: "0",
          placeholder2: "255",
          onSubmit: (minS, maxS) => {
            const [min, max] = [parseInt(minS, 10), parseInt(maxS, 10)];
            if (isNaN(min) || isNaN(max)) {
              new import_obsidian5.Notice("Enter valid numbers.");
              return;
            }
            this.insertAtEachSelection(
              editor,
              () => randomHex(min, max, this.settings.insertUppercaseGuids)
            );
          }
        }).open();
      }
    });
    this.addCommand({
      id: "lorem-sentence",
      name: "Insert lorem ipsum sentence",
      editorCallback: (editor) => this.insertAtEachSelection(editor, loremSentence)
    });
    this.addCommand({
      id: "lorem-paragraph",
      name: "Insert lorem ipsum paragraph",
      editorCallback: (editor) => this.insertAtEachSelection(editor, loremParagraph)
    });
    const sequences = [
      ["uppercase-letters", "Insert sequence: uppercase letters (A, B, C\u2026)"],
      ["lowercase-letters", "Insert sequence: lowercase letters (a, b, c\u2026)"],
      ["nato", "Insert sequence: NATO phonetic alphabet"],
      ["months-long", "Insert sequence: long month names"],
      ["months-short", "Insert sequence: short month names"],
      ["days-long", "Insert sequence: long day names"],
      ["days-short", "Insert sequence: short day names"]
    ];
    for (const [type, name] of sequences) {
      this.addCommand({
        id: `sequence-${type}`,
        name,
        editorCallback: (editor) => {
          const sels = editor.listSelections();
          const hasMultiple = sels.filter(
            (s) => s.anchor.line !== s.head.line || s.anchor.ch !== s.head.ch
          ).length > 1;
          if (hasMultiple) {
            let idx = 0;
            for (let i = sels.length - 1; i >= 0; i--) {
              const { from, to } = normalizeRange(sels[i].anchor, sels[i].head);
              if (from.line === to.line && from.ch === to.ch) continue;
              editor.replaceRange(getSequenceItem(type, idx++), from, to);
            }
          } else {
            new InputModal(this.app, {
              title: name,
              label: "How many items to insert?",
              placeholder: "5",
              onSubmit: (countStr) => {
                const count = parseInt(countStr, 10);
                if (isNaN(count) || count < 1) {
                  new import_obsidian5.Notice("Enter a positive number.");
                  return;
                }
                const items = [];
                for (let i = 0; i < count; i++) {
                  items.push(getSequenceItem(type, i));
                }
                const sel = sels[sels.length - 1];
                const { from, to } = normalizeRange(sel.anchor, sel.head);
                editor.replaceRange(items.join("\n"), from, to);
              }
            }).open();
          }
        }
      });
    }
    this.addCommand({
      id: "insert-timestamp-local",
      name: "Insert timestamp (local)",
      editorCallback: (editor) => this.insertAtEachSelection(editor, timestampLocal)
    });
    this.addCommand({
      id: "insert-timestamp-utc",
      name: "Insert timestamp (utc / iso 8601)",
      editorCallback: (editor) => this.insertAtEachSelection(editor, timestampUTC)
    });
    this.addCommand({
      id: "insert-timestamp-unix",
      name: "Insert unix timestamp",
      editorCallback: (editor) => this.insertAtEachSelection(editor, timestampUnix)
    });
  }
  // =========================================================================
  // Advanced: format as table, extract via regex, duplicate
  // =========================================================================
  registerAdvancedCommands() {
    this.addCommand({
      id: "format-as-table",
      name: "Format as table",
      editorCallback: (editor) => {
        new InputModal(this.app, {
          title: "Format as table",
          label: "Column delimiter",
          placeholder: "\\t",
          defaultValue: "\\t",
          onSubmit: (delimRaw) => {
            const delim = delimRaw.replace(/\\t/g, "	").replace(/\\n/g, "\n");
            transformSelections(editor, (text) => formatAsTable(text, delim));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "extract-regex",
      name: "Extract with regex",
      editorCallback: (editor) => {
        new TwoInputModal(this.app, {
          title: "Extract with regex",
          label1: "Pattern (with capture groups)",
          label2: "Replacement (use $1, $2\u2026)",
          placeholder1: "(\\w+)\\s(\\w+)",
          placeholder2: "$2, $1",
          onSubmit: (pattern, replacement) => {
            let regex;
            try {
              regex = new RegExp(pattern, "g");
            } catch (e) {
              new import_obsidian5.Notice("Invalid regular expression.");
              return;
            }
            transformSelections(
              editor,
              (text) => text.split("\n").filter((line) => regex.test(line)).map((line) => {
                regex.lastIndex = 0;
                return line.replace(regex, replacement.replace(/\\n/g, "\n"));
              }).join("\n")
            );
          }
        }).open();
      }
    });
    this.addCommand({
      id: "duplicate-selection",
      name: "Duplicate selection",
      editorCallback: (editor) => {
        transformSelections(editor, (t) => t + t);
      }
    });
  }
  // =========================================================================
  // Line numbers (kept from v1)
  // =========================================================================
  registerLineNumberCommands() {
    const insert = (editor, style) => {
      const selections = editor.listSelections();
      const hasSelection = selections.some(
        (s) => s.anchor.line !== s.head.line || s.anchor.ch !== s.head.ch
      );
      if (!hasSelection) {
        new import_obsidian5.Notice("Select some text first.");
        return;
      }
      let maxLineNum = 0;
      if (this.settings.padLineNumbers) {
        for (const sel of selections) {
          const { from, to } = normalizeRange(sel.anchor, sel.head);
          if (from.line === to.line && from.ch === to.ch) continue;
          const lc = editor.getRange(from, to).split("\n").length;
          const last = style === "real" ? from.line + lc : lc;
          if (last > maxLineNum) maxLineNum = last;
        }
      }
      const padWidth = this.settings.padLineNumbers ? String(maxLineNum).length : 0;
      for (let i = selections.length - 1; i >= 0; i--) {
        const { from, to } = normalizeRange(
          selections[i].anchor,
          selections[i].head
        );
        if (from.line === to.line && from.ch === to.ch) continue;
        const lines = editor.getRange(from, to).split("\n");
        const numbered = lines.map((line, idx) => {
          const num = style === "real" ? from.line + idx + 1 : idx + 1;
          const numStr = this.settings.padLineNumbers ? String(num).padStart(padWidth, "0") : String(num);
          return `${numStr}${this.settings.lineNumberSeparator}${line}`;
        });
        editor.replaceRange(numbered.join("\n"), from, to);
      }
    };
    this.addCommand({
      id: "line-numbers-sequential",
      name: "Insert line numbers (sequential, starting at 1)",
      editorCallback: (editor) => insert(editor, "sequential")
    });
    this.addCommand({
      id: "line-numbers-real",
      name: "Insert line numbers (real file line numbers)",
      editorCallback: (editor) => insert(editor, "real")
    });
  }
  // =========================================================================
  // Text slots  (5 persistent named clipboard entries)
  // =========================================================================
  registerTextSlotCommands() {
    for (let i = 1; i <= 5; i++) {
      const idx = i - 1;
      this.addCommand({
        id: `text-slot-set-${i}`,
        name: `Text slot ${i}: set`,
        editorCallback: (editor) => {
          const selections = editor.listSelections();
          const texts = [];
          for (const sel of selections) {
            const { from, to } = normalizeRange(sel.anchor, sel.head);
            if (from.line === to.line && from.ch === to.ch) continue;
            texts.push(editor.getRange(from, to));
          }
          if (texts.length === 0) {
            new import_obsidian5.Notice("Select text to store in the slot.");
            return;
          }
          this.settings.textSlots[idx] = texts.join("\n");
          void this.saveSettings().catch((error) => {
            console.error("Text Tools: failed to save settings", error);
          });
          new import_obsidian5.Notice(`Text slot ${i} set.`);
        }
      });
      this.addCommand({
        id: `text-slot-paste-${i}`,
        name: `Text slot ${i}: paste`,
        editorCallback: (editor) => {
          const content = this.settings.textSlots[idx];
          if (!content) {
            new import_obsidian5.Notice(`Text slot ${i} is empty.`);
            return;
          }
          this.insertAtEachSelection(editor, () => content);
        }
      });
    }
  }
  // =========================================================================
  // Shared helpers
  // =========================================================================
  /**
   * Inserts `factory()` at every selection / cursor position.
   * Each selection is replaced by the generated value; a new independent value
   * is generated for each selection by calling factory() again.
   */
  insertAtEachSelection(editor, factory) {
    const selections = editor.listSelections();
    for (let i = selections.length - 1; i >= 0; i--) {
      const { from, to } = normalizeRange(
        selections[i].anchor,
        selections[i].head
      );
      editor.replaceRange(factory(), from, to);
    }
  }
  // =========================================================================
  // Persistence
  // =========================================================================
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
function formatAsTable(text, delimiter) {
  const rows = text.split("\n").map((line) => line.split(delimiter));
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths = Array.from(
    { length: colCount },
    (_, ci) => Math.max(...rows.map((r) => {
      var _a;
      return ((_a = r[ci]) != null ? _a : "").length;
    }))
  );
  return rows.map(
    (row) => row.map((cell, ci) => cell.padEnd(colWidths[ci])).join("  ").trimEnd()
  ).join("\n");
}

/* nosourcemap */