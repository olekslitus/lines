import { describe, expect, test } from "bun:test";
import { devices, notes, storage } from "./sync";
// After ./sync, which puts the notes' storage in memory.
const { vault } = await import("../../src/lib/lock/vault");
const { aesKey, randomBytes } = await import("../../src/lib/crypto");
const { noteKeys } = await import("../../src/lib/notes/noteKeys.svelte");

/** The notes on the device that's open, by their text. */
const bodies = () => notes.entries.map((entry) => entry.note.body).sort();
const KEPT = "lines.unsaved.";
const kept = () => Object.keys(localStorage).filter((key) => key.startsWith(KEPT));

/** Resolves once `ready()` is true, checked every few milliseconds; fails after a few seconds. */
async function until(ready: () => boolean) {
  for (const start = Date.now(); !ready(); await Bun.sleep(20)) if (Date.now() - start > 5000) throw new Error("timed out");
}

describe("the notes store", () => {
  test("a write that fails says so, and is tried again until it works, losing nothing", async () => {
    const [device] = await devices(1);
    const id = notes.add("# Plan");
    await notes.flush();
    storage.failing = 1;
    notes.update(id, "# Plan\n\nedited");
    // Saved after the usual pause, which fails; then tried again after a moment, by itself.
    await until(() => notes.saveError === "The disk is full");
    await until(() => notes.saveError === null);
    await device.open();
    expect(bodies()).toEqual(["# Plan\n\nedited"]);
  });

  test("so does a flush, as a window closes", async () => {
    await devices(1);
    const id = notes.add("# Plan");
    await notes.flush();
    storage.failing = 1;
    notes.update(id, "# Plan\n\nedited");
    expect(await notes.flush().then(() => null, (error: Error) => error.message)).toBe("The disk is full");
    expect(await notes.flush().then(() => null, (error: Error) => error.message)).toBeNull();
  });

  test("a note deleted while it's being written isn't brought back by the write", async () => {
    const [device] = await devices(1);
    const id = notes.add("# Draft");
    await notes.flush();
    let land!: () => void;
    storage.slow = new Promise((resolve) => (land = resolve));
    notes.update(id, "# Draft\n\nmore");
    notes.saveNow();
    // Once the write is under way.
    await new Promise((resolve) => setTimeout(resolve));
    const deleting = notes.deleteForever(id);
    land();
    storage.slow = null;
    await deleting;
    await device.open();
    expect(bodies()).toEqual([]);
  });

  test("emptying the Trash deletes what's in it, for good, and nothing else", async () => {
    const [device] = await devices(1);
    const gone = notes.add("# Old");
    notes.add("# Kept");
    notes.trash(notes.add("# Also old"));
    notes.trash(gone);
    await notes.emptyTrash();
    await device.open();
    expect(bodies()).toEqual(["# Kept"]);
  });

  test("a note left blank is let go once another is opened; one written in, or in the Trash, isn't", async () => {
    const [device] = await devices(1);
    const other = notes.add("# Other");
    const blank = notes.add("");
    const written = notes.add("# Written");
    const trashed = notes.add("");
    notes.trash(trashed);
    for (const id of [blank, written, trashed]) {
      notes.select(id);
      notes.select(other);
    }
    await notes.flush();
    await device.open();
    expect(notes.entries.map(({ note }) => note.id).sort()).toEqual([other, written, trashed].sort());
  });

  describe("as the page goes", () => {
    test("what isn't stored yet is kept beside the notes at once, but not a locked note's, nor anything while the app lock is on", async () => {
      await devices(1);
      const id = notes.add("# Quick");
      await notes.flush();
      notes.update(id, "# Quick\n\ntyped");
      const leaving = notes.leave();
      expect(kept()).toEqual([KEPT + id]);
      expect(JSON.parse(localStorage.getItem(KEPT + id)!).body).toBe("# Quick\n\ntyped");
      await leaving;
      // Stored, it's let go.
      expect(kept()).toEqual([]);

      // A locked note's text is only ever stored encrypted.
      const { key } = await noteKeys.create("correct horse");
      noteKeys.save({ key, touchId: false });
      const locked = notes.add("# Bank\n\nPIN 2468");
      await notes.lock(locked);
      await notes.flush();
      notes.update(locked, "# Bank\n\nPIN 2468\nPUK 1357");
      const leavingLocked = notes.leave();
      expect(kept()).toEqual([]);
      await leavingLocked;
      noteKeys.clear();

      vault.use(await aesKey(randomBytes(32)));
      notes.update(id, "# Quick\n\ntyped\nwhile locked");
      const sealing = notes.leave();
      expect(kept()).toEqual([]);
      await sealing;
      vault.use(null);
    });

    test("what was kept is stored as Lines starts again, over the note as it was stored before", async () => {
      const [device] = await devices(1);
      const id = notes.add("# Quick");
      await notes.flush();
      const note = notes.get(id)!.note;
      localStorage.setItem(KEPT + id, JSON.stringify({ ...note, body: "# Quick\n\ntyped as it closed", updatedAt: note.updatedAt + 1000 }));
      await device.open();
      expect(bodies()).toEqual(["# Quick\n\ntyped as it closed"]);
      expect(kept()).toEqual([]);
      // Stored, not only shown.
      await device.open();
      expect(bodies()).toEqual(["# Quick\n\ntyped as it closed"]);
    });

    test("but not over the note stored since with a later edit", async () => {
      const [device] = await devices(1);
      const id = notes.add("# Quick");
      await notes.flush();
      const note = notes.get(id)!.note;
      localStorage.setItem(KEPT + id, JSON.stringify({ ...note, body: "# Quick\n\nearlier", updatedAt: note.updatedAt - 1000 }));
      await device.open();
      expect(bodies()).toEqual(["# Quick"]);
      expect(kept()).toEqual([]);
    });
  });
});
