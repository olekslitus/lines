import { afterEach, expect, test } from "bun:test";
import { type App, noErrors, openApp } from "./app";

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

test("Lock Now from an open locked note's lock button puts focus in the password that opens it again", async () => {
  app = await openApp();
  const { page } = app;
  await app.open("# Plans\n\nIn confidence");
  await page.getByRole("button", { name: "Lock note", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const fields = dialog.locator("input[type=password]");
  await fields.nth(0).fill("correct horse");
  await fields.nth(1).fill("correct horse");
  await fields.nth(1).press("Enter");
  await dialog.waitFor({ state: "hidden" });

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
