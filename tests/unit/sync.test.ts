import { afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import type { MarkField, Marks } from "../../src/lib/feeds/marks";
import { beforeDelete, beforeRead, beforeWrite, type Device, devices, drive, driveFiles, editElsewhere, FOLDER, fileOf, inAnotherTab, languages, listings, notes, placeholders, reads, refused, serialize, sync, used, written } from "./sync";
// After ./sync, which sets up the page they run in and the notes' storage in memory: imported first,
// a module would read a page that isn't there, or bind the real storage (IndexedDB) before it's replaced.
const { latexContent, markTitle } = await import("../../src/plugins/latex/text");
const { latestOf, marked, markKey, mergeFeed, readShard, shardOf, sharedMarks, stateOf, tidyFeed } = await import("../../src/lib/feeds/marks");
const { looks, tagLooks, typeLooks } = await import("../../src/lib/notes/looks.svelte");
const { ratings } = await import("../../src/lib/library/ratings.svelte");
const { writeLooks } = await import("../../src/lib/notes/looks");

// LaTeX, its title read as the plugin reads it: a document's \title, or its first line of text.
const latexTitle = (body: string) => {
  const { text, title } = latexContent(body);
  return title ?? text.split("\n").find((line) => line.trim()) ?? "";
};
languages.push({ id: "latex", meta: (body) => ({ ...languages[0].meta!(""), title: latexTitle(body) }), markTitle });
const { code } = await import("../../src/plugins/code");
languages.push(...(code().contributes.languages ?? []));

/** Edits a note here and, later, on another device (there to `elsewhere`), and syncs them: the copy that makes, as it's written. */
async function conflictedCopy(body: string, format?: string, elsewhere = body) {
  const [here, there] = await devices(2);
  const now = Date.now();
  const id = crypto.randomUUID();
  await notes.insert({ id, body, format, createdAt: now, updatedAt: now, pinned: false, trashed: false });
  await here.sync();
  await there.sync();
  notes.update(id, `${elsewhere}\n\nthere`);
  await there.sync();
  await here.open();
  notes.update(id, `${body}\n\nhere`);
  await here.sync();
  return notes.entries.find(({ note }) => note.id !== id)!.note.body;
}

describe("sync", () => {
  test("a conflicted copy of a LaTeX document is titled as one in its \\title, and its preamble is left as it is", async () => {
    const copy = await conflictedCopy("\\documentclass{article}\n\\title{On \\emph{Graphs}}\n\\begin{document}\n\\maketitle\nHello\n\\end{document}", "latex");
    expect(copy.split("\n").slice(0, 2)).toEqual(["\\documentclass{article}", "\\title{On \\emph{Graphs} (conflicted copy)}"]);
  });

  test("a note in another language whose title line can't be marked is left as it is", async () => {
    const body = "\\documentclass{article}\n\\begin{document}\n\\end{document}";
    expect(await conflictedCopy(body, "latex")).toBe(`${body}\n\nthere`);
  });

  test("a code note's is marked in the comment its title comes from, or in one of its own above a line of code", async () => {
    expect(await conflictedCopy("/* Theme */\nbody {}", "code-css")).toBe("/* Theme (conflicted copy) */\nbody {}\n\nthere");
    expect(await conflictedCopy("'use strict';\n\nconst a = 1;", "code-javascript")).toBe(
      "// 'use strict'; (conflicted copy)\n'use strict';\n\nconst a = 1;\n\nthere",
    );
    expect(await conflictedCopy("#!/bin/sh\necho hi", "code-shell")).toBe("#!/bin/sh\n# echo hi (conflicted copy)\necho hi\n\nthere");
  });

  test("a code note's line of code is never marked, nor given a tag it didn't have (#include)", async () => {
    const body = "#include <stdio.h>\n\nint main(void) {}";
    expect(await conflictedCopy(body, "code-c")).toBe(`${body}\n\nthere`);
  });

  test("a feed's subscription's is a note of its own, not a second subscription to its feed: its feed: is taken off", async () => {
    expect(await conflictedCopy("---\ntype: feed\nfeed: https://blog.example/feed\nstream: Work\n---\n# Blog")).toBe("---\ntype: feed\nstream: Work\n---\n# Blog (conflicted copy)\n\nthere");
  });

  test("a feed: that isn't a feed's link is the note's own, and kept in its copy", async () => {
    expect(await conflictedCopy("---\nfeed: 120 ml at 3am\n---\n# Baby log")).toBe("---\nfeed: 120 ml at 3am\n---\n# Baby log (conflicted copy)\n\nthere");
  });

  test("a subscription whose feed's address was changed on one device keeps it in the copy: a second subscription, to keep or trash, so neither address is lost", async () => {
    const copy = await conflictedCopy("---\ntype: feed\nfeed: https://blog.example/feed\n---\n# Blog", undefined, "---\ntype: feed\nfeed: https://blog.example/atom.xml\n---\n# Blog");
    expect(copy).toBe("---\ntype: feed\nfeed: https://blog.example/atom.xml\n---\n# Blog (conflicted copy)\n\nthere");
    expect(notes.entries.map(({ note }) => note.body.match(/feed: (.*)/)?.[1]).sort()).toEqual(["https://blog.example/atom.xml", "https://blog.example/feed"]);
  });

  test("a Markdown note's is marked on its title", async () => {
    expect(await conflictedCopy("# Plan\n\nA")).toBe("# Plan (conflicted copy)\n\nA\n\nthere");
  });

  test("the folder is named to the app's native side before it's used, and again once it was refused", async () => {
    const [here] = await devices(1);
    used.length = 0;
    listings.length = 0;
    refused.add(FOLDER.path);
    const id = notes.add("# Kept");
    await here.sync();
    expect([[...new Set(used)], listings, sync.error]).toEqual([[FOLDER.path], [], "Couldn’t use the folder: Error: Choose a folder for sync again."]);
    refused.delete(FOLDER.path);
    const asked = used.length;
    await here.sync();
    expect([used.length > asked, sync.error, drive.has(fileOf(id))]).toEqual([true, null, true]);
  });
});

/** The notes on the device that's open, by their text. */
const bodies = () => notes.entries.map((entry) => entry.note.body).sort();

describe("sync, with lines in several tabs, of what another tab did that this one hasn't heard of yet", () => {
  /** What the folder has of the note, its text. */
  const synced = (id: string) => drive.get(fileOf(id))?.text;

  test("an edit synced there isn't written over with this tab's older copy, which takes it up", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Plan\n\nfirst");
    await here.sync();
    await inAnotherTab(async () => {
      notes.update(id, "# Plan\n\nsecond");
      await here.sync();
    });
    written.length = 0;
    await here.sync();
    expect([synced(id), written.includes(fileOf(id)), notes.get(id)!.note.body]).toEqual([expect.stringContaining("second"), false, "# Plan\n\nsecond"]);
  });

  test("a note deleted there isn't uploaded again", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Done with");
    await here.sync();
    await inAnotherTab(async () => {
      await notes.deleteForever(id);
      await here.sync();
    });
    await here.sync();
    await here.sync();
    expect([synced(id), notes.get(id)]).toEqual([undefined, undefined]);
  });

  test("a note brought in there from another device isn't taken as deleted here", async () => {
    const [here, there] = await devices(2);
    await there.open();
    const id = notes.add("# From the phone");
    await there.sync();
    await here.open();
    await inAnotherTab(() => sync.syncNow());
    await here.sync();
    expect([synced(id), notes.get(id)?.note.body]).toEqual([expect.stringContaining("From the phone"), "# From the phone"]);
  });

  test("an edit stored there, as another device edits the note too, isn't written over with the other's: both are kept", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# List\n\nmilk");
    await here.sync();
    await there.sync();
    notes.update(id, "# List\n\nmilk\nbread");
    await there.sync();
    await here.open();
    await inAnotherTab(async () => notes.update(id, "# List\n\nmilk\neggs"));
    await here.sync();
    await here.sync();
    expect(bodies()).toEqual(["# List\n\nmilk\neggs", "# List (conflicted copy)\n\nmilk\nbread"]);
  });
});

describe("sync, as another device writes the same note", () => {
  test("an edit another device saves while this one syncs isn't written over, but kept with a conflicted copy", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Shopping\n\nmilk");
    await here.sync();
    notes.update(id, "# Shopping\n\nmilk\neggs");
    // Saved by another device after this one listed the folder, before it wrote the note.
    beforeWrite.next = () => editElsewhere(id, { body: "# Shopping\n\nmilk\nbread" });
    await here.sync();
    expect(drive.get(fileOf(id))!.text).toContain("bread");
    // The next pass brings it in and keeps this edit as a copy, which the one after uploads.
    await here.sync();
    await here.sync();
    const both = ["# Shopping\n\nmilk\nbread", "# Shopping (conflicted copy)\n\nmilk\neggs"];
    expect(bodies()).toEqual(both);
    await there.sync();
    expect(bodies()).toEqual(both);
  });

  test("nor deleted, deleted here, as another device saves an edit of it: the edit wins, as it does over a delete", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Shopping\n\nmilk");
    await here.sync();
    await notes.deleteForever(id);
    // Saved by another device after this one listed the folder, before it deleted the note.
    beforeDelete.next = () => editElsewhere(id, { body: "# Shopping\n\nmilk\nbread" });
    await here.sync();
    expect(drive.get(fileOf(id))!.text).toContain("bread");
    await here.sync();
    expect(bodies()).toEqual(["# Shopping\n\nmilk\nbread"]);
  });

  test("nor is a file the drive brings in under a new note's name", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Plan\n\nhere");
    beforeWrite.next = (path) => drive.set(path, { text: serialize({ ...notes.get(id)!.note, body: "# Plan\n\nthere" }), etag: "elsewhere" });
    await here.sync();
    await here.sync();
    expect(bodies()).toEqual(["# Plan\n\nhere", "# Plan (conflicted copy)\n\nthere"]);
  });
});

describe("importing a note's file from a sync folder", () => {
  test("brings the note back as it was, and never in place of one that's here", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Trip\n\nRome");
    notes.togglePin(id);
    notes.setIcon(id, "archive");
    await here.sync();
    const { createdAt, updatedAt } = notes.get(id)!.note;
    const file = () => new File([drive.get(fileOf(id))!.text], `${id}.md`);
    await there.open();
    await notes.importFiles([file()]);
    expect(notes.entries.map(({ note }) => note)).toEqual([{ id, body: "# Trip\n\nRome", createdAt, updatedAt, pinned: true, trashed: false, icon: "archive" }]);
    await notes.importFiles([file()]);
    expect(notes.entries.map(({ note }) => note.body)).toEqual(["# Trip\n\nRome", "# Trip\n\nRome"]);
    expect(notes.entries[0].note.id).not.toBe(id);
  });

  test("a copy of one imported from another app, given an id of its own, isn't where that came from", async () => {
    const [here] = await devices(1);
    const source = { app: "obsidian", collection: { id: "c1", name: "Vault" }, id: "Plan.md", name: "Plan" };
    await notes.insert({ id: "imported", body: "# Plan", createdAt: 1, updatedAt: 1, pinned: false, trashed: false, source });
    await here.sync();
    await notes.importFiles([new File([drive.get(fileOf("imported"))!.text], "imported.md")]);
    expect(notes.entries.map(({ note }) => [note.id === "imported", note.source])).toEqual([[false, undefined], [true, source]]);
  });

  test("a locked note's comes in locked, not as its encrypted text", async () => {
    const { noteKeys } = await import("../../src/lib/notes/noteKeys.svelte");
    const { key } = await noteKeys.create("correct horse");
    noteKeys.save({ key, touchId: false });
    const [here, there] = await devices(2);
    const id = notes.add("# Bank\n\nPIN 1234");
    await notes.lock(id);
    await here.sync();
    const file = new File([drive.get(fileOf(id))!.text], `${id}.md`);
    await there.open();
    await notes.importFiles([file]);
    expect(notes.get(id)!.note.locked?.sealed).toBeTruthy();
    expect(notes.get(id)!.meta.title).toBe("Bank");
  });
});

const { noteKeys } = await import("../../src/lib/notes/noteKeys.svelte");

/** The notes on the device that's open: their text, and how they're kept. */
const listed = () => notes.entries.map(({ note }) => ({ body: note.body, pinned: note.pinned, trashed: note.trashed, icon: note.icon, color: note.color, locked: !!note.locked }));

describe("sync, of a note changed on two devices", () => {
  test("a note edited on two devices keeps the newer edit, and the other as a conflicted copy", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Trip\n\nRome");
    await here.sync();
    await there.sync();
    notes.update(id, "# Trip\n\nRome\nVenice");
    await there.sync();
    await here.open();
    // A minute later, so the newer edit is newer, not one made in the same millisecond.
    setSystemTime(Date.now() + 60_000);
    notes.update(id, "# Trip\n\nRome\nFlorence");
    await here.sync();
    setSystemTime();
    expect(listed().map((note) => note.body)).toEqual(["# Trip (conflicted copy)\n\nRome\nVenice", "# Trip\n\nRome\nFlorence"]);
  });

  test("the newer edit is kept whichever device syncs last", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Trip\n\nRome");
    await here.sync();
    await there.sync();
    await here.open();
    notes.update(id, "# Trip\n\nRome\nFlorence");
    await notes.flush();
    await there.open();
    setSystemTime(Date.now() + 60_000);
    notes.update(id, "# Trip\n\nRome\nVenice");
    await there.sync();
    setSystemTime();
    await here.sync();
    expect(listed().map((note) => note.body)).toEqual(["# Trip (conflicted copy)\n\nRome\nFlorence", "# Trip\n\nRome\nVenice"]);
  });

  test("an edit made here while sync reads another device's isn't written over: the newer is kept, the other as a conflicted copy", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Trip\n\nRome");
    await here.sync();
    await there.sync();
    notes.update(id, "# Trip\n\nRome\nVenice");
    await there.sync();
    await here.open();
    // Typed after sync listed the folder, as it reads the note.
    setSystemTime(Date.now() + 60_000);
    beforeRead.set(fileOf(id), () => notes.update(id, "# Trip\n\nRome\nFlorence"));
    await here.sync();
    setSystemTime();
    expect(beforeRead.size).toBe(0);
    expect(notes.get(id)!.note.body).toBe("# Trip\n\nRome\nFlorence");
    await here.sync();
    expect(listed().map((note) => note.body)).toEqual(["# Trip (conflicted copy)\n\nRome\nVenice", "# Trip\n\nRome\nFlorence"]);
  });

  test("an edit sync brings in while another window types in the note keeps both, with a conflicted copy", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Trip\n\nRome");
    await here.sync();
    await there.sync();
    notes.update(id, "# Trip\n\nRome\nVenice");
    await there.sync();
    await here.sync();
    // A floating note, still showing Rome, is typed in as it hears that sync stored Venice; its typing wins there.
    notes.update(id, "# Trip\n\nRome\nFlorence");
    await notes.reload(id, false);
    await notes.flush();
    await here.sync();
    expect(listed().map((note) => note.body)).toEqual(["# Trip (conflicted copy)\n\nRome\nVenice", "# Trip\n\nRome\nFlorence"]);
  });

  test("pinning a note, or giving it an icon and a color, while it's edited on another device keeps both, without a conflicted copy", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Groceries\n\nmilk");
    await here.sync();
    await there.sync();
    notes.update(id, "# Groceries\n\nmilk\neggs");
    await there.sync();
    await here.open();
    notes.togglePin(id);
    notes.setIcon(id, "archive");
    notes.setColor(id, "orange");
    await here.sync();
    const merged: ReturnType<typeof listed> = [{ body: "# Groceries\n\nmilk\neggs", pinned: true, trashed: false, icon: "archive", color: "orange", locked: false }];
    expect(listed()).toEqual(merged);
    await there.sync();
    expect(listed()).toEqual(merged);
  });

  test("filing a note out of the Inbox while it's edited on another device keeps both, and the file says so only while it's in", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Idea\n\none");
    notes.setInbox([id], true);
    await here.sync();
    expect(drive.get(fileOf(id))!.text).toContain("\ninbox: true\n");
    await there.sync();
    expect(notes.get(id)!.note.inbox).toBe(true);
    notes.update(id, "# Idea\n\none\ntwo");
    await there.sync();
    await here.open();
    notes.setInbox([id], false);
    await here.sync();
    expect(notes.get(id)!.note).toMatchObject({ body: "# Idea\n\none\ntwo", inbox: false });
    expect(drive.get(fileOf(id))!.text).not.toContain("inbox:");
    await there.sync();
    expect(notes.get(id)!.note.inbox).toBeFalsy();
  });

  test("a note imported from another app says where it came from on every device, edited or not; its conflicted copy doesn't", async () => {
    const [here, there] = await devices(2);
    const source = { app: "obsidian", collection: { id: "c1", name: "Vault" }, id: "Projects/Plan.md", name: "Plan" };
    await notes.insert({ id: "imported", body: "# Plan\n\none", createdAt: 1, updatedAt: 1, pinned: false, trashed: false, source });
    await here.sync();
    expect(drive.get(fileOf("imported"))!.text).toContain(`\nsource: ${JSON.stringify(source)}\n`);
    await there.sync();
    notes.update("imported", "# Plan\n\none\ntwo");
    await there.sync();
    await here.sync();
    expect(notes.get("imported")!.note).toMatchObject({ body: "# Plan\n\none\ntwo", source });
    // Edited on both: the copy isn't where the note came from, so links and importing again find the note.
    await there.open();
    notes.update("imported", "# Plan\n\nthere");
    await there.sync();
    await here.open();
    notes.update("imported", "# Plan\n\nhere");
    await here.sync();
    const copy = notes.entries.find(({ note }) => note.id !== "imported")!.note;
    expect([copy.body.startsWith("# Plan (conflicted copy"), copy.source]).toEqual([true, undefined]);
  });

  test("what a newer version writes in a note's header is kept here, and written back when it's edited", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Plan\n\none");
    await here.sync();
    const { text } = drive.get(fileOf(id))!;
    drive.set(fileOf(id), { text: text.replace("\ntrashed: false\n", "\ntrashed: false\nfuture: {\"kept\":true}\n").replace("one", "one\ntwo"), etag: "newer" });
    await here.sync();
    expect(notes.get(id)!.note.header).toEqual({ future: '{"kept":true}' });
    notes.update(id, "# Plan\n\none\ntwo\nthree");
    await here.sync();
    expect(drive.get(fileOf(id))!.text).toContain('\nfuture: {"kept":true}\n---\n# Plan\n\none\ntwo\nthree');
  });

  test("a line a newer version writes in a note's header elsewhere, while it's edited here, is kept, a line at a time, without a conflicted copy", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Plan\n\none");
    await here.sync();
    const write = (change: (text: string) => string) => drive.set(fileOf(id), { text: change(drive.get(fileOf(id))!.text), etag: crypto.randomUUID() });
    write((text) => text.replace("\ntrashed: false\n", "\ntrashed: false\nfuture: 1\nlater: a\n"));
    await there.sync();
    expect(notes.get(id)!.note.header).toEqual({ future: "1", later: "a" });
    // Edited here while a newer version elsewhere archives it, changes one line and drops another.
    notes.update(id, "# Plan\n\none\ntwo");
    write((text) => text.replace("\nfuture: 1\nlater: a\n", "\nfuture: 2\narchived: true\n"));
    await there.sync();
    expect(notes.entries.length).toBe(1);
    expect(notes.get(id)!.note).toMatchObject({ body: "# Plan\n\none\ntwo", header: { future: "2", archived: "true" } });
    expect(drive.get(fileOf(id))!.text).toContain("\nfuture: 2\narchived: true\n---\n# Plan\n\none\ntwo");
  });

  test("a note moved to the trash while it's edited elsewhere goes there with the edit", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Draft\n\none");
    await here.sync();
    await there.sync();
    notes.trash(id);
    await there.sync();
    await here.open();
    notes.update(id, "# Draft\n\none\ntwo");
    await here.sync();
    expect(listed()).toEqual([{ body: "# Draft\n\none\ntwo", pinned: false, trashed: true, icon: undefined, color: undefined, locked: false }]);
  });

  describe("locked on one device while edited on another", () => {
    beforeAll(async () => {
      const { key } = await noteKeys.create("correct horse");
      noteKeys.save({ key, touchId: false });
    });

    test("stays locked, with the edit", async () => {
      const [here, there] = await devices(2);
      const id = notes.add("# Bank\n\nPIN 1234");
      await here.sync();
      await there.sync();
      notes.update(id, "# Bank\n\nPIN 1234\nPUK 5678");
      await there.sync();
      await here.open();
      await notes.lock(id);
      await here.sync();
      const locked = [{ body: "# Bank\n\nPIN 1234\nPUK 5678", pinned: false, trashed: false, icon: undefined, color: undefined, locked: true }];
      expect(listed()).toEqual(locked);
      expect(drive.get(fileOf(id))!.text).not.toContain("PIN");
      await there.sync();
      expect(listed()).toEqual(locked);
    });

    test("also when it's edited here and locked there", async () => {
      const [here, there] = await devices(2);
      const id = notes.add("# Bank\n\nPIN 1234");
      await here.sync();
      await there.sync();
      await notes.lock(id);
      await there.sync();
      await here.open();
      notes.update(id, "# Bank\n\nPIN 1234\nPUK 5678");
      await here.sync();
      expect(listed()).toEqual([{ body: "# Bank\n\nPIN 1234\nPUK 5678", pinned: false, trashed: false, icon: undefined, color: undefined, locked: true }]);
      expect(drive.get(fileOf(id))!.text).not.toContain("PIN");
    });

    test("imported from another app, keeps only a hash of where it came from, which importing again still knows it by", async () => {
      const [here, there] = await devices(2);
      const source = { app: "obsidian", collection: { id: "c1", name: "Vault" }, id: "Finance/Bank.md", name: "Bank" };
      await notes.insert({ id: "bank", body: "# Bank\n\nPIN 1234", createdAt: 1, updatedAt: 1, pinned: false, trashed: false, source });
      await notes.lock("bank");
      await here.sync();
      const text = drive.get(fileOf("bank"))!.text;
      expect([text.includes("Finance"), text.includes('"name":"Bank"')]).toEqual([false, false]);
      await there.sync();
      const kept = notes.get("bank")!.note.source!;
      expect([kept.app, kept.collection, /^#\w+$/.test(kept.id), kept.name]).toEqual(["obsidian", source.collection, true, ""]);
      const { planNotes, Tally } = await import("../../src/lib/imports/notes");
      const vault = { name: "Vault", local: true, notes: [{ id: "Finance/Bank.md", name: "Bank", body: "# Bank", folders: ["Finance"], tags: [] }], attachments: [], report: new Tally() };
      expect(planNotes("obsidian", vault, notes.entries).there.length).toBe(1);
    });

    test("and with the password not given here, the locked note is kept as it is, the edit as a copy", async () => {
      const [here, there] = await devices(2);
      const id = notes.add("# Bank\n\nPIN 1234");
      await here.sync();
      await there.sync();
      await notes.lock(id);
      await there.sync();
      await here.open();
      notes.update(id, "# Bank\n\nPIN 1234\nPUK 5678");
      noteKeys.clear();
      await here.sync();
      expect(listed()).toEqual([
        { body: "# Bank (conflicted copy)\n\nPIN 1234\nPUK 5678", pinned: false, trashed: false, icon: undefined, color: undefined, locked: false },
        { body: "", pinned: false, trashed: false, icon: undefined, color: undefined, locked: true },
      ]);
    });
  });
});

describe("sync, of a note's file saved by another app", () => {
  test("with a byte order mark and Windows line endings: lines' own header isn't taken for the note's text", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Recipe\n\nflour");
    notes.togglePin(id);
    await here.sync();
    const { text } = drive.get(fileOf(id))!;
    drive.set(fileOf(id), { text: `\uFEFF${text.replace("flour", "flour\nsugar").replaceAll("\n", "\r\n")}`, etag: "saved elsewhere" });
    await here.sync();
    expect(notes.get(id)!.note).toMatchObject({ body: "# Recipe\n\nflour\nsugar", pinned: true });
    await there.sync();
    expect(notes.get(id)!.note).toMatchObject({ body: "# Recipe\n\nflour\nsugar", pinned: true });
  });
});

describe("sync, when a cloud drive keeps its own copy of a note it couldn't merge", () => {
  const copyOf = (id: string, suffix: string) => `${FOLDER.path}/notes/${id}${suffix}.md`;

  // Dropbox, iCloud, Google Drive and OneDrive name theirs so.
  test.each([" (MacBook's conflicted copy 2026-11-09)", " 2", " (1)", "-MacBook"])("<id>%s.md is a conflicted copy, on every device", async (suffix) => {
    const [here, there] = await devices(2);
    const id = notes.add("# Trip\n\nRome");
    await here.sync();
    await there.sync();
    await here.open();
    notes.update(id, "# Trip\n\nRome\nFlorence");
    await here.sync();
    // The drive brings in another device's version too: it keeps that as the note, and this one beside it.
    drive.set(copyOf(id, suffix), drive.get(fileOf(id))!);
    editElsewhere(id, { body: "# Trip\n\nRome\nVenice" });
    await here.sync();
    const both = ["# Trip\n\nRome\nVenice", "# Trip (conflicted copy)\n\nRome\nFlorence"];
    expect(bodies()).toEqual(both);
    expect(drive.has(copyOf(id, suffix))).toBe(false);
    await here.sync();
    await there.sync();
    expect(bodies()).toEqual(both);
  });

  test("one that says what the note does is just taken out of the folder", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Trip\n\nRome");
    await here.sync();
    drive.set(copyOf(id, " 2"), drive.get(fileOf(id))!);
    await here.sync();
    expect(bodies()).toEqual(["# Trip\n\nRome"]);
    expect(drive.has(copyOf(id, " 2"))).toBe(false);
  });

  test("with end-to-end encryption too", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Trip\n\nRome");
    await here.sync();
    await sync.encrypt("correct horse battery");
    await sync.syncNow();
    const sealed = (name: string) => `${FOLDER.path}/notes/${name}.enc`;
    const before = drive.get(sealed(id))!;
    notes.update(id, "# Trip\n\nRome\nFlorence");
    await here.sync();
    drive.set(sealed(`${id} 2`), drive.get(sealed(id))!);
    drive.set(sealed(id), { ...before, etag: "the drive's" });
    await here.sync();
    expect(bodies()).toEqual(["# Trip\n\nRome", "# Trip (conflicted copy)\n\nRome\nFlorence"]);
    expect(drive.has(sealed(`${id} 2`))).toBe(false);
  });
});

describe("sync, of tags' and types' icons and colors", () => {
  test("go to the folder, and come in from other devices choice by choice, the later winning", async () => {
    const [here] = await devices(1);
    tagLooks.setColor("work", "blue");
    await here.sync();
    const file = `${FOLDER.path}/library.json`;
    expect(JSON.parse(drive.get(file)!.text).tags.work).toMatchObject({ color: "blue" });

    // Another device chose a type's icon since, and gave the tag a color before this one did.
    const there = JSON.parse(drive.get(file)!.text);
    there.types.book = { icon: "book-open", at: Date.now() + 1000 };
    there.tags.work = { color: "red", at: 1 };
    drive.set(file, { text: JSON.stringify(there), etag: "elsewhere" });
    await here.sync();
    expect(typeLooks.icon("book")).toBe("book-open");
    expect(tagLooks.color("work")).toBe("blue");
    const merged = JSON.parse(drive.get(file)!.text);
    expect(merged.tags.work).toMatchObject({ color: "blue" });
    expect(merged.types.book).toMatchObject({ icon: "book-open" });
    expect(looks.looks.types.book.icon).toBe("book-open");
  });
});

describe("sync, of what the Library's kinds are rated on", () => {
  test("goes to the folder as ratings.json, beside library.json, and comes in from other devices choice by choice, the later winning", async () => {
    const [here] = await devices(1);
    ratings.setScale("show", "10");
    await here.sync();
    const file = `${FOLDER.path}/ratings.json`;
    expect(JSON.parse(drive.get(file)!.text).kinds.show.scale.id).toBe("10");
    // Not in library.json, which a lines from before ratings writes back whole.
    expect(JSON.parse(drive.get(`${FOLDER.path}/library.json`)!.text).ratings).toBeUndefined();

    // Another device named a show's ratings and made a scale since, and chose its scale before this one did.
    const there = JSON.parse(drive.get(file)!.text);
    there.kinds.show = { scale: { id: "5", at: 1 }, named: { names: ["Story", "Music"], at: Date.now() + 1000 } };
    there.scales.vibes = { name: "Vibes", scale: { kind: "labels", labels: ["Great", "Meh"] }, at: Date.now() + 1000 };
    drive.set(file, { text: JSON.stringify(there), etag: "elsewhere" });
    await here.sync();
    expect(ratings.choices.kinds.show).toMatchObject({ scale: { id: "10" }, named: { names: ["Story", "Music"] } });
    expect(ratings.choices.scales.vibes).toMatchObject({ name: "Vibes" });
    const merged = JSON.parse(drive.get(file)!.text);
    expect(merged.kinds.show).toMatchObject({ scale: { id: "10" }, named: { names: ["Story", "Music"] } });
    expect(merged.scales.vibes.scale).toEqual({ kind: "labels", labels: ["Great", "Meh"] });

    // A lines from before ratings writes library.json back as it knows it: nothing here changes, and ratings.json is left alone.
    const library = `${FOLDER.path}/library.json`;
    drive.set(library, { text: writeLooks(looks.looks), etag: "older" });
    const before = drive.get(file)!;
    await here.sync();
    expect(drive.get(file)).toEqual(before);
    expect(drive.get(library)!.etag).toBe("older");
  });
});

describe("sync, of a folder of small files beside the notes: what was done with feeds' posts", () => {
  test("each file goes up when it changed here, comes in only when its tag says it changed there, and a drive's copy of one is merged in and taken out", async () => {
    const files = new Map([
      ["a.json", "A1"],
      ["b.json", "B1"],
    ]);
    const merged: [string, string][] = [];
    let ready = true;
    sync.shareFolder({ dir: "feeds/", ready: () => ready, names: () => [...files.keys()], files: () => files, merge: (name, text) => (merged.push([name, text]), text), onChange: () => {} });
    const [device] = await devices(1);
    const path = (name: string) => `${FOLDER.path}/feeds/${name}`;
    const folderReads = () => reads.filter((read) => read.includes("/feeds/"));
    await device.sync();
    expect([drive.get(path("a.json"))?.text, drive.get(path("b.json"))?.text]).toEqual(["A1", "B1"]);

    // Nothing changed: nothing read, nothing written.
    reads.length = 0;
    const tags = [drive.get(path("a.json"))!.etag, drive.get(path("b.json"))!.etag];
    await device.sync();
    expect(folderReads()).toEqual([]);
    expect([drive.get(path("a.json"))!.etag, drive.get(path("b.json"))!.etag]).toEqual(tags);

    // Changed here: only that one goes up.
    files.set("b.json", "B2");
    await device.sync();
    expect([drive.get(path("a.json"))!.etag, drive.get(path("b.json"))!.text]).toEqual([tags[0], "B2"]);

    // Changed there: only that one is read, and merged.
    drive.set(path("a.json"), { text: "A-elsewhere", etag: "elsewhere" });
    reads.length = 0;
    await device.sync();
    expect(folderReads()).toEqual([path("a.json")]);
    expect(merged).toEqual([["a.json", "A-elsewhere"]]);

    // A drive's own copy of one, kept beside it: merged in, then taken out of the folder.
    drive.set(path("a 2.json"), { text: "A-copy", etag: "copy" });
    await device.sync();
    expect(merged.at(-1)).toEqual(["a.json", "A-copy"]);
    expect(drive.has(path("a 2.json"))).toBe(false);

    // Encrypted: under names that hide them, the plain ones gone; still read only when changed.
    await sync.encrypt("correct horse battery");
    await sync.syncNow();
    const stored = [...drive.keys()].filter((key) => key.includes("/feeds/"));
    expect(stored).toHaveLength(2);
    expect(stored.every((key) => /\/feeds\/[0-9a-f]{32}\.enc$/.test(key))).toBe(true);
    reads.length = 0;
    await device.sync();
    expect(folderReads()).toEqual([]);
    ready = false;
  });
});

describe("sync, of a note deleted on one device", () => {
  test("deletes it on the others, and takes it out of the folder", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Old list");
    notes.add("# Kept");
    await here.sync();
    await there.sync();
    await notes.deleteForever(id);
    await there.sync();
    expect(drive.has(fileOf(id))).toBe(false);
    await here.sync();
    expect(bodies()).toEqual(["# Kept"]);
  });

  test("edited on another device meanwhile, keeps it there with the edit, and brings it back to the folder", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Plan\n\none");
    notes.add("# Kept");
    await here.sync();
    await there.sync();
    await notes.deleteForever(id);
    await there.sync();
    await here.open();
    notes.update(id, "# Plan\n\none\ntwo");
    await here.sync();
    expect(bodies()).toEqual(["# Kept", "# Plan\n\none\ntwo"]);
    expect(drive.get(fileOf(id))?.text).toEndWith("# Plan\n\none\ntwo");
    await there.sync();
    expect(bodies()).toEqual(["# Kept", "# Plan\n\none\ntwo"]);
  });

  test("edited on another device before it heard, brings the edit back here rather than deleting it there", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Plan\n\none");
    await here.sync();
    await there.sync();
    notes.update(id, "# Plan\n\none\ntwo");
    await there.sync();
    await here.open();
    await notes.deleteForever(id);
    await here.sync();
    expect(drive.get(fileOf(id))?.text).toEndWith("# Plan\n\none\ntwo");
    expect(bodies()).toEqual(["# Plan\n\none\ntwo"]);
  });
});

describe("sync, of a locked note", () => {
  async function lockedNote() {
    const { key } = await noteKeys.create("correct horse");
    noteKeys.save({ key, touchId: false });
    const devicesHere = await devices(2);
    const id = notes.add("# Bank\n\nPIN 1234");
    await notes.lock(id);
    await devicesHere[0].sync();
    return { id, devices: devicesHere };
  }

  test("edited as a pass starts, goes up once it's encrypted again, never empty", async () => {
    const {
      id,
      devices: [here, there],
    } = await lockedNote();
    beforeRead.set(`${FOLDER.path}/encryption.json`, () => notes.update(id, "# Bank\n\nPIN 1234\nPUK 5678"));
    await here.sync();
    expect(beforeRead.size).toBe(0);
    expect(drive.get(fileOf(id))!.text).not.toEndWith("\n---\n");
    await here.sync();
    await there.sync();
    expect(listed()).toEqual([{ body: "# Bank\n\nPIN 1234\nPUK 5678", pinned: false, trashed: false, icon: undefined, color: undefined, locked: true }]);
    noteKeys.clear();
  });

  test("a drive's own copy of one, with the password not given here, is kept locked, titled as a conflicted copy", async () => {
    const {
      id,
      devices: [here],
    } = await lockedNote();
    const before = drive.get(fileOf(id))!;
    notes.update(id, "# Bank\n\nPIN 1234\nPUK 5678");
    await here.sync();
    drive.set(`${FOLDER.path}/notes/${id} 2.md`, before);
    noteKeys.clear();
    await here.open();
    await here.sync();
    const copy = notes.entries.find(({ note }) => note.id !== id)!.note;
    expect(copy.locked && [copy.locked.title, copy.locked.open, before.text.endsWith(copy.locked.sealed)]).toEqual(["Bank (conflicted copy)", undefined, true]);
  });
});

describe("sync, connecting", () => {
  test("to another folder deletes nothing here: the notes go up there, beside what it has", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Mine");
    await here.sync();
    const other = { ...FOLDER, path: "/drive/other" };
    drive.set(`${other.path}/notes/theirs.md`, { text: serialize({ id: "theirs", body: "# Theirs", createdAt: 1, updatedAt: 1, pinned: false, trashed: false }), etag: "theirs" });
    await sync.configure(other);
    await sync.syncNow();
    expect(sync.status).toBe("idle");
    expect(bodies()).toEqual(["# Mine", "# Theirs"]);
    expect(drive.get(`${other.path}/notes/${id}.md`)?.text).toEndWith("# Mine");
  });

  test("a note with nothing written in it yet isn't synced until something is", async () => {
    const [here] = await devices(1);
    const id = notes.add("");
    await here.sync();
    expect(drive.has(fileOf(id))).toBe(false);
    notes.update(id, "# Now");
    await here.sync();
    expect(drive.get(fileOf(id))?.text).toEndWith("# Now");
  });
});

describe("sync, of the images and files notes show", () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const kept = async (name: string) => {
    const { getAttachment } = await import("../../src/lib/notes/attachments");
    const file = await getAttachment(name);
    return file && new Uint8Array(await file.arrayBuffer());
  };

  test("go to the folder, come in on other devices, and with encryption on are kept there only encrypted", async () => {
    const { saveAttachment } = await import("../../src/lib/notes/attachments");
    const [here, there, third] = await devices(3);
    const name = await saveAttachment(new File([bytes], "photo.png", { type: "image/png" }));
    notes.add(`# Photo\n\n![](../attachments/${name})`);
    await here.sync();
    expect(driveFiles.get(`${FOLDER.path}/attachments/${name}`)).toEqual(bytes);
    await there.sync();
    expect(await kept(name)).toEqual(bytes);

    await here.open();
    await sync.encrypt("correct horse battery");
    await sync.syncNow();
    const stored = [...driveFiles.keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/\/attachments\/[0-9a-f]{32}\.enc$/);
    expect(driveFiles.get(stored[0])).not.toEqual(bytes);
    await third.sync();
    expect(await kept(name)).toEqual(bytes);
  });
});

describe("sync, with end-to-end encryption", () => {
  const PASSPHRASE = "correct horse battery";
  const KEY_FILE = `${FOLDER.path}/encryption.json`;
  /** Whatever in the folder says `text`, in a note or beside them. */
  const saying = (text: string) => [...drive].filter(([, file]) => file.text.includes(text)).map(([path]) => path);
  /** Connects the device that's open as one that's never had the passphrase. */
  async function connectAnew() {
    await sync.configure(null);
    await sync.configure(FOLDER);
    await sync.syncNow();
  }
  /** What `work` failed with, or null. */
  const failure = (work: Promise<unknown>) => work.then(
    () => null,
    (error: Error) => error.message,
  );

  test("keeps no note's text in the folder; a device without the passphrase stops, writing nothing, until it's given", async () => {
    const [here, there] = await devices(2);
    const id = notes.add("# Bank\n\nPIN 1234");
    await here.sync();
    await sync.encrypt(PASSPHRASE);
    await sync.syncNow();
    expect([...drive.keys()].filter((path) => path.includes("/notes/"))).toEqual([`${FOLDER.path}/notes/${id}.enc`]);
    expect(saying("PIN")).toEqual([]);

    await there.open();
    notes.add("# Diary\n\nDear diary");
    await connectAnew();
    expect([sync.status, sync.encryptionIssue]).toEqual(["error", "locked"]);
    expect(saying("Dear diary")).toEqual([]);
    expect(bodies()).toEqual(["# Diary\n\nDear diary"]);

    expect(await failure(sync.unlockLibrary("not the passphrase"))).toBeString();
    expect(saying("Dear diary")).toEqual([]);
    await sync.unlockLibrary(PASSPHRASE);
    await sync.syncNow();
    expect(sync.status).toBe("idle");
    expect(bodies()).toEqual(["# Bank\n\nPIN 1234", "# Diary\n\nDear diary"]);
    expect([...drive.keys()].filter((path) => path.includes("/notes/"))).toHaveLength(2);
    expect(saying("Dear diary")).toEqual([]);
  });

  test("set up again elsewhere with a new passphrase, or turned off there, a device stops and says which, writing nothing", async () => {
    const [here] = await devices(1);
    notes.add("# Plan");
    await here.sync();
    await sync.encrypt(PASSPHRASE);
    await sync.syncNow();
    const original = drive.get(KEY_FILE)!;
    const rekeyed = { text: JSON.stringify({ ...JSON.parse(original.text), id: crypto.randomUUID() }), etag: "rekeyed" };
    drive.set(KEY_FILE, rekeyed);
    notes.add("# New here");
    written.length = 0;
    await sync.syncNow();
    expect([sync.status, sync.encryptionIssue]).toEqual(["error", "rekeyed"]);
    expect(written).toEqual([]);
    // Nor is the other device's key file written over with this one's key.
    expect(await failure(sync.changePassphrase("another passphrase"))).toBeString();
    expect(drive.get(KEY_FILE)).toEqual(rekeyed);

    // Turned off there: the key file gone, and the encrypted notes with it.
    drive.delete(KEY_FILE);
    for (const path of drive.keys()) if (path.endsWith(".enc")) drive.delete(path);
    written.length = 0;
    await sync.syncNow();
    expect([sync.status, sync.encryptionIssue]).toEqual(["error", "turned-off"]);
    expect(written).toEqual([]);
  });

  test("with a new passphrase, a device setting up needs it, not the old one", async () => {
    const [here, there] = await devices(2);
    notes.add("# Plan");
    await here.sync();
    await sync.encrypt(PASSPHRASE);
    await sync.syncNow();
    await sync.changePassphrase("staple battery horse");
    await there.open();
    await connectAnew();
    expect(sync.encryptionIssue).toBe("locked");
    expect(await failure(sync.unlockLibrary(PASSPHRASE))).toBeString();
    await sync.unlockLibrary("staple battery horse");
    await sync.syncNow();
    expect(bodies()).toEqual(["# Plan"]);
  });

  test("turned off, the notes go back to plain files, the encrypted ones and the key file go, and sync goes on", async () => {
    const [here] = await devices(1);
    const id = notes.add("# Plan\n\none");
    await here.sync();
    await sync.encrypt(PASSPHRASE);
    await sync.syncNow();
    await sync.decrypt();
    await sync.syncNow();
    expect(sync.status).toBe("idle");
    expect([...drive.keys()].filter((path) => path.endsWith(".enc") || path === KEY_FILE)).toEqual([]);
    expect(drive.get(fileOf(id))?.text).toEndWith("# Plan\n\none");
    notes.update(id, "# Plan\n\none\ntwo");
    await here.sync();
    expect(drive.get(fileOf(id))?.text).toEndWith("# Plan\n\none\ntwo");
  });
});

describe("sync, once every synced note was deleted on another device", () => {
  /** A note synced to two devices and deleted for good on the other; one written here since. */
  async function deletedElsewhere() {
    const [here, there] = await devices(2);
    const id = notes.add("# Only note");
    await here.sync();
    await there.sync();
    await notes.deleteForever(id);
    await there.sync();
    await here.open();
    notes.add("# Written here since");
    await here.sync();
    return id;
  }

  /** The notes' files in the folder, without tags' and types' looks (library.json) and ratings' (ratings.json). */
  const noteFiles = () => [...drive].filter(([path]) => !/\/(?:library|ratings)\.json$/.test(path)).map(([, file]) => file);

  test("stops, deleting nothing, until the person says", async () => {
    await deletedElsewhere();
    await sync.syncNow();
    expect(sync.status).toBe("error");
    expect(sync.missing).toBe(1);
    expect(bodies()).toEqual(["# Only note", "# Written here since"]);
    expect(noteFiles()).toHaveLength(0);
  });

  test("deletes them here too, if they were, and syncs on", async () => {
    await deletedElsewhere();
    await sync.deleteMissing();
    await sync.syncNow();
    expect(sync.status).toBe("idle");
    expect(sync.missing).toBe(0);
    expect(bodies()).toEqual(["# Written here since"]);
    expect(noteFiles().map((file) => file.text.split("\n").at(-1))).toEqual(["# Written here since"]);
  });

  test("or uploads them again", async () => {
    await deletedElsewhere();
    await sync.uploadMissing();
    await sync.syncNow();
    expect(sync.status).toBe("idle");
    expect(bodies()).toEqual(["# Only note", "# Written here since"]);
    expect(noteFiles()).toHaveLength(2);
  });
});

describe("mentions of notes imported from another app", () => {
  const collection = { id: "c1", name: "Vault" };
  const imported = (id: string, body: string, name: string, { updatedAt = 1, from = collection } = {}) =>
    notes.insert({ id, body, createdAt: 1, updatedAt, pinned: false, trashed: false, source: { app: "obsidian", collection: from, id: `${name}.md`, name } });

  test("find a note renamed here by the name it had there, from a note imported with it, the one edited last of two", async () => {
    await devices(1);
    await imported("plan", "# Q3 plan", "Plan");
    await imported("links", "# Links\n\n[[Plan]]", "Links");
    await imported("other-vault", "# Elsewhere", "Elsewhere", { from: { id: "c2", name: "Vault" } });
    await notes.insert({ id: "mine", body: "# Mine\n\n[[Plan]]", createdAt: 1, updatedAt: 1, pinned: false, trashed: false });
    const from = (id: string) => notes.get(id)!.note;
    expect(notes.find("Plan", from("links"))?.note.id).toBe("plan");
    // Not from a note of lines' own, which offers to create Plan, nor from another vault's.
    expect(notes.find("Plan", from("mine"))).toBeUndefined();
    expect(notes.find("Plan", from("other-vault"))).toBeUndefined();
    // A title here wins; and of two once called Plan, the one edited last.
    await imported("plan-2", "# Plan B", "Plan", { updatedAt: 5 });
    expect(notes.find("Plan", from("links"))?.note.id).toBe("plan-2");
    await notes.insert({ id: "titled", body: "# Plan", createdAt: 1, updatedAt: 1, pinned: false, trashed: false });
    expect(notes.find("Plan", from("links"))?.note.id).toBe("titled");
  });
});

describe("sync of what was done with feeds' posts, a file for each feed, between devices", () => {
  const FEED = "https://news.example/rss";
  const DAY = 86_400_000;
  const file = () => `${FOLDER.path}/feeds/${shardOf(FEED)}`;
  const writesOfFeeds = () => written.filter((path) => path.includes("/feeds/"));

  /** A device's marks, as feeds/feeds.svelte.ts keeps them, shared through the engine as it shares them (marks.ts' sharedMarks). */
  class Reader {
    marks: Marks = {};
    constructor(
      readonly device: Device,
      readonly feeds: string[] = [FEED],
    ) {}

    /** Marks a post of the feed, now (or at `now`). */
    mark(id: string, fields: MarkField[], now?: number) {
      const own = this.marks[FEED] ?? { posts: {} };
      const key = markKey(id);
      this.marks = { ...this.marks, [FEED]: { ...own, posts: { ...own.posts, [key]: marked(own.posts[key], fields, latestOf(own), now) } } };
    }

    /** Fetches the feed, finding these posts in it, at `at`, as the app does. */
    fetch(ids: string[], at = Date.now()) {
      const own = this.marks[FEED];
      if (own) this.marks = { ...this.marks, [FEED]: tidyFeed(own, new Set(ids.map(markKey)), at) };
    }
  }

  let reading: Reader | null = null;
  sync.shareFolder({
    ...sharedMarks({
      marks: () => reading!.marks,
      feeds: () => reading!.feeds,
      take: (there) => {
        for (const [feed, marks] of Object.entries(there)) reading!.marks = { ...reading!.marks, [feed]: mergeFeed(reading!.marks[feed], marks) };
      },
    }),
    ready: () => reading !== null,
    onChange: () => {},
  });

  afterEach(() => {
    reading = null;
  });

  /** A sync pass on this reader's device. */
  async function pass(reader: Reader) {
    reading = reader;
    await reader.device.sync();
  }

  async function readers() {
    const [mac, phone] = await devices(2);
    return [new Reader(mac), new Reader(phone)];
  }

  test("two devices, a post read and then dismissed on one, another dismissed on the other: each writes its feed's file once, then never again", async () => {
    const [mac, phone] = await readers();
    // The inbox's way: read, then dismissed.
    mac.mark("p", ["read"]);
    mac.mark("p", ["done"]);
    mac.mark("q", ["read"]);
    await pass(mac);
    await pass(phone);
    phone.mark("q", ["uninteresting"]);
    await pass(phone);
    await pass(mac);
    // The Mac has what the phone did, field by field.
    expect(stateOf(mac.marks[FEED].posts[markKey("q")])).toEqual({ read: true, dismissed: "uninteresting" });
    written.length = 0;
    for (const reader of [mac, phone, mac, phone]) await pass(reader);
    expect(writesOfFeeds()).toEqual([]);
  });

  test("a device that never fetches the feed lets go of what the one that does let go, and neither writes it back", async () => {
    const [mac, web] = await readers();
    const now = Date.now();
    // Months ago, a post read; it's long gone from the feed. Another, read lately, is still in it.
    mac.mark("old", ["read"], now - 200 * DAY);
    mac.mark("new", ["read"], now - DAY);
    await pass(mac);
    await pass(web);
    expect(Object.keys(web.marks[FEED].posts)).toHaveLength(2);

    // The Mac fetches the feed: the old post's mark goes, and the file says so.
    mac.fetch(["new"], now);
    expect(Object.keys(mac.marks[FEED].posts)).toEqual([markKey("new")]);
    written.length = 0;
    await pass(mac);
    expect(writesOfFeeds()).toEqual([file()]);

    // The web app, which never fetches, lets it go too, and writes nothing back; nor does anyone after.
    written.length = 0;
    await pass(web);
    expect(Object.keys(web.marks[FEED].posts)).toEqual([markKey("new")]);
    for (const reader of [mac, web, mac, web]) await pass(reader);
    expect(writesOfFeeds()).toEqual([]);

    // Another fetch a quarter of an hour later, as another Mac's: nothing to say, nothing written.
    mac.fetch(["new"], now + 15 * 60_000);
    await pass(mac);
    await pass(web);
    expect(writesOfFeeds()).toEqual([]);

    // Something new on the web app goes up, as ever.
    web.mark("new", ["done"]);
    await pass(web);
    expect(writesOfFeeds()).toEqual([file()]);
  });

  test("a file the drive hasn't downloaded yet isn't written over: it's read on a later pass, without passes in between", async () => {
    const [mac, phone] = await readers();
    phone.mark("p", ["done"]);
    await pass(phone);
    // On the Mac, the phone's file is there but not downloaded (an iCloud placeholder), and the Mac marked another post.
    placeholders.add(file());
    mac.mark("q", ["read"]);
    written.length = 0;
    await pass(mac);
    expect(writesOfFeeds()).toEqual([]);
    // Downloaded: read, merged, and the Mac's mark goes up with the phone's.
    placeholders.delete(file());
    await pass(mac);
    expect(writesOfFeeds()).toEqual([file()]);
    expect(Object.keys(readShard(drive.get(file())!.text)[FEED].posts).sort()).toEqual([markKey("p"), markKey("q")].sort());
  });

  test("with no feeds, nothing done with posts: the folder isn't even listed", async () => {
    const [device] = await devices(1);
    const nobody = new Reader(device, []);
    listings.length = 0;
    await pass(nobody);
    expect(listings.some((dir) => dir.endsWith("/feeds"))).toBe(false);
    expect([...drive.keys()].some((path) => path.includes("/feeds/"))).toBe(false);
  });
});
