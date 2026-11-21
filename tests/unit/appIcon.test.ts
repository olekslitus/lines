import { describe, expect, test } from "bun:test";
import { iconSvg, iconUrl, LILAC, MARK } from "../../src/lib/appIcon/art";
import { contrast, parse } from "../../src/lib/themes/color";

describe("app icon", () => {
  test("its lines read on both ends of its background, light and dark", () => {
    for (const look of [LILAC.light, LILAC.dark]) {
      for (const bg of look.bg) expect(contrast(parse(look.lines)!, parse(bg)!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("is cut to the edges, rounded, or on the Mac's grid with its shadow", () => {
    expect(iconSvg(LILAC, "light")).toContain('<rect width="1024" height="1024" fill="url(#bg)"/>');
    expect(iconSvg(LILAC, "light", "rounded")).toContain('rx="228"');
    const mac = iconSvg(LILAC, "light", "mac");
    expect(mac).toContain('x="100" y="100" width="824" height="824"');
    expect(mac).toContain("feDropShadow");
  });

  test("draws its light and dark colors, and the dark one in greys for tinting", () => {
    expect(iconSvg(LILAC, "light")).toContain(LILAC.light.lines);
    expect(iconSvg(LILAC, "dark")).toContain(LILAC.dark.lines);
    const tinted = iconSvg(LILAC, "tinted");
    expect(tinted).toContain('<feColorMatrix type="saturate" values="0"/>');
    expect(tinted).toContain(LILAC.dark.bg[0]);
  });

  test("the mark takes the color of what it's in", () => {
    expect(MARK).toContain('stroke="currentColor"');
    expect(MARK).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  test("an address an <img> can show", () => {
    expect(iconUrl(LILAC, "dark").startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(iconUrl(LILAC, "dark"))).toContain(LILAC.dark.lines);
  });
});
