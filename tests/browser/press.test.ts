import { afterEach, expect, test } from "bun:test";
import { type App, noErrors, openApp } from "./app";
import { hold } from "./touch";

/*
 * A long press (longPress.ts), the touch screen's right-click: a row's menu opens once the finger
 * has been held still 0.4 s, as Android's long press and about as iOS's context menus, sinking a
 * little as it's held and felt in the hand as it opens. Moving, a list that was just scrolling,
 * or a mouse don't open it.
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const ROW = ".note-list .item[data-id]";

/** On a phone, with a note in the list and the buzzes the page asks for kept (Safari has none, so it's given one). */
async function phone() {
  app = await openApp({ phone: true });
  await app.page.evaluate(async () => {
    const felt: number[] = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (ms: number) => (felt.push(ms), true) });
    Object.assign(window, { felt });
    await window.testing.notes.insert({ id: crypto.randomUUID(), body: "# Held", createdAt: 1, updatedAt: 1, pinned: false, trashed: false });
  });
  await app.page.locator(ROW).first().waitFor();
  return app.page;
}

const felt = () => app.page.evaluate(() => (window as unknown as { felt: number[] }).felt);
const menu = () => app.page.getByRole("menu");

test("held 0.4 s, a row's menu opens, the row sinking a little as it's held, with a tap felt; the click after it doesn't open the note", async () => {
  const page = await phone();
  const { opened, sunk } = await hold(page, ROW);
  expect(opened).not.toBeNull();
  // Not before 0.4 s; a frame or two after, as the page is busy.
  expect(opened!).toBeGreaterThanOrEqual(390);
  expect(opened!).toBeLessThan(500);
  expect(sunk).toBeLessThan(1);
  expect(sunk).toBeGreaterThan(0.95);
  expect(await felt()).toEqual([12]);
  await menu().waitFor();
  expect(await page.evaluate(() => window.testing.notes.selected)).toBeNull();
  // Back up as the menu opened.
  await page.waitForFunction((row) => ["none", "1"].includes(getComputedStyle(document.querySelector(row)!).scale), ROW);
});

test("moved, or put down on a list that was just scrolling, or with a mouse, it's not a long press", async () => {
  const page = await phone();
  expect((await hold(page, ROW, { moveBy: 15 })).opened).toBeNull();
  await page.waitForFunction((row) => ["none", "1"].includes(getComputedStyle(document.querySelector(row)!).scale), ROW);

  // A finger that stops a list's fling and stays down isn't pressing the row under it.
  await page.locator(".note-list ul.items").evaluate((list) => list.dispatchEvent(new Event("scroll")));
  expect((await hold(page, ROW)).opened).toBeNull();

  expect((await hold(page, ROW, { pointerType: "mouse" })).opened).toBeNull();
  expect(await felt()).toEqual([]);
  expect(await menu().count()).toBe(0);
});

test("the + button's menu opens held, felt too, the button showing being pressed in its own way", async () => {
  const page = await phone();
  const { opened, sunk } = await hold(page, ".add-button");
  expect(opened).not.toBeNull();
  expect(sunk).toBe(1);
  expect(await felt()).toEqual([12]);
});
