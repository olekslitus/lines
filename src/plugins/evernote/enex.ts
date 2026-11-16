import { htmlToMarkdown, type MarkdownOf, type OwnElements } from "../../lib/feeds/markdown";
import { t } from "../../lib/i18n/index.svelte";
import type { Exported, ExportedFile } from "../../lib/imports/exported";
import { attachmentPath, type Source, type SourceNote, Tally, withTitle } from "../../lib/imports/notes";
import { attachmentType } from "../../lib/notes/attachments";
import { escapeMarkdownText, propertyValue } from "../../lib/notes/escape";
import { UNPACKED, Unpacking } from "../../lib/zip";
import { md5 } from "./md5";

/*
 * Evernote's notebooks, as it exports them (docs/importing.md#evernote): an .enex file each, XML
 * holding each note's title, dates, tags and attributes, its text as ENML (Evernote's HTML) and its
 * files, in base64. The text goes through the HTML lines reads feeds with (feeds/markdown.ts), so
 * nothing in it runs and it's only ever text; Evernote's own elements become lines': its files
 * (`<en-media>`, by their MD5) as attachments, its checklists as tasks, its code blocks and
 * highlights, and an encrypted part as text saying so, kept as Evernote encrypted it.
 *
 * An .enex that declares entities isn't read at all, so nothing in it is fetched (an external
 * entity) or multiplied (entities made of entities, "billion laughs"): Evernote's declare none.
 * Its files are held to what any import unpacks (zip.ts's `Unpacking`), and decoded from base64
 * only to find their MD5, then again when they're kept.
 */

/** A time as Evernote writes one, `20241114T093000Z`, in ms. */
export function timeOf(value: string | null | undefined) {
  const parts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value?.trim() ?? "");
  return parts ? Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6]) : undefined;
}

const two = (value: number) => String(value).padStart(2, "0");

/** A time as lines writes a date with one, `2024-11-14 09:30`, in this time zone. */
function dueOf(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Base64, as bytes. */
function bytesOf(base64: string) {
  const text = atob(base64);
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** How many bytes base64 of this length holds. */
const sizeOf = (base64: string) => Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);

/**
 * Whether an .enex declares entities, outside its notes' text (CDATA, which is never read as XML's):
 * what XML would expand as it's read, from elsewhere or entities of entities, so such a file isn't
 * read at all. Evernote declares none.
 */
function declaresEntities(xml: string) {
  for (let at = xml.indexOf("<!ENTITY"); at >= 0; at = xml.indexOf("<!ENTITY", at + 1)) {
    const cdata = xml.lastIndexOf("<![CDATA[", at);
    if (cdata < 0 || xml.lastIndexOf("]]>", at) > cdata) return true;
  }
  return false;
}

/** What a note's style says of it, Evernote writing its own as CSS: `--en-todo:true` (`-en-codeblock:true`, in older notes). */
const says = (element: Element, property: string, value = "true") => new RegExp(`(?:^|[;\\s])--?en-${property}\\s*:\\s*${value}`, "i").test(element.getAttribute("style") ?? "");

/** A code block's lines: each line element's text, and text right in it, a `<br>` ending a line. */
function codeLines(block: Element): string[] {
  const lines: string[] = [];
  let line = "";
  for (const node of block.childNodes) {
    if (node instanceof Element && node.localName === "br") {
      lines.push(line);
      line = "";
    } else if (node instanceof Element && (node.localName === "div" || node.localName === "p")) {
      if (line) lines.push(line);
      line = "";
      lines.push(...codeLines(node));
    } else line += node.textContent ?? "";
  }
  if (line || !lines.length) lines.push(...line.split("\n"));
  return lines;
}

/** Whether a checkbox, `<en-todo>`, is ticked. */
const ticked = (box: Element) => box.getAttribute("checked") === "true";

/** A list item's first checkbox of its own, not one in a list under it. */
const boxOf = (item: Element) => [...item.querySelectorAll("en-todo")].find((box) => box.parentElement!.closest("li") === item);

/**
 * An element's content as lines, each checkbox in it starting a task of its own (`[x] `) wherever it
 * is, in a span or after a `<br>`, and each `<br>` a line: the inline elements a box is in are read
 * through, their words kept.
 */
function taskLines(element: Element, markdown: MarkdownOf): string[] {
  const lines: { task: boolean | null; nodes: Node[] }[] = [{ task: null, nodes: [] }];
  const walk = (parent: Node) => {
    for (const node of parent.childNodes) {
      if (node instanceof Element && node.localName === "en-todo") lines.push({ task: ticked(node), nodes: [] });
      else if (node instanceof Element && node.localName === "br") lines.push({ task: null, nodes: [] });
      else if (node instanceof Element && node.querySelector("en-todo, br")) walk(node);
      else lines.at(-1)!.nodes.push(node);
    }
  };
  walk(element);
  const holder = element.ownerDocument.createElement("div");
  return lines.flatMap(({ task, nodes }) => {
    holder.replaceChildren(...nodes.map((node) => node.cloneNode(true)));
    const text = markdown.line(holder);
    if (task === null) return text ? [text] : [];
    return [`- [${task ? "x" : " "}] ${text}`];
  });
}

/** A note's files, by their MD5, and which its text shows. */
interface Files {
  byHash: Map<string, { index: number; file: ExportedFile; type: string }>;
  shown: Set<number>;
}

/** Evernote's own elements in a note's ENML, as lines writes what they are. */
function enml(files: Files, report: Tally, title: string): OwnElements {
  return {
    block(element, markdown) {
      if (element.localName === "div" && says(element, "codeblock")) {
        const code = codeLines(element).join("\n");
        const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((run) => run[0].length + 1)));
        return [`${fence}\n${code}\n${fence}`];
      }
      // Checkboxes, as earlier versions wrote checklists: each starts a task, wherever it is. Not in a list's item, which the list asks about (`task`).
      if ((element.localName === "div" || element.localName === "p") && !element.closest("li") && element.querySelector("en-todo")) {
        const lines = taskLines(element, markdown);
        return lines.length ? [lines.join("\n")] : [];
      }
      return null;
    },
    // A checklist's item, as Evernote 10 writes one; or an item starting with a box.
    task(item) {
      if (says(item.parentElement!, "todo")) return says(item, "checked");
      const box = boxOf(item);
      return box ? ticked(box) : null;
    },
    inline(element, markdown) {
      switch (element.localName) {
        case "en-todo":
          return "";
        case "en-media": {
          const found = files.byHash.get(element.getAttribute("hash")?.toLowerCase() ?? "");
          if (!found) {
            report.add("import.report.missing", `${element.getAttribute("type") ?? ""} (${title})`);
            return "";
          }
          files.shown.add(found.index);
          const place = attachmentPath(found.index);
          const width = Number(element.getAttribute("width"));
          if (found.type.startsWith("image/")) return `![${width > 0 ? `|${Math.round(width)}` : ""}](${place})`;
          return `[${found.file.path.split("/").pop()!.replace(/[[\]]/g, "")}](${place})`;
        }
        case "en-crypt": {
          report.add("import.report.encrypted", title);
          // Its hint is only words: never a link, a tag or anything else.
          const hint = escapeMarkdownText(element.getAttribute("hint") ?? "").join(" ").trim();
          return ` ${t(hint ? "import.evernote.encryptedHint" : "import.evernote.encrypted", { hint: hint ?? "" })} \`${(element.textContent ?? "").replace(/\s+/g, "")}\` `;
        }
        case "span":
          return says(element, "highlight", "[a-z]+") ? `==${markdown.line(element)}==` : null;
        default:
          return null;
      }
    },
  };
}

/** A note's ENML, its own elements written so HTML's reader reads them as elements, not as starts of what follows. */
const enmlOf = (content: string) =>
  (/<en-note[^>]*>([\s\S]*)<\/en-note>/.exec(content)?.[1] ?? content).replace(/<(en-media|en-todo)\b([^>]*?)\s*\/>/g, "<$1$2></$1>");

/** Lines of tasks, one under another, without the blank lines paragraphs had between them. */
const tightTasks = (markdown: string) => markdown.replace(/^(- \[[ x]\] .*)\n\n(?=- \[[ x]\] )/gm, "$1\n");

/** The notes of one notebook's .enex, its name the notebook's. */
export function readNotebook(notebook: string, xml: string, attachments: ExportedFile[], report: Tally, unpacking = new Unpacking()): SourceNote[] {
  if (declaresEntities(xml)) throw new Error(`${notebook} declares entities, which lines doesn't expand`);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`${notebook} isn't an .enex file lines can read`);
  return [...document.querySelectorAll("en-export > note")].map((note) => {
    const own = (name: string) => note.querySelector(`:scope > ${name}`)?.textContent ?? "";
    const attribute = (name: string) => note.querySelector(`:scope > note-attributes > ${name}`)?.textContent?.trim() ?? "";
    const title = own("title").trim() || t("import.evernote.untitled");
    const files: Files = { byHash: new Map(), shown: new Set() };
    for (const resource of note.querySelectorAll(":scope > resource")) {
      const base64 = (resource.querySelector("data")?.textContent ?? "").replace(/\s+/g, "");
      const type = resource.querySelector("mime")?.textContent?.trim() || "application/octet-stream";
      const named = resource.querySelector("resource-attributes > file-name")?.textContent?.trim();
      const extension = /^[^/]+\/([a-z0-9]+)/i.exec(type)?.[1] ?? "bin";
      const name = named || `${t("import.evernote.file")}.${extension === "jpeg" ? "jpg" : extension}`;
      const path = `${notebook}/${title}/${name}`;
      const size = sizeOf(base64);
      let hash: string;
      try {
        if (!unpacking.allows({ size, packed: size })) throw new Error("Too big");
        hash = md5(bytesOf(base64));
      } catch {
        // Too big, past what's left, or not base64: left out, and said so.
        report.add("import.report.skipped", path);
        continue;
      }
      const file: ExportedFile = {
        path,
        size,
        text: async () => new TextDecoder().decode(bytesOf(base64)),
        file: async () => new File([bytesOf(base64)], name, { type: attachmentType(name) === "application/octet-stream" ? type : attachmentType(name) }),
      };
      files.byHash.set(hash, { index: attachments.push(file) - 1, file, type });
    }
    let markdown = tightTasks(htmlToMarkdown(enmlOf(own("content")), undefined, enml(files, report, title)));
    // Files a note has but its text doesn't show: under it, rather than left out.
    for (const { index, file, type } of files.byHash.values()) {
      if (files.shown.has(index)) continue;
      const name = file.path.split("/").pop()!.replace(/[[\]]/g, "");
      markdown += `\n\n${type.startsWith("image/") ? `![${name}]` : `[${name}]`}(${attachmentPath(index)})`;
    }
    const created = timeOf(own("created"));
    const updated = timeOf(own("updated"));
    const reminder = timeOf(attribute("reminder-time"));
    const properties = [
      ...(attribute("author") ? [`author: ${propertyValue(attribute("author"))}`] : []),
      ...(attribute("source-url") ? [`url: ${propertyValue(attribute("source-url"))}`] : []),
      ...(reminder && !attribute("reminder-done-time") ? [`due: ${dueOf(reminder)}`] : []),
    ];
    return {
      id: `${notebook}/${title}/${own("created").trim()}`,
      name: title,
      body: `${withTitle(title, markdown, properties.length ? `---\n${properties.join("\n")}\n---\n` : "").trimEnd()}\n`,
      folders: [notebook],
      tags: [...note.querySelectorAll(":scope > tag")].map((tag) => tag.textContent?.trim() ?? "").filter(Boolean),
      created,
      updated: updated ?? created,
    };
  });
}

/**
 * Evernote's .enex files, a notebook each. One that can't be read, or is over 2 GB (more than's read
 * here at once), is left out, and said so, unless it's all there is. A note's id is its notebook's name, its title and when it was made, which an
 * .enex has of it (not Evernote's own id), the same each time it's exported.
 */
export async function readEnex({ name, files }: Exported): Promise<Source> {
  const report = new Tally();
  const unpacking = new Unpacking();
  const attachments: ExportedFile[] = [];
  const notes: SourceNote[] = [];
  const enex = files.filter((file) => /\.enex$/i.test(file.path));
  for (const file of enex) {
    try {
      if (file.size > UNPACKED) throw new Error(`${file.path} is over 2 GB`);
      notes.push(...readNotebook(file.path.split("/").pop()!.replace(/\.enex$/i, ""), await file.text(), attachments, report, unpacking));
    } catch (error) {
      if (enex.length === 1) throw error;
      console.warn(`lines: couldn't read ${file.path}`, error);
      report.add("import.report.skipped", file.path);
    }
  }
  return { name: name.replace(/\.enex$/i, ""), notes, attachments, report };
}
