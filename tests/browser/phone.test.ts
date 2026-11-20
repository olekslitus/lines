import { afterEach, expect, test } from "bun:test";
import type { Locator } from "playwright";
import { type App, noErrors, openApp } from "./app";

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
