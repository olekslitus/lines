import { beforeEach, describe, expect, test } from "bun:test";
import type { Note, WrappedKey } from "../../src/lib/notes/types";
// The page's storage, and the notes' plugins, as the app has them.
import { deserialize, serialize } from "./sync";

const { noteKeys, keyCopy } = await import("../../src/lib/notes/noteKeys.svelte");
const { lockKey, randomBytes } = await import("../../src/lib/crypto");

/** Each test's own, as keys seen in one test stay seen in the next. */
let PASSWORD = "";

/** A locked note that came in with this copy of its key, as sync brings one. */
const lockedWith = (key: WrappedKey): Note => ({
  id: crypto.randomUUID(),
  body: "",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  trashed: false,
  locked: { key, title: "Bank", files: [], sealed: "" },
});

/** A copy someone put in the bucket in place of the key: newer, and holding another key. */
async function bad(key: WrappedKey, password = "someone else's", check?: string): Promise<WrappedKey> {
  return { ...(await lockKey(randomBytes(32), password)), id: key.id, changed: key.changed + 60_000, ...(check ? { check } : {}) };
}

/** The copy the open key seals notes with, so syncs to other devices. */
async function sealedWith(id: string) {
  const note = lockedWith({ id } as WrappedKey);
  return (await noteKeys.seal({ ...note, body: "# Bank\n\nPIN 1234" })).key;
}

/** This device's password, set and its key closed, as after a restart. */
async function setUp() {
  const { raw, key } = await noteKeys.create(PASSWORD);
  noteKeys.save({ key, touchId: false });
  noteKeys.clear();
  return { raw, key };
}

/** Until checking copies seen while their key is open, which happens in the background, is done. */
async function settled(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await Bun.sleep(5);
}

beforeEach(() => {
  PASSWORD = `correct horse ${crypto.randomUUID()}`;
  noteKeys.clear();
  noteKeys.save(null);
});

describe("a locked notes' key's copies, synced with notes", () => {
  test("a bad copy put in place of this device's isn't taken, and the password still opens the key", async () => {
    const { raw, key } = await setUp();
    noteKeys.notice(lockedWith(await bad(key)));
    noteKeys.notice(lockedWith(await bad(key, "someone else's", "Zm9yZ2Vk")));
    expect(noteKeys.settings?.key).toEqual(key);
    expect(await noteKeys.unlock(PASSWORD)).toEqual([key.id]);
    expect(noteKeys.raw(key.id)).toEqual(raw);
    expect(await sealedWith(key.id)).toEqual(key);
    expect(noteKeys.settings?.key).toEqual(key);
  });

  test("one the password opens, but that holds another key, is refused for this device's", async () => {
    const { raw, key } = await setUp();
    noteKeys.notice(lockedWith(await bad(key, PASSWORD)));
    noteKeys.notice(lockedWith(await keyCopy(randomBytes(32), key.id, PASSWORD)));
    expect(await noteKeys.unlock(PASSWORD)).toEqual([key.id]);
    expect(noteKeys.raw(key.id)).toEqual(raw);
    expect(await sealedWith(key.id)).toEqual(key);
  });

  test("with the key open, a copy it doesn't vouch for is refused, and one it does (a password changed on another device) taken", async () => {
    const { raw, key } = await setUp();
    await noteKeys.unlock(PASSWORD);
    noteKeys.notice(lockedWith(await bad(key, "someone else's", "Zm9yZ2Vk")));
    const changed = await keyCopy(raw, key.id, `${PASSWORD} changed`);
    noteKeys.notice(lockedWith(changed));
    await settled(() => noteKeys.settings?.key.changed === changed.changed);
    expect(noteKeys.settings?.key).toEqual(changed);
    expect(await sealedWith(key.id)).toEqual(changed);
  });

  test("with it closed, a password changed on another device opens it, is this device's from then on, and the old one no longer does", async () => {
    const { raw, key } = await setUp();
    const changed = await keyCopy(raw, key.id, `${PASSWORD} changed`);
    noteKeys.notice(lockedWith(changed));
    expect(noteKeys.settings?.key).toEqual(key);
    expect(await noteKeys.unlock(`${PASSWORD} changed`)).toEqual([key.id]);
    expect(noteKeys.settings?.key).toEqual(changed);
    noteKeys.clear();
    expect(await noteKeys.unlock(PASSWORD)).toEqual([]);
  });

  test("a device with no password of its own takes the good copy of one synced to it, not a bad one beside it", async () => {
    const raw = randomBytes(32);
    const good = await keyCopy(raw, crypto.randomUUID(), PASSWORD);
    noteKeys.notice(lockedWith(good));
    noteKeys.notice(lockedWith(await bad(good, PASSWORD, "Zm9yZ2Vk")));
    expect(await noteKeys.unlock(PASSWORD)).toEqual([good.id]);
    expect(noteKeys.raw(good.id)).toEqual(raw);
    expect(noteKeys.settings?.key).toEqual(good);
  });

  test("a key from before copies were checked opens as it did, and its key vouches for it from then on", async () => {
    const raw = randomBytes(32);
    const old: WrappedKey = { id: crypto.randomUUID(), changed: Date.now(), ...(await lockKey(raw, PASSWORD)) };
    noteKeys.save({ key: old, touchId: false });
    expect(await noteKeys.unlock(PASSWORD)).toEqual([old.id]);
    const { check, ...rest } = noteKeys.settings!.key;
    expect([rest, typeof check]).toEqual([old, "string"]);
    expect(await sealedWith(old.id)).toEqual(noteKeys.settings!.key);
  });

  test("a copy's check is kept in the note's file", async () => {
    const { key } = await setUp();
    const note = { ...lockedWith(key), locked: { ...lockedWith(key).locked!, sealed: "AQID" } };
    expect(deserialize(serialize(note), note.id).locked?.key).toEqual(key);
  });
});

describe("changing the password", () => {
  test("the current one is still taken with a bad copy of the key among the notes, and the new one opens it from then on", async () => {
    const { key } = await setUp();
    noteKeys.notice(lockedWith(await bad(key, PASSWORD)));
    expect(await noteKeys.openWith(key.id, `${PASSWORD} wrong`)).toBe(false);
    expect(await noteKeys.openWith(key.id, PASSWORD)).toBe(true);
    expect(await noteKeys.openWith(key.id, PASSWORD)).toBe(true);
    const changed = await noteKeys.rewrap(key.id, `${PASSWORD} changed`);
    noteKeys.save({ key: changed, touchId: false });
    noteKeys.clear();
    expect(await noteKeys.unlock(`${PASSWORD} changed`)).toEqual([key.id]);
  });
});
