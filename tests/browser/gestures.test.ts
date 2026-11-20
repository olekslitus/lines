import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type App, mod, noErrors, openApp, toggle } from "./app";
import { answerPictures } from "./files";
import { drag, lift } from "./touch";

/*
 * A touch screen's gestures (gestures.ts) on an iPhone, in Chromium and WebKit: swipes from the
 * screen's edge that follow the finger, back from a note and the sidebar in and out, and pulls
 * down past the top to search the list, find in a note, and refresh the feeds.
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const phone = (prefs?: Record<string, unknown>) => openApp({ phone: true, prefs });

/** Whether a pane is out of reach (off-screen, on a phone). */
const inert = (pane: string) => app.page.locator(`[data-pane=${pane}]`).evaluate((element) => (element as HTMLElement).inert);
/** Where a pane's left edge is on screen. */
const left = (pane: string) => app.page.locator(pane === "editor" ? ".editor-pane" : `[data-pane=${pane}]`).evaluate((element) => Math.round(element.getBoundingClientRect().left) + 0);
/** Done sliding: nothing the finger set is left on the panes. */
const settled = () => app.page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>("[data-pane], .editor-pane")].every((pane) => !pane.style.translate));

async function openNote() {
  await app.open("# A note\n\nSome text to read.");
  await app.page.waitForFunction(() => document.querySelector(".editor-pane")!.getBoundingClientRect().x === 0);
}

test("a swipe from the left edge takes a note back to the list, following the finger, the list coming out from under it", async () => {
  app = await phone();
  await openNote();
  const { page } = app;
  const width = page.viewportSize()!.width;
  await drag(page, { x: 4, y: 300 }, { x: 4 + width * 0.6, y: 305 }, { lift: false });
  // Past halfway: the note as far right as the finger, the list a little way out from under it, dimmed.
  expect(Math.abs((await page.locator(".editor-pane").evaluate((pane) => pane.getBoundingClientRect().left)) - width * 0.6)).toBeLessThan(2);
  expect(await left("list")).toBeLessThan(0);
  expect(await left("list")).toBeGreaterThan(-width / 2);
  expect(Number(await page.locator("[data-pane=list]").evaluate((pane) => getComputedStyle(pane, "::after").opacity))).toBeGreaterThan(0);
  await lift(page);
  await page.waitForFunction(() => !window.testing.notes.selected);
  await settled();
  expect(await inert("list")).toBe(false);
  expect(await left("list")).toBe(0);
});

test("let go before halfway and slowly, the note springs back; a flick takes it back however short", async () => {
  app = await phone();
  await openNote();
  const { page } = app;
  await drag(page, { x: 4, y: 300 }, { x: 120, y: 300 }, { duration: 600 });
  await settled();
  expect(await page.evaluate(() => !!window.testing.notes.selected)).toBe(true);
  expect(await inert("list")).toBe(true);
  expect(await left("editor")).toBe(0);

  await drag(page, { x: 4, y: 300 }, { x: 110, y: 300 }, { duration: 60, steps: 4 });
  await page.waitForFunction(() => !window.testing.notes.selected);
  await settled();
});

test("only from the edge, sideways, and its way: a swipe further in, a scroll, or a swipe left doesn't go back", async () => {
  app = await phone();
  await openNote();
  const { page } = app;
  await drag(page, { x: 80, y: 300 }, { x: 300, y: 300 });
  await drag(page, { x: 4, y: 200 }, { x: 30, y: 400 });
  await drag(page, { x: 20, y: 300 }, { x: 4, y: 300 });
  await settled();
  expect(await page.evaluate(() => !!window.testing.notes.selected)).toBe(true);
  expect(await left("editor")).toBe(0);
});

test("on the list, a swipe from the edge opens the sidebar as it follows, and a swipe left closes it", async () => {
  app = await phone();
  const { page } = app;
  await drag(page, { x: 4, y: 300 }, { x: 120, y: 300 }, { lift: false });
  // Part way out, over the list, dimmed as much.
  const sidebar = page.locator("[data-pane=sidebar]");
  expect(await sidebar.evaluate((pane) => getComputedStyle(pane).visibility)).toBe("visible");
  expect(await left("sidebar")).toBeLessThan(0);
  await lift(page);
  await page.waitForFunction(() => !(document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  await settled();
  expect(await left("sidebar")).toBe(0);

  await drag(page, { x: 250, y: 300 }, { x: 20, y: 300 });
  await page.waitForFunction(() => (document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
});

test("turned off in Settings, swipes and pulls do nothing", async () => {
  app = await phone();
  const { page } = app;
  // Settings is in the sidebar.
  await page.keyboard.press(`${mod()}+\\`);
  await page.waitForFunction(() => !(document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  const settings = await app.settings("General");
  await toggle(settings, "Swipes and pulls", false);
  await app.closeSettings();
  await page.keyboard.press(`${mod()}+\\`);
  await page.waitForFunction(() => (document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  expect(await page.evaluate(() => window.testing.prefs.gestures)).toBe(false);
  await drag(page, { x: 4, y: 300 }, { x: 300, y: 300 });
  await drag(page, { x: 200, y: 220 }, { x: 200, y: 500 });
  await settled();
  expect(await inert("sidebar")).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).not.toBe("search");
});

test("pulling the list down past its top searches it; not far enough, it springs back", async () => {
  app = await phone();
  const { page } = app;
  const search = page.getByRole("searchbox", { name: "Search notes" });
  const list = await page.locator(".note-list ul.items").boundingBox();
  const top = list!.y + 20;
  await drag(page, { x: 200, y: top }, { x: 200, y: top + 60 });
  // Back where it was.
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".note-list ul.items")!).translate === "none");
  expect(await search.evaluate((field) => field === document.activeElement)).toBe(false);

  await drag(page, { x: 200, y: top }, { x: 200, y: top + 300 }, { lift: false });
  // The list stretched down, and a magnifying glass in the room it opened, ready.
  expect(await page.locator(".note-list ul.items").evaluate((list) => list.style.translate)).toMatch(/^0px \d+/);
  expect(await page.locator(".note-list .pull-indicator").getAttribute("data-armed")).not.toBeNull();
  await lift(page);
  await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "search");
});

test("on iPhone, a list that scrolls bounces past its top by itself, and how far it went is the pull", async () => {
  app = await phone();
  const { page } = app;
  // As if WebKit on iPhone had it bounced 90px down past its top under the finger.
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) await window.testing.notes.insert({ id: crypto.randomUUID(), body: `# Note ${i}`, createdAt: i, updatedAt: i, pinned: false, trashed: false });
  });
  const list = page.locator(".note-list ul.items");
  await page.waitForFunction(() => {
    const list = document.querySelector(".note-list ul.items")!;
    return list.scrollHeight > list.clientHeight;
  });
  const box = (await list.boundingBox())!;
  await drag(page, { x: 200, y: box.y + 20 }, { x: 200, y: box.y + 24 }, { lift: false, steps: 1 });
  await list.evaluate((list) => {
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => -90 });
    list.dispatchEvent(new Event("scroll"));
  });
  expect(await page.locator(".note-list .pull-indicator").getAttribute("data-armed")).not.toBeNull();
  // Not moved here: iPhone moved it.
  expect(await list.evaluate((list) => list.style.translate)).toBe("");
  await lift(page);
  await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "search");
});

test("pulling a note down past its top finds in it", async () => {
  app = await phone();
  await openNote();
  const { page } = app;
  const box = (await page.locator(".editor-pane .cm-scroller").boundingBox())!;
  await drag(page, { x: 200, y: box.y + 40 }, { x: 200, y: box.y + 340 });
  await page.waitForFunction(() => document.activeElement?.closest(".cm-panel"));
  await settled();
});

test("pulling the feeds down refreshes them, with a spinner while they're fetched", async () => {
  app = await phone();
  const { page } = app;
  const BLOG = "https://site.example/feed.xml";
  let asked = 0;
  let answer: () => void = () => {};
  await answerPictures(page);
  await page.route(
    (url) => url.href === BLOG,
    async (route) => {
      // The refresh waits for the test to answer, so its spinner can be seen.
      if (asked++) await new Promise<void>((resolve) => (answer = resolve));
      await route.fulfill({ body: readFileSync(new URL("./feeds/blog.rss", import.meta.url), "utf8"), contentType: "application/rss+xml", headers: { "access-control-allow-origin": "*" } });
    },
  );
  await page.evaluate((url) => window.testing.feeds.subscribe(url), BLOG);
  await page.evaluate(() => window.testing.notes.setFilter({ kind: "feeds" }));
  await page.locator(".note-list [data-post]").first().waitFor();
  expect(asked).toBe(1);

  const box = (await page.locator(".note-list ul.items").boundingBox())!;
  await drag(page, { x: 200, y: box.y + 20 }, { x: 200, y: box.y + 320 });
  const indicator = page.locator(".note-list .pull-indicator");
  await page.waitForFunction(() => document.querySelector(".note-list .pull-indicator")?.hasAttribute("data-busy"));
  expect(asked).toBe(2);
  // The list kept down under the spinner until it's done.
  expect(await page.locator(".note-list ul.items").evaluate((list) => list.style.translate)).toMatch(/^0px \d+/);
  answer();
  await indicator.evaluate((element) => new Promise((resolve) => new MutationObserver(() => !element.hasAttribute("data-busy") && resolve(null)).observe(element, { attributes: true })));
  await page.waitForFunction(() => !(document.querySelector(".note-list ul.items") as HTMLElement).style.translate);
});

test("a laptop's touch screen pulls, but its edges are the system's: no swipes", async () => {
  // A computer's browser, in a window as narrow as a phone.
  app = await openApp({ width: 390, height: 800 });
  const { page } = app;
  await drag(page, { x: 4, y: 300 }, { x: 300, y: 300 });
  await settled();
  expect(await inert("sidebar")).toBe(true);
  const box = (await page.locator(".note-list ul.items").boundingBox())!;
  await drag(page, { x: 200, y: box.y + 20 }, { x: 200, y: box.y + 320 });
  await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "search");
});
