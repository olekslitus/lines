import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import CanvasKitInit from "canvaskit-wasm";
import { favicon, glyph, ICON_IDS, type IconArt, ICONS, iconArt, iconSvg, iconUrl, LILAC, type Look, MARK } from "../../src/lib/appIcon/art";
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

describe("iOS 26's icons and the Mac's (Icon Composer's, from scripts/icons.mjs)", async () => {
  interface Fill {
    solid?: string;
    "linear-gradient"?: string[];
  }
  interface Layer {
    "image-name": string;
    glass: boolean;
    "fill-specializations"?: { appearance?: string; value: Fill }[];
    "hidden-specializations"?: { appearance?: string; value: boolean }[];
  }
  interface IconJson {
    "fill-specializations": { appearance?: string; value: Fill }[];
    groups: { layers: Layer[]; specular: boolean }[];
  }

  const skia = await CanvasKitInit();
  const apple = new URL("../../src-tauri/gen/apple/", import.meta.url);
  const srgb = (hex: string) => `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
  /** The paints art.ts gives the five shapes in `look`: the knot's line, the bullet, its line, the last line, its full stop. */
  const paints = (look: Look) => [...glyph(look).matchAll(/<(?:path|circle) [^>]*?(?:stroke|fill)="(?!none)([^"]+)"/g)].map(([, paint]) => paint);
  // A point on each of the five shapes, and on the knot: its end, the loop's sides and top, where it crosses itself.
  const ON = [[214, 420.8], [229.68, 601.6], [500, 601.6], [300, 782.4], [558, 782.4]];
  const KNOT = [[778, 420.8], [356.11, 288.19], [477.97, 288.19], [417.04, 241.6], [417.04, 393.92]];
  // Inside the loop, and off the lines.
  const OFF = [[417, 300], [417, 270], [417, 200], [600, 470], [800, 601.6]];

  const files = (icon: IconArt) => {
    const dir = new URL(icon === LILAC ? "AppIcon.icon/" : `AlternateIcons/AppIcon-${icon.id}.icon/`, apple);
    const json: IconJson = JSON.parse(readFileSync(new URL("icon.json", dir), "utf8"));
    return { json, svg: (name: string) => readFileSync(new URL(`Assets/${name}`, dir), "utf8") };
  };
  /** Whether `svg`'s paths cover (x, y) under `fill`. */
  const covers = (svg: string, [x, y]: number[], fill = skia.FillType.Winding) =>
    [...svg.matchAll(/<path d="([^"]+)"/g)].some(([, d]) => {
      const path = skia.Path.MakeFromSVGString(d)!;
      path.setFillType(fill);
      const inside = path.contains(x, y);
      path.delete();
      return inside;
    });
  const byAppearance = <T,>(list: { appearance?: string; value: T }[]) => Object.fromEntries(list.map(({ appearance = "light", value }) => [appearance, value]));

  for (const icon of ICONS) {
    describe(icon.id, () => {
      const { json, svg } = files(icon);
      const [lines, ...backgrounds] = json.groups;
      const colored = lines.layers.filter((layer) => layer["fill-specializations"]);

      test("draws its lines from vectors with no strokes, as glass without the specular highlight that blurs them", () => {
        expect(json.groups.every((group) => group.specular === false)).toBe(true);
        for (const layer of json.groups.flatMap((group) => group.layers)) {
          expect(layer["image-name"]).toEndWith(".svg");
          // Icon Composer fills a stroke's path, which closes the loop.
          expect(svg(layer["image-name"])).not.toContain("stroke");
        }
        expect(colored.every((layer) => layer.glass)).toBe(true);
      });

      test("covers the lines, the knot's loop open, under either fill rule", () => {
        for (const fill of [skia.FillType.Winding, skia.FillType.EvenOdd]) {
          for (const point of [...ON, ...KNOT]) expect(colored.filter((layer) => covers(svg(layer["image-name"]), point, fill))).toHaveLength(1);
          for (const layer of lines.layers) for (const point of OFF) expect(covers(svg(layer["image-name"]), point, fill)).toBe(false);
        }
      });

      test("draws each line in its colors, light and dark, and in greys when tinted, the lightest white", () => {
        const tints: number[] = [];
        for (const [i, point] of ON.entries()) {
          const layer = colored.find((each) => covers(svg(each["image-name"]), point))!;
          const fills = byAppearance(layer["fill-specializations"]!);
          for (const appearance of ["light", "dark"] as const) {
            const look = icon[appearance];
            const paint = icon.glass ? look.rim! : paints(look)[i];
            if (paint === "url(#along)") expect(fills[appearance]["linear-gradient"]).toEqual(look.along!.map(srgb));
            else expect(fills[appearance].solid).toBe(srgb(paint));
          }
          for (const grey of fills.tinted.solid ? [fills.tinted.solid] : fills.tinted["linear-gradient"]!) {
            const [r, g, b] = grey.slice(5).split(",").map(Number);
            expect(r).toBe(g);
            expect(g).toBe(b);
            tints.push(r);
          }
        }
        expect(Math.max(...tints)).toBe(1);
      });

      test("has the background art.ts draws: its gradient, a layer where a fill can't draw it", () => {
        const fills = byAppearance(json["fill-specializations"]);
        for (const appearance of ["light", "dark"] as const) {
          const { bg, diagonal } = icon[appearance];
          expect(fills[appearance]["linear-gradient"]).toEqual([bg[0], bg.at(-1)!].map(srgb));
          const layer = backgrounds.flatMap((group) => group.layers).find((each) => each["image-name"] === `background-${appearance}.svg`);
          // A fill takes two colors, top to bottom.
          expect(Boolean(layer)).toBe(bg.length > 2 || Boolean(diagonal));
          if (!layer) continue;
          const drawn = svg(layer["image-name"]);
          for (const color of bg) expect(drawn).toContain(`stop-color="${color}"`);
          expect(drawn).toContain(diagonal ? 'x2="1" y2="1"' : 'x2="0" y2="1"');
          const hidden = byAppearance(layer["hidden-specializations"]!);
          expect([hidden.light, hidden.dark, hidden.tinted]).toEqual([appearance !== "light", appearance !== "dark", true]);
        }
      });
    });
  }

  test("the Xcode project has each of the others, for Settings → Theme → App Icon to switch to", () => {
    const project = readFileSync(new URL("lines.xcodeproj/project.pbxproj", apple), "utf8");
    expect(readFileSync(new URL("project.yml", apple), "utf8")).toContain("- path: AlternateIcons\n        buildPhase: resources");
    expect(project).toContain("path = AlternateIcons;");
    const others = ICONS.filter((icon) => icon !== LILAC);
    expect(readdirSync(new URL("AlternateIcons/", apple)).sort()).toEqual(others.map((icon) => `AppIcon-${icon.id}.icon`).sort());
    for (const { id } of others) {
      expect(project.match(new RegExp(`/\\* AppIcon-${id}\\.icon in Resources \\*/`, "g"))).toHaveLength(2);
      expect(project).toContain(`/* AppIcon-${id}.icon */ = {isa = PBXFileReference; lastKnownFileType = wrapper.icon; path = "AppIcon-${id}.icon";`);
    }
  });
});
