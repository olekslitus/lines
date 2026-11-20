import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type App, mod, noErrors, openApp, toggle } from "./app";
import { answerPictures } from "./files";
import { drag, lift } from "./touch";

/*
 * A touch screen's gestures (gestures.ts) on an iPhone and an Android phone, in Chromium and
 * WebKit: swipes from the screen's edge that follow the finger, back from a note and the sidebar
 * in and out, and pulls down past the top to search the list, find in a note, and refresh the
 * feeds. On iPhone lists and notes bounce past their top by themselves, which a test can only fake
 * (below); on Android lines moves them, as a script's touches can show.
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const phone = (prefs?: Record<string, unknown>) => openApp({ phone: true, prefs });
const android = () => openApp({ device: "Pixel 7" });

/** Whether a pane is out of reach (off-screen, on a phone). */
const inert = (pane: string) => app.page.locator(`[data-pane=${pane}]`).evaluate((element) => (element as HTMLElement).inert);
/** Where a pane's left edge is on screen. */
const left = (pane: string) => app.page.locator(pane === "editor" ? ".editor-pane" : `[data-pane=${pane}]`).evaluate((element) => element.getBoundingClientRect().left);
/** A pane in its place at the screen's left edge, within the pixel a slide's last frame may leave it (WebKit's are fractions). */
const home = async (pane: string) => expect(Math.abs(await left(pane))).toBeLessThanOrEqual(1);
/** Done sliding: nothing the finger set is left on the panes, nor anything still moving them. */
const settled = () => app.page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>("[data-pane], .editor-pane")].every((pane) => !pane.style.translate && !pane.getAnimations().length));

async function openNote() {
  await app.open("# A note\n\nSome text to read.");
  await app.page.waitForFunction(() => Math.abs(document.querySelector(".editor-pane")!.getBoundingClientRect().x) < 1);
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
  expect(Number(await page.locator("[data-list-dim]").evaluate((dim) => getComputedStyle(dim).opacity))).toBeGreaterThan(0);
  await lift(page);
  await page.waitForFunction(() => !window.testing.notes.selected);
  await settled();
  expect(await inert("list")).toBe(false);
  await home("list");
});

test("let go before halfway and slowly, the note springs back; a flick takes it back however short", async () => {
  app = await phone();
  await openNote();
  const { page } = app;
  await drag(page, { x: 4, y: 300 }, { x: 120, y: 300 }, { duration: 600 });
  await settled();
  expect(await page.evaluate(() => !!window.testing.notes.selected)).toBe(true);
  expect(await inert("list")).toBe(true);
  await home("editor");

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
  await home("editor");
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
  await home("sidebar");

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
  // Nor is anything drawn as iPhone bounces the list past its top.
  await page.locator(".note-list ul.items").evaluate((list) => {
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => -90 });
    list.dispatchEvent(new Event("scroll"));
  });
  expect(await page.locator(".note-list .pull-indicator").getAttribute("data-armed")).toBeNull();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).not.toBe("search");
});

test("pulling the list down past its top searches it; not far enough, it springs back", async () => {
  app = await android();
  const { page } = app;
  const search = page.getByRole("searchbox", { name: "Search notes" });
  const listTop = async () => (await page.locator(".note-list ul.items").boundingBox())!.y + 20;
  let top = await listTop();
  await drag(page, { x: 200, y: top }, { x: 200, y: top + 60 });
  // Back where it was, under the search field it showed (put away on a phone), not searching.
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".note-list ul.items")!).translate === "none");
  expect(await search.evaluate((field) => field === document.activeElement)).toBe(false);
  expect((await search.boundingBox())!.height).toBeGreaterThan(30);

  top = await listTop();
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
  app = await android();
  await openNote();
  const { page } = app;
  const box = (await page.locator(".editor-pane .cm-scroller").boundingBox())!;
  await drag(page, { x: 200, y: box.y + 40 }, { x: 200, y: box.y + 340 });
  await page.waitForFunction(() => document.activeElement?.closest(".cm-panel"));
  await settled();
});

test("pulling the feeds down refreshes them, with a spinner while they're fetched", async () => {
  app = await android();
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

/** What's moving the panes as the finger lifts: each animation's keyframes, `translate` and `opacity` as numbers, and what else they set. */
async function liftAndRead(page: App["page"]) {
  return page.evaluate(() => {
    (window as unknown as { liftFinger: () => void }).liftFinger();
    const panes = [...document.querySelectorAll<HTMLElement>("[data-pane], .editor-pane, [data-list-dim]")];
    const animations = panes.flatMap((pane) => pane.getAnimations().map((animation) => ({ pane, effect: animation.effect as KeyframeEffect })));
    const frames = (pane: Element) => animations.find((each) => each.pane === pane)?.effect.getKeyframes() ?? [];
    const editor = document.querySelector(".editor-pane")!;
    const ignored = new Set(["offset", "computedOffset", "easing", "composite"]);
    return {
      editor: frames(editor).map((frame) => parseFloat(String(frame.translate))),
      easing: animations.map(({ effect }) => effect.getTiming().easing),
      properties: [...new Set(animations.flatMap(({ effect }) => effect.getKeyframes().flatMap((frame) => Object.keys(frame).filter((key) => !ignored.has(key)))))].sort(),
      listInert: (document.querySelector("[data-pane=list]") as HTMLElement).inert,
    };
  });
}

test("let go, a swipe carries on at the finger's speed and comes to rest as a spring, moving and fading only, the list in reach at once", async () => {
  app = await phone();
  await openNote();
  const { page } = app;
  const width = page.viewportSize()!.width;
  // Steadily, 60% of the way in 160 ms.
  await drag(page, { x: 4, y: 300 }, { x: 4 + width * 0.6, y: 300 }, { lift: false });
  const finger = (width * 0.6) / 160;
  const { editor, easing, properties, listInert } = await liftAndRead(page);
  // A keyframe a frame apart at 120 Hz, nothing eased between them, which Core Animation can run.
  expect(editor.length).toBeGreaterThan(20);
  expect(new Set(easing)).toEqual(new Set(["linear"]));
  expect(properties).toEqual(["opacity", "translate"]);
  // Setting off at about the finger's speed: no jump to a curve's own, and no ease-in.
  const speed = (editor[1] - editor[0]) / (1000 / 120);
  expect(speed / finger).toBeGreaterThan(0.75);
  expect(speed / finger).toBeLessThan(1.5);
  // Then slowing, never passing the end.
  const steps = editor.slice(1).map((at, i) => at - editor[i]);
  expect(steps.at(-1)!).toBeLessThan(steps[0]);
  expect(Math.max(...editor)).toBeLessThanOrEqual(0.5);
  // The list's already in reach, to scroll or tap, while the note slides off.
  expect(listInert).toBe(false);
  await page.waitForFunction(() => !window.testing.notes.selected);
  await settled();
  await home("list");
});

test("a row tapped while a note's still sliding off opens its note, sliding in from where the other got to", async () => {
  app = await phone();
  const { page } = app;
  const other = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    await window.testing.notes.insert({ id, body: "# Another note", createdAt: 0, updatedAt: 0, pinned: false, trashed: false });
    return id;
  });
  await openNote();
  const width = page.viewportSize()!.width;
  await drag(page, { x: 4, y: 300 }, { x: 4 + width * 0.6, y: 300 }, { lift: false });
  const opened = await page.evaluate((other) => {
    (window as unknown as { liftFinger: () => void }).liftFinger();
    document.querySelector<HTMLElement>(`.note-list [data-id="${other}"]`)!.click();
    return window.testing.notes.selectedId;
  }, other);
  expect(opened).toBe(other);
  await settled();
  expect(await page.evaluate(() => window.testing.notes.selectedId)).toBe(other);
  await home("editor");
  expect(await inert("list")).toBe(true);
  expect(await page.locator(".editor-pane").evaluate((pane) => (pane as HTMLElement).inert)).toBe(false);
});

test("tapped, a note, the list and the sidebar slide on the same spring, run off the page", async () => {
  app = await phone();
  const transition = (selector: string) => app.page.locator(selector).first().evaluate((element) => [getComputedStyle(element).transitionTimingFunction, getComputedStyle(element).transitionDuration]);
  for (const selector of [".editor-pane", "[data-pane=list]", "[data-pane=sidebar]"]) {
    const [timing, duration] = await transition(selector);
    expect(timing).toContain("cubic-bezier(0.285, 0.458, 0.044, 1)");
    expect(duration).toContain("0.573s");
  }
});

test("a scroll isn't stopped as it starts, near the edge or on the feeds: only a first move that's clearly sideways is a swipe's", async () => {
  app = await phone();
  const { page } = app;
  await answerPictures(page);
  const BLOG = "https://site.example/feed.xml";
  await page.route(
    (url) => url.href === BLOG,
    (route) => route.fulfill({ body: readFileSync(new URL("./feeds/blog.rss", import.meta.url), "utf8"), contentType: "application/rss+xml", headers: { "access-control-allow-origin": "*" } }),
  );
  await page.evaluate((url) => window.testing.feeds.subscribe(url), BLOG);
  await page.evaluate(() => window.testing.notes.setFilter({ kind: "feeds" }));
  await page.locator(".note-list [data-post]").first().waitFor();
  const box = (await page.locator(".note-list ul.items").boundingBox())!;
  const move = (x: number, y: number, dx: number, dy: number) => drag(page, { x, y }, { x: x + dx, y: y + dy }, { steps: 1, duration: 0 });
  // Starting a scroll by the sidebar's edge, a little to the side: WebKit would lose the whole scroll.
  expect(await move(6, box.y + 200, 2, 2)).toBe(false);
  expect(await move(6, box.y + 200, 1, -3)).toBe(false);
  // Anywhere else on the list, and pulling down from its top, which on iPhone bounces by itself.
  expect(await move(200, box.y + 200, 0, -4)).toBe(false);
  expect(await move(200, box.y + 20, 0, 4)).toBe(false);
  // Clearly sideways from the edge, it's the sidebar's swipe.
  expect(await move(6, box.y + 200, 6, 1)).toBe(true);
});

test("on a phone the search field waits above the list: a short pull shows it, scrolling down puts it away, a search keeps it", async () => {
  app = await android();
  const { page } = app;
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) await window.testing.notes.insert({ id: crypto.randomUUID(), body: `# Note ${i}`, createdAt: i, updatedAt: i, pinned: false, trashed: false });
  });
  const search = page.getByRole("searchbox", { name: "Search notes" });
  const field = () => search.evaluate((input) => input.parentElement!.getBoundingClientRect().height);
  const list = page.locator(".note-list ul.items");
  // The list starts with its first row, right under the title bar.
  expect(await field()).toBe(0);
  const bar = (await page.locator(".note-list .titlebar").boundingBox())!;
  expect((await list.boundingBox())!.y - (bar.y + bar.height)).toBeLessThan(4);

  const top = (await list.boundingBox())!.y + 20;
  await drag(page, { x: 200, y: top }, { x: 200, y: top + 50 });
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".note-list input[type=search]")!.parentElement!.getBoundingClientRect().height > 30);
  expect(await search.evaluate((input) => input === document.activeElement)).toBe(false);

  // Scrolled down past it, it goes; back at the top, it stays away until pulled.
  await list.evaluate((element) => element.scrollTo(0, 200));
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".note-list input[type=search]")!.parentElement!.getBoundingClientRect().height === 0);

  // Searching, it stays however far the list scrolls.
  await search.focus();
  expect(await field()).toBeGreaterThan(30);
  await page.keyboard.type("Note 1");
  await search.evaluate((input) => input.blur());
  await list.evaluate((element) => element.scrollTo(0, 200));
  await page.waitForTimeout(100);
  expect(await field()).toBeGreaterThan(30);
});

test("the Search shortcut shows the put-away field as it focuses it; tablets and computers always show it", async () => {
  app = await phone();
  const { page } = app;
  const field = () => page.locator(".note-list input[type=search]").evaluate((input) => input.parentElement!.getBoundingClientRect().height);
  expect(await field()).toBe(0);
  await page.keyboard.press("Meta+Shift+f");
  await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "search");
  expect(await field()).toBeGreaterThan(30);
  await app.close();

  for (const options of [{ device: "iPad Pro 11" }, {}]) {
    app = await openApp(options);
    expect(await app.page.locator(".note-list input[type=search]").evaluate((input) => input.parentElement!.getBoundingClientRect().height)).toBeGreaterThan(30);
    if (options.device) await app.close();
  }
});
