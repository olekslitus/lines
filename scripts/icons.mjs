// Makes every platform's app icon from Lines' icons (src/lib/appIcon/art.ts), drawn by headless
// Chromium. Run with `bun run icons` after changing one, and commit what it writes:
//
//   src-tauri/icons/                 the desktop apps': the Mac's .icns (on Apple's grid, with its
//                                    shadow), and for macOS 26 Assets.car from AppIcon.icon below;
//                                    Windows' .ico and tiles, Linux's PNGs (`tauri icon`)
//   src-tauri/icons/source/          Lines' own icon's SVGs, as drawn: full bleed, the Mac's, dark, tinted
//   src-tauri/gen/apple/             iOS and iPadOS: the asset catalog's light, dark and tinted
//                                    icons, each other icon as an alternate, and AppIcon.icon for
//                                    iOS 26's Liquid Glass
//   src-tauri/gen/android/…/res/     Android: an adaptive icon for each (the lines over a gradient,
//                                    and alone for themed icons), and PNGs for Android 7; the
//                                    manifest's activity alias for each
//   public/                          the web app's and the website's: favicons, the touch icon,
//                                    the manifest's icons
//
// The desktop apps and the web app show the other icons from art.ts as they run (appIcon/show.svelte.ts).

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { favicon, glyph, ICONS, iconSvg, LILAC, MARK } from "../src/lib/appIcon/art.ts";

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

// iOS and iPadOS: each icon as an app icon set, one 1024 picture in each appearance, which Xcode
// makes the other sizes from: Lines' own as AppIcon, the others as AppIcon-<id>, which the app
// switches to (src-tauri/src/app_icon.rs; ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS).
const catalog = join(apple, "Assets.xcassets");
for (const name of readdirSync(catalog)) if (name.endsWith(".appiconset")) rmSync(join(catalog, name), { recursive: true });
for (const icon of ICONS) {
  const set = join(catalog, `${icon === LILAC ? "AppIcon" : `AppIcon-${icon.id}`}.appiconset`);
  mkdirSync(set);
  const appearances = [
    ["AppIcon.png", "light", []],
    ["AppIcon-dark.png", "dark", [{ appearance: "luminosity", value: "dark" }]],
    ["AppIcon-tinted.png", "tinted", [{ appearance: "luminosity", value: "tinted" }]],
  ];
  for (const [file, appearance] of appearances) writeFileSync(join(set, file), await png(iconSvg(icon, appearance), 1024));
  const images = appearances.map(([filename, , list]) => ({ ...(list.length ? { appearances: list } : {}), filename, idiom: "universal", platform: "ios", size: "1024x1024" }));
  writeFileSync(join(set, "Contents.json"), JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2) + "\n");
}

// iOS 26: Lines' own, as Icon Composer's layers, so the system draws the lines in Liquid Glass and
// colors them itself when tinted or clear. The lines are a picture rather than an SVG, whose
// strokes Icon Composer fills in, closing the knot's loop.
const composer = join(apple, "AppIcon.icon");
rmSync(composer, { recursive: true, force: true });
mkdirSync(join(composer, "Assets"), { recursive: true });
writeFileSync(join(composer, "Assets/lines.png"), await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${glyph("#000000")}</svg>`, 1024));
const srgb = (hex) => `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
const down = { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } };
const iconJson = {
  "fill-specializations": [
    { value: { "linear-gradient": art.light.bg.map(srgb), orientation: down } },
    { appearance: "dark", value: { "linear-gradient": art.dark.bg.map(srgb), orientation: down } },
  ],
  groups: [
    {
      layers: [
        {
          "image-name": "lines.png",
          name: "lines",
          glass: true,
          "fill-specializations": [
            { value: { solid: srgb(art.light.lines) } },
            { appearance: "dark", value: { solid: srgb(art.dark.lines) } },
            { appearance: "tinted", value: { solid: srgb("#ffffff") } },
          ],
        },
      ],
      shadow: { kind: "neutral", opacity: 0.5 },
      translucency: { enabled: false, value: 0.5 },
    },
  ],
  "supported-platforms": { squares: "shared" },
};
writeFileSync(join(composer, "icon.json"), JSON.stringify(iconJson, null, 2) + "\n");

// macOS 26: the same, compiled into the asset catalog the Mac bundle takes as it is
// (tauri.conf.json), with the arguments Tauri's bundler gives actool. Made here rather than by each
// build, whose actool fails when Xcode's ibtoold is left in a bad state, and which needs Xcode 26.
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
cpSync(join(compiled, "Assets.car"), join(icons, "Assets.car"));
rmSync(compiled, { recursive: true });

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
  return [...glyph(look).matchAll(/<(path|circle) ([^>]*)\/>/g)]
    .map(([, tag, attrs]) => {
      const get = (name) => attrs.match(new RegExp(`(?:^| )${name}="([^"]+)"`))?.[1];
      if (tag === "circle") {
        const [cx, cy, r] = ["cx", "cy", "r"].map((name) => Number(get(name)));
        const [x, y, rr] = [at(cx - r), at(cy), +((r * 72) / 1024).toFixed(3)];
        return `<path android:fillColor="${get("fill")}" android:pathData="M${x},${y} a${rr},${rr} 0 1,0 ${2 * rr},0 a${rr},${rr} 0 1,0 ${-2 * rr},0z"/>`;
      }
      const d = get("d").replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `${at(Number(x))},${at(Number(y))}`);
      const stroke = get("stroke");
      const width = +((56 * 72) / 1024).toFixed(3);
      const common = `android:strokeWidth="${width}" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${d}"`;
      if (!stroke.startsWith("url(")) return `<path android:strokeColor="${stroke}" ${common}/>`;
      return `<path ${common}>${gradient("strokeColor", [at(214), 0, at(814), 0], look.along)}</path>`;
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
