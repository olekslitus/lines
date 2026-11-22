import { afterEach, describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { type App, noErrors, openApp } from "./app";

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

/** Everything Lines keeps in the page's storage, as text: each database's records, their bytes and files read as text too, and localStorage. */
const storedText = (page: Page) =>
  page.evaluate(async () => {
    const decode = async (value: unknown): Promise<unknown> => {
      if (value instanceof Blob) return value.text();
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return new TextDecoder().decode(value);
      if (Array.isArray(value)) return Promise.all(value.map(decode));
      if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, each]) => [key, await decode(each)])));
      return value;
    };
    const request = <T>(asked: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        asked.onsuccess = () => resolve(asked.result);
        asked.onerror = () => reject(asked.error);
      });
    const texts = [JSON.stringify({ ...localStorage })];
    for (const { name } of await indexedDB.databases()) {
      const db = await request(indexedDB.open(name!));
      for (const store of db.objectStoreNames) texts.push(JSON.stringify(await decode(await request(db.transaction(store).objectStore(store).getAll()))));
      db.close();
    }
    return texts.join("\n");
  });

/** Locks the open note from its toolbar, setting the password for locked notes. */
async function lockNote(page: Page, password: string) {
  await page.getByRole("button", { name: "Lock note", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const fields = dialog.locator("input[type=password]");
  await fields.nth(0).fill(password);
  await fields.nth(1).fill(password);
  await fields.nth(1).press("Enter");
  await dialog.waitFor({ state: "hidden" });
}

/** Locks every open locked note, from the open one's lock button. */
async function lockNow(page: Page) {
  await page.getByRole("button", { name: "Locked note, open until you lock it" }).click();
  await page.getByRole("menuitem", { name: "Lock Now" }).click();
  await page.getByLabel("Password for locked notes").waitFor();
}

/** The note as stored, encrypted (`sealed`) once it's written. */
const stored = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    await window.testing.notes.flush();
    const { body, locked } = window.testing.notes.get(id)!.note;
    return { body, sealed: !!locked?.sealed, open: !!locked?.open };
  }, id);

test("Lock Now from an open locked note's lock button puts focus in the password that opens it again", async () => {
  app = await openApp();
  const { page } = app;
  await app.open("# Plans\n\nIn confidence");
  await lockNote(page, "correct horse");

  // By keyboard: the lock button, then its menu's Lock Now.
  await page.getByRole("button", { name: "Locked note, open until you lock it" }).press("Enter");
  await page.getByRole("menuitem", { name: "Lock Now" }).press("Enter");
  await page.getByLabel("Password for locked notes").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Password for locked notes");
});

test("a bad copy of locked notes' key, synced in, doesn't stop the password opening them, nor take this device's key's place", async () => {
  app = await openApp();
  const { page } = app;
  const id = await app.open("# Bank\n\nPIN 1234");
  const key = await page.evaluate(async (id) => {
    const { noteKeys, notes } = window.testing;
    const { key } = await noteKeys.create("correct horse");
    noteKeys.save({ key, touchId: false });
    notes.lock(id);
    await notes.flush();
    // Someone who can write to the bucket puts a copy among the notes that says it's newer, and opens
    // with the same password, but holds a key of their own.
    const { key: theirs } = await noteKeys.create("correct horse");
    const bad = { ...theirs, id: key.id, changed: key.changed + 60_000 };
    const now = Date.now();
    await notes.applyRemote({ id: crypto.randomUUID(), body: "", createdAt: now, updatedAt: now, pinned: false, trashed: false, locked: { key: bad, title: "Bank", files: [], sealed: "" } });
    return key;
  }, id);

  await page.reload();
  await page.waitForFunction(() => window.testing?.notes.ready);
  await page.evaluate((id) => window.testing.notes.select(id), id);
  await page.getByLabel("Password for locked notes").fill("correct horse");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.testing.text() === "# Bank\n\nPIN 1234");
  expect(await page.evaluate(() => window.testing.noteKeys.settings?.key)).toEqual(key);
});

describe("a locked note", () => {
  test("is kept only encrypted, and once locked again opens with its password, not another", async () => {
    app = await openApp();
    const { page } = app;
    const id = await app.open("# Bank\n\nPIN 2468");
    await lockNote(page, "correct horse");
    await page.waitForFunction((id) => !!window.testing.notes.get(id)?.note.locked?.sealed, id);
    expect(await storedText(page)).not.toContain("2468");

    await lockNow(page);
    expect(await stored(page, id)).toEqual({ body: "", sealed: true, open: false });
    expect(await page.locator(".editor-pane").innerText()).not.toContain("2468");
    const password = page.getByLabel("Password for locked notes");
    await password.fill("wrong horse");
    await password.press("Enter");
    await page.getByText("That password isn’t right.").waitFor();
    expect(await stored(page, id)).toEqual({ body: "", sealed: true, open: false });

    await password.fill("correct horse");
    await password.press("Enter");
    await page.locator(".cm-content").getByText("PIN 2468").waitFor();
  });

  test("edited while open is stored encrypted, edit and all, and is closed again when Lines starts", async () => {
    app = await openApp();
    const { page } = app;
    const id = await app.open("# Bank\n\nPIN 2468");
    await lockNote(page, "correct horse");
    await page.evaluate(() => window.testing.place());
    await page.keyboard.type("\nPUK 1357");
    await page.waitForFunction((id) => window.testing.notes.get(id)?.note.body.includes("PUK 1357"), id);
    expect(await stored(page, id)).toEqual({ body: "# Bank\n\nPIN 2468\nPUK 1357", sealed: true, open: true });
    const text = await storedText(page);
    expect([text.includes("2468"), text.includes("1357")]).toEqual([false, false]);

    await page.reload();
    await page.waitForFunction(() => window.testing?.notes.ready);
    expect(await stored(page, id)).toEqual({ body: "", sealed: true, open: false });
    await page.evaluate(() => window.testing.lockedNotes.unlock("correct horse"));
    expect(await stored(page, id)).toEqual({ body: "# Bank\n\nPIN 2468\nPUK 1357", sealed: true, open: true });
  });

  test("with its lock removed, is kept as plain text again", async () => {
    app = await openApp();
    const { page } = app;
    const id = await app.open("# Bank\n\nPIN 2468");
    await lockNote(page, "correct horse");
    await page.waitForFunction((id) => !!window.testing.notes.get(id)?.note.locked?.sealed, id);
    await page.locator(`.note-list [data-id="${id}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove Lock" }).click();
    await page.waitForFunction((id) => !window.testing.notes.get(id)?.note.locked, id);
    await page.evaluate(() => window.testing.notes.flush());
    expect(await storedText(page)).toContain("PIN 2468");
    await page.reload();
    await page.waitForFunction(() => window.testing?.notes.ready);
    expect(await page.evaluate((id) => window.testing.notes.get(id)!.note.body, id)).toBe("# Bank\n\nPIN 2468");
  });

  test("with the password changed, opens with the new one, not the old", async () => {
    app = await openApp();
    const { page } = app;
    const id = await app.open("# Bank\n\nPIN 2468");
    await lockNote(page, "correct horse");
    await page.waitForFunction((id) => !!window.testing.notes.get(id)?.note.locked?.sealed, id);
    const wrong = await page.evaluate(() => window.testing.lockedNotes.changePassword("not the password", "battery staple").then(() => null, (error: Error) => error.message));
    expect(wrong).toBe("That password isn’t right.");
    await page.evaluate(() => window.testing.lockedNotes.changePassword("correct horse", "battery staple"));
    await lockNow(page);

    // As Lines starts again, with only what it stored.
    await page.reload();
    await page.waitForFunction(() => window.testing?.notes.ready);
    const opens = (password: string) => page.evaluate((password) => window.testing.lockedNotes.unlock(password).then(() => true, () => false), password);
    expect(await opens("correct horse")).toBe(false);
    expect(await stored(page, id)).toEqual({ body: "", sealed: true, open: false });
    expect(await opens("battery staple")).toBe(true);
    expect(await stored(page, id)).toEqual({ body: "# Bank\n\nPIN 2468", sealed: true, open: true });
  });
});

describe("the app lock", () => {
  const PASSPHRASE = "a passphrase only tests know";

  test("keeps notes and their files encrypted, and Lines opens locked until the passphrase is given, not another", async () => {
    // On disk, where WebKit keeps the attachment.
    app = await openApp({ onDisk: true });
    const { page } = app;
    await app.open("# Diary\n\nDear diary");
    const name = await page.evaluate(() => window.testing.saveAttachment(new File(["attached words"], "words.txt", { type: "text/plain" })));
    await app.open(`# Files\n\n[words](../attachments/${name})`);
    await page.evaluate((passphrase) => window.testing.lock.enable(passphrase), PASSPHRASE);
    const text = await storedText(page);
    expect([text.includes("Dear diary"), text.includes("attached words")]).toEqual([false, false]);

    await Promise.all([page.waitForEvent("load"), page.evaluate(() => void window.testing.lock.lockNow())]);
    const field = page.getByRole("textbox", { name: "Passphrase" });
    await field.fill("not the passphrase");
    await field.press("Enter");
    await page.getByText("That passphrase isn’t right.").waitFor();
    expect(await page.evaluate(() => window.testing.lock.locked)).toBe(true);
    expect(await page.locator("body").innerText()).not.toContain("Diary");

    await field.fill(PASSPHRASE);
    await field.press("Enter");
    await page.waitForFunction(() => window.testing.notes.entries.some(({ note }) => note.body === "# Diary\n\nDear diary"));
    const file = await page.evaluate(async (name) => (await window.testing.getAttachment(name))?.text(), name);
    expect(file).toBe("attached words");
  });

  test("turned off with its passphrase, keeps everything plain again, and Lines opens without it", async () => {
    app = await openApp();
    const { page } = app;
    await app.open("# Diary\n\nDear diary");
    await page.evaluate((passphrase) => window.testing.lock.enable(passphrase), PASSPHRASE);
    const wrong = await page.evaluate(() => window.testing.lock.disable("not the passphrase").then(() => null, (error: Error) => error.message));
    expect(wrong).toBe("That passphrase isn’t right.");
    expect(await page.evaluate(() => window.testing.lock.enabled)).toBe(true);
    expect(await storedText(page)).not.toContain("Dear diary");

    await page.evaluate((passphrase) => window.testing.lock.disable(passphrase), PASSPHRASE);
    expect(await storedText(page)).toContain("Dear diary");
    await page.reload();
    await page.waitForFunction(() => window.testing?.notes.ready);
    expect(await page.evaluate(() => [window.testing.lock.locked, window.testing.notes.entries.map(({ note }) => note.body)])).toEqual([false, ["# Diary\n\nDear diary"]]);
  });

  test("with its passphrase changed, opens with the new one, not the old", async () => {
    app = await openApp();
    const { page } = app;
    await app.open("# Diary\n\nDear diary");
    await page.evaluate((passphrase) => window.testing.lock.enable(passphrase), PASSPHRASE);
    const wrong = await page.evaluate(() => window.testing.lock.changePassphrase("not the passphrase", "another passphrase").then(() => null, (error: Error) => error.message));
    expect(wrong).toBe("That passphrase isn’t right.");
    await page.evaluate((passphrase) => window.testing.lock.changePassphrase(passphrase, "another passphrase"), PASSPHRASE);

    await Promise.all([page.waitForEvent("load"), page.evaluate(() => void window.testing.lock.lockNow())]);
    const field = page.getByRole("textbox", { name: "Passphrase" });
    await field.fill(PASSPHRASE);
    await field.press("Enter");
    await page.getByText("That passphrase isn’t right.").waitFor();
    await field.fill("another passphrase");
    await field.press("Enter");
    await page.waitForFunction(() => window.testing.notes.entries.some(({ note }) => note.body === "# Diary\n\nDear diary"));
  });
});
