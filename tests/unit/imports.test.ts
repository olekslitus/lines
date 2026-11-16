import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { join, relative } from "node:path";
import type { Exported } from "../../src/lib/imports/exported";
import { baseOf } from "../../src/lib/imports/markdown";
import type { NewNote } from "../../src/lib/imports/imports.svelte";
import type { Tally } from "../../src/lib/imports/notes";
import type { Entry } from "../../src/lib/notes/store.svelte";
import type { NoteSource } from "../../src/lib/notes/types";
import { stubApp } from "./stubs";

/*
 * Notes from other apps: an Obsidian vault (fixtures/obsidian/Vault, written by hand as Obsidian
 * keeps one: Markdown files, its settings in .obsidian/, its trash in .trash/) read into Linedown,
 * what importing it would do against the notes there are, and the notes it makes. Messages are their
 * keys here (stubs.ts).
 */

stubApp();

const { readVault } = await import("../../src/plugins/obsidian/vault");
const { readBear } = await import("../../src/plugins/bear/backup");
const { readGraph } = await import("../../src/plugins/logseq/graph");
const { readPage, writePage } = await import("../../src/plugins/logseq/outline");
const { formatDay, readDay } = await import("../../src/plugins/logseq/dates");
const { readNotion } = await import("../../src/plugins/notion/export");
const { translate: translateNotion } = await import("../../src/plugins/notion/markdown");
const { md5 } = await import("../../src/plugins/evernote/md5");
const { timeOf } = await import("../../src/plugins/evernote/enex");
const { translate: translateBear } = await import("../../src/plugins/bear/markdown");
const { translate } = await import("../../src/plugins/obsidian/markdown");
const { attachmentPath, notesInput, notesWork, planNotes, Tally: Tallies, withTitle } = await import("../../src/lib/imports/notes");
const { exportedFrom, TooBig } = await import("../../src/lib/imports/exported");
const { Unpacking, zip } = await import("../../src/lib/zip");
const { computeMeta } = await import("../../src/lib/notes/parse");
const { imageSize, withWidth } = await import("../../src/lib/notes/attachments");

const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? walk(join(dir, entry)) : [join(dir, entry)]));

/** A folder of fixtures/ as a picker of folders gives it, each file dated alike. */
function folder(name: string): Exported {
  const root = new URL(`fixtures/${name}`, import.meta.url).pathname;
  return {
    name: root.split("/").at(-1)!,
    files: walk(root).map((path) => ({
      path: relative(root, path),
      size: statSync(path).size,
      modified: DAY,
      text: async () => readFileSync(path, "utf8"),
      file: async () => new File([readFileSync(path)], path.split("/").at(-1)!),
    })),
  };
}

const DAY = Date.UTC(2024, 10, 14);
const vault = await readVault(folder("obsidian/Vault"));
const note = (id: string) => vault.notes.find((each) => each.id === id)!;
/** What's said of each kind that didn't come across as it was: how many, and its examples (in order, as files may come in any). */
const said = (report: Tally) => Object.fromEntries([...report.kinds].map(([kind, { count, examples }]) => [kind.replace("import.report.", ""), [count, ...[...examples].sort()]]));
/** Where a placeholder for an attachment is, as a test reads it. */
const shown = (body: string) => body.replace(/\.\.\/attachments\/\uE000(\d+)\uE000/g, (_, index) => `<${vault.attachments[Number(index)].path}>`);
const entries = (...notes: { body: string; source?: NoteSource; trashed?: boolean }[]): Entry[] =>
  notes.map(({ body, source, trashed = false }, i) => ({ note: { id: `note-${i}`, body, createdAt: 0, updatedAt: 0, pinned: false, trashed, source }, meta: computeMeta(body) }));
/** The vault imported before, as its notes say. */
const VAULT = { id: "c1", name: "Vault" };
/** A note imported from that vault before, by its path in it. */
const from = (id: string, { trashed = false, app = "obsidian" } = {}) => ({ body: `# ${id}`, source: { app, collection: VAULT, id, name: id }, trashed });

/** A note's translation on its own, with links leading to `notes` (by name) and `files` (by path). */
function translated(text: string, { notes = [] as string[], files = [] as string[] } = {}) {
  const report = new Tallies();
  const resolve = (target: string) => {
    const note = target.replace(/\.md$/, "");
    return notes.includes(note) ? { note } : files.includes(target) ? { file: files.indexOf(target), name: target } : null;
  };
  const done = translate(text, { report, resolve }, "Note");
  return { ...done, body: done.body.replace(/\.\.\/attachments\/\uE000(\d+)\uE000/g, (_, index) => `<${files[Number(index)]}>`), report: said(report) };
}

describe("an Obsidian vault", () => {
  test("each Markdown file a note, its title its file's name, in its folders; its settings and other hidden files left out", () => {
    expect(vault.name).toBe("Vault");
    expect(vault.notes.map(({ id, name, folders }) => [id, name, folders.join("/")]).sort()).toEqual([
      [".trash/Old idea.md", "Old idea", ""],
      ["Daily/2026-11-14.md", "2026-11-14", "Daily"],
      ["Ideas.md", "Ideas", ""],
      ["Projects/Acme/Plan.md", "Plan", "Projects/Acme"],
      ["Projects/Plan.md", "Plan", "Projects"],
      ["Welcome.md", "Welcome", ""],
    ]);
    // A title written as the note's first heading isn't written again.
    expect(note("Ideas.md").body).toBe("# Ideas\n\n- A garden #someday\n");
    expect(note("Projects/Plan.md").body).toBe("# Plan\n\nThe plan for #work, from [[Welcome]].\n");
  });

  test("bookmarked notes (in groups too) pinned, the trash's in the Trash, daily notes dated, dates from properties or the file", () => {
    expect(vault.notes.filter((each) => each.pinned).map((each) => each.id)).toEqual(["Ideas.md", "Projects/Plan.md"]);
    expect(note(".trash/Old idea.md")).toMatchObject({ trashed: true, folders: [] });
    expect(note("Daily/2026-11-14.md").body).toBe("---\ndate: 2026-11-14\n---\n# 2026-11-14\n\nRain all day.\n");
    expect(note("Welcome.md")).toMatchObject({ created: Date.UTC(2024, 2, 1, 9), updated: DAY });
  });

  test("its Markdown in Linedown: links to where they lead, pictures and files, callouts, comments; code as it is", () => {
    expect(shown(note("Welcome.md").body)).toBe(
      [
        "---",
        "aliases:",
        "  - Start",
        "cssclasses: wide",
        "created: 2024-03-01T09:00:00Z",
        "---",
        "# Welcome",
        "",
        "Welcome to the vault. See [[Plan]], [[Ideas|my ideas]] and [[Plan#Budget|Acme's budget]].",
        "",
        "![|300](<Attachments/diagram.png>)",
        "[Report 2026.pdf](<Attachments/Report 2026.pdf>)",
        "[[Ideas]]",
        "[[Missing note]], [[#Further reading]] and ![[gone.png]]",
        "",
        ":::info icon=lightbulb",
        "**Remember**",
        "",
        "Keep it **simple**.",
        "",
        ":::warning",
        "Nested.",
        ":::",
        ":::",
        "",
        "A ==highlight== and <!--a hidden comment--> here. A line with an id ^37066d",
        "",
        "<!--",
        "A comment",
        "over lines",
        "-->",
        "",
        "- [ ] Open task",
        "- [x] Done task",
        "- [/] Half done",
        "",
        "`[[not a link]]` stays code.",
        "",
        "```dataview",
        "LIST FROM #project",
        "```",
        "",
        "[[Plan|Plan as Markdown]], ![photo](<Attachments/diagram.png>) and [the site](https://obsidian.md).",
        "",
      ].join("\n"),
    );
    expect(note("Welcome.md").tags).toEqual(["inbox", "project/active"]);
    expect(note("Projects/Acme/Plan.md").body).toBe("# Plan\n\n## Budget\n\n:::question\n**Who pays?**\n\nAcme does.\n:::\n\nBack to [[Welcome#Ideas]].\n");
  });

  test("what doesn't come across as it was is counted, with where it is; files no note shows are left out", () => {
    // Not the picture of the same name in the trash, which is nearer: links never lead into it.
    expect(vault.attachments.map((file) => file.path)).toEqual(["Attachments/diagram.png", "Attachments/Report 2026.pdf"]);
    expect(said(vault.report)).toEqual({
      cssClasses: [1, "cssclasses: wide (Welcome)"],
      embeds: [1, "![[Ideas]] (Welcome)"],
      headingLinks: [1, "[[#Further reading]] (Welcome)"],
      missing: [1, "![[gone.png]] (Welcome)"],
      blockIds: [1, "^37066d (Welcome)"],
      taskStatuses: [1, "[/] (Welcome)"],
      dataview: [1, "Welcome"],
      sameName: [2, "Projects/Acme/Plan.md", "Projects/Plan.md"],
      unused: [2, "Attachments/unused.png", "Board.canvas"],
    });
  });

  test("read from a ZIP of it too, its top folder its name", async () => {
    const files = folder("obsidian/Vault").files;
    const bytes = zip(await Promise.all(files.map(async (file) => ({ name: `Vault/${file.path}`, data: new Uint8Array(await (await file.file()).arrayBuffer()), modified: new Date(DAY) }))));
    const exported = await exportedFrom([new File([bytes], "Vault.zip")]);
    expect(exported.name).toBe("Vault");
    expect(exported.files.map((file) => file.path).sort()).toEqual(files.map((file) => file.path).sort());
    const welcome = exported.files.find((file) => file.path === "Welcome.md")!;
    expect(await welcome.text()).toStartWith("---\ntags: [inbox, project/active]\n");
    expect(welcome.modified).toBe(new Date(DAY).setSeconds(0, 0));
    expect((await exported.files.find((file) => file.path.endsWith(".png"))!.file()).type).toBe("image/png");
  });
});

describe("Obsidian's Markdown", () => {
  test("callouts of each kind as lines' nearest, foldable or not, unknown ones as cards of their name", () => {
    expect(translated("> [!NOTE]\n> Hi").body).toBe(":::info icon=pencil\nHi\n:::");
    expect(translated("Before\n> [!faq]+ Why?\n> Because.\n\nAfter").body).toBe("Before\n\n:::question\n**Why?**\n\nBecause.\n:::\n\nAfter");
    // A line under the quote's text without its `>` goes on with it, as Markdown (and Obsidian) has it.
    expect(translated("> [!faq] Why?\n> Because\nof this.").body).toBe(":::question\n**Why?**\n\nBecause\nof this.\n:::");
    expect(translated("> [!danger] Careful").body).toBe(":::error icon=zap\n**Careful**\n:::");
    expect(translated("> [!recipe]\n> Flour").body).toBe("::: recipe\nFlour\n:::");
    // A quote is a quote, and a callout in code is code.
    expect(translated("> Just a quote").body).toBe("> Just a quote");
    expect(translated("```\n> [!note]\n```").body).toBe("```\n> [!note]\n```");
  });

  test("links by path, with a heading or text; Markdown links decoded; web links as they are", () => {
    const notes = ["Plan", "Other Note"];
    expect(translated("[[Plan#Goals|the goals]] [[Plan|Plan]] [[Plan.md]]", { notes }).body).toBe("[[Plan#Goals|the goals]] [[Plan]] [[Plan]]");
    expect(translated("[x](Other%20Note.md#Some%20Heading) [y](<Other Note.md>) [z](mailto:a@b.c) [w](#top)", { notes }).body).toBe(
      "[[Other Note#Some Heading|x]] [[Other Note|y]] [z](mailto:a@b.c) [w](#top)",
    );
  });

  test("pictures with their width or description, other files as links to them, wherever they're written", () => {
    const files = ["a.png", "b.pdf", "c.mp3"];
    expect(translated("![[a.png|640x480]] ![[a.png|A lake]] ![[b.pdf#page=3]] [[c.mp3|Interview]] ![alt|200](a.png) [doc](b.pdf)", { files }).body).toBe(
      "![|640](<a.png>) ![A lake](<a.png>) [b.pdf](<b.pdf>) [Interview](<c.mp3>) ![alt|200](<a.png>) [doc](<b.pdf>)",
    );
  });

  test("comments hide links in them, and stop at code; block ids and task statuses only outside code", () => {
    expect(translated("%%[[Plan]]%% `%%` [[Plan]]", { notes: ["Plan"] }).body).toBe("<!--[[Plan]]--> `%%` [[Plan]]");
    const { report } = translated("```\n- [?] Not a task ^not-an-id\n```\n- [?] A question ^q1");
    expect(report).toEqual({ taskStatuses: [1, "[?] (Note)"], blockIds: [1, "^q1 (Note)"] });
  });

  test("code as lines' Markdown reads it, indented or in a list too, is left as it is, and a comment never runs into it", () => {
    const notes = ["Plan"];
    const files = ["a.png"];
    expect(translated('Text\n\n    printf("%%d", x); ![[a.png]]\n\n[[Plan]] %%hidden%%', { notes, files }).body).toBe('Text\n\n    printf("%%d", x); ![[a.png]]\n\n[[Plan]] <!--hidden-->');
    expect(translated("- One\n  - Two\n\n        ```\n        %% [[Plan]]\n        ```\n\n[[Plan]]", { notes }).body).toBe("- One\n  - Two\n\n        ```\n        %% [[Plan]]\n        ```\n\n[[Plan]]");
    // A `%%` whose pair is past a code block, or which would be no HTML comment, stays as written.
    expect(translated("%% open\n\n```\nx\n```\n\nclose %% [[Plan]]", { notes }).body).toBe("%% open\n\n```\nx\n```\n\nclose %% [[Plan]]");
    const unsafe = translated("%% a --> b %% and [[Plan]]", { notes });
    expect([unsafe.body, unsafe.report]).toEqual(["%% a --> b %% and [[Plan]]", { comments: [1, "%% a --> b %% (Note)"] }]);
  });

  test("a bar it writes in a table is escaped, `\\|`, as the table needs it: a link's, a heading link's, a picture's width; in a callout too", () => {
    const notes = ["Plan"];
    const table = (row: string) => `| A | B |\n|---|---|\n${row}`;
    expect(translated(table("| ![[a.png\\|300]] | [[Plan\\|the plan]] |"), { notes, files: ["a.png"] }).body).toBe(table("| ![\\|300](<a.png>) | [[Plan\\|the plan]] |"));
    expect(translated(table("| [the plan](Plan.md) | [goals](Plan.md#Goals) |"), { notes }).body).toBe(table("| [[Plan\\|the plan]] | [[Plan#Goals\\|goals]] |"));
    expect(translated("> [!note]\n> | A |\n> |---|\n> | [x](Plan.md) |", { notes }).body).toBe(":::info icon=pencil\n| A |\n|---|\n| [[Plan\\|x]] |\n:::");
    // lines reads a picture's width after an escaped bar, and keeps it escaped when it's resized.
    expect([imageSize("\\|300"), imageSize("Lake\\|300"), withWidth("Lake\\|300", 400), withWidth("Lake|300", 400)]).toEqual([
      { alt: "", width: 300 },
      { alt: "Lake", width: 300 },
      "Lake\\|400",
      "Lake|400",
    ]);
    // Outside a table, a bar is a bar.
    expect(translated("[the plan](Plan.md) ![[a.png|300]]", { notes, files: ["a.png"] }).body).toBe("[[Plan|the plan]] ![|300](<a.png>)");
  });

  test("a comment within text ends in its paragraph, or its `%%` stays text, said so; one starting a paragraph runs on; links aren't looked in", () => {
    const notes = ["Plan"];
    const open = translated("Text %%a thought\n\nmore%% and [[Plan]]", { notes });
    expect([open.body, open.report]).toEqual(["Text %%a thought\n\nmore%% and [[Plan]]", { openComments: [2, "%% and [[Plan]] (Note)", "%%a thought (Note)"] }]);
    expect(translated("- one %%a\n- two%%").body).toBe("- one %%a\n- two%%");
    expect(translated("| %%a | b%% |\n|---|---|").body).toBe("| %%a | b%% |\n|---|---|");
    expect(translated("%%\nHidden\n\nstill hidden\n%%\nShown").body).toBe("<!--\nHidden\n\nstill hidden\n-->\nShown");
    expect(translated("[50%% off](Plan.md) [[Plan|100%%]] %%note%%", { notes }).body).toBe("[[Plan|50%% off]] [[Plan|100%%]] <!--note-->");
  });

  test("Markdown links with brackets or reserved characters in their paths", () => {
    const done = translated("[m](Meeting%20(2024).md) ![](Screenshot%20(1).png) [x](A%26B.md) [y](<Q&A.md>)", { notes: ["Meeting (2024)", "A&B", "Q&A"], files: ["Screenshot (1).png"] });
    expect(done.body).toBe("[[Meeting (2024)|m]] ![](<Screenshot (1).png>) [[A&B|x]] [[Q&A|y]]");
  });

  test("properties: tags taken into the text, links in values followed, those lines can't read kept as YAML", () => {
    // Properties are YAML: a `%%` in one is text.
    expect(translated("---\nsale: 50%% off %%\n---\nText").front).toBe("---\nsale: 50%% off %%\n---\n");
    const done = translated("---\ntags:\n  - a\n  - b/c\nup: \"[[Plan]]\"\n---\nText", { notes: ["Plan"] });
    expect([done.front, done.body, done.tags]).toEqual(["---\nup: \"[[Plan]]\"\n---\n", "Text", ["a", "b/c"]]);
    expect(translated("---\ntags: one two\n---\nText").front).toBe("");
    // Nested ones are read as text; a key in quotes isn't read at all.
    expect(translated("---\nauthor:\n  name: Ada\n---\nText").front).toBe("---\nauthor:\n  name: Ada\n---\n");
    const unread = translated('---\n"Born on": 1815\n---\nText');
    expect([unread.front, unread.body, unread.report]).toEqual(["", '```yaml\n"Born on": 1815\n```\n\nText', { properties: [1, "Note"] }]);
  });
});

describe("what's chosen to import", () => {
  /** A file as a picker of folders gives it, knowing its path in the folder chosen. */
  const inFolder = (path: string, data: BlobPart) => Object.defineProperty(new File([data], path.split("/").at(-1)!), "webkitRelativePath", { value: path });
  const zipOf = (files: Record<string, string | Uint8Array>) => zip(Object.entries(files).map(([name, data]) => ({ name, data, modified: new Date(DAY) })));
  const MB = 1024 ** 2;

  /** A ZIP of `files`, each deflated, as most apps write them. */
  function deflated(files: Record<string, Uint8Array>) {
    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const [name, data] of Object.entries(files)) {
      const packed = deflateRawSync(data);
      const path = new TextEncoder().encode(name);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(8, 8, true);
      head.setUint32(18, packed.length, true);
      head.setUint32(22, data.length, true);
      head.setUint16(26, path.length, true);
      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true);
      record.setUint16(10, 8, true);
      record.setUint32(20, packed.length, true);
      record.setUint32(24, data.length, true);
      record.setUint16(28, path.length, true);
      record.setUint32(42, offset, true);
      local.push(new Uint8Array(head.buffer), path, packed);
      central.push(new Uint8Array(record.buffer), path);
      offset += 30 + path.length + packed.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, central.length / 2, true);
    end.setUint16(10, central.length / 2, true);
    end.setUint32(16, offset, true);
    return new Uint8Array(Buffer.concat([...local, ...central, new Uint8Array(end.buffer)]));
  }

  test("a folder's files, a ZIP in it too: never unpacked, nor changing its name or paths", async () => {
    const exported = await exportedFrom([inFolder("Vault/Welcome.md", "# Hi"), inFolder("Vault/Attachments/archive.zip", zipOf({ "readme.md": "# Readme" })), inFolder("Vault/old.zip", "damaged"), inFolder("Vault/.obsidian/app.json", "{}")]);
    expect([exported.name, exported.files.map((file) => file.path), exported.skipped]).toEqual(["Vault", ["Welcome.md", "Attachments/archive.zip", "old.zip", ".obsidian/app.json"], undefined]);
    expect((await exported.files[1].file()).size).toBeGreaterThan(0);
  });

  test("a folder of nothing but ZIPs (and hidden files), as a large Notion export unpacks to, is theirs; so is a ZIP of ZIPs", async () => {
    const parts = await exportedFrom([inFolder("Export/Part-1.zip", zipOf({ "Workspace/A.md": "a" })), inFolder("Export/Part-2.zip", zipOf({ "Workspace/B.md": "b" })), inFolder("Export/.DS_Store", "x")]);
    expect([parts.name, parts.files.map((file) => file.path)]).toEqual(["Workspace", ["A.md", "B.md"]]);
    const nested = await exportedFrom([new File([zipOf({ "Part-1.zip": zipOf({ "Workspace/A.md": "a" }), "Part-2.zip": zipOf({ "Workspace/B.md": "b" }) })], "Export.zip")]);
    expect([nested.name, nested.files.map((file) => file.path), await nested.files[1].text()]).toEqual(["Workspace", ["A.md", "B.md"], "b"]);
  });

  test("a ZIP that can't be read is left out and said so, unless it's all there is; one too big to read here says so", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const damaged = await exportedFrom([inFolder("Export/Part-1.zip", zipOf({ "A.md": "a" })), inFolder("Export/Part-2.zip", "not a ZIP")]);
      expect([damaged.name, damaged.files.map((file) => file.path), damaged.skipped]).toEqual(["Export", ["A.md"], ["Part-2.zip"]]);
      await expect(exportedFrom([new File(["not a ZIP"], "Vault.zip")])).rejects.toThrow("Nothing in Vault.zip could be read");
    } finally {
      console.warn = warn;
    }
    const big = Object.defineProperty(new File([""], "Vault.zip"), "size", { value: 3 * 1024 ** 3 });
    await expect(exportedFrom([big])).rejects.toBeInstanceOf(TooBig);
  });

  test("a file that would unpack to too much is left out and said so: packed tighter than any real file, past what one can be, or past what's left", async () => {
    const exported = await exportedFrom([new File([deflated({ "Vault/Note.md": new TextEncoder().encode("# Note"), "Vault/zeros.bin": new Uint8Array(2 * MB) })], "Vault.zip")]);
    expect([exported.name, exported.files.map((file) => file.path), exported.skipped]).toEqual(["Vault", ["Note.md"], ["Vault/zeros.bin"]]);
    const file = (size: number, packed = size) => ({ size, packed, modified: 0, read: async () => new Uint8Array() });
    const unpacking = new Unpacking(10 * MB);
    expect([6 * MB, 6 * MB, [2 * MB, MB / 100], [1000, 1], 3 * MB].map((size) => unpacking.allows(Array.isArray(size) ? file(size[0], size[1]) : file(size)))).toEqual([true, false, false, true, true]);
    expect(new Unpacking().allows(file(300 * MB))).toBe(false);
    // A ZIP in a ZIP of ZIPs is held to the same limits.
    const bomb = zip([{ name: "zeros.md", data: new Uint8Array(2 * MB), modified: new Date(DAY) }]);
    const parts = await exportedFrom([new File([deflated({ "Part-1.zip": zipOf({ "Workspace/A.md": "a" }), "Part-2.zip": bomb })], "Export.zip")]);
    expect([parts.name, parts.files.map((each) => each.path), parts.skipped]).toEqual(["Workspace", ["A.md"], ["Part-2.zip"]]);
  });

  test("a Bear backup: a note that would unpack to too much is left out and said so; TextPacks in a folder are a bundle each", async () => {
    const text = (value: string) => new TextEncoder().encode(value);
    const backup = deflated({ "Bomb.textbundle/text.markdown": new Uint8Array(2 * MB), "Bomb.textbundle/info.json": text("{}"), "Note.textbundle/text.markdown": text("# Note"), "Note.textbundle/info.json": text("{}") });
    const exported = await exportedFrom([new File([backup], "Bear.bear2bk")]);
    expect([(await readBear(exported)).notes.map((note) => note.name), exported.skipped]).toEqual([["Note"], ["Bomb.textbundle/text.markdown"]]);
    const pack = (title: string) => zipOf({ "text.markdown": `# ${title}`, "info.json": "{}" });
    const packs = await exportedFrom([inFolder("Export/One.textpack", pack("One")), inFolder("Export/Two.textpack", pack("Two"))]);
    expect((await readBear(packs)).notes.map((note) => note.name).sort()).toEqual(["One", "Two"]);
  });
});

/** A folder of fixtures/ as a ZIP of what's in it, named `name`. */
function zipped(folder: string, name: string) {
  const root = new URL(`fixtures/${folder}`, import.meta.url).pathname;
  return new File([zip(walk(root).map((path) => ({ name: relative(root, path), data: new Uint8Array(readFileSync(path)), modified: new Date(DAY) })))], name);
}

describe("Bear", () => {
  test("its backup: a note of each TextBundle, titled by its first line, with Bear's id, dates, pin, archive and trash", async () => {
    const bear = await readBear(await exportedFrom([zipped("bear/Backup", "Bear Notes 2024-11-14.bear2bk")]));
    expect(bear.name).toBe("Bear Notes 2024-11-14");
    const byName = Object.fromEntries(bear.notes.map((each) => [each.name, each]));
    expect(Object.keys(byName).sort()).toEqual(["Gone", "Ideas", "Old plans", "Pancakes", "Welcome"]);
    expect(byName.Welcome).toMatchObject({ id: "3A0F6C1E-5B7D-4E2A-9C11-0D2B6F8E4A01", created: Date.UTC(2024, 1, 1, 9, 30), updated: Date.UTC(2024, 10, 2, 18, 4, 11), folders: [], tags: [] });
    expect([byName.Ideas.pinned, byName.Gone.trashed, byName["Old plans"].tags]).toEqual([true, true, ["archived"]]);
    expect(bear.attachments.map((file) => file.path)).toEqual(["Welcome.textbundle/assets/photo.png", "Welcome.textbundle/assets/Report 2026.pdf"]);
    const pictures = (body: string) => body.replace(/\.\.\/attachments\/\uE000(\d+)\uE000/g, (_, index) => `<${bear.attachments[Number(index)].path}>`);
    expect(pictures(byName.Welcome.body)).toBe(
      [
        "# Welcome",
        "",
        "A note with #inbox, #work/projects and #big-ideas in it, a ==highlight==, <u>underlined</u> and ~~struck~~ text.",
        "",
        "See [[Ideas]], [[Ideas#Later|later ideas]] and [[Pancakes|the recipe]].",
        "",
        "![|320](<Welcome.textbundle/assets/photo.png>)",
        "",
        "[Report 2026.pdf](<Welcome.textbundle/assets/Report 2026.pdf>)",
        "",
        "[A site](https://example.com)",
        "",
        "Fruit counts:",
        "",
        "| Fruit | Count |",
        "|---|---|",
        "| Apple | 3 |",
        "",
        "`#not-a-tag and ~not underline~` stays code. A picture that isn't there: ![](assets/gone.png)",
        "",
        "- [ ] Open",
        "- [x] Done",
        "",
      ].join("\n"),
    );
    expect(byName.Pancakes.body).toBe("# Pancakes\n\nFlour and milk. #recipes/breakfast\n");
    expect(said(bear.report)).toEqual({
      locked: [1, "Secret"],
      archived: [1, "Old plans"],
      spacedTags: [1, "#big ideas# → #big-ideas (Welcome)"],
      previews: [1, "A site (Welcome)"],
      missing: [1, "![](assets/gone.png) (Welcome)"],
      unused: [1, "Welcome.textbundle/assets/unused.png"],
    });
  });

  test("its Markdown export: a file for each note, its pictures in a folder beside it", async () => {
    const bear = await readBear(folder("bear/Export"));
    expect(bear.notes.map(({ id, name, folders }) => [id, name, folders])).toEqual([["Trip.md", "Trip", []]]);
    expect(bear.local).toBe(true);
    expect(bear.attachments.map((file) => file.path)).toEqual(["Trip/map.png"]);
    expect(bear.notes[0].body).toBe("# Trip\n\n![|200](../attachments/\uE0000\uE000)\n\nWith #travel and a link to [[Pancakes]].\n");
  });

  test("Bear's marks: tags closed by a #, underlines, sizes, links to headings, outside code", () => {
    const report = new Tallies();
    const links = { report, note: (by: { title: string } | { id: string }) => ("id" in by ? (by.id === "A1" ? "Plan" : null) : by.title === "Plan" ? "Plan" : null), file: () => null };
    const translated = (text: string) => translateBear(text, links, "Note");
    expect(translated("#one# #2024# #work/next steps# a#b c# #a b #")).toBe("#one #2024# #work/next-steps a#b c# #a b #");
    expect(translated("~one~ ~~two~~ ~ three ~ ~/path and ~4")).toBe("<u>one</u> ~~two~~ ~ three ~ ~/path and ~4");
    expect(translated("[[Plan/Goals]] [[Plan/Goals|the goals]] [x](bear://x-callback-url/open-note?id=A1&header=Goals) [[Missing]]")).toBe(
      "[[Plan#Goals]] [[Plan#Goals|the goals]] [[Plan#Goals|x]] [[Missing]]",
    );
    expect(translated("```\n#one# ~two~\n```")).toBe("```\n#one# ~two~\n```");
    // Code as lines' Markdown reads it: indented, in a list, a URL too.
    expect(translated("Text\n\n    ~one~ #a b#\n\n- Item\n\n      ~two~\n\nhttps://example.com/~a~")).toBe("Text\n\n    ~one~ #a b#\n\n- Item\n\n      ~two~\n\nhttps://example.com/~a~");
    expect(translated("A\n| a |\n|---|\n\n| b |\n|---|")).toBe("A\n\n| a |\n|---|\n\n| b |\n|---|");
    // A bar it writes in a table, right under text too, is escaped: a link's text, a heading's, a picture's width.
    const files = { ...links, file: () => ({ index: 0, name: "a.png" }) };
    expect(translateBear('A\n| [x](bear://x-callback-url/open-note?id=A1) | [[Plan/Goals\\|the goals]] | ![](a.png)<!-- {"width":320} --> |\n|---|---|---|', files, "Note")).toBe(
      "A\n\n| [[Plan\\|x]] | [[Plan#Goals\\|the goals]] | ![\\|320](../attachments/\uE0000\uE000) |\n|---|---|---|",
    );
  });
});

const graph = await readGraph(folder("logseq/Graph"));

describe("Logseq", () => {
  const page = (name: string) => graph.notes.find((each) => each.name === name)!;
  const shownPaths = (body: string) => body.replace(/\.\.\/attachments\/\uE000(\d+)\uE000/g, (_, index) => `<${graph.attachments[Number(index)].path}>`);

  test("a note of each page and day, titled as Logseq names it, namespaces in their folders; empty ones, backups and Org pages left out", () => {
    expect(graph.notes.map(({ id, name, folders, pinned }) => [id, name, folders.join("/"), pinned]).sort()).toEqual([
      ["journals/2024_11_14.md", "Nov 14th, 2024", "Journals", false],
      ["pages/Essay.md", "Essay", "", false],
      ["pages/Projects___Acme.md", "Projects/Acme", "Projects", true],
      ["pages/Recipes%2FPancakes.md", "Recipes/Pancakes", "Recipes", false],
      ["pages/Welcome.md", "Welcome", "", true],
    ]);
    expect(page("Nov 14th, 2024")).toMatchObject({ body: "---\ndate: 2024-11-14\n---\n# Nov 14th, 2024\n\n- Rain all day. Met [[Ada]].\n- [ ] Call the bank\n", created: new Date(2024, 10, 14).getTime() });
  });

  test("an outline stays a list; a page that's clearly prose is paragraphs; headings are headings", () => {
    expect(page("Essay").body).toBe(
      "# Essay\n\nThis is the first paragraph of an essay, written in Logseq one paragraph to a block.\n\nThe second paragraph goes on with the thought, as prose does, and ends here.\n\n## A heading\n\nThe last paragraph, under the heading, is long enough to read as prose too.\n",
    );
    expect(page("Projects/Acme").body).toBe("# Projects/Acme\n\n## Budget\n\n- Planned: 100\n- Spent: 80\n");
    expect(page("Recipes/Pancakes").body).toBe("# Recipes/Pancakes\n\nFlour, milk and eggs.\n");
  });

  test("its Markdown in Linedown: links, tags, tasks, references, embeds, assets; properties; code as it is", () => {
    expect(page("Welcome").tags).toEqual(["inbox", "Big Ideas"]);
    expect(shownPaths(page("Welcome").body)).toBe(
      [
        "---",
        "alias: Start",
        "---",
        "# Welcome",
        "",
        "- Links to [[Essay]], [[Projects/Acme]] and [[Recipes/Pancakes]], and [[Essay|the essay]].",
        "  - A child with a #tag and #two-words, ==highlighted==.",
        "    - Deeper still",
        "- [ ] Write the plan",
        "- [ ] DOING Draft it",
        "- [x] Ship it",
        "- [ ] [#A] Celebrate",
        "  SCHEDULED: <2024-11-20 Wed>",
        "- [x] ~~Old idea~~",
        "- As I said: Planned: 100 ([[Projects/Acme]])",
        "- [[Essay]]",
        "- {{query (todo todo doing)}}",
        "- https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "- ![photo.png|320](<assets/photo_1731571200000_0.png>)",
        "- ```js",
        '  const x = "[[not a link]]";',
        "  ```",
        "- A block with properties",
        "  owner:: Ada",
        "  - Hidden child",
        "",
      ].join("\n"),
    );
    expect(said(graph.report)).toEqual({
      empty: [2, "Nov 15th, 2024", "contents"],
      org: [1, "pages/Notes.org"],
      taskStates: [2, "CANCELED Old idea (Welcome)", "DOING Draft it (Welcome)"],
      blockProperties: [1, "owner:: (Welcome)"],
      priorities: [1, "[#A] (Welcome)"],
      taskDates: [1, "SCHEDULED: <2024-11-20 Wed> (Welcome)"],
      embeds: [1, "{{embed [[Essay]]}} (Welcome)"],
      macros: [1, "{{query (todo todo doing)}} (Welcome)"],
      spacedTags: [1, "#[[two words]] → #two-words (Welcome)"],
      refs: [1, "Planned: 100 (Welcome)"],
      unused: [2, "assets/unused_1731571200001_0.png", "draws/2024-11-14-sketch.excalidraw"],
    });
  });

  test("outlines indented with spaces or tabs, a block's lines and code under it, and properties written as the first block", () => {
    const page = readPage("title:: Old\n- First\n  more of it\n  - Under\n    ```\n    - not a block\n    ```\n- Second");
    expect(page.properties).toEqual([["title", "Old"]]);
    expect(writePage(page, { property: () => {}, task: () => {} })).toBe("- First\n  more of it\n  - Under\n    ```\n    - not a block\n    ```\n- Second");
    expect(readPage("- tags:: a, b\n- Text").properties).toEqual([["tags", "a, b"]]);
  });

  test("nothing of a page is lost: blank lines in code, a heading's blocks, the first block's text, a bullet in code at the top", () => {
    const write = (text: string) => writePage(readPage(text), { property: () => {}, task: () => {} });
    // Code keeps its blank lines; between blocks, one is enough.
    expect(write("- A paragraph that is long enough to read as prose, ending here.\n  ```\n  one\n\n\n  two\n  ```")).toBe(
      "A paragraph that is long enough to read as prose, ending here.\n```\none\n\n\ntwo\n```",
    );
    // A heading with a property, among paragraphs, keeps the blocks under it.
    expect(write("- ## Plans\n  owner:: Ada\n  - Under it\n- A paragraph that is long enough to read as prose, ending here.")).toBe(
      "- ## Plans\n  owner:: Ada\n  - Under it\n- A paragraph that is long enough to read as prose, ending here.",
    );
    // Properties written as the first block: the page's; the text after them, the block's.
    const first = readPage("- type:: book\n  author:: Ada\n  A note about it.");
    expect([first.properties, first.blocks.map((block) => block.first)]).toEqual([[["type", "book"], ["author", "Ada"]], ["A note about it."]]);
    // A page without bullets: a `- ` in its code isn't a block.
    const loose = readPage("Notes\n```\n- not a block\n```\n");
    expect([loose.blocks.length, loose.loose]).toEqual([0, ["Notes", "```", "- not a block", "```", ""]]);
  });

  test("journals' days, read from their files' names and titled as the graph says", () => {
    const day = { year: 2026, month: 11, day: 1 };
    expect(["MMM do, yyyy", "EEE, dd.MM.yyyy", "yyyy-MM-dd", "MMMM d'st'"].map((format) => formatDay(day, format))).toEqual(["Nov 1st, 2026", "Sun, 01.11.2026", "2026-11-01", "November 1st"]);
    expect([readDay("2026_11_01", "yyyy_MM_dd"), readDay("Nov 1st, 2026", "MMM do, yyyy"), readDay("2026_13_01", "yyyy_MM_dd")]).toEqual([day, null, null]);
  });
});

/** Notion's export of the fixture, as a large one comes: a ZIP holding a ZIP of the pages. */
const notion = await readNotion(
  await exportedFrom([new File([zip([{ name: "Export-0a1b-Part-1.zip", data: new Uint8Array(await zipped("notion/Export", "part.zip").arrayBuffer()), modified: new Date(DAY) }])], "Export-0a1b.zip")]),
);

describe("Notion", () => {
  const page = (name: string) => notion.notes.find((each) => each.name === name)!;
  const paths = (body: string) => body.replace(/\.\.\/attachments\/\uE000(\d+)\uE000/g, (_, index) => `<${baseOf(notion.attachments[Number(index)].path)}>`);

  test("a note of each page and database, titled without Notion's ids, sub-pages under their pages, from a ZIP of ZIPs", () => {
    expect(notion.name).toBe("Export-0a1b");
    expect(notion.notes.map(({ id, name, folders }) => [id, name, folders.join("/")]).sort()).toEqual([
      ["1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", "Home", ""],
      ["2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e", "Plans", "Home"],
      ["3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f", "Reading List", "Home"],
      ["4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a", "Dune", "Home"],
      ["5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", "Walden", "Home"],
    ]);
    expect(notion.local).toBeFalsy();
    // A link in a table keeps its bar escaped, so the table keeps its columns.
    expect(page("Plans").body).toBe("# Plans\n\nBack to [[Home]], and a link to [nowhere](Gone%200000.md).\n\n| Page | Why |\n| --- | --- |\n| [[Home\\|the home page]] | It starts there |\n");
  });

  test("a database a table of its rows; each row a note of its type, its columns properties, relations links, dates as lines writes them", () => {
    expect(page("Reading List").body).toBe("# Reading List\n\n@type.reading_list(Author, Status, Date read, Related)\n");
    expect(page("Dune").body).toBe("---\ntype: Reading List\nAuthor: Frank Herbert\nStatus: Read\nDate read: 2024-11-14 21:30\nRelated: '[[Walden]]'\n---\n# Dune\n\nA desert planet.\n");
    expect(page("Walden").body).toBe("---\ntype: Reading List\nAuthor: Henry David Thoreau\nStatus: Reading\n---\n# Walden\n");
  });

  test("its Markdown in Linedown: links to pages and databases, pictures and files, callouts, toggles; code and math as they are", () => {
    expect(paths(page("Home").body)).toBe(
      [
        "# Home",
        "",
        "Welcome to the workspace. See [[Plans]] and the [[Reading List]].",
        "",
        "![photo](<photo.png>)",
        "",
        "[Report 2026.pdf](<Report 2026.pdf>)",
        "",
        ":::info",
        "💡 Remember to **water** the plants.",
        ":::",
        "",
        ":::warning",
        "⚠️ Careful with the oven.",
        ":::",
        "",
        "**More**",
        "Hidden by default.",
        "",
        "- [ ] Open task",
        "- [x] Done task",
        "",
        "```js",
        'const link = "[x](Home%201a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md)";',
        "```",
        "",
        "$$",
        "E = mc^2",
        "$$",
        "",
      ].join("\n"),
    );
    expect(said(notion.report)).toEqual({
      missing: [1, "[nowhere](Gone%200000.md) (Plans)"],
      toggles: [1, "More (Home)"],
      unused: [1, "Home 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d/unused.png"],
    });
  });

  /** An export of these files (by path), as Notion would write them. */
  const exportOf = (files: Record<string, string>): Exported => ({
    name: "Export",
    files: Object.entries(files).map(([path, text]) => ({ path, size: text.length, text: async () => text, file: async () => new File([text], baseOf(path)) })),
  });
  const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const C = "cccccccccccccccccccccccccccccccc";

  test("columns and databases named with what keys and types can't have: renamed so they can, said so; one with nothing left lists its rows", async () => {
    const tasks = await readNotion(
      exportOf({
        [`📋 Tasks ${A}_all.csv`]: "Name,Price ($),Done?,Est. hours,% done,📅 Due,Type,Done\nFix roof,12,Yes,3,50%,\"November 14, 2024\",Chore,No\n",
        [`📋 Tasks ${A}/Fix roof ${B}.md`]: "# Fix roof\n\nPrice ($): 12\nDone?: Yes\nEst. hours: 3\n% done: 50%\n📅 Due: November 14, 2024\nType: Chore\nDone: No\n\nThe one by the door.\n",
        [`📚 ${C}.csv`]: "Name\nDune\n",
        [`📚 ${C}/Dune ${A.replace(/a/g, "d")}.md`]: "# Dune\n",
      }),
    );
    const body = (name: string) => tasks.notes.find((note) => note.name === name)!.body;
    expect(body("Fix roof")).toBe(
      "---\ntype: Tasks\nPrice: 12\nDone: 'Yes'\nEst hours: 3\ndone 2: 50%\nDue: 2024-11-14\nType 2: Chore\nDone 3: 'No'\n---\n# Fix roof\n\nThe one by the door.\n",
    );
    expect(computeMeta(body("Fix roof")).properties.map((property) => property.key)).toEqual(["type", "Price", "Done", "Est hours", "done 2", "Due", "Type 2", "Done 3"]);
    expect(body("📋 Tasks")).toBe("# 📋 Tasks\n\n@type.tasks(Price, Done, Est hours, done 2, Due, Type 2, Done 3)\n");
    const { propertyOf, readTypeRef } = await import("../../src/lib/notes/properties");
    // The table reads as one, of the type the rows have, its columns their properties.
    const ref = readTypeRef("@type.tasks(Price, Done, Est hours, done 2, Due, Type 2, Done 3)")!;
    const row = computeMeta(body("Fix roof"));
    expect([ref.type, row.type, ref.columns!.map((key) => propertyOf(row.properties, key)?.value)]).toEqual(["tasks", "tasks", ["12", "Yes", "3", "50%", "2024-11-14", "Chore", "No"]]);
    expect(body("📚")).toBe("# 📚\n\n- [[Dune]]\n");
    expect(said(tasks.report)).toMatchObject({ untyped: [1, "📚"] });
    expect(said(tasks.report).columns[0]).toBe(7);
  });

  test("a callout on one line closes there", () => {
    const report = new Tallies();
    expect(translateNotion("<aside>💡 Water the plants.</aside>\nAfter it.", { report, resolve: () => null }, "Note")).toBe(":::info\n💡 Water the plants.\n:::\n\nAfter it.");
  });
});

describe("Evernote", () => {
  // Its notes' text is HTML, read in a page (tests/browser/imports.test.ts); what needs no page is here.
  test("a file is found by its MD5, as Evernote names it in a note's text", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect([md5(text("")), md5(text("abc")), md5(text("The quick brown fox jumps over the lazy dog"))]).toEqual([
      "d41d8cd98f00b204e9800998ecf8427e",
      "900150983cd24fb0d6963f7d28e17f72",
      "9e107d9d372bb6826bd81d3542a419d6",
    ]);
    // Across the 64-byte blocks MD5 works in.
    expect(md5(text("x".repeat(56)))).toBe("668a72d5ba17f08e62dabcafad6db14b");
  });

  test("its times, as it writes them", () => {
    expect([timeOf("20241114T093005Z"), timeOf("2024-11-14"), timeOf(null)]).toEqual([Date.UTC(2024, 10, 14, 9, 30, 5), undefined, undefined]);
  });
});

describe("importing notes", () => {
  test("its title above its text, unless it starts with it, written so nothing in it is more than text", () => {
    expect(withTitle("Plan", "Text")).toBe("# Plan\n\nText");
    expect(withTitle("Plan", "\n## plan\nText")).toBe("## plan\nText");
    expect(withTitle("Ideas #inbox", "Text", "---\na: b\n---\n")).toBe("---\na: b\n---\n# Ideas \\#inbox\n\nText");
    // Blank lines before its text go, but not the spaces code starts with.
    expect(withTitle("Plan", "\n\n    code\nText")).toBe("# Plan\n\n    code\nText");
    expect(withTitle("Plan", "\n  # Plan\nText")).toBe("  # Plan\nText");
  });

  test("what it would do: notes not imported before (but those in the Trash), their folders and the files they show", () => {
    const plan = planNotes("obsidian", vault, entries(from("Ideas.md"), from("Projects/Plan.md", { trashed: true })), { fresh: "new" });
    expect([plan.add.length, plan.there.map((each) => each.id), plan.folders, plan.attachments]).toEqual([5, ["Ideas.md"], 3, [0, 1]]);
    expect(plan.collection).toEqual(VAULT);
    expect(plan.earlier).toEqual({ ...VAULT, notes: 2, shared: 2 });
    // One that was in Obsidian's trash is here while it's in lines' Trash.
    expect(planNotes("obsidian", vault, entries(from(".trash/Old idea.md", { trashed: true }))).there.length).toBe(1);
    // Another app's isn't this.
    expect(planNotes("obsidian", vault, entries(from("Ideas.md", { app: "bear" }))).there.length).toBe(0);
  });

  test("a vault imported before, by its name or the same paths, is asked about: as another, all of it is imported", () => {
    const there = entries(from("Welcome.md"), from("Daily/2026-11-14.md"));
    // Renamed since, its notes say it may be the same.
    const renamed = { ...vault, name: "Brain" };
    const same = planNotes("obsidian", renamed, there, { fresh: "new" });
    expect(same.earlier).toEqual({ ...VAULT, notes: 2, shared: 2 });
    expect([same.there.map((each) => each.id).sort(), same.collection]).toEqual([["Daily/2026-11-14.md", "Welcome.md"], { id: "c1", name: "Brain" }]);
    const another = planNotes("obsidian", renamed, there, { same: false, fresh: "new" });
    expect([another.there.length, another.add.length, another.collection]).toEqual([0, 6, { id: "new", name: "Brain" }]);
    // One of the same name, none of whose notes these are: asked about too, nothing of it here.
    const named = planNotes("obsidian", vault, entries({ ...from("Elsewhere.md") }), { fresh: "new" });
    expect([named.earlier?.shared, named.there.length]).toEqual([0, 0]);
    // Nothing imported before: a collection of its own, nothing asked.
    const first = planNotes("obsidian", vault, [], { fresh: "new" });
    expect([first.earlier, first.collection]).toEqual([undefined, { id: "new", name: "Vault" }]);
  });

  test("the notes it makes: their attachments as kept, their tags and folders' tags, where they came from", () => {
    const plan = planNotes("obsidian", vault, [], { fresh: "c1" });
    const input = notesInput("obsidian", plan, new Map([[0, "3f2a9c0d1e8b4a7f6c5d2e1f0a9b8c7d.png"]]), vault, { folderTags: true });
    const made = (id: string) => input.notes.find((each) => "source" in each && each.source.id === id) as Extract<NewNote, { body: string }>;
    const welcome = made("Welcome.md");
    expect(welcome.body).toContain("![|300](../attachments/3f2a9c0d1e8b4a7f6c5d2e1f0a9b8c7d.png)\n[Report 2026.pdf](Attachments/Report%202026.pdf)\n");
    expect(welcome.body).toEndWith("and [the site](https://obsidian.md).\n\n#inbox #project/active\n");
    expect(welcome).toMatchObject({ source: { app: "obsidian", collection: VAULT, id: "Welcome.md", name: "Welcome" }, created: Date.UTC(2024, 2, 1, 9), pinned: false });
    expect(made("Projects/Acme/Plan.md").body).toEndWith("Back to [[Welcome#Ideas]].\n\n#projects/acme\n");
    expect(made(".trash/Old idea.md")).toMatchObject({ body: "# Old idea\n\nSomething I let go of.\n", trashed: true });
    const plain = notesInput("obsidian", plan, new Map(), vault, { folderTags: false });
    expect(plain.notes.find((each) => "source" in each && each.source.id === "Projects/Plan.md")!).toMatchObject({ body: "# Plan\n\nThe plan for #work, from [[Welcome]].\n", pinned: true });
  });

  test("written against the notes there by then: one imported meanwhile isn't made twice", () => {
    const input = notesInput("obsidian", planNotes("obsidian", vault, [], { fresh: "c1" }), new Map(), vault, { folderTags: true });
    const work = notesWork(JSON.parse(JSON.stringify(input)), entries(from("Ideas.md")));
    expect(work.add.length).toBe(5);
    expect(work.add.some((each) => "source" in each && each.source.id === "Ideas.md")).toBe(false);
  });

  test("a placeholder for an attachment is a path in the note until it's kept", () => {
    expect(attachmentPath(3)).toBe("../attachments/\uE0003\uE000");
  });
});

describe("the import itself", () => {
  test("keeping the files says how far it's got now and then, not for each; stopped then, it says so and makes nothing", async () => {
    // The notes store as sync's tests set it up, in memory, which the import writes to.
    await import("./sync");
    const { imports } = await import("../../src/lib/imports/imports.svelte");
    // Each state it says, as Settings (and a screen reader) hears it.
    const said: unknown[] = [];
    const { get, set } = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(imports), "state")!;
    Object.defineProperty(imports, "state", {
      get,
      set(value) {
        said.push(value);
        set!.call(imports, value);
      },
      configurable: true,
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const files = Array.from({ length: 60 }, (_, i) => ({
      path: `p${i}.png`,
      size: 1,
      text: async () => "",
      // The last takes a while, as a big one would.
      file: async () => {
        if (i === 59) await held;
        return new File([new Uint8Array([i])], `p${i}.png`, { type: "image/png" });
      },
    }));
    const warn = console.warn;
    // Nowhere to keep them here (no IndexedDB): each is said not to be kept, which is no matter.
    console.warn = () => {};
    try {
      const going = imports.importNotes("obsidian", { name: "Vault", notes: [], attachments: files, report: new Tallies() }, { add: [], there: [], folders: 0, attachments: files.map((_, i) => i) }, { folderTags: true, report: [] });
      await Bun.sleep(50);
      imports.cancel();
      release();
      await going;
    } finally {
      console.warn = warn;
      delete (imports as { state?: unknown }).state;
    }
    expect(said.length).toBeLessThan(5);
    expect(imports.state).toEqual({ id: "obsidian", kind: "done", added: 0, appended: 0, stopped: true, failed: false });
  });

  test("notes sent ahead for an import stopped meanwhile are never another's", async () => {
    const { importers } = await import("./stubs");
    const { imports } = await import("../../src/lib/imports/imports.svelte");
    // What each start is given to write, by the notes' text.
    const given: string[][] = [];
    importers.push({
      id: "test",
      work: (input) => {
        given.push((input as { notes: { body: string }[] }).notes.map((note) => note.body));
        return { add: [], append: [] };
      },
    });
    const made = (body: string): NewNote => ({ body, source: { app: "test", id: body, name: body } });
    // Sent, and then stopped (or Settings closed) before it started.
    imports.receive("stopped", [made("Stale")]);
    await imports.start("test", { notes: [] }, "next");
    imports.receive("stopped again", [made("Stale too")]);
    imports.stop();
    await imports.start("test", { notes: [] }, "stopped again");
    imports.receive("last", [made("Fresh")]);
    imports.receive("last", [made("Fresh too")]);
    await imports.start("test", { notes: [] }, "last");
    expect(given).toEqual([[], [], ["Fresh", "Fresh too"]]);
  });
});
