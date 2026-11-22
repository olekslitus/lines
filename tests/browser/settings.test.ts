import { afterEach, expect, test } from "bun:test";
import type { Page } from "playwright";
import { type App, mod, noErrors, openApp } from "./app";

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

test("opened on a section in a narrow window, focus is on its title, and typing doesn't reach the note", async () => {
  app = await openApp({ width: 600 });
  await app.open("Some text");
  await app.page.evaluate(() => window.testing.place());
  await app.page.keyboard.press(`${mod()}+/`);
  const dialog = app.page.getByRole("dialog");
  await dialog.waitFor();
  await app.page.waitForFunction(() => document.activeElement?.id === "settings-section-title", null, { timeout: 2000 });
  await app.page.keyboard.type("more");
  expect(await app.text()).toBe("Some text");
  // Back to the list, focus is on the section it was on.
  await dialog.getByRole("button", { name: "All settings" }).click();
  await app.page.waitForFunction(() => document.activeElement?.id === "settings-nav-shortcuts");
});

test("plugins with settings have a page each under Plugins, reached from the list, and found by search", async () => {
  app = await openApp();
  const settings = await app.settings("All Plugins");
  const nav = settings.getByRole("navigation", { name: "Settings sections" });
  for (const name of ["Mascots", "Paper", "Keyboards", "Spreadsheets"]) await nav.getByRole("button", { name, exact: true }).waitFor();
  // Not under Appearance or Editor any more.
  expect(await nav.getByRole("button", { name: "Mascot", exact: true }).count()).toBe(0);
  await app.settings("Editor");
  expect(await settings.getByText("Play typing sounds").count()).toBe(0);

  await app.settings("All Plugins");
  await settings.getByRole("button", { name: "Spreadsheets Settings" }).click();
  await settings.getByRole("heading", { name: "Spreadsheets", level: 2 }).waitFor();
  await settings.getByRole("switch", { name: "Spreadsheets" }).waitFor();
  await settings.getByText("Column letters and row numbers").waitFor();

  const search = settings.getByRole("searchbox", { name: "Search settings" });
  await search.fill("talks");
  const found = settings.getByRole("list", { name: "Settings found" }).getByRole("button");
  await found.filter({ hasText: "Mascots" }).first().click();
  await settings.getByRole("heading", { name: "Mascots", level: 2 }).waitFor();
});

test("search finds a setting in any section, in its words or a choice's, and opens its section on it", async () => {
  app = await openApp();
  await app.open("Some text");
  const settings = await app.settings("General");
  const search = settings.getByRole("searchbox", { name: "Search settings" });
  // ⌘F reaches it from anywhere in Settings.
  await settings.getByRole("heading", { name: "General" }).click();
  await app.page.keyboard.press(`${mod()}+f`);
  await app.page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Search settings");
  expect(await app.text()).toBe("Some text");

  await app.page.keyboard.type("underline");
  const found = settings.getByRole("list", { name: "Settings found" }).getByRole("button");
  await found.first().waitFor();
  expect(await found.filter({ hasText: "Cursor" }).count()).toBeGreaterThan(0);
  await found.filter({ hasText: /^Underline\s*Cursor$/ }).click();
  await settings.getByRole("heading", { name: "Cursor", level: 2 }).waitFor();
  // Focus on the setting's control, in its row.
  await app.page.waitForFunction(() => document.activeElement?.closest("[data-setting]")?.textContent?.includes("Shape"));

  // A word in any order, without its accents; nothing found says so; Esc empties the search, then closes Settings.
  await search.fill("color cursor");
  await found.first().waitFor();
  await search.fill("zzqx");
  await settings.getByText("Nothing in Settings matches “zzqx”.").first().waitFor();
  // Nor what it says only once something's done, which it couldn't lead to.
  for (const done of ["preset copied", "passphrase changed"]) {
    await search.fill(done);
    await settings.getByText(`Nothing in Settings matches “${done}”.`).first().waitFor();
  }
  await search.press("Escape");
  expect(await search.inputValue()).toBe("");
  await settings.getByRole("navigation", { name: "Settings sections" }).waitFor();
  await search.press("Escape");
  await settings.waitFor({ state: "hidden" });
});

test("what only a theme or palette of your own has, found with one of lines' own chosen, leads to making one", async () => {
  app = await openApp();
  const settings = await app.settings("General");
  const search = settings.getByRole("searchbox", { name: "Search settings" });
  const found = settings.getByRole("list", { name: "Settings found" }).getByRole("button");
  /** Focus on Make a Copy, in the group whose note says to make a copy to change it. */
  const onMakeCopy = (note: string) =>
    app.page.waitForFunction(
      (note) => document.activeElement?.textContent?.trim() === "Make a Copy" && !!document.activeElement.closest("section")?.querySelector("p")?.textContent?.includes(note),
      note,
      { timeout: 2000 },
    );

  await search.fill("light colors");
  await found.filter({ hasText: /^Make Light Colors/ }).click();
  await settings.getByRole("heading", { name: "Theme", level: 2 }).waitFor();
  await onMakeCopy("what it’s made of. Make a copy to change it.");

  await search.fill("add a color");
  await found.filter({ hasText: /^Add a Color/ }).click();
  await onMakeCopy("One of Lines’ own. Make a copy to change it.");
});

test("spreadsheet notes are off at first, blocks in notes on; a spreadsheet note here turns them on, unless they were turned off", async () => {
  app = await openApp();
  const page = app.page;
  const on = (id: string) => page.evaluate((id) => window.testing.plugins.isOn(window.testing.plugins.get(id)!), id);
  expect(await on("spreadsheet")).toBe(true);
  expect(await on("spreadsheet-notes")).toBe(false);
  const settings = await app.settings("All Plugins");
  await settings.getByRole("switch", { name: "Spreadsheet Notes" }).waitFor();
  expect(await settings.getByRole("switch", { name: "Spreadsheet Notes" }).isChecked()).toBe(false);
  await app.closeSettings();

  // One comes (synced, imported): it opens as a spreadsheet.
  await app.open("# Budget\n\nItem,Cost\nTea,4\n", "spreadsheet");
  await page.waitForFunction(() => window.testing.plugins.isOn(window.testing.plugins.get("spreadsheet-notes")!));
  await page.locator(".editor-pane .cm-sheet").waitFor();

  // Turned off by choice, it stays off as more come.
  await page.evaluate(() => window.testing.plugins.setOn(window.testing.plugins.get("spreadsheet-notes")!, false));
  await app.open("# Another\n\nA\n1\n", "spreadsheet");
  await page.waitForTimeout(200);
  expect(await on("spreadsheet-notes")).toBe(false);
});

test("two windows changing different settings at the same moment each keep the other's, and both are kept", async () => {
  app = await openApp();
  const { page } = app;
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other.waitForFunction(() => window.testing?.notes.ready);
  // The other window busy for a moment, then changing the text's size before it hears of the font chosen here meanwhile.
  await other.evaluate(() => {
    setTimeout(() => {
      const until = performance.now() + 600;
      while (performance.now() < until);
      window.testing.prefs.textSize = 20;
    });
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => (window.testing.prefs.font = "serif"));
  for (const each of [page, other]) await each.waitForFunction(() => window.testing.prefs.font === "serif" && window.testing.prefs.textSize === 20);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => [window.testing.prefs.font, window.testing.prefs.textSize])).toEqual(["serif", 20]);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("lines.prefs")!))).toMatchObject({ font: "serif", textSize: 20 });
  await other.close();
});

/** Another window of the app, beside `app`'s, ready. */
async function otherWindow(app: App) {
  const other = await app.page.context().newPage();
  await other.goto(app.page.url());
  await other.waitForFunction(() => window.testing?.notes.ready);
  return other;
}

test("a setting changed in one window goes to the others alone and once, isn't sent back, and one another window can't have is its default", async () => {
  app = await openApp({ prefs: { textSize: 15 } });
  const { page } = app;
  const other = await otherWindow(app);
  // What the windows say to each other about settings, heard in this one.
  await page.evaluate(() => {
    const heard: unknown[] = [];
    const channel = new BroadcastChannel("lines:window");
    channel.onmessage = ({ data }) => data.type === "prefs" && heard.push(data.changed);
    Object.assign(window, { heard, channel });
  });
  const heard = () => page.evaluate(() => (window as unknown as { heard: unknown[] }).heard);
  await other.evaluate(() => (window.testing.prefs.textSize = 20));
  await page.waitForFunction(() => window.testing.prefs.textSize === 20);
  await other.evaluate(() => (window.testing.prefs.font = "serif"));
  await page.waitForFunction(() => window.testing.prefs.font === "serif");
  expect(await heard()).toEqual([{ textSize: 20 }, { font: "serif" }]);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("lines.prefs")!))).toMatchObject({ font: "serif", textSize: 20 });

  // From a window of another version, a size this one can't have, and an appearance it doesn't know.
  await page.evaluate(() => (window as unknown as { channel: BroadcastChannel }).channel.postMessage({ type: "prefs", changed: { textSize: "huge", appearance: "sepia" } }));
  await page.waitForFunction(() => window.testing.prefs.textSize !== 20);
  expect(await page.evaluate(() => [window.testing.prefs.textSize, window.testing.prefs.appearance])).toEqual([17, "system"]);
  await other.close();
});

test("a plugin turned off in one window is off in the others at once", async () => {
  app = await openApp();
  const { page } = app;
  const other = await otherWindow(app);
  const on = (page: Page) => page.evaluate(() => window.testing.plugins.isOn(window.testing.plugins.get("spreadsheet")!));
  expect(await on(other)).toBe(true);
  const settings = await app.settings("All Plugins");
  await settings.getByRole("switch", { name: "Spreadsheets" }).click();
  await other.waitForFunction(() => !window.testing.plugins.isOn(window.testing.plugins.get("spreadsheet")!));
  expect(await on(page)).toBe(false);
  await other.close();
});

test("the language chosen in one window: each starts again in it, with what was being typed kept", async () => {
  app = await openApp();
  const { page } = app;
  const id = await app.open("# Plan");
  const other = await otherWindow(app);
  await page.evaluate(() => window.testing.place());
  await page.keyboard.type("\n\nTyped just now");
  const settings = await app.settings("General");
  await settings.getByRole("combobox", { name: "Language" }).click();
  await Promise.all([page.waitForEvent("load"), other.waitForEvent("load"), page.getByRole("option", { name: "Français" }).click()]);
  for (const each of [page, other]) {
    await each.waitForFunction(() => window.testing?.notes.ready);
    expect(await each.evaluate(() => document.documentElement.lang)).toBe("fr");
  }
  expect(await page.evaluate((id) => window.testing.notes.get(id)?.note.body, id)).toBe("# Plan\n\nTyped just now");
  await other.close();
});

test("a theme and a preset of your own made in one window are there to choose in the others at once", async () => {
  app = await openApp();
  const { page } = app;
  const other = await otherWindow(app);
  const [theme, preset] = await page.evaluate(() => {
    const { customThemes, plugins, presets } = window.testing;
    const theme = customThemes.copy(plugins.theme("lines").definition, (each) => plugins.palette(each), "Moss");
    return [theme, presets.add("Mossy", presets.builtIn[0].settings)];
  });
  await other.waitForFunction(([theme, preset]) => window.testing.customThemes.get(theme)?.name === "Moss" && window.testing.presets.get(preset)?.name === "Mossy", [theme, preset]);
  await other.evaluate((theme) => (window.testing.prefs.theme = theme), theme);
  await page.waitForFunction((theme) => window.testing.prefs.theme === theme, theme);
  await other.close();
});
