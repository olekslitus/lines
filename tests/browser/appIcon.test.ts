import { afterEach, describe, expect, test } from "bun:test";
import { type App, noErrors, openApp } from "./app";

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

/** The page's favicons: each link's type and address. */
const favicons = (page: App["page"]) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((link) => ({ type: link.type, href: link.href })));

describe("app icon", () => {
  test("Settings → Theme lists every icon, Lines' own chosen, as a radio group", async () => {
    app = await openApp();
    const settings = await app.settings("Theme");
    const group = settings.getByRole("radiogroup", { name: "App Icon", exact: true });
    const icons = group.getByRole("radio");
    expect(await icons.count()).toBe(21);
    expect(await group.getByRole("radio", { name: "Lilac (Default)", exact: true }).getAttribute("aria-checked")).toBe("true");
    // The arrow keys go from one to the next, choosing it, as in any radio group.
    await group.getByRole("radio", { name: "Lilac (Default)", exact: true }).focus();
    await app.page.keyboard.press("ArrowRight");
    expect(await group.getByRole("radio", { name: "Oat", exact: true }).getAttribute("aria-checked")).toBe("true");
  });

  test("choosing one keeps it and shows it as the tab's icon; Lines' own puts the page's back", async () => {
    app = await openApp();
    const own = await favicons(app.page);
    const settings = await app.settings("Theme");
    const group = settings.getByRole("radiogroup", { name: "App Icon", exact: true });
    await group.getByRole("radio", { name: "Sea", exact: true }).click();
    await app.page.waitForFunction(() => document.querySelector('link[data-app-icon="sea"]'));
    const shown = await favicons(app.page);
    expect(shown).toHaveLength(1);
    expect(decodeURIComponent(shown[0].href)).toContain("#f3f7f5");
    expect(await app.page.evaluate(() => JSON.parse(localStorage.getItem("lines.prefs") ?? "{}").appIcon)).toBe("sea");

    await app.page.reload();
    await app.page.waitForFunction(() => document.querySelector('link[data-app-icon="sea"]'));

    const again = await app.settings("Theme");
    await again.getByRole("radiogroup", { name: "App Icon", exact: true }).getByRole("radio", { name: "Lilac (Default)", exact: true }).click();
    await app.page.waitForFunction(() => !document.querySelector("link[data-app-icon]"));
    expect(await favicons(app.page)).toEqual(own);
  });

  test("an icon Lines doesn't know is taken as its own", async () => {
    app = await openApp({ prefs: { appIcon: "nonesuch" } });
    const settings = await app.settings("Theme");
    expect(await settings.getByRole("radio", { name: "Lilac (Default)", exact: true }).getAttribute("aria-checked")).toBe("true");
    expect(await app.page.locator("link[data-app-icon]").count()).toBe(0);
  });
});

describe("app icon, in the phone apps", () => {
  type Invoked = { cmd: string; args: { alternate: string | null; picture: unknown; size: number } }[];
  /** The App Icon choices, in Settings → Theme reached from the sidebar, as on a phone. */
  async function icons() {
    await app.page.getByRole("button", { name: "Show sidebar" }).click();
    await app.page.locator("[data-pane=sidebar]").getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = app.page.getByRole("dialog");
    await dialog.getByRole("navigation").getByText("Theme", { exact: true }).click();
    return dialog.getByRole("radiogroup", { name: "App Icon", exact: true });
  }

  test("on an iPhone, the alternate icon of its name is set, and none for Lines' own", async () => {
    app = await openApp({ phone: true, app: true });
    const { page } = app;
    const asked = () => page.evaluate(() => (window as unknown as { invoked: Invoked }).invoked.filter(({ cmd }) => cmd === "set_app_icon").map(({ args }) => args));
    const group = await icons();
    await group.getByRole("radio", { name: "Sea", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { invoked: Invoked }).invoked.some(({ cmd, args }) => cmd === "set_app_icon" && args.alternate === "AppIcon-sea"));
    // Not the tab's: there's no tab.
    expect(await page.locator("link[data-app-icon]").count()).toBe(0);
    await group.getByRole("radio", { name: "Lilac (Default)", exact: true }).click();
    await page.waitForFunction(() => {
      const calls = (window as unknown as { invoked: Invoked }).invoked.filter(({ cmd }) => cmd === "set_app_icon");
      return calls[calls.length - 1].args.alternate === null;
    });
    expect((await asked()).slice(-2)).toEqual([
      { alternate: "AppIcon-sea", picture: null, size: 0 },
      { alternate: null, picture: null, size: 0 },
    ]);
    // Settings → Theme shows the SF Symbols icon set, which only the app itself serves (sfsymbol://).
    const ours = app.errors.filter((error) => !error.includes("sfsymbol://") && !error.startsWith("Failed to load resource"));
    app.errors.splice(0, app.errors.length, ...ours);
  });

  test("on Android, the launcher's is set by the icon's id, Lines' own too", async () => {
    app = await openApp({ device: "Pixel 7", app: true });
    const { page } = app;
    // The app's bridge to the launcher's icons (MainActivity.kt).
    await page.evaluate(() => {
      const set: string[] = [];
      Object.assign(window, { set, linesAppIcon: { set: (id: string) => set.push(id) } });
    });
    const set = () => page.evaluate(() => (window as unknown as { set: string[] }).set);
    const group = await icons();
    await group.getByRole("radio", { name: "Sea", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { set: string[] }).set.length === 1);
    await group.getByRole("radio", { name: "Lilac (Default)", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { set: string[] }).set.length === 2);
    expect(await set()).toEqual(["sea", "lilac"]);
    expect(await page.evaluate(() => (window as unknown as { invoked: Invoked }).invoked.some(({ cmd }) => cmd === "set_app_icon"))).toBe(false);
  });
});
