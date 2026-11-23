import { afterEach, expect, test } from "bun:test";
import type { Locator } from "playwright";
import { type App, noErrors, openApp } from "./app";
import { drag } from "./touch";

/*
 * lines on an iPhone, as Safari there has it (Playwright's iPhone 15: its size, touch and user
 * agent). The apps on iPhone and Android are this page too, in the system's web view.
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

/** Text sizes on a phone are iOS's, times the system's text size (mobile.ts): what that comes to here, in px. */
const scaled = (page: App["page"], px: number) => page.evaluate((px) => px * Number(getComputedStyle(document.documentElement).getPropertyValue("--type-scale")), px);

/** The font size of what `locator` finds first, in px. */
const fontSize = (locator: Locator) => locator.first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

test("on an iPhone, Safari can't zoom into a field that takes focus, but people can still pinch-zoom", async () => {
  app = await openApp({ phone: true });
  const content = await app.page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content).toContain("maximum-scale=1");
  // Safari ignores maximum-scale for pinching; user-scalable=no is for the apps alone.
  expect(content).not.toContain("user-scalable");
  expect(await app.root("platform")).toBe("ios");
});

test("on a computer, the viewport is index.html's", async () => {
  app = await openApp();
  expect(await app.page.locator('meta[name="viewport"]').getAttribute("content")).not.toContain("maximum-scale");
  expect(await app.root("platform")).toBeNull();
});

test("on a phone, text is iOS's size: rows, fields and settings 17, what's under them 15; and no field is under 16", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  await app.open("# A title\n\nSome text under it.");
  await page.getByRole("button", { name: "Back to notes" }).click();
  const list = page.locator("[data-pane=list]");
  expect(await fontSize(list.getByRole("searchbox"))).toBeCloseTo(await scaled(page, 17));
  const row = list.locator(".items li").first();
  expect(await fontSize(row.getByText("A title"))).toBeCloseTo(await scaled(page, 17));
  expect(await fontSize(row.getByText("Some text under it."))).toBeCloseTo(await scaled(page, 15));

  await page.getByRole("button", { name: "Show sidebar" }).click();
  const sidebar = page.locator("[data-pane=sidebar]");
  expect(await fontSize(sidebar.getByText("Notes", { exact: true }))).toBeCloseTo(await scaled(page, 17));

  // Settings: its sections, a setting's name, and every field in it.
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const theme = dialog.getByRole("navigation").getByText("Theme", { exact: true });
  expect(await fontSize(theme)).toBeCloseTo(await scaled(page, 17));
  await theme.click();
  expect(await fontSize(dialog.getByText("Contrast", { exact: true }))).toBeCloseTo(await scaled(page, 17));
  const fields = await dialog
    .locator("input:not([type=checkbox], [type=range], [type=file], [type=color], [type=radio]), textarea")
    .evaluateAll((fields) => fields.map((field) => parseFloat(getComputedStyle(field).fontSize)));
  expect(fields.length).toBeGreaterThan(0);
  const least = await scaled(page, 16);
  for (const size of fields) expect(size).toBeGreaterThanOrEqual(least);
});

test("on an iPhone, the lists, Settings and a short note can always be dragged and spring back", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  /** Whether it can scroll, and so bounce, though all of it fits. */
  const bounces = (selector: string) => page.locator(selector).first().evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(await bounces(".note-list .items")).toBe(true);
  // Resting at the top, all the same.
  expect(await page.locator(".note-list .items").evaluate((element) => element.scrollTop)).toBe(0);
  await app.open("Short.");
  expect(await bounces(".editor-pane .cm-scroller")).toBe(true);
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  expect(await bounces("[data-pane=sidebar] .bounce")).toBe(true);
  await page.locator("[data-pane=sidebar]").getByRole("button", { name: "Settings", exact: true }).click();
  expect(await bounces('[role="dialog"] nav')).toBe(true);
});

test("on a computer nothing scrolls that doesn't need to", async () => {
  app = await openApp();
  expect(await app.page.locator(".note-list .items").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(false);
});

test("the status bar takes the color of the pane at the top: the list's, the note's, the sidebar's, a dark pane's", async () => {
  app = await openApp({ phone: true, prefs: { darkPanes: "sidebar" } });
  const { page } = app;
  /** A pane's background, as hex. */
  const color = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const canvas = document.createElement("canvas").getContext("2d")!;
      canvas.fillStyle = getComputedStyle(element).backgroundColor;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    });
  const tinted = async (selector: string) =>
    page.waitForFunction((color) => document.querySelector('meta[name="theme-color"]')!.getAttribute("content") === color, await color(selector));
  // Different colors, or this would tell nothing.
  expect(await color("[data-pane=list]")).not.toBe(await color(".editor-pane"));
  await tinted("[data-pane=list]");
  await app.open("A note");
  await tinted(".editor-pane");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  expect(await page.locator("[data-pane=sidebar]").getAttribute("data-scheme")).toBe("dark");
  await tinted("[data-pane=sidebar]");
});

test("on a phone the panes' title bars reach the top of the screen, with no line or other color above them", async () => {
  app = await openApp({ phone: true });
  expect(await app.style("body", "padding-top")).toBe("0px");
  expect(await app.page.locator("[data-pane=list] .titlebar").evaluate((element) => element.getBoundingClientRect().top)).toBe(0);
  expect(await app.style("[data-pane=list] .titlebar", "border-top-width")).toBe("0px");
});

test("on a phone, a Key: Value line's copy button at the end of a full line is all on the screen", async () => {
  app = await openApp({ phone: true });
  await app.open("# Car\n\nPlate: 3WBZ56");
  await app.page.evaluate(() => window.testing.place(0));
  await app.page.locator(".editor-pane .cm-lp-copy").waitFor();
  // The value made longer a character at a time, past where the line wraps.
  const cut = await app.page.evaluate(async () => {
    const view = window.testing.editor()!;
    const edge = view.scrollDOM.getBoundingClientRect().right;
    const found: number[] = [];
    for (let i = 0; i < 60; i++) {
      const line = view.state.doc.line(3);
      view.dispatch({ changes: { from: line.from, to: line.to, insert: `Plate: 3WBZ56 ${"W".repeat(i)}` } });
      // Drawn again once the line's parsed, which on a busy machine can be a moment after the change.
      await window.testing.until(() => view.contentDOM.querySelector(".cm-lp-copy"));
      if (view.contentDOM.querySelector(".cm-lp-copy")!.getBoundingClientRect().right > edge) found.push(i);
    }
    return found;
  });
  expect(cut).toEqual([]);
});

/**
 * The cursor as the editor has it: the system's caret's color, and whether lines' own is drawn.
 * Read once the editor's drawn what it was last told: lines' cursor is drawn in its next measure,
 * a frame after the selection changes, and in WebKit its layer is hidden while it has nothing in it.
 */
const cursorShown = (page: App["page"]) =>
  page.evaluate(async () => {
    const view = window.testing.editor()!;
    await new Promise((drawn) => view.requestMeasure({ read: () => null, write: drawn }));
    const probe = document.body.appendChild(document.createElement("span"));
    probe.style.color = "var(--caret-color)";
    const cursorColor = getComputedStyle(probe).color;
    probe.remove();
    const caret = getComputedStyle(view.contentDOM).caretColor;
    return { system: caret === cursorColor ? "the cursor's color" : caret, lines: getComputedStyle(view.dom.querySelector(".cm-cursorLayer")!).display !== "none" };
  });

/** A finger put down on the note's first line and lifted, once the note's slid in and the line is what's under it. */
async function tapText(page: App["page"]) {
  const under = await page.waitForFunction(() => {
    const line = document.querySelector(".editor-pane .cm-line")!;
    const box = line.getBoundingClientRect();
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    return line.contains(document.elementFromPoint(at.x, at.y)) && at;
  });
  const at = (await under.jsonValue()) as { x: number; y: number };
  await drag(page, at, at, { steps: 1, duration: 16 });
}

test("on an iPhone the cursor is the system's from a touch until typing, and while text is selected, so iOS shows the selection's handles and highlight", async () => {
  app = await openApp({ phone: true });
  const { page } = app;
  await app.open("Lines is a calm place for your thoughts.");
  await page.evaluate(() => window.testing.place(0));
  // Typed into without a touch: lines' own cursor, the system's hidden.
  expect(await cursorShown(page)).toEqual({ system: "rgba(0, 0, 0, 0)", lines: true });

  // iOS draws the handles, the highlight and the loupe in the caret's color: in the cursor's from the touch on, before anything's selected.
  await tapText(page);
  await page.waitForFunction(() => window.testing.editor()!.dom.classList.contains("cm-systemCursor"));
  expect(await cursorShown(page)).toEqual({ system: "the cursor's color", lines: false });
  await page.evaluate(() => window.testing.editor()!.dispatch({ selection: { anchor: 11, head: 15 } }));
  expect(await cursorShown(page)).toEqual({ system: "the cursor's color", lines: false });

  // Typing over it, lines' cursor is back.
  await page.keyboard.type("quiet");
  await page.waitForFunction(() => window.testing.text()!.startsWith("Lines is a quiet place"));
  expect(await cursorShown(page)).toEqual({ system: "rgba(0, 0, 0, 0)", lines: true });

  // Text selected with an iPad's keys has the system's highlight too.
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForFunction(() => !window.testing.editor()!.state.selection.main.empty);
  expect((await cursorShown(page)).system).toBe("the cursor's color");

  // On Android and on a computer the cursor is always lines' own, touched or not.
  for (const options of [{ device: "Pixel 7" }, {}]) {
    noErrors(app);
    await app.close();
    app = await openApp(options);
    await app.open("Lines is a calm place for your thoughts.");
    await app.page.evaluate(() => window.testing.place(0));
    if (options.device) await tapText(app.page);
    await app.page.evaluate(() => window.testing.editor()!.dispatch({ selection: { anchor: 11, head: 15 } }));
    expect((await cursorShown(app.page)).system).toBe("rgba(0, 0, 0, 0)");
  }
});
