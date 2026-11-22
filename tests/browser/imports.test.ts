import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zip } from "../../src/lib/zip";
import { type App, engine, mod, noErrors, openApp } from "./app";
import { png } from "./files";

/*
 * Notes from another app, imported from Settings → Export and Import: an Obsidian vault (the unit
 * tests' fixture, tests/unit/fixtures/obsidian/Vault) chosen as a folder, what importing it would do
 * said first, then done with its pictures and files, undone into the Trash, and imported again
 * adding only what isn't there; ten thousand notes at once, stopped partway; and Bear's backup
 * (tests/unit/fixtures/bear/Backup, zipped as Bear zips it).
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const VAULT = fileURLToPath(new URL("../unit/fixtures/obsidian/Vault", import.meta.url));

/** Chooses `folder` as the vault to import, in Settings → Export and Import. */
async function chooseVault(folder: string) {
  const settings = await app.settings("Export and Import");
  const group = settings.getByRole("region", { name: "From Obsidian" });
  await group.locator("input[webkitdirectory]").setInputFiles(folder);
  return group;
}

/** The notes imported from Obsidian, by their path in the vault. */
const imported = () =>
  app.page.evaluate(() =>
    Object.fromEntries(window.testing.notes.entries.filter(({ note }) => note.source?.app === "obsidian").map(({ note }) => [note.source!.id, note])),
  );

/** Bear's backup of the unit tests' notes, as a .bear2bk file is: a ZIP of a TextBundle for each. */
function bearBackup() {
  const root = fileURLToPath(new URL("../unit/fixtures/bear/Backup", import.meta.url));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? walk(join(dir, entry)) : [join(dir, entry)]));
  const data = zip(walk(root).map((path) => ({ name: relative(root, path), data: new Uint8Array(readFileSync(path)), modified: new Date(2024, 10, 14) })));
  return { name: "Bear Notes 2024-11-14.bear2bk", mimeType: "application/octet-stream", buffer: Buffer.from(data) };
}

test("an Obsidian vault: what importing it would do, said first; then its notes, pictures and files; undone into the Trash, and imported again only once", async () => {
  // On disk, so WebKit keeps the attachments.
  app = await openApp({ onDisk: true });
  const { page } = app;
  // Playwright's WebKit leaves a chosen folder's hidden files out: Obsidian's settings (its bookmarks) and its trash.
  const hidden = engine() !== "webkit";
  const count = hidden ? 6 : 5;
  const group = await chooseVault(VAULT);
  await group.getByText(`${count} notes, 2 attachments, and 3 folders in Vault.`).waitFor();
  expect(await group.getByText(/kept as text/).allInnerTexts()).toEqual([
    "1 link to a heading in its own note, kept as text: [[#Further reading]] (Welcome)",
    "1 block id, kept as text, as Lines doesn’t link to a line: ^37066d (Welcome)",
    "1 task with a status Lines doesn’t have, kept as text: [/] (Welcome)",
  ]);
  await group.getByText(/^2 files no note shows, left out: /).waitFor();
  // Nothing written yet, and Import is where focus is.
  expect(Object.keys(await imported())).toEqual([]);
  const start = group.getByRole("button", { name: `Import ${count} Notes` });
  expect(await start.evaluate((button) => button === document.activeElement)).toBe(true);
  await start.click();
  await group.getByText(`Imported ${count} notes.`).waitFor();
  // What didn't come across as it was is said again.
  await group.getByText("1 note shown in another, made a link to it, as Lines doesn’t show one note in another: ![[Ideas]] (Welcome)").waitFor();

  const notes = await imported();
  expect(Object.keys(notes).sort()).toEqual([...(hidden ? [".trash/Old idea.md"] : []), "Daily/2026-11-14.md", "Ideas.md", "Projects/Acme/Plan.md", "Projects/Plan.md", "Welcome.md"]);
  const picture = /!\[\|300\]\(\.\.\/attachments\/([0-9a-f]{32}\.png)\)\n\[Report 2026\.pdf\]\(\.\.\/attachments\/([0-9a-f]{32}\.pdf)\)/.exec(notes["Welcome.md"].body);
  expect(picture).not.toBeNull();
  expect(await page.evaluate(() => window.testing.attachmentNames())).toEqual(expect.arrayContaining([picture![1], picture![2]]));
  expect(notes["Welcome.md"].body).toEndWith("\n\n#inbox #project/active\n");
  expect(notes["Projects/Acme/Plan.md"].body).toEndWith("\n\n#projects/acme\n");
  if (hidden) expect([notes["Ideas.md"].pinned, notes["Projects/Plan.md"].pinned, notes[".trash/Old idea.md"].trashed]).toEqual([true, true, true]);

  // A link from the vault still finds a note renamed in lines, by the name it had in Obsidian; a note of lines' own doesn't.
  await page.evaluate((id) => window.testing.notes.setText(id, "# Someday\n\n- A garden #someday\n"), notes["Ideas.md"].id);
  const finds = (from?: string) => page.evaluate((from) => window.testing.notes.find("Ideas", from ? window.testing.notes.get(from)?.note : undefined)?.meta.title, from);
  expect([await finds(notes["Welcome.md"].id), await finds()]).toEqual(["Someday", undefined]);
  // Printed too.
  await app.closeSettings();
  await page.evaluate((id) => window.testing.notes.select(id), notes["Welcome.md"].id);
  await page.waitForFunction(() => window.testing.text()?.includes("Welcome to the vault"));
  await page.evaluate(() => window.testing.place(0));
  await page.keyboard.press(`${mod()}+P`);
  await page.getByRole("dialog").locator(".doc-mention", { hasText: /^Someday$/ }).first().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await app.settings("Export and Import");

  // Undone: the notes it made are in the Trash, but the one changed since.
  await group.getByRole("button", { name: "Undo Import" }).click();
  await group.getByText("Import undone: 4 notes moved to the Trash.").waitFor();
  await group.getByText("1 you’ve changed since is kept.").waitFor();
  const undone = await imported();
  // In the Trash, not deleted: every one is still here.
  expect(Object.keys(undone).sort()).toEqual(Object.keys(notes).sort());
  expect(Object.entries(undone).filter(([, note]) => !note.trashed).map(([path]) => path)).toEqual(["Ideas.md"]);

  // Imported again, it brings back only what isn't here (the one from Obsidian's trash is, in lines'); and once more, nothing.
  await chooseVault(VAULT);
  await group.getByText("4 notes, 2 attachments, and 3 folders in Vault.").waitFor();
  // Which, by name, and why.
  await group.getByText(hidden ? /^2 are in Lines already, from importing it before, and left out: / : "1 is in Lines already, from importing it before, and left out: Ideas").waitFor();
  await group.getByRole("button", { name: "Import 4 Notes" }).click();
  await group.getByText("Imported 4 notes.").waitFor();
  await chooseVault(VAULT);
  await group.getByText("Everything in Vault is in Lines already.").waitFor();
  expect(await group.getByRole("button", { name: /^Import/ }).count()).toBe(0);
  // The last import's Undo stays, under what this one would do.
  await group.getByRole("button", { name: "Undo Import" }).waitFor();
  // Said to be another vault of the same name, all of it would be imported.
  await group.getByRole("switch", { name: "The same as “Vault”, imported before" }).click();
  await group.getByRole("button", { name: `Import ${count} Notes` }).waitFor();
  await app.closeSettings();

  // Its folders are tags in the sidebar.
  await page.locator('.sidebar [data-tag="projects"]').waitFor();
}, 90_000);

test("ten thousand notes: the import says how it's going, with Settings closed and opened again too, can be stopped, and what it wrote undone", async () => {
  app = await openApp();
  const folder = mkdtempSync(join(tmpdir(), "lines-vault-"));
  try {
    const vault = join(folder, "Many");
    for (let i = 0; i < 100; i++) {
      mkdirSync(join(vault, `Folder ${i}`), { recursive: true });
      for (let j = 0; j < 100; j++) writeFileSync(join(vault, `Folder ${i}`, `Note ${i * 100 + j}.md`), `Text of note ${i * 100 + j}, linking [[Note ${(i * 100 + j + 1) % 10000}]].\n`);
    }
    const started = Date.now();
    const group = await chooseVault(vault);
    await group.getByText("10,000 notes and 100 folders in Many.").waitFor({ timeout: 60_000 });
    console.log(`Read 10,000 notes in ${Date.now() - started} ms`);
    await group.getByRole("button", { name: "Import 10,000 Notes" }).click();
    await app.page.waitForFunction(() => window.testing.notes.entries.length >= 250);
    // Settings closed meanwhile, it goes on, and says so when it's opened again.
    await app.closeSettings();
    const reopened = (await app.settings("Export and Import")).getByRole("region", { name: "From Obsidian" });
    await reopened.locator("progress").waitFor();
    await reopened.getByRole("button", { name: "Stop" }).click();
    await group.getByText("Stopped: what was imported before is kept, and Undo takes it back.").waitFor();
    const written = Object.keys(await imported()).length;
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(10_000);
    await group.getByRole("button", { name: "Undo Import" }).click();
    await group.getByText(`Import undone: ${written.toLocaleString("en")} notes moved to the Trash.`).waitFor();

    // Again, all of them this time.
    const again = Date.now();
    await chooseVault(vault);
    // Read again first, as long as that takes.
    await group.getByText("10,000 notes and 100 folders in Many.").waitFor({ timeout: 60_000 });
    await group.getByRole("button", { name: "Import 10,000 Notes" }).click();
    await group.getByText("Imported 10,000 notes.").waitFor({ timeout: 120_000 });
    console.log(`Imported 10,000 notes in ${Date.now() - again} ms`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 240_000);

test("Bear's backup: its notes with their tags, pictures, pins, archive and trash; then nothing new to import", async () => {
  app = await openApp({ onDisk: true });
  const { page } = app;
  const settings = await app.settings("Export and Import");
  const group = settings.getByRole("region", { name: "From Bear" });
  await group.locator("input[accept*='.bear2bk']").setInputFiles(bearBackup());
  await group.getByText("5 notes and 2 attachments in Bear Notes 2024-11-14.").waitFor();
  await group.getByText("1 locked note, which can’t be read (unlock it in Bear to bring it), left out: Secret").waitFor();
  await group.getByText("1 tag of several words, written with dashes, as Lines’ tags have no spaces: #big ideas# → #big-ideas (Welcome)").waitFor();
  // No folders in Bear: nothing to tag them with.
  expect(await group.getByRole("switch").count()).toBe(0);
  await group.getByRole("button", { name: "Import 5 Notes" }).click();
  await group.getByText("Imported 5 notes.").waitFor();

  const notes = await page.evaluate(() =>
    Object.fromEntries(window.testing.notes.entries.filter(({ note }) => note.source?.app === "bear").map(({ note, meta }) => [meta.title, note])),
  );
  expect(Object.keys(notes).sort()).toEqual(["Gone", "Ideas", "Old plans", "Pancakes", "Welcome"]);
  expect(notes.Welcome.body).toMatch(/\n!\[\|320\]\(\.\.\/attachments\/[0-9a-f]{32}\.png\)\n/);
  expect(notes.Welcome.body).toContain("See [[Ideas]], [[Ideas#Later|later ideas]] and [[Pancakes|the recipe]].");
  expect([notes.Ideas.pinned, notes.Gone.trashed, notes["Old plans"].body]).toEqual([true, true, "# Old plans\n\nDone with these.\n\n#archived\n"]);
  expect(notes.Welcome.createdAt).toBe(Date.UTC(2024, 1, 1, 9, 30));
  await page.locator('.sidebar [data-tag="big-ideas"]').waitFor();

  await group.locator("input[accept*='.bear2bk']").setInputFiles(bearBackup());
  await group.getByText("Everything in Bear Notes 2024-11-14 is in Lines already.").waitFor();
});

test("a Logseq graph: its pages and journals, outlines as lists and prose as paragraphs, references as text; then nothing new", async () => {
  app = await openApp({ onDisk: true });
  const { page } = app;
  const settings = await app.settings("Export and Import");
  const group = settings.getByRole("region", { name: "From Logseq" });
  const graph = fileURLToPath(new URL("../unit/fixtures/logseq/Graph", import.meta.url));
  await group.locator("input[webkitdirectory]").setInputFiles(graph);
  await group.getByText("5 notes, 1 attachment, and 3 folders in Graph.").waitFor();
  await group.getByText(/^2 empty pages, left out \(Logseq makes some itself\): /).waitFor();
  await group.getByRole("button", { name: "Import 5 Notes" }).click();
  await group.getByText("Imported 5 notes.").waitFor();
  const notes = await page.evaluate(() =>
    Object.fromEntries(window.testing.notes.entries.filter(({ note }) => note.source?.app === "logseq").map(({ note, meta }) => [meta.title, note])),
  );
  expect(Object.keys(notes).sort()).toEqual(["Essay", "Nov 14th, 2024", "Projects/Acme", "Recipes/Pancakes", "Welcome"]);
  expect(notes.Essay.body).toStartWith("# Essay\n\nThis is the first paragraph of an essay");
  expect(notes.Welcome.body).toContain("\n- As I said: Planned: 100 ([[Projects/Acme]])\n");
  expect(notes.Welcome.body).toMatch(/\n- !\[photo\.png\|320\]\(\.\.\/attachments\/[0-9a-f]{32}\.png\)\n/);
  expect([notes.Welcome.pinned, notes["Projects/Acme"].pinned]).toEqual([true, true]);
  await page.locator('.sidebar [data-tag="journals"]').waitFor();

  await group.locator("input[webkitdirectory]").setInputFiles(graph);
  await group.getByText("Everything in Graph is in Lines already.").waitFor();
});

test("Notion's export, a ZIP of ZIPs: its pages, a database as a table of its rows, each a note of its type; then nothing new", async () => {
  app = await openApp({ onDisk: true });
  const { page } = app;
  const root = fileURLToPath(new URL("../unit/fixtures/notion/Export", import.meta.url));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? walk(join(dir, entry)) : [join(dir, entry)]));
  const part = zip(walk(root).map((path) => ({ name: relative(root, path), data: new Uint8Array(readFileSync(path)), modified: new Date(2024, 10, 14) })));
  const exported = { name: "Export-0a1b.zip", mimeType: "application/zip", buffer: Buffer.from(zip([{ name: "Export-0a1b-Part-1.zip", data: part, modified: new Date(2024, 10, 14) }])) };
  const settings = await app.settings("Export and Import");
  const group = settings.getByRole("region", { name: "From Notion" });
  await group.locator("input[accept='.zip']").setInputFiles(exported);
  await group.getByText("5 notes, 2 attachments, and 1 folder in Export-0a1b.").waitFor();
  await group.getByRole("button", { name: "Import 5 Notes" }).click();
  await group.getByText("Imported 5 notes.").waitFor();
  const notes = await page.evaluate(() =>
    Object.fromEntries(window.testing.notes.entries.filter(({ note }) => note.source?.app === "notion").map(({ note, meta }) => [meta.title, { body: note.body, type: meta.type }])),
  );
  expect(Object.keys(notes).sort()).toEqual(["Dune", "Home", "Plans", "Reading List", "Walden"]);
  expect([notes.Dune.type, notes.Walden.type]).toEqual(["reading list", "reading list"]);
  expect(notes.Home.body).toContain("See [[Plans]] and the [[Reading List]].");
  expect(notes.Home.body).toMatch(/\n!\[photo\]\(\.\.\/attachments\/[0-9a-f]{32}\.png\)\n/);
  await app.closeSettings();
  // The database's note is a table of its rows.
  await app.page.evaluate(() => window.testing.notes.select(window.testing.notes.entries.find((entry) => entry.meta.title === "Reading List")!.note.id));
  await page.locator(".cm-content").getByText("Frank Herbert").waitFor();

  await (await app.settings("Export and Import")).getByRole("region", { name: "From Notion" }).locator("input[accept='.zip']").setInputFiles(exported);
  await group.getByText("Everything in Export-0a1b is in Lines already.").waitFor();
});

test("Import Files…: a file's time where the system gives one, and now where it gives one before 1970, as Android's picker does", async () => {
  app = await openApp();
  const settings = await app.settings("Export and Import");
  const before = Date.now();
  await settings.locator("input[type=file][multiple]").first().evaluate((input: HTMLInputElement) => {
    const chosen = new DataTransfer();
    chosen.items.add(new File(["# Dated"], "Dated.md", { lastModified: Date.UTC(2024, 10, 14) }));
    chosen.items.add(new File(["# Undated"], "Undated.md", { lastModified: -11_644_473_600_000 }));
    input.files = chosen.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settings.getByText("Imported 2 notes").waitFor();
  const times = await app.page.evaluate(() => Object.fromEntries(window.testing.notes.entries.map(({ note }) => [note.body, note.createdAt])));
  expect(times["# Dated"]).toBe(Date.UTC(2024, 10, 14));
  expect(times["# Undated"]).toBeGreaterThanOrEqual(before);
});

test("Import Files… brings an export's .zip back: its notes, the pictures they show where they show them, and its Trash", async () => {
  // On disk, so WebKit keeps the attachments.
  app = await openApp({ onDisk: true });
  const picture = png(4, 4, () => [200, 80, 40]);
  const name = await app.page.evaluate(async (bytes) => {
    const name = await window.testing.saveAttachment(new File([new Uint8Array(bytes)], "dot.png", { type: "image/png" }));
    const note = (body: string, trashed = false, format?: string) => ({ id: crypto.randomUUID(), body, format, createdAt: 0, updatedAt: Date.UTC(2024, 10, 14), pinned: false, trashed });
    await window.testing.notes.insert(
      note(`# Trip\n\n![](../attachments/${name})`),
      note(`# Old trip\n\n![](../attachments/${name})`, true),
      note(`\\section{Trip plan}\n\\includegraphics{../attachments/${name}}`, false, "latex"),
    );
    return name;
  }, [...picture]);
  let settings = await app.settings("Export and Import");
  await settings.getByRole("switch", { name: /^Include the trash/ }).click();
  const [download] = await Promise.all([app.page.waitForEvent("download"), settings.getByRole("button", { name: /^Export \d+ notes$/ }).click()]);
  const exported = readFileSync((await download.path())!);
  noErrors(app);
  await app.close();

  // Another browser, or this one after its storage was cleared.
  app = await openApp({ onDisk: true });
  settings = await app.settings("Export and Import");
  await settings.locator("input[type=file][multiple]").first().setInputFiles({ name: download.suggestedFilename(), mimeType: "application/zip", buffer: exported });
  await settings.getByText("Imported 3 notes").waitFor();
  const imported = await app.page.evaluate(async () => ({
    notes: window.testing.notes.entries.filter(({ note }) => /trip/i.test(note.body)).map(({ note }) => [note.format ?? "markdown", note.body, note.trashed]),
    attachments: await window.testing.attachmentNames(),
  }));
  expect(imported.notes.sort()).toEqual([
    // A LaTeX note comes back as the document it was exported as, its picture where it was.
    ["latex", expect.stringContaining(`\\includegraphics{../attachments/${name}}`), false],
    ["markdown", `# Old trip\n\n![](../attachments/${name})`, true],
    ["markdown", `# Trip\n\n![](../attachments/${name})`, false],
  ]);
  expect(imported.attachments).toContain(name);
});

describe("Evernote", () => {
  const enex = readFileSync(new URL("../unit/fixtures/evernote/Work.enex", import.meta.url), "utf8");

  test("a notebook's notes in Linedown: its ENML read as HTML is, where nothing runs; files by their MD5, checklists, code, highlights, an encrypted part", async () => {
    app = await openApp();
    const { notes, attachments, report } = await app.page.evaluate((xml) => window.testing.readEnex("Work", xml), enex);
    expect(notes.map(({ id, name, folders, tags }) => [id, name, folders, tags])).toEqual([
      ["Work/Plan/20240301T090000Z", "Plan", ["Work"], ["work", "big ideas"]],
      ["Work/Untitled/20240401T090000Z", "Untitled", ["Work"], []],
    ]);
    expect(attachments).toEqual(["Work/Plan/photo.png", "Work/Plan/Report 2026.pdf", "Work/Untitled/File.png"]);
    const due = await app.page.evaluate(() => {
      const date = new Date(Date.UTC(2024, 10, 20, 14));
      const two = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
    });
    expect(notes[0].body.replace(/(\d+)/g, "<$1>")).toBe(
      [
        "---",
        "author: Ada Lovelace",
        "url: https://example.com/plan",
        `due: ${due}`,
        "---",
        "# Plan",
        "",
        "Meeting notes with **bold**, *italics*, a [link](https://example.com/doc) and a ==highlight==.",
        "",
        "![|300](../attachments/<0>)",
        "",
        "[Report 2026.pdf](../attachments/<1>)",
        "",
        "- [x] Book the room",
        "- [ ] Send the agenda",
        "- [x] Newer done",
        "- [ ] Newer open",
        "",
        "```",
        "const a = 1;",
        'const b = "#not-a-tag";',
        "```",
        "",
        "| Item | Cost |",
        "| --- | --- |",
        "| Tea | 3 |",
        "",
        "Secret: 🔒 Encrypted in Evernote (hint: the usual), as it was: `RU5DMAAAAAA=`",
        "",
        // Its script is left out, a picture from `javascript:` too, and its words are only words.
        "\\#not a tag either",
        "",
      ].join("\n"),
    );
    // A file its text doesn't show is under it, not left out.
    expect(notes[1].body).toBe("# Untitled\n\nA note without a title, and a file its text doesn't show.\n\n![File.png](../attachments/2)\n");
    expect(report).toEqual({ "import.report.encrypted": [1, "Plan"] });
  });

  test("read safely: nothing a DOCTYPE declares, files held to the import's limits, a picture in a table with its bar escaped", async () => {
    app = await openApp();
    const read = (xml: string, total?: number) =>
      app.page.evaluate(([xml, total]) => {
        try {
          return window.testing.readEnex("Work", xml as string, total as number | undefined);
        } catch (error) {
          return String(error);
        }
      }, [xml, total] as const);
    // Entities made of entities ("billion laughs"), or one read from elsewhere: never expanded, so the file can't be read.
    const laughs = `<?xml version="1.0"?><!DOCTYPE en-export [<!ENTITY a "ha"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><en-export><note><title>&c;</title></note></en-export>`;
    const outside = `<?xml version="1.0"?><!DOCTYPE en-export [<!ENTITY x SYSTEM "file:///etc/passwd">]><en-export><note><title>&x;</title></note></en-export>`;
    // Nor past a DOCTYPE in a comment before it, nor one that would make megabytes: refused before it's read, at once.
    const commented = `<?xml version="1.0"?><!-- <!DOCTYPE en-export> --><!DOCTYPE en-export [<!ENTITY a "ha">]><en-export><note><title>&a;</title></note></en-export>`;
    const large = `<?xml version="1.0"?><!DOCTYPE en-export [<!ENTITY a "${"ha".repeat(50_000)}">]><en-export><note><title>${"&a;".repeat(100)}</title></note></en-export>`;
    const started = Date.now();
    for (const xml of [laughs, outside, commented, large]) expect(String(await read(xml))).toMatch(/declares entities/);
    expect(Date.now() - started).toBeLessThan(2000);
    // Its files past what's left are left out, and said so; a picture in a table keeps the table's columns.
    const table = enex.replace('<table><tr><td>Item</td>', '<table><tr><td><en-media hash="884697b1b2bb4136e34ee5669e4030b6" type="image/png" width="300"/></td>');
    const held = (await read(table, 100)) as Exclude<Awaited<ReturnType<typeof read>>, string>;
    expect([held.attachments, held.report["import.report.skipped"]]).toEqual([["Work/Plan/photo.png", "Work/Plan/Report 2026.pdf"], [1, "Work/Untitled/File.png"]]);
    expect(held.notes[0].body).toContain("\n| ![\\|300](../attachments/\uE0000\uE000) | Cost |\n");
  });

  test("checklists nested, in lists or not, boxes anywhere in a line, older code blocks, and a hint that's only words", async () => {
    app = await openApp();
    const note = (content: string) =>
      `<?xml version="1.0"?><en-export><note><title>Lists</title><created>20240301T090000Z</created><content><![CDATA[<en-note>${content}</en-note>]]></content></note></en-export>`;
    const body = async (content: string) => (await app.page.evaluate((xml) => window.testing.readEnex("Work", xml), note(content))).notes[0].body.replace(/^# Lists\n\n/, "");
    // A checklist in a checklist, in an item, and in a bullet list: tasks still, nested, ticked as they were.
    expect(await body('<ul style="--en-todo:true;"><li style="--en-checked:true;">Done</li><ul style="--en-todo:true;"><li style="--en-checked:false;">Under it</li></ul><li style="--en-checked:false;">Open<ul style="--en-todo:true;"><li style="--en-checked:true;">In it</li></ul></li></ul>')).toBe(
      "- [x] Done\n  - [ ] Under it\n- [ ] Open\n  - [x] In it\n",
    );
    expect(await body('<ul><li>Bullet</li><ul style="--en-todo:true;"><li style="--en-checked:true;">Task under it</li></ul><li><en-todo checked="true"/>A task in a bullet list</li></ul>')).toBe(
      "- Bullet\n  - [x] Task under it\n- [x] A task in a bullet list\n",
    );
    // Boxes not first in their line: in a span, after words, several split by line breaks.
    expect(await body('<div>Before <span><en-todo checked="true"/>in a span</span></div><div><en-todo/>one<br/><en-todo checked="true"/>two<br/>plain</div>')).toBe(
      "Before\n- [x] in a span\n- [ ] one\n- [x] two\nplain\n",
    );
    // Older code blocks (`-en-codeblock`), and text right in one beside its lines.
    expect(await body('<div style="-en-codeblock:true;">first<div>second</div>third</div>')).toBe("```\nfirst\nsecond\nthird\n```\n");
    // A hint's words are only words.
    expect(await body('<en-crypt hint="[x](https://evil.example) #tag">RU5D</en-crypt>')).toBe(
      "🔒 Encrypted in Evernote (hint: \\[x](https://evil.example) \\#tag), as it was: `RU5D`\n",
    );
  });

  test("imported from its .enex: the notebook a tag, its files kept; then nothing new", async () => {
    app = await openApp({ onDisk: true });
    const { page } = app;
    const settings = await app.settings("Export and Import");
    const group = settings.getByRole("region", { name: "From Evernote" });
    const file = { name: "Work.enex", mimeType: "application/xml", buffer: Buffer.from(enex) };
    await group.locator("input[accept='.enex']").setInputFiles(file);
    await group.getByText("2 notes, 3 attachments, and 1 folder in Work.").waitFor();
    await group.getByRole("button", { name: "Import 2 Notes" }).click();
    await group.getByText("Imported 2 notes.").waitFor();
    const notes = await page.evaluate(() =>
      Object.fromEntries(window.testing.notes.entries.filter(({ note }) => note.source?.app === "evernote").map(({ note, meta }) => [meta.title, { body: note.body, created: note.createdAt }])),
    );
    expect(Object.keys(notes).sort()).toEqual(["Plan", "Untitled"]);
    expect(notes.Plan.body).toMatch(/\n!\[\|300\]\(\.\.\/attachments\/[0-9a-f]{32}\.png\)\n/);
    // Its tags, and its notebook's, which is one of them here.
    expect(notes.Plan.body).toEndWith("\n\n#work #big-ideas\n");
    expect(notes.Plan.created).toBe(Date.UTC(2024, 2, 1, 9));
    await page.locator('.sidebar [data-tag="big-ideas"]').waitFor();
    await group.locator("input[accept='.enex']").setInputFiles(file);
    await group.getByText("Everything in Work is in Lines already.").waitFor();
  });
});
