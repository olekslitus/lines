import { afterEach, test } from "bun:test";
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
