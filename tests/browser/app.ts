import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devices, type Locator, type Page, webkit } from "playwright";

/*
 * The app in a page of its own, for a browser test: fresh storage, Settings as given, and what the
 * test needs to drive it. setup.ts starts the server and the browser.
 */

export interface Options {
  /** Settings to start with, as they're stored (prefs.svelte.ts). */
  prefs?: Record<string, unknown>;
  /** The tour's notes, as a first visit has them. */
  tour?: boolean;
  scheme?: "light" | "dark";
  width?: number;
  height?: number;
  /** The page's time zone (`America/New_York`), if not this machine's. */
  timezone?: string;
  /** As Safari on an iPhone has it: its size, its touch screen, and its user agent, which lines takes for an iPhone's. */
  phone?: boolean;
  /** Another phone or tablet as Playwright has it (`Pixel 7`): its size, touch screen and user agent. */
  device?: string;
  /**
   * As lines' own app there rather than a browser: Tauri's IPC is the test's, which notes each
   * command asked of the app in `window.invoked` and answers it with nothing.
   */
  app?: boolean;
  /**
   * Its storage kept on disk, as a browser's own is: Playwright's WebKit keeps no files (Blobs) in
   * IndexedDB otherwise, so the app can't keep an attachment there. Slower to start.
   */
  onDisk?: boolean;
}

export interface App {
  page: Page;
  /** What went wrong in the page: uncaught errors and console errors. */
  errors: string[];
  /** Opens a note with this text, in `format` (Markdown if left out). */
  open(body: string, format?: string): Promise<string>;
  /** Settings, at `section` (as the sidebar names it). */
  settings(section: string): Promise<Locator>;
  closeSettings(): Promise<void>;
  /** The open note's text. */
  text(): Promise<string | null>;
  /** A computed style of the first element `selector` matches. */
  style(selector: string, property: string): Promise<string>;
  /** The page's own attribute, `data-<name>`. */
  root(name: string): Promise<string | null>;
  close(): Promise<void>;
}

export const engine = () => globalThis.lines.engine;
/** ⌘ where the browser runs on a Mac, Ctrl elsewhere (WebKit on Linux too), as the app's shortcuts take them. */
export const mod = () => (process.platform === "darwin" ? "Meta" : "Control");

/**
 * ⌘ or Ctrl as a click with it reads in the page (links.ts): by what the browser says it is, so ⌘ in
 * Playwright's WebKit, which says it's a Mac on Linux too.
 */
export const clickMod = (page: App["page"]) => page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "Meta" : "Control"));

/**
 * Done sliding: nothing a finger set is left on the panes, nor anything still moving them. Measure
 * where things are on a phone only then: during a slide, WebKit can give two measurements from
 * different moments of it, on a busy machine even an earlier place after a later one.
 */
export const settled = (page: Page) => page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>("[data-pane], .editor-pane")].every((pane) => !pane.style.translate && !pane.getAnimations().length));

/** What a browser says in the console on its own, not about lines: WebKit on Linux doesn't know a viewport key the page sets. */
const NOISE = [/^Viewport argument key ".+" not recognized and ignored\.$/];

export async function openApp({ prefs = {}, tour = false, scheme = "light", width = 1280, height = 820, timezone, phone = false, device: name = phone ? "iPhone 15" : undefined, app = false, onDisk = false }: Options = {}): Promise<App> {
  const device = name ? devices[name] : { viewport: { width, height }, deviceScaleFactor: 1 };
  const settings = { ...device, colorScheme: scheme, timezoneId: timezone };
  const dir = onDisk && engine() === "webkit" ? mkdtempSync(join(tmpdir(), "lines-test-")) : null;
  const context = dir ? await webkit.launchPersistentContext(dir, settings) : await globalThis.lines.browser.newContext(settings);
  if (engine() === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Playwright's WebKit can't be let read the clipboard: there it's one of the page's own, which the
  // app writes to as it would the system's, and a test reads back what it was given.
  else
    await context.addInitScript(() => {
      let items: ClipboardItem[] = [];
      const clipboard = {
        write: async (given: ClipboardItem[]) => void (items = given),
        writeText: async (text: string) => void (items = [new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }) })]),
        read: async () => items,
        readText: async () => (items[0]?.types.includes("text/plain") ? (await items[0].getType("text/plain")).text() : ""),
      };
      Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    });
  // Nothing reaches the web: what a test doesn't answer itself (its own routes come first) is answered with nothing.
  await context.route((url) => url.protocol.startsWith("http") && url.hostname !== "127.0.0.1", (route) => route.fulfill({ body: "", contentType: "text/plain" }));
  // Once, so a reload keeps what the test changed.
  await context.addInitScript(
    ([prefs, tour]) => {
      // Not in the blank page a tab starts as, which has no storage.
      if (location.protocol !== "http:" || sessionStorage.getItem("lines.test")) return;
      sessionStorage.setItem("lines.test", "1");
      if (!tour) localStorage.setItem("lines.seeded", "1");
      localStorage.setItem("lines.prefs", JSON.stringify(prefs));
    },
    [prefs, tour] as const,
  );
  if (app) {
    await context.addInitScript(() => {
      const invoked: { cmd: string; args: unknown }[] = [];
      let callbacks = 0;
      Object.assign(window, {
        invoked,
        __TAURI_INTERNALS__: {
          metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
          invoke: async (cmd: string, args: unknown) => void invoked.push({ cmd, args }),
          transformCallback: (callback: unknown) => {
            const id = ++callbacks;
            Object.assign(window, { [`_${id}`]: callback });
            return id;
          },
          convertFileSrc: (path: string) => path,
        },
      });
    });
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && !NOISE.some((noise) => noise.test(message.text())) && errors.push(message.text()));
  await page.goto(globalThis.lines.url);
  await page.waitForFunction(() => window.testing?.notes.ready);
  const dialog = page.getByRole("dialog");
  return {
    page,
    errors,
    open: (body, format) => page.evaluate(([body, format]) => window.testing.open(body, format), [body, format] as const),
    async settings(section) {
      if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Settings", exact: true }).click();
      await dialog.getByRole("navigation").getByText(section, { exact: true }).first().click();
      return dialog;
    },
    async closeSettings() {
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    },
    text: () => page.evaluate(() => window.testing.text()),
    style: (selector, property) => page.locator(selector).first().evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), property),
    root: (name) => page.evaluate((name) => document.documentElement.getAttribute(`data-${name}`), name),
    async close() {
      await context.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Chooses `option` in the segmented control or radio group labelled `label`. */
export const choose = (within: Locator, label: string, option: string) => within.getByRole("radiogroup", { name: label, exact: true }).getByRole("radio", { name: option, exact: true }).click();

/** Turns the switch labelled `label` on or off. */
export async function toggle(within: Locator, label: string, on: boolean) {
  const control = within.getByRole("switch", { name: label, exact: true });
  if ((await control.getAttribute("aria-checked")) !== String(on)) await control.click();
}

/** Nothing went wrong in the page. */
export const noErrors = (app: App) => expect(app.errors).toEqual([]);
