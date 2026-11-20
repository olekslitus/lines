import { afterEach, expect, test } from "bun:test";
import { type App, clickMod, noErrors, openApp } from "./app";

/*
 * Where a web link opens: in the iPhone, iPad and Android apps over lines, in Safari's view or a
 * Custom Tab (platform.ts), unless Settings → General → Open links says the browser; elsewhere in the
 * browser. The apps are the page here with Tauri's IPC the test's (app.ts), which notes what's asked.
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const PAGE = "https://example.com/page";

type Invoked = { cmd: string; args: Record<string, unknown> }[];

/** What the page has asked the app to open, once it's asked `count` times. */
async function opened(count: number) {
  const found = await app.page.waitForFunction(
    (count) => {
      const asked = (window as unknown as { invoked: Invoked }).invoked.filter(({ cmd }) => cmd === "open_safari_view" || cmd === "plugin:opener|open_url");
      return asked.length >= count && asked;
    },
    count,
  );
  return (await found.jsonValue()) as Invoked;
}

/** Settings → General, on a phone: from the sidebar. */
async function general(app: App) {
  await app.page.getByRole("button", { name: "Show sidebar" }).click();
  await app.page.locator("[data-pane=sidebar]").getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = app.page.getByRole("dialog");
  await dialog.getByRole("navigation").getByText("General", { exact: true }).click();
  return dialog;
}

test("Open links is in Settings → General in the phone apps alone, In Lines at first", async () => {
  app = await openApp({ phone: true, app: true });
  const choice = (await general(app)).getByRole("radiogroup", { name: "Open links", exact: true });
  await choice.waitFor();
  expect(await choice.getByRole("radio", { name: "In Lines", exact: true }).getAttribute("aria-checked")).toBe("true");
  await choice.getByRole("radio", { name: "In your browser", exact: true }).click();
  expect(await app.page.evaluate(() => window.testing.prefs.openLinks)).toBe("browser");
  noErrors(app);
  await app.close();

  // Safari on an iPhone, and a computer, open the browser's way.
  app = await openApp({ phone: true });
  const dialog = await general(app);
  await dialog.getByRole("radiogroup", { name: "New notes go to" }).waitFor();
  expect(await dialog.getByRole("radiogroup", { name: "Open links" }).count()).toBe(0);
  noErrors(app);
  await app.close();

  app = await openApp();
  expect(await (await app.settings("General")).getByRole("radiogroup", { name: "Open links" }).count()).toBe(0);
});

test("in the iPhone app a link in a note opens in Safari's view, in the theme's accent; in the browser as Settings or its menu says", async () => {
  app = await openApp({ phone: true, app: true });
  const { page } = app;
  await app.open(`[A page](${PAGE}) and [mail](mailto:someone@example.com)\n\nEnd`);
  const link = page.locator(".editor-pane .cm-lp-link", { hasText: "A page" });
  const accent = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
    probe.remove();
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  });
  await link.click({ modifiers: [await clickMod(page)] });
  expect(await opened(1)).toEqual([{ cmd: "open_safari_view", args: { url: PAGE, tint: accent, dark: false } }]);

  // Its menu offers the browser too.
  await link.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in Browser" }).click();
  expect((await opened(2))[1]).toEqual({ cmd: "plugin:opener|open_url", args: { url: PAGE } });

  // Mail goes to Mail, as before.
  await page.locator(".editor-pane .cm-lp-link", { hasText: "mail" }).click({ modifiers: [await clickMod(page)] });
  expect((await opened(3))[2]).toEqual({ cmd: "plugin:opener|open_url", args: { url: "mailto:someone@example.com" } });

  // Settings says the browser: links go there, and the menu has no second way.
  await page.evaluate(() => (window.testing.prefs.openLinks = "browser"));
  await link.click({ modifiers: [await clickMod(page)] });
  expect((await opened(4))[3]).toEqual({ cmd: "plugin:opener|open_url", args: { url: PAGE } });
  await link.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open Link" }).waitFor();
  expect(await page.getByRole("menuitem", { name: "Open in Browser" }).count()).toBe(0);
});
