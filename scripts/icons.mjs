// Makes every platform's app icon from Lines' icons (src/lib/appIcon/art.ts), drawn by headless
// Chromium. Run with `bun run icons` after changing one, and commit what it writes:
//
//   src-tauri/icons/                 the desktop apps': the Mac's .icns (on Apple's grid, with its
//                                    shadow), and for macOS 26 Assets.car from AppIcon.icon below;
//                                    Windows' .ico and tiles, Linux's PNGs (`tauri icon`)
//   src-tauri/icons/source/          Lines' own icon's SVGs, as drawn: full bleed, the Mac's, dark, tinted
//   src-tauri/gen/apple/             iOS and iPadOS: each icon as an Icon Composer file, light, dark
//                                    and tinted, for iOS 26's Liquid Glass and the pictures earlier
//                                    versions show: Lines' own AppIcon.icon, the others alternates in
//                                    AlternateIcons/, which the Xcode project lists
//   src-tauri/gen/android/…/res/     Android: an adaptive icon for each (the lines over a gradient,
//                                    and alone for themed icons), and PNGs for Android 7; the
//                                    manifest's activity alias for each
//   public/                          the web app's and the website's: favicons, the touch icon,
//                                    the manifest's icons
//
// The desktop apps and the web app show the other icons from art.ts as they run (appIcon/show.svelte.ts).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { chromium } from "playwright";
import { ALONG, favicon, GLASS, glyph, gradient as backgroundGradient, ICONS, iconSvg, LILAC, MARK } from "../src/lib/appIcon/art.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const icons = join(root, "src-tauri/icons");
const apple = join(root, "src-tauri/gen/apple");
const android = join(root, "src-tauri/gen/android/app/src/main");
const res = join(android, "res");
const pub = join(root, "public");
const art = LILAC;
const others = ICONS.filter((icon) => icon !== LILAC);

const browser = await chromium.launch();
const page = await browser.newPage();

/** `svg` drawn at size×size, as a PNG; `clip` cuts it to a circle or a rounded square first. */
async function png(svg, size, clip = "none") {
  const radius = { none: "0", circle: "50%", rounded: "22.37%" }[clip];
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0"><img style="display:block;width:${size}px;height:${size}px;border-radius:${radius}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body>`,
  );
  await page.waitForLoadState("load");
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An .ico holding each of `pictures` (PNGs, by size). */
function ico(pictures) {
  const header = Buffer.alloc(6 + 16 * pictures.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pictures.length, 4);
  let at = header.length;
  pictures.forEach(([size, data], i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(at, entry + 12);
    at += data.length;
  });
  return Buffer.concat([header, ...pictures.map(([, data]) => data)]);
}

const light = iconSvg(art, "light");
const dark = iconSvg(art, "dark");
const tinted = iconSvg(art, "tinted");
const mac = iconSvg(art, "light", "mac");
const rounded = iconSvg(art, "light", "rounded");

// The SVGs, for looking at and for other tools.
const generated = "<!-- Made by scripts/icons.mjs from src/lib/appIcon/art.ts: change it there. -->\n";
const source = join(icons, "source");
rmSync(source, { recursive: true, force: true });
mkdirSync(source);
for (const [name, svg] of Object.entries({ "icon-square": light, "icon-dark": dark, "icon-tinted": tinted, "icon-mac": mac, mark: MARK })) {
  writeFileSync(join(source, `${name}.svg`), generated + svg + "\n");
}

// The desktop apps': `tauri icon` from the Mac's, as before (its iOS and Android icons are made
// below instead). Then the .icns and .ico again, their sizes under 32 pixels drawn with the mark's
// heavier lines, which the full ones are too thin to show at.
const scratch = mkdtempSync(join(tmpdir(), "lines-icons-"));
writeFileSync(join(scratch, "icon.png"), await png(mac, 1024));
execFileSync("bun", ["tauri", "icon", join(scratch, "icon.png"), "-o", join(scratch, "out")], { cwd: root, stdio: "ignore" });
for (const name of readdirSync(join(scratch, "out"))) {
  if (/\.(png|icns|ico)$/.test(name)) cpSync(join(scratch, "out", name), join(icons, name));
}
const macSmall = iconSvg(art, "light", "mac", { small: true });
const iconset = join(scratch, "icon.iconset");
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${size}x${size}.png`), await png(size <= 24 ? macSmall : mac, size));
  writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), await png(mac, size * 2));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(icons, "icon.icns")]);
const windows = [];
for (const size of [16, 24, 32, 48, 64, 256]) windows.push([size, await png(size <= 24 ? macSmall : mac, size)]);
writeFileSync(join(icons, "icon.ico"), ico(windows));
rmSync(scratch, { recursive: true });
rmSync(join(icons, "ios"), { recursive: true, force: true });
rmSync(join(icons, "android"), { recursive: true, force: true });

// iOS and iPadOS: each icon as an Icon Composer file, its layers vectors, which iOS 26 draws in
// Liquid Glass, sharp at every size, and colors itself when tinted or clear; Xcode draws the
// pictures earlier versions show from it too (an app icon set of the same name would go unused).
// Lines' own is AppIcon.icon; the others are AlternateIcons/AppIcon-<id>.icon, which the app
// switches to (src-tauri/src/app_icon.rs; ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS).
const skia = await CanvasKitInit();

/** The lines' five shapes as art.ts draws them in `look`: the knot's line, the bullet, its line, the last line, its full stop. */
function shapes(look) {
  return [...glyph(look).matchAll(/<(path|circle) ([^>]*)\/>/g)].map(([, tag, attrs]) => {
    const get = (name) => attrs.match(new RegExp(`(?:^| )${name}="([^"]+)"`))?.[1];
    return tag === "circle"
      ? { circle: ["cx", "cy", "r"].map((name) => Number(get(name))), paint: get("fill") }
      : { d: get("d"), width: Number(get("stroke-width")), paint: get("stroke") };
  });
}
const SHAPES = shapes("#000000");

/**
 * What `list` covers, as one Skia path: each line stroked with the round caps and joins art.ts
 * draws and the dots as circles, grown by `by` on every side (shrunk when it's less than 0) and
 * moved by `dx`, `dy`, united, so the knot's crossing is one shape around its loop.
 */
function cover(list, by = 0, dx = 0, dy = 0) {
  return list
    .map(({ d, width, circle }) => {
      if (circle) return new skia.PathBuilder().addCircle(circle[0] + dx, circle[1] + dy, circle[2] + by).snapshot();
      const line = new skia.PathBuilder().addPath(skia.Path.MakeFromSVGString(d)).offset(dx, dy).snapshot();
      return line.makeStroked({ width: width + 2 * by, cap: skia.StrokeCap.Round, join: skia.StrokeJoin.Round });
    })
    .reduce((all, shape) => skia.Path.MakeFromOp(all, shape, skia.PathOp.Union), new skia.Path());
}

const ARGUMENTS = { [skia.MOVE_VERB]: 2, [skia.LINE_VERB]: 2, [skia.QUAD_VERB]: 4, [skia.CONIC_VERB]: 5, [skia.CUBIC_VERB]: 6, [skia.CLOSE_VERB]: 0 };
const BINOMIALS = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1]];

/** `path`'s outlines, each a start and its segments (a verb, its points after the start, a conic's weight). */
function contours(path) {
  const commands = [...path.toCmds()];
  const list = [];
  for (let i = 0; i < commands.length; i += 1 + ARGUMENTS[commands[i]]) {
    const [verb, ...args] = commands.slice(i, i + 1 + ARGUMENTS[commands[i]]);
    if (verb === skia.MOVE_VERB) list.push({ start: args, segments: [] });
    else if (verb === skia.CONIC_VERB) list.at(-1).segments.push({ verb, points: args.slice(0, 4), weight: args[4] });
    else if (verb !== skia.CLOSE_VERB) list.at(-1).segments.push({ verb, points: args, weight: 1 });
  }
  return list;
}

/** A contour as a polygon through eight points on each of its curves. */
function polygon({ start, segments }) {
  const points = [];
  let from = start;
  for (const { points: to, weight } of segments) {
    const controls = [from, ...Array.from({ length: to.length / 2 }, (_, i) => to.slice(2 * i, 2 * i + 2))];
    const weights = controls.map((_, i) => (i === 0 || i === controls.length - 1 ? 1 : weight));
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      const terms = controls.map((_, i) => BINOMIALS[controls.length - 1][i] * t ** i * (1 - t) ** (controls.length - 1 - i) * weights[i]);
      const sum = terms.reduce((a, b) => a + b);
      points.push([0, 1].map((axis) => controls.reduce((a, point, i) => a + terms[i] * point[axis], 0) / sum));
    }
    from = to.slice(-2);
  }
  return points;
}
const area = (points) => points.reduce((sum, [x, y], i) => sum + x * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * y, 0);
const encloses = (points, [x, y]) =>
  points.reduce((inside, [x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    return y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1) ? !inside : inside;
  }, false);

/** A contour drawn the other way round. */
function reversed({ start, segments }) {
  const ends = [start, ...segments.map(({ points }) => points.slice(-2))];
  return {
    start: ends.at(-1),
    segments: segments
      .map((segment, i) => {
        const controls = Array.from({ length: segment.points.length / 2 - 1 }, (_, k) => segment.points.slice(2 * k, 2 * k + 2)).reverse();
        return { ...segment, points: [...controls.flat(), ...ends[i]] };
      })
      .reverse(),
  };
}

/**
 * `path` as SVG path data that fills the same under either fill rule (Icon Composer fills a layer's
 * paths, and a stroke's path too, closing the knot's loop): Skia's path operations leave outlines that
 * don't cross, and each is wound by how many others it's inside, one way for an outline and the
 * other for a hole, the loop.
 */
function pathData(path) {
  const outlines = contours(path);
  const polygons = outlines.map(polygon);
  const commands = outlines.flatMap((outline, i) => {
    const depth = polygons.filter((other, j) => j !== i && encloses(other, polygons[i][0])).length;
    const { start, segments } = area(polygons[i]) > 0 === (depth % 2 === 0) ? outline : reversed(outline);
    return [skia.MOVE_VERB, ...start, ...segments.flatMap(({ verb, points, weight }) => [verb, ...points, ...(verb === skia.CONIC_VERB ? [weight] : [])]), skia.CLOSE_VERB];
  });
  return skia.Path.MakeFromCmds(commands).toSVGString().replace(/-?\d+\.\d+/g, (n) => String(+Number(n).toFixed(2)));
}

/**
 * Inside glass lines, art.ts's glass (GLASS) as vectors: a core, an inner light, a lit edge and a
 * sheen, each blur drawn as four outlines a little apart, whose opacities add up to the blur's.
 */
function glassShading(look) {
  const blurred = ({ erode, blur, opacity, dx = 0, dy = 0 }, color) =>
    [-0.9, -0.3, 0.3, 0.9]
      .map((t) => `<path d="${pathData(cover(SHAPES, t * blur - erode, dx, dy))}" fill="${color}" fill-opacity="${+(1 - (1 - opacity) ** (1 / 4)).toFixed(3)}"/>`)
      .join("");
  const edge = skia.Path.MakeFromOp(cover(SHAPES), cover(SHAPES, -GLASS.edge.width), skia.PathOp.Difference);
  return (
    `<defs><linearGradient id="lit" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">${GLASS.lit}</linearGradient></defs>` +
    blurred(GLASS.core, look.lines) +
    blurred(GLASS.inner, look.inner) +
    `<path d="${pathData(edge)}" fill="url(#lit)" fill-opacity="${GLASS.edge.opacity}"/>` +
    blurred(GLASS.sheen, "#ffffff")
  );
}

/** A color as Icon Composer writes one. */
const srgb = (hex) => `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
/** How light a color is, as art.ts greys an icon for tinting. */
const luma = (hex) => [0.2126, 0.7152, 0.0722].reduce((sum, k, i) => sum + (k * parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) / 255, 0);
const down = { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } };

/**
 * A layer's fill for `paint` in `look`: its color, or the gradient along the lines, whose ends
 * Icon Composer puts at the edges of the layer's `bounds`. With `brightest`, in greys, as light
 * beside it as art.ts's tinted icon has them: what iOS colors when it tints the icon.
 */
function fill(paint, look, [left, , right], brightest) {
  const color = (hex) => (brightest ? srgb(`#${Math.round((255 * luma(hex)) / brightest).toString(16).padStart(2, "0").repeat(3)}`) : srgb(hex));
  if (paint !== "url(#along)") return { solid: color(paint) };
  const at = (x) => ({ x: +((x - left) / (right - left)).toFixed(4), y: 0.5 });
  return { "linear-gradient": look.along.map(color), orientation: { start: at(ALONG[0]), stop: at(ALONG[1]) } };
}

/** A layer seen only in `appearance` (light or dark), never tinted. */
const onlyIn = (appearance) => [{ value: appearance !== "light" }, { appearance: "dark", value: appearance !== "dark" }, { appearance: "tinted", value: true }];

/**
 * `icon` as an Icon Composer file at `dir`. Its background is the file's fill, the gradient art.ts
 * draws, or for one a fill can't draw (three colors, or corner to corner: a fill takes two, top to
 * bottom) a layer of its own over it, seen only in its appearance. The lines are a layer for
 * each color they have (each line its own, or the dots theirs), outlines filled, glass without the
 * specular highlight, which blurs lines this thin at home screen sizes; glass lines have their
 * shading over them.
 */
function composerIcon(icon, dir) {
  const assets = join(dir, "Assets");
  mkdirSync(assets, { recursive: true });
  const svg = (name, body) => writeFileSync(join(assets, name), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${body}</svg>\n`);
  const [light, dark] = [shapes(icon.light), shapes(icon.dark)];
  const brightest = Math.max(...dark.flatMap(({ paint }) => (paint === "url(#along)" ? icon.dark.along : [paint])).map(luma));
  const colors = [...Map.groupBy(SHAPES.keys(), (i) => `${light[i].paint} ${dark[i].paint}`).values()];
  const layers = colors.map((indices, n) => {
    const name = colors.length === 1 ? "lines" : `lines-${n + 1}`;
    const shape = cover(indices.map((i) => SHAPES[i]));
    svg(`${name}.svg`, `<path d="${pathData(shape)}" fill="#000000"/>`);
    const bounds = shape.computeTightBounds();
    const [paint, darkPaint] = [light[indices[0]].paint, dark[indices[0]].paint];
    const fills = icon.glass
      ? [{ solid: srgb(icon.light.rim) }, { solid: srgb(icon.dark.rim) }]
      : [fill(paint, icon.light, bounds), fill(darkPaint, icon.dark, bounds)];
    return {
      "image-name": `${name}.svg`,
      name,
      glass: true,
      // A glass rim is a little see-through, but not when tinted, which is white glass already.
      ...(icon.glass ? { "opacity-specializations": [{ value: GLASS.rim }, { appearance: "tinted", value: 1 }] } : {}),
      "fill-specializations": [
        { value: fills[0] },
        { appearance: "dark", value: fills[1] },
        { appearance: "tinted", value: fill(darkPaint, icon.dark, bounds, brightest) },
      ],
    };
  });
  if (icon.glass) {
    for (const appearance of ["dark", "light"]) {
      svg(`shading-${appearance}.svg`, glassShading(icon[appearance]));
      layers.unshift({ "image-name": `shading-${appearance}.svg`, name: `shading (${appearance})`, glass: false, "hidden-specializations": onlyIn(appearance) });
    }
  }
  const backgrounds = ["light", "dark"]
    .filter((appearance) => icon[appearance].bg.length > 2 || icon[appearance].diagonal)
    .map((appearance) => {
      svg(`background-${appearance}.svg`, `<defs>${backgroundGradient(icon[appearance])}</defs><rect width="1024" height="1024" fill="url(#bg)"/>`);
      return { "image-name": `background-${appearance}.svg`, name: `background (${appearance})`, glass: false, "hidden-specializations": onlyIn(appearance) };
    });
  const background = ({ bg }) => ({ "linear-gradient": [bg[0], bg.at(-1)].map(srgb), orientation: down });
  const flat = { specular: false, translucency: { enabled: false, value: 0.5 } };
  const iconJson = {
    "fill-specializations": [{ value: background(icon.light) }, { appearance: "dark", value: background(icon.dark) }],
    groups: [
      { layers, shadow: { kind: "neutral", opacity: 0.5 }, ...flat },
      ...(backgrounds.length ? [{ layers: backgrounds, shadow: { kind: "none", opacity: 0 }, ...flat }] : []),
    ],
    "supported-platforms": { squares: "shared" },
  };
  writeFileSync(join(dir, "icon.json"), JSON.stringify(iconJson, null, 2) + "\n");
}

const composer = join(apple, "AppIcon.icon");
const alternates = join(apple, "AlternateIcons");
/** Every file in `dir` and what it holds, to tell whether Lines' own icon has changed. */
const contents = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).sort().map((name) => [name, statSync(join(dir, name)).isFile() && readFileSync(join(dir, name), "utf8")]) : []);
const before = JSON.stringify(contents(composer));
for (const dir of [composer, alternates]) rmSync(dir, { recursive: true, force: true });
for (const icon of ICONS) composerIcon(icon, icon === LILAC ? composer : join(alternates, `AppIcon-${icon.id}.icon`));

// Xcode: each alternate among the app's resources, as project.yml's AlternateIcons has them, under
// ids made from their names, so the project changes only as ICONS does.
const pbxproj = join(apple, "lines.xcodeproj/project.pbxproj");
const uid = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24).toUpperCase();
const entries = (line) => others.map((icon) => line(`AppIcon-${icon.id}.icon`)).join("");
const project = readFileSync(pbxproj, "utf8")
  .replace(/^.*AppIcon-[a-z]+\.icon.*\n/gm, "")
  .replace(/^.*\/\* AppIcon\.icon in Resources \*\/ = \{isa = PBXBuildFile.*\n/m, (line) =>
    line + entries((name) => `\t\t${uid(`${name} in Resources`)} /* ${name} in Resources */ = {isa = PBXBuildFile; fileRef = ${uid(name)} /* ${name} */; };\n`))
  .replace(/^.*\/\* AppIcon\.icon \*\/ = \{isa = PBXFileReference.*\n/m, (line) =>
    line + entries((name) => `\t\t${uid(name)} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = wrapper.icon; path = "${name}"; sourceTree = "<group>"; };\n`))
  .replace(/\/\* AlternateIcons \*\/ = \{\n\t+isa = PBXGroup;\n\t+children = \(\n/, (start) => start + entries((name) => `\t\t\t\t${uid(name)} /* ${name} */,\n`))
  .replace(/^\t+\w+ \/\* AppIcon\.icon in Resources \*\/,\n/m, (line) => line + entries((name) => `\t\t\t\t${uid(`${name} in Resources`)} /* ${name} in Resources */,\n`));
writeFileSync(pbxproj, project);

// macOS 26: the same, compiled into the asset catalog the Mac bundle takes as it is
// (tauri.conf.json), with the arguments Tauri's bundler gives actool. Made here rather than by each
// build, whose actool fails when Xcode's ibtoold is left in a bad state, and which needs Xcode 26.
// Only when the icon has changed: actool's catalog differs each time, by the time and ids in it.
const car = join(icons, "Assets.car");
if (JSON.stringify(contents(composer)) !== before || !existsSync(car)) {
  const compiled = mkdtempSync(join(tmpdir(), "lines-car-"));
  const actool = () =>
    execFileSync("xcrun", ["actool", composer, "--compile", compiled, "--output-format", "human-readable-text", "--errors",
      "--output-partial-info-plist", join(compiled, "info.plist"), "--app-icon", "AppIcon", "--include-all-app-icons",
      "--enable-on-demand-resources", "NO", "--development-region", "en", "--target-device", "mac",
      "--minimum-deployment-target", "26.0", "--platform", "macosx"], { encoding: "utf8" });
  if (/error:/.test(actool())) {
    execFileSync("pkill", ["-f", "ibtoold"]);
    const errors = actool();
    if (/error:/.test(errors)) throw new Error(`actool couldn't compile ${composer}:\n${errors}`);
  }
  cpSync(join(compiled, "Assets.car"), car);
  rmSync(compiled, { recursive: true });
}

// Android 8 and later: an adaptive icon for each, its layers drawn as vectors (a glass one's lines
// as a picture). The icon's 1024 is the 72 dp the launcher shows of the 108, so the lines keep
// inside the 66 dp every mask leaves. Lines' own is ic_launcher, the others ic_launcher_<id>.
const at = (x) => +(18 + (x * 72) / 1024).toFixed(3);
const vector = (body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!-- Made by scripts/icons.mjs. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n  ${body}\n</vector>\n`;
/** A gradient for a vector's `attribute` (its fill or stroke), from (x1, y1) to (x2, y2), through `colors`. */
const gradient = (attribute, [x1, y1, x2, y2], colors) =>
  `\n    <aapt:attr name="android:${attribute}">\n      <gradient android:type="linear" android:startX="${x1}" android:startY="${y1}" android:endX="${x2}" android:endY="${y2}">${colors
    .map((color, i) => `\n        <item android:offset="${i / (colors.length - 1)}" android:color="${color}"/>`)
    .join("")}\n      </gradient>\n    </aapt:attr>\n  `;
/** The lines as a vector's paths, in their colors (`along`: the look's gradient along them). */
function vectorLines(look) {
  return shapes(look)
    .map(({ d, width, circle, paint }) => {
      if (circle) {
        const [cx, cy, r] = circle;
        const [x, y, rr] = [at(cx - r), at(cy), +((r * 72) / 1024).toFixed(3)];
        return `<path android:fillColor="${paint}" android:pathData="M${x},${y} a${rr},${rr} 0 1,0 ${2 * rr},0 a${rr},${rr} 0 1,0 ${-2 * rr},0z"/>`;
      }
      const data = d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `${at(Number(x))},${at(Number(y))}`);
      const common = `android:strokeWidth="${+((width * 72) / 1024).toFixed(3)}" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${data}"`;
      if (!paint.startsWith("url(")) return `<path android:strokeColor="${paint}" ${common}/>`;
      return `<path ${common}>${gradient("strokeColor", [at(ALONG[0]), 0, at(ALONG[1]), 0], look.along)}</path>`;
    })
    .join("\n  ");
}
const drawable = join(res, "drawable");
const glassy = join(res, "drawable-xxxhdpi");
const anydpi = join(res, "mipmap-anydpi-v26");
for (const dir of [drawable, glassy, anydpi]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
}
rmSync(join(res, "values/ic_launcher_background.xml"), { force: true });
writeFileSync(join(drawable, "ic_launcher_monochrome.xml"), vector(vectorLines("#FFFFFFFF")));
for (const icon of ICONS) {
  const name = icon === LILAC ? "ic_launcher" : `ic_launcher_${icon.id}`;
  const { bg, diagonal } = icon.light;
  const ends = diagonal ? [18, 18, 90, 90] : [54, 18, 54, 90];
  writeFileSync(join(drawable, `${name}_background.xml`), vector(`<path android:pathData="M0,0h108v108h-108z">${gradient("fillColor", ends, bg)}</path>`));
  if (icon.glass) {
    // Its 1024 at the middle 72 dp of the 108, at 4× (xxxhdpi), which the launcher scales.
    const inner = iconSvg(icon, "light", "bleed", { background: false }).replace("<svg ", '<svg x="256" y="256" width="1024" height="1024" ');
    writeFileSync(join(glassy, `${name}_foreground.png`), await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1536">${inner}</svg>`, 432));
  } else {
    writeFileSync(join(drawable, `${name}_foreground.xml`), vector(vectorLines(icon.light)));
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@drawable/${name}_background"/>\n  <foreground android:drawable="@drawable/${name}_foreground"/>\n  <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n</adaptive-icon>\n`;
  writeFileSync(join(anydpi, `${name}.xml`), adaptive);
  if (icon === LILAC) writeFileSync(join(anydpi, `${name}_round.xml`), adaptive);
}
// Android 7: a 48 dp picture, square and round, for Lines' own; one at 4× for the others.
for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  const dir = join(res, `mipmap-${density}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  writeFileSync(join(dir, "ic_launcher.png"), await png(light, 48 * scale, "rounded"));
  writeFileSync(join(dir, "ic_launcher_round.png"), await png(light, 48 * scale, "circle"));
}
for (const icon of others) writeFileSync(join(res, "mipmap-xxxhdpi", `ic_launcher_${icon.id}.png`), await png(iconSvg(icon, "light"), 192, "rounded"));
// The launcher's entries: an alias of MainActivity for each icon, Lines' own on (MainActivity.kt switches them).
const aliases = ICONS.map((icon) => {
  const name = icon === LILAC ? "ic_launcher" : `ic_launcher_${icon.id}`;
  return `        <activity-alias
            android:name=".AppIcon_${icon.id}"
            android:targetActivity=".MainActivity"
            android:icon="@mipmap/${name}"
            android:roundIcon="@mipmap/${icon === LILAC ? "ic_launcher_round" : name}"
            android:enabled="${icon === LILAC}"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <!-- AndroidTV support -->
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity-alias>`;
}).join("\n");
const manifestPath = join(android, "AndroidManifest.xml");
const manifest = readFileSync(manifestPath, "utf8").replace(
  /(<!-- App icons, made by scripts\/icons.mjs -->\n)[\s\S]*?( *<!-- End of app icons -->)/,
  (_, start, end) => `${start}${aliases}\n${end}`,
);
writeFileSync(manifestPath, manifest);

// The web: a favicon of the lines alone, plum in a light browser and lilac in a dark one (an .ico of
// the icon for browsers without SVG ones); the full-bleed icon for phones' home screens, which round
// it; the rounded one for the manifest, and one with room around the lines for masks.
writeFileSync(join(pub, "favicon.svg"), favicon(art) + "\n");
const roundedSmall = iconSvg(art, "light", "rounded", { small: true });
const favicons = [];
for (const size of [16, 32, 48]) favicons.push([size, await png(size <= 24 ? roundedSmall : rounded, size)]);
writeFileSync(join(pub, "favicon.ico"), ico(favicons));
writeFileSync(join(pub, "icon.svg"), rounded + "\n");
writeFileSync(join(pub, "icon-dark.svg"), iconSvg(art, "dark", "rounded") + "\n");
writeFileSync(join(pub, "icon-180.png"), await png(light, 180));
writeFileSync(join(pub, "icon-192.png"), await png(rounded, 192));
writeFileSync(join(pub, "icon-512.png"), await png(rounded, 512));
const maskable = light.replace(/(<rect[^>]*\/>)(.*)(<\/svg>)/, '$1<g transform="translate(102.4 102.4) scale(0.8)">$2</g>$3');
writeFileSync(join(pub, "icon-maskable-512.png"), await png(maskable, 512));

await browser.close();
console.log("Icons made.");
