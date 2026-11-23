import { afterEach, expect, test } from "bun:test";
import type { Page } from "playwright";
import { type App, mod, noErrors, openApp, toggle } from "./app";

/*
 * The bar on top of a phone's keyboard as a note's written in (editor/KeyboardBar.svelte), in place
 * of the toolbar over selected text, where iOS puts its own menu. The keyboard is made the way each
 * system makes it: on iPhone and iPad it's over the page, and the visual viewport above it shrinks
 * (told here as WebKit tells it, by the viewport's height and a resize); on Android the web view is
 * made shorter (here the page's viewport).
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const TEXT = "Lines is a calm place for your thoughts.";
const KEYBOARD = 336;

/**
 * An iPhone's or iPad's keyboard, `height` px of it over the bottom of the page; 0 puts it away. With
 * it up, WebKit there pans what shows of the page when it's asked to scroll, which here the page
 * isn't tall enough to: how far it was asked to is noted (`pageScrolled`).
 */
const iosKeyboard = (page: Page, height: number) =>
  page.evaluate((height) => {
    const viewport = window.visualViewport!;
    const full = innerHeight;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => full - height });
    Object.assign(window, { pageScrolled: 0 });
    window.scrollBy = ((x: number, y: number) => Object.assign(window, { pageScrolled: (window as unknown as { pageScrolled: number }).pageScrolled + Math.abs(y) })) as typeof window.scrollBy;
    viewport.dispatchEvent(new Event("resize"));
  }, height);

/** How far the page itself was asked to scroll since the keyboard came up. */
const pageScrolled = (page: Page) => page.evaluate(() => (window as unknown as { pageScrolled: number }).pageScrolled);

const bar = () => app.page.getByRole("toolbar", { name: "Formatting", exact: true });
const button = (name: string) => bar().getByRole("button", { name, exact: true });

/** Waits for the bar's bottom edge to be at `y`, once it's slid there with the keyboard. */
const barAt = (y: number) =>
  app.page.waitForFunction((y) => {
    const box = document.querySelector(".keyboard-bar")!.getBoundingClientRect();
    return getComputedStyle(document.querySelector(".keyboard-bar")!).visibility === "visible" && Math.abs(box.bottom - y) < 1;
  }, y);

/** Whether the toolbar over selected text shows, a frame after the selection's made. */
const selectionToolbar = (page: Page, anchor: number, head: number) =>
  page.evaluate(
    ([anchor, head]) =>
      new Promise<boolean>((resolve) => {
        window.testing.editor()!.dispatch({ selection: { anchor, head } });
        requestAnimationFrame(() => resolve(!!document.querySelector(".cm-format-bar")));
      }),
    [anchor, head] as const,
  );

/** The note keeps the keyboard: its text has focus. */
const typingInNote = (page: Page) => page.evaluate(() => !!document.activeElement?.closest(".cm-content"));

test("on an iPhone it's on top of the keyboard as a note's written in, and the toolbar over selected text isn't", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  await app.open(TEXT);
  expect(await bar().isVisible()).toBe(false);

  await page.evaluate(() => window.testing.place(0));
  const height = await page.evaluate(() => innerHeight);
  // Down at the bottom until the keyboard's there, then on top of it as it comes up, and back down as it goes.
  await barAt(height);
  await iosKeyboard(page, KEYBOARD);
  await barAt(height - KEYBOARD);
  expect(await selectionToolbar(page, 11, 15)).toBe(false);

  // Its buttons, each at least 44 px, named, the formats the toolbar has and what the keyboard has no keys for.
  const names = await bar().getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  expect(names).toEqual(["Bold", "Italic", "Underline", "Strikethrough", "Code", "Highlight", "Bullet list", "Numbered list", "Todo", "Outdent", "Indent", "Hide keyboard"]);
  for (const box of await bar().getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON())))
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);

  // On the selection, and the keyboard stays in the note.
  await button("Bold").tap();
  await page.waitForFunction(() => window.testing.text() === "Lines is a **calm** place for your thoughts.");
  expect(await button("Bold").getAttribute("aria-pressed")).toBe("true");
  expect(await typingInNote(page)).toBe(true);
  await button("Bold").tap();
  await page.waitForFunction((text) => window.testing.text() === text, TEXT);
  expect(await button("Bold").getAttribute("aria-pressed")).toBe("false");

  // At the cursor, as ⌘I does: the markers, and the cursor between them.
  await page.evaluate(() => window.testing.place(5));
  await button("Italic").tap();
  await page.keyboard.type("so");
  await page.waitForFunction(() => window.testing.text() === "Lines*so* is a calm place for your thoughts.");
  expect(await typingInNote(page)).toBe(true);

  // Put away, the keyboard goes and the bar with it.
  await button("Hide keyboard").tap();
  await page.waitForFunction(() => !document.activeElement?.closest(".cm-content"));
  await iosKeyboard(page, 0);
  await bar().waitFor({ state: "hidden" });
});

test("its lists make the lines items and back, and Indent and Outdent nest them as Tab and ⇧Tab do", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  await app.open("Milk\nEggs\n");
  await page.evaluate(() => window.testing.editor()!.focus());
  await page.evaluate(() => window.testing.editor()!.dispatch({ selection: { anchor: 0, head: 9 } }));
  await iosKeyboard(page, KEYBOARD);
  await bar().waitFor();

  await button("Bullet list").tap();
  await page.waitForFunction(() => window.testing.text() === "- Milk\n- Eggs\n");
  expect(await button("Bullet list").getAttribute("aria-pressed")).toBe("true");
  await button("Numbered list").tap();
  await page.waitForFunction(() => window.testing.text() === "1. Milk\n2. Eggs\n");
  expect(await button("Bullet list").getAttribute("aria-pressed")).toBe("false");
  expect(await button("Numbered list").getAttribute("aria-pressed")).toBe("true");
  await button("Todo").tap();
  await page.waitForFunction(() => window.testing.text() === "- [ ] Milk\n- [ ] Eggs\n");
  // All todos already: plain lines again.
  await button("Todo").tap();
  await page.waitForFunction(() => window.testing.text() === "Milk\nEggs\n");

  // An empty line at the cursor becomes an item, the cursor after its marker.
  await page.evaluate(() => window.testing.place());
  await button("Bullet list").tap();
  await page.keyboard.type("Bread");
  await page.waitForFunction(() => window.testing.text() === "Milk\nEggs\n- Bread");

  // A number after the item above at its depth.
  await page.evaluate(() => window.testing.editor()!.dispatch({ changes: { from: 0, to: window.testing.text()!.length, insert: "1. Milk\n2. Eggs\nBread" } }));
  await page.evaluate(() => window.testing.place());
  await button("Numbered list").tap();
  await page.waitForFunction(() => window.testing.text() === "1. Milk\n2. Eggs\n3. Bread");

  await page.evaluate(() => window.testing.editor()!.dispatch({ changes: { from: 0, to: window.testing.text()!.length, insert: "- Milk\n- Eggs" } }));
  await page.evaluate(() => window.testing.place());
  await button("Indent").tap();
  await page.waitForFunction(() => window.testing.text() === "- Milk\n  - Eggs");
  await button("Outdent").tap();
  await page.waitForFunction(() => window.testing.text() === "- Milk\n- Eggs");
  expect(await typingInNote(page)).toBe(true);
});

test("the line being written stays in sight over it as the keyboard comes up and as you type", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  const body = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long note.`).join("\n");
  await app.open(body);
  // A line near the bottom of the screen, which the keyboard comes up over.
  const pos = await page.evaluate(() => {
    const view = window.testing.editor()!;
    const bottom = innerHeight - 40;
    return view.posAtCoords({ x: 60, y: bottom })!;
  });
  await page.evaluate((pos) => window.testing.place(pos), pos);
  await iosKeyboard(page, KEYBOARD);
  const height = await page.evaluate(() => innerHeight);
  await barAt(height - KEYBOARD);
  const clear = () =>
    page.waitForFunction(() => {
      const view = window.testing.editor()!;
      const caret = view.coordsAtPos(view.state.selection.main.head)!;
      return caret.bottom <= document.querySelector(".keyboard-bar")!.getBoundingClientRect().top;
    });
  await clear();
  await page.keyboard.type(" More words, and more, and more, until the line wraps onto another one below it.");
  await clear();
  // Only the note scrolls: the page stays put, the note's title bar at the top of the screen.
  expect(await pageScrolled(page)).toBe(0);
});

test("a line already in sight over the bar stays where it is, and the page doesn't scroll", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  await app.open(Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long note.`).join("\n"));
  await page.evaluate(() => window.testing.place(25));
  const before = await page.evaluate(() => window.testing.editor()!.coordsAtPos(25)!.top);
  await iosKeyboard(page, KEYBOARD);
  await barAt((await page.evaluate(() => innerHeight)) - KEYBOARD);
  await page.keyboard.type("x");
  await page.waitForFunction(() => window.testing.text()!.startsWith("Line 1 of a long note.\nLixne 2"));
  expect(await page.evaluate(() => window.testing.editor()!.coordsAtPos(25)!.top)).toBe(before);
  expect(await pageScrolled(page)).toBe(0);
});

test("on Android, where the keyboard makes the page shorter, it's at the page's new bottom", async () => {
  app = await openApp({ device: "Pixel 7" });
  const { page } = app;
  await app.open(TEXT);
  await page.evaluate(() => window.testing.place(0));
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height - KEYBOARD });
  await barAt(size.height - KEYBOARD);
  expect(await selectionToolbar(page, 11, 15)).toBe(false);
  await button("Highlight").tap();
  await page.waitForFunction(() => window.testing.text() === "Lines is a ==calm== place for your thoughts.");
});

test("on an iPad it's there while the keyboard's on the screen; with keys of its own, the toolbar over selected text is", async () => {
  app = await openApp({ device: "iPad Pro 11" });
  const { page } = app;
  await app.open(TEXT);
  await page.evaluate(() => window.testing.place(0));
  expect(await selectionToolbar(page, 11, 15)).toBe(true);
  expect(await bar().isVisible()).toBe(false);

  await iosKeyboard(page, 400);
  await barAt((await page.evaluate(() => innerHeight)) - 400);
  await page.waitForFunction(() => !document.querySelector(".cm-format-bar"));
  await iosKeyboard(page, 0);
  await bar().waitFor({ state: "hidden" });
  expect(await selectionToolbar(page, 0, 5)).toBe(true);
});

test("in a plain-text or LaTeX note it has Indent, Outdent and Hide keyboard; turned off in Settings, the toolbar over selected text is back", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  await app.open("Some plain text.", "text");
  await page.evaluate(() => window.testing.place(0));
  await iosKeyboard(page, KEYBOARD);
  await bar().waitFor();
  const names = await bar().getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  expect(names).toEqual(["Outdent", "Indent", "Hide keyboard"]);

  // Settings, from the sidebar's drawer.
  await page.evaluate(() => window.testing.notes.select(null));
  await page.keyboard.press(`${mod()}+\\`);
  await page.waitForFunction(() => !(document.querySelector("[data-pane=sidebar]") as HTMLElement).inert);
  await toggle(await app.settings("Editor"), "Formatting bar above the keyboard", false);
  await app.closeSettings();
  await app.open(TEXT);
  await page.evaluate(() => window.testing.place(0));
  expect(await selectionToolbar(page, 11, 15)).toBe(true);
  expect(await bar().isVisible()).toBe(false);
});

test("by keyboard and screen reader: a toolbar of named buttons, one Tab stop, the arrows between them, Esc back to the note", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  await app.open(TEXT);
  await page.evaluate(() => window.testing.place(0));
  await bar().waitFor();
  await button("Bold").focus();
  // Focus in the bar keeps it, as a screen reader moving to it would.
  expect(await bar().isVisible()).toBe(true);
  expect(await bar().getByRole("button").evaluateAll((buttons) => buttons.filter((button) => button.tabIndex === 0).length)).toBe(1);
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Italic");
  await page.keyboard.press("End");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Hide keyboard");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  // Nothing selected: Bold's markers at the cursor, and the keyboard back in the note.
  await page.waitForFunction(() => window.testing.text() === `****${"Lines is a calm place for your thoughts."}`);
  await page.waitForFunction(() => !!document.activeElement?.closest(".cm-content"));
  await button("Bold").focus();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !!document.activeElement?.closest(".cm-content"));
});

test("on a computer there's none, and the toolbar shows over selected text", async () => {
  app = await openApp();
  const { page } = app;
  await app.open(TEXT);
  await page.evaluate(() => window.testing.place(0));
  expect(await page.locator(".keyboard-bar").count()).toBe(0);
  expect(await selectionToolbar(page, 11, 15)).toBe(true);
});
