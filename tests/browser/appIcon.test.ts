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
