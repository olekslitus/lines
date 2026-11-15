import type { Exported, ExportedFile } from "../../lib/imports/exported";
import { baseOf, folderOf, normalized, pathOf } from "../../lib/imports/markdown";
import { noteLink, type Source, type SourceNote, Tally, withTitle } from "../../lib/imports/notes";
import { propertyValue } from "../../lib/notes/escape";
import { nameOf, typeRefOf } from "../../lib/notes/properties";
import { parseCsv } from "../../lib/sheets/csv";
import { type Target, translate } from "./markdown";

/*
 * Notion's "Markdown & CSV" export, read (docs/importing.md#notion): a note for each page, titled
 * without the id Notion adds to names (`Plan 1a2b….md`), filed under the pages it's in as nested
 * tags; each database a note with a table of its rows (`@type.reading_list`), and each row a note
 * of that type, its columns its properties. Notion's ids are its own everywhere, so importing again
 * knows its notes wherever the export was made.
 */

const lower = (text: string) => text.toLowerCase();
/** The id Notion adds to a page's, a database's or a folder's name: ` 1a2b3c…` (32 hex digits). */
const ID = / ([0-9a-f]{32})$/i;
const stem = (path: string) => baseOf(path).replace(/(?:_all)?\.(?:md|csv)$/i, "");
const idOf = (path: string) => ID.exec(stem(path))?.[1]?.toLowerCase();
/** A name as Notion shows it, without its id. */
const titleOf = (name: string) => name.replace(ID, "").trim() || name;

/** What a database is: its name, its columns, and its rows' folder. */
interface Database {
  id: string;
  name: string;
  /** Its name as a type of notes (`keyOf`); empty for one with nothing a type's name can have. */
  type: string;
  columns: string[];
  /** Its columns as its rows' properties' keys (`keysOf`), in the same order. */
  keys: string[];
  folder: string;
  file: ExportedFile;
}

/**
 * A name as a property's key or a type's name can have it: letters, digits, spaces, `_` and `-`,
 * the rest left out (`Price ($)` → `Price`, `📚 Reading List` → `Reading List`).
 */
const keyOf = (name: string) =>
  name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} _-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[- ]+/, "");

/** A database's columns as keys, each its own (`Done 2` after `Done`), and none `type`, which says what a row is. */
function keysOf(columns: string[]) {
  const taken = new Set(["type"]);
  return columns.map((column) => {
    const base = keyOf(column) || "Column";
    let key = base;
    for (let n = 2; taken.has(key.toLowerCase()); n++) key = `${base} ${n}`;
    taken.add(key.toLowerCase());
    return key;
  });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) ([AP]M))?$/;
const two = (value: number) => String(value).padStart(2, "0");

/** A date as Notion writes one (`November 14, 2024 9:00 AM`), as lines does (`2024-11-14 09:00`); null for anything else. */
function isoOf(value: string) {
  const date = DATE.exec(value.trim());
  const month = date ? MONTHS.indexOf(date[1].toLowerCase()) + 1 : 0;
  if (!date || !month) return null;
  const hours = date[4] ? (Number(date[4]) % 12) + (date[6] === "PM" ? 12 : 0) : null;
  return `${date[3]}-${two(month)}-${two(Number(date[2]))}${hours === null ? "" : ` ${two(hours)}:${date[5]}`}`;
}

/** When a date lines writes is, in this time zone (ms). */
const timeOf = (iso: string) => {
  const time = Date.parse(iso.replace(" ", "T"));
  return Number.isNaN(time) ? undefined : time;
};

export async function readNotion({ name: exported, files }: Exported): Promise<Source> {
  const byPath = new Map(files.map((file) => [lower(file.path), file]));
  const report = new Tally();

  // Databases: their `_all` CSV where there's one, which has every row, not only those of its first view.
  const databases = new Map<string, Database>();
  for (const file of files.filter((each) => /\.csv$/i.test(each.path))) {
    const id = idOf(file.path);
    if (!id || (databases.has(id) && !/_all\.csv$/i.test(file.path))) continue;
    const [columns = []] = parseCsv(await file.text());
    const name = titleOf(stem(file.path));
    databases.set(id, { id, name, type: keyOf(name), columns, keys: keysOf(columns), folder: `${folderOf(file.path) ? `${folderOf(file.path)}/` : ""}${stem(file.path)}`, file });
  }
  for (const { name, type, columns, keys } of databases.values()) {
    // Its title column is each row's title, not a property.
    for (const [i, column] of columns.entries()) if (i && keys[i] !== column) report.add("import.report.columns", `${column} → ${keys[i]} (${name})`);
    if (!type) report.add("import.report.untyped", name);
  }
  /** Each database's rows' names, for one that can't be a type, whose note lists them instead. */
  const rows = new Map<Database, string[]>();
  const databaseOf = new Map([...databases.values()].map((database) => [lower(database.folder), database]));

  const pages = files.filter((file) => /\.md$/i.test(file.path));
  const names = new Map<string, string>();
  const texts = new Map<ExportedFile, string>();
  for (const file of pages) {
    const text = await file.text();
    texts.set(file, text);
    names.set(lower(file.path), /^#\s+(.+?)\s*$/m.exec(text.slice(0, 500))?.[1] ?? titleOf(stem(file.path)));
  }
  for (const database of databases.values()) names.set(lower(database.file.path), database.name);
  const named = new Map<string, number>();
  for (const name of names.values()) named.set(nameOf(name), (named.get(nameOf(name)) ?? 0) + 1);
  for (const [path, name] of names) if (named.get(nameOf(name))! > 1) report.add("import.report.sameName", byPath.get(path)!.path);
  // A database's other CSV, which a page may link to as well, leads to its note too.
  for (const file of files) {
    const database = /\.csv$/i.test(file.path) && databases.get(idOf(file.path) ?? "");
    if (database) names.set(lower(file.path), database.name);
  }
  /** Pages by their files' names, for a relation written from elsewhere than its row's folder. */
  const byFile = new Map([...names].map(([path, name]) => [baseOf(path), name]));

  const attachments: ExportedFile[] = [];
  const shown = new Map<ExportedFile, number>();
  const notes: SourceNote[] = [];

  /** A database row's columns as properties: relations as links to their pages, dates as lines writes them. */
  const valueOf = (value: string, from: string) =>
    value
      .split(/,\s+(?=[^,]*\(.*\.md\))/)
      .map((part) => {
        const relation = /^(.*?) \(([^()]*\.md)\)$/.exec(part.trim());
        if (relation) {
          const path = pathOf(relation[2]);
          const target = names.get(lower(normalized(`${from}/${path}`))) ?? byFile.get(lower(baseOf(path)));
          return target ? noteLink(target) : relation[1];
        }
        const range = part.split(" → ").map(isoOf);
        return range.every(Boolean) ? range.join(" → ") : part;
      })
      .join(", ");

  for (const file of pages) {
    const folder = folderOf(file.path);
    const name = names.get(lower(file.path))!;
    const database = databaseOf.get(lower(folder));
    let text = texts.get(file)!;
    const properties: string[] = [];
    let created: number | undefined;
    let updated: number | undefined;
    if (database) {
      // A row's columns, written under its title as `Key: Value` lines.
      const lines = text.split("\n");
      const start = lines.findIndex((line) => line.trim() && !/^#\s/.test(line));
      let end = start;
      for (; end >= 0 && end < lines.length; end++) {
        const column = /^([^:\n]+): (.*)$/.exec(lines[end]);
        const index = column ? database.columns.indexOf(column[1]) : -1;
        if (!column || index < 0) break;
        const [, label, raw] = column;
        const value = valueOf(raw, folder);
        if (/^created( time)?$/i.test(label)) created ??= timeOf(value);
        if (/^(last edited|updated)( time)?$/i.test(label)) updated ??= timeOf(value);
        properties.push(`${database.keys[index]}: ${propertyValue(value)}`);
      }
      // And the blank line after them.
      if (start >= 0) text = [...lines.slice(0, start), ...lines.slice(end + (lines[end]?.trim() ? 0 : 1))].join("\n");
      if (database.type) properties.unshift(`type: ${propertyValue(database.type)}`);
      rows.set(database, [...(rows.get(database) ?? []), name]);
    }
    const body = translate(
      text,
      {
        report,
        resolve(path): Target | null {
          const target = byPath.get(lower(normalized(`${folder}/${path}`)));
          if (!target) return null;
          const page = names.get(lower(target.path));
          if (page) return { note: page };
          if (!shown.has(target)) shown.set(target, attachments.push(target) - 1);
          return { file: shown.get(target)!, name: baseOf(target.path) };
        },
      },
      name,
    );
    // The pages it's in, by their names, but a database, which is its type.
    const parents = (database ? folderOf(folder) : folder).split("/").filter(Boolean).map(titleOf);
    notes.push({
      id: idOf(file.path) ?? file.path,
      name,
      body: `${withTitle(name, body, properties.length ? `---\n${properties.join("\n")}\n---\n` : "").trimEnd()}\n`,
      folders: parents,
      tags: [],
      created: created ?? file.modified,
      updated: updated ?? created ?? file.modified,
    });
  }

  for (const database of databases.values()) {
    const keys = database.keys.slice(1);
    // A table of its rows, as a type's; or, for one that can't be a type, a list of them.
    const table = database.type ? typeRefOf(lower(database.type), keys.length ? keys : null) : (rows.get(database) ?? []).map((row) => `- ${noteLink(row)}`).join("\n");
    notes.push({
      id: database.id,
      name: database.name,
      body: `${withTitle(database.name, table)}\n`,
      folders: folderOf(database.file.path).split("/").filter(Boolean).map(titleOf),
      tags: [],
      created: database.file.modified,
      updated: database.file.modified,
    });
  }
  for (const file of files) if (!/\.(?:md|csv)$/i.test(file.path) && !shown.has(file)) report.add("import.report.unused", file.path);
  return { name: exported, notes, attachments, report };
}
