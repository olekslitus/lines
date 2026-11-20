import { afterEach, expect, test } from "bun:test";
import { type App, mod, noErrors, openApp, toggle } from "./app";
import { drag, lift } from "./touch";

/*
 * On a phone, the round + at the bottom of the note list (AddButton.svelte): what it makes where you
 * are, out of the way as the list scrolls down or the keyboard is up, over the mini player, held for
 * other kinds, and turned off in Settings → Layout. Not on a wider screen.
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const PHONE = { width: 390, height: 844 };
const button = (name = "New note") => app.page.getByRole("button", { name, exact: true }).and(app.page.locator(".add-button"));
/** Whether it's showing: there, and not slid away. */
const shown = (name?: string) => button(name).evaluate((element) => getComputedStyle(element).opacity === "1" && getComputedStyle(element).pointerEvents !== "none");

test("on a phone, it's at the bottom middle in the accent, the title bar's button gone, and makes a note that opens", async () => {
  app = await openApp(PHONE);
  const { page } = app;
  const box = (await button().boundingBox())!;
  expect(box.width).toBe(56);
  expect(Math.abs(box.x + box.width / 2 - PHONE.width / 2)).toBeLessThan(1);
  expect(PHONE.height - (box.y + box.height)).toBe(16);
  // The theme's accent, as something colored with it is.
  const [background, accent] = await button().evaluate((element) => {
    const probe = document.body.appendChild(Object.assign(document.createElement("i"), { style: "color: var(--accent)" }));
    const colors = [getComputedStyle(element).backgroundColor, getComputedStyle(probe).color];
    probe.remove();
    return colors;
  });
  expect(background).toBe(accent);
  // One "New note", not two.
  expect(await page.getByRole("button", { name: "New note", exact: true }).count()).toBe(1);

  const before = await page.evaluate(() => window.testing.notes.entries.length);
  await button().click();
  await page.waitForFunction((before) => window.testing.notes.entries.length === before + 1 && !!window.testing.notes.selectedId, before);
  // The list, the button with it, slides away and is out of reach.
  await page.waitForFunction(() => (document.querySelector("[data-pane=list]") as HTMLElement).inert);
  await page.waitForFunction(() => document.querySelector(".add-button")!.getBoundingClientRect().right <= 0);
});

test("under a tag the note has the tag; in the Library it's Add to Library, on that shelf; in the Feeds, subscribing; none in the Trash", async () => {
  app = await openApp({ ...PHONE, prefs: { newNotes: "notes" } });
  const { page } = app;
  await page.evaluate(() => window.testing.notes.setFilter({ kind: "tag", tag: "work" }));
  await button().click();
  await page.waitForFunction(() => window.testing.notes.selected?.meta.tags.includes("work"));
  await page.evaluate(() => window.testing.notes.select(null));

  await page.evaluate(() => window.testing.notes.setFilter({ kind: "library", shelf: "movie" }));
  await button("Add to Library").click();
  const adding = page.getByRole("dialog", { name: /Add to Library/ });
  await adding.waitFor();
  expect(await adding.getByRole("radio", { name: "Movies", exact: true }).getAttribute("aria-checked")).toBe("true");
  // Opened under the title bar, where the keyboard won't cover it.
  expect((await adding.boundingBox())!.y).toBeLessThan(150);
  await page.keyboard.press("Escape");
  await adding.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.classList.contains("add-button"));

  await page.evaluate(() => window.testing.notes.setFilter({ kind: "feeds" }));
  await button("Subscribe to a Feed").click();
  await page.getByRole("textbox", { name: "Link to a feed, a site or a podcast on Apple Podcasts" }).waitFor();
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.testing.notes.setFilter({ kind: "trash" }));
  await page.locator(".add-button").waitFor({ state: "detached" });
});

test("it goes as the list scrolls down and the keyboard comes up, and comes back as it scrolls up or is tabbed to", async () => {
  app = await openApp(PHONE);
  const { page } = app;
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) window.testing.notes.add(`# Note ${i}\n\nSome text.`);
  });
  const list = page.locator(".note-list ul");
  await list.evaluate((element) => element.scrollTo({ top: 600 }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".add-button")!).opacity === "0");
  expect(await shown()).toBe(false);
  await list.evaluate((element) => element.scrollTo({ top: 300 }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".add-button")!).opacity === "1");

  // The last row scrolls clear of it.
  await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight - element.clientHeight - 20 }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".add-button")!).opacity === "1");
  const last = (await page.locator(".note-list li").last().boundingBox())!;
  const plus = (await button().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(plus.y);

  await page.getByRole("searchbox", { name: "Search notes" }).focus();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".add-button")!).opacity === "0");
  await page.keyboard.press("Escape");
  await button().focus();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".add-button")!).opacity === "1");
});

test("over the mini player, not under it", async () => {
  app = await openApp(PHONE);
  const { page } = app;
  await page.evaluate(() => (window.testing.player.episode = { key: "test", audio: "", title: "An episode", from: { sound: "test" } }));
  const mini = page.getByRole("region", { name: "Podcast player" });
  await mini.waitFor();
  await page.waitForFunction(() => {
    const plus = document.querySelector(".add-button")!.getBoundingClientRect();
    const player = document.querySelector("[aria-label='Podcast player']")!.getBoundingClientRect();
    return plus.bottom === player.top - 16;
  });
  await page.evaluate(() => (window.testing.player.episode = null));
});

test("under the sidebar's dimming, opened by its button or a swipe: dimmed as much as the list, a tap on it closing the sidebar", async () => {
  // The sidebar at its narrowest, so the + is half out from under it, under the dimming alone.
  app = await openApp({ phone: true, prefs: { sidebarWidth: 180 } });
  const { page } = app;
  const sidebar = page.locator("[data-pane=sidebar]");
  /** Where a finger on the + clear of the sidebar lands: its right edge. */
  const point = async () => {
    const box = (await button().boundingBox())!;
    return { x: box.x + box.width - 8, y: box.y + box.height / 2 };
  };
  const at = ({ x, y }: { x: number; y: number }) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), [x, y]);
  /** Settled: the sidebar done sliding. */
  const slid = () => sidebar.evaluate((pane) => Promise.all(pane.getAnimations().map((animation) => animation.finished)));
  const covered = () =>
    page.evaluate(() => {
      const [scrim, plus] = [document.querySelector('[aria-label="Close sidebar"]')!, document.querySelector(".add-button")!];
      return { opacity: Number(getComputedStyle(scrim).opacity), over: Number(getComputedStyle(scrim).zIndex) > Number(getComputedStyle(plus).zIndex) };
    });
  const spot = await point();
  expect(await at(spot)).toBe("New note");

  // Opened by its button: the dimming over the +, which a tap there closes, making nothing.
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.waitForFunction(() => !(document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  await slid();
  expect((await sidebar.boundingBox())!.width).toBeLessThan(spot.x);
  expect(await at(spot)).toBe("Close sidebar");
  expect(await covered()).toEqual({ opacity: 1, over: true });
  const before = await page.evaluate(() => window.testing.notes.entries.length);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForFunction(() => (document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  expect(await page.evaluate(() => window.testing.notes.entries.length)).toBe(before);
  await slid();

  // Swiped in: dimmed part way as it follows the finger, and drawn over the + all the while.
  await drag(page, { x: 4, y: 400 }, { x: 100, y: 400 }, { lift: false });
  const partway = await covered();
  expect(partway.over).toBe(true);
  expect(partway.opacity).toBeGreaterThan(0);
  expect(partway.opacity).toBeLessThan(1);
  await lift(page);
  await page.waitForFunction(() => !(document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  await page.waitForFunction(() => !(document.querySelector("[data-pane=sidebar]") as HTMLElement).style.translate);
  expect(await at(spot)).toBe("Close sidebar");
});

test("held, a menu of other kinds: a plain note, a type of your own, Add to Library", async () => {
  app = await openApp(PHONE);
  const { page } = app;
  await page.evaluate(() => window.testing.notes.add("---\ntype: recipe\n---\n# Soup"));
  await button().click({ button: "right" });
  const menu = page.getByRole("menu", { name: "New" });
  await menu.waitFor();
  expect((await menu.getByRole("menuitem").allInnerTexts()).slice(0, 3)).toEqual(["Note", "Recipe", "Add to Library"]);
  await menu.getByRole("menuitem", { name: "Recipe" }).click();
  await page.waitForFunction(() => window.testing.notes.selected?.meta.type === "recipe");
});

test("Settings → Layout turns it off, and the title bar's button is back; wider than a phone there's none", async () => {
  app = await openApp(PHONE);
  const { page } = app;
  await button().waitFor();
  // Settings, from the sidebar's drawer.
  await page.keyboard.press(`${mod()}+\\`);
  await page.waitForFunction(() => !(document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  const layout = await app.settings("Layout");
  await toggle(layout, "Add button on phones", false);
  await app.closeSettings();
  await page.locator(".add-button").waitFor({ state: "detached" });
  await page.locator(".note-list .titlebar").getByRole("button", { name: "New note", exact: true }).waitFor();
  noErrors(app);
  await app.close();

  app = await openApp();
  await app.page.locator(".note-list .titlebar").getByRole("button", { name: "New note", exact: true }).waitFor();
  expect(await app.page.locator(".add-button").count()).toBe(0);
});
