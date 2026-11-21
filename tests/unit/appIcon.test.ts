import { describe, expect, test } from "bun:test";
import { favicon, ICON_IDS, ICONS, iconArt, iconSvg, iconUrl, LILAC, type Look, MARK } from "../../src/lib/appIcon/art";
import { contrast, parse } from "../../src/lib/themes/color";

/** Every color a look's lines are drawn in. */
const lineColors = (look: Look) => [...[look.lines].flat(), ...(look.dots ? [look.dots] : []), ...(look.knot ? [look.knot] : []), ...(look.along ?? [])];

describe("app icon", () => {
  test("Lines' own is first, and every icon has an id of its own", () => {
    expect(ICONS[0]).toBe(LILAC);
    expect(LILAC.id).toBe("lilac");
    expect(ICONS).toHaveLength(21);
    expect(new Set(ICON_IDS).size).toBe(ICONS.length);
    for (const id of ICON_IDS) expect(id).toMatch(/^[a-z]+$/);
  });

  test("an id it doesn't know is Lines' own", () => {
    expect(iconArt("sea").id).toBe("sea");
    expect(iconArt("nonesuch")).toBe(LILAC);
    expect(iconArt("")).toBe(LILAC);
  });

  test("Lines' own lines read as text would, on both ends of its background, light and dark", () => {
    for (const look of [LILAC.light, LILAC.dark]) {
      for (const bg of look.bg) expect(contrast(parse(look.lines as string)!, parse(bg)!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("every icon's lines stand out from its background as a graphic should, at 3:1", () => {
    for (const icon of ICONS) {
      for (const look of [icon.light, icon.dark]) {
        for (const line of lineColors(look)) for (const bg of look.bg) expect(contrast(parse(line)!, parse(bg)!)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("is cut to the edges, rounded, or on the Mac's grid with its shadow", () => {
    expect(iconSvg(LILAC, "light")).toContain('<rect width="1024" height="1024" fill="url(#bg)"/>');
    expect(iconSvg(LILAC, "light", "rounded")).toContain('rx="228"');
    const mac = iconSvg(LILAC, "light", "mac");
    expect(mac).toContain('x="100" y="100" width="824" height="824"');
    expect(mac).toContain("feDropShadow");
    expect(iconSvg(LILAC, "light", "bleed", { background: false })).not.toContain("<rect");
  });

  test("draws its light and dark colors, and the dark one in greys for tinting", () => {
    expect(iconSvg(LILAC, "light")).toContain(LILAC.light.lines as string);
    expect(iconSvg(LILAC, "dark")).toContain(LILAC.dark.lines as string);
    const tinted = iconSvg(LILAC, "tinted");
    expect(tinted).toContain('<feColorMatrix type="saturate" values="0"/>');
    expect(tinted).toContain(LILAC.dark.bg[0]);
  });

  test("draws each line in its own color, a gradient along them, or glass", () => {
    const warm = iconArt("warm");
    for (const color of warm.light.lines) expect(iconSvg(warm, "light")).toContain(color);
    expect(iconSvg(iconArt("ember"), "light")).toContain('stroke="url(#along)"');
    expect(iconSvg(iconArt("aurora"), "light")).toContain('x2="1" y2="1"');
    expect(iconSvg(iconArt("glass"), "light")).toContain('mask="url(#inside)"');
    // Small, the lines are the mark's, and glass is drawn plain.
    expect(iconSvg(iconArt("glass"), "light", "mac", { small: true })).not.toContain("url(#inside)");
  });

  test("the mark takes the color of what it's in", () => {
    expect(MARK).toContain('stroke="currentColor"');
    expect(MARK).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  test("the favicon follows the browser's light or dark where an icon has a color for each, and keeps several colors as they are", () => {
    const own = favicon(LILAC);
    expect(own).toContain(`svg{color:${LILAC.light.lines}}`);
    expect(own).toContain(`@media (prefers-color-scheme:dark){svg{color:${LILAC.dark.lines}}}`);
    const coral = favicon(iconArt("coral"));
    expect(coral).not.toContain("prefers-color-scheme");
    expect(coral).toContain("#ff6f59");
    expect(favicon(iconArt("ember"))).toContain('id="alongMark"');
  });

  test("an address an <img> can show", () => {
    expect(iconUrl(LILAC, "dark").startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(iconUrl(LILAC, "dark"))).toContain(LILAC.dark.lines as string);
  });
});
