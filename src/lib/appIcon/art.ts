/*
 * Lines' icon, drawn as SVG: three hand-drawn lines on 1024, top to bottom a line with a knot in it,
 * a bullet then a line, and a line ending in a full stop, in one of the colors in ICONS. Every
 * platform's icon is made from these (scripts/icons.mjs), and the app draws them where it shows
 * its icon (Settings → About and Theme → App Icon).
 */

/** The lines' weight on 1024. */
const STROKE = 56;
const LINE = `stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

const KNOT =
  "M214 420.8 C228.17 420.97 265.15 426.28 298.99 421.8 C332.83 417.32 387.21 416.19 417.04 393.92 C446.87 371.65 477.97 313.58 477.97 288.19 C477.97 262.81 437.35 241.6 417.04 241.6 C396.73 241.6 356.11 262.81 356.11 288.19 C356.11 313.58 387.21 371.65 417.04 393.92 C446.87 416.19 474.93 417.32 535.09 421.8 C595.25 426.28 737.51 420.97 778 420.8";
const DOT = 43.68;

/** An icon's colors in one appearance. */
export interface Look {
  /** Its background's gradient: two or three colors, top to bottom, or corner to corner when `diagonal`. */
  bg: string[];
  diagonal?: boolean;
  /** Its lines' color, or each line's: the knot's, the bullet's, the full stop's. */
  lines: string | [string, string, string];
  /** Both dots' color, when it isn't their lines'. */
  dots?: string;
  /** The knot's line's color, when it isn't the rest's. */
  knot?: string;
  /** A gradient along the lines, from their start to their end; the dots take its ends. */
  along?: [string, string];
  /** A glass icon's rim and inner light (IconArt.glass). */
  rim?: string;
  inner?: string;
}

/** An app icon: its colors in light and in dark, and whether its lines are glass. */
export interface IconArt {
  id: string;
  light: Look;
  dark: Look;
  glass?: boolean;
}

/** The colors each of the five shapes is painted in: the knot's line, the bullet, its line, the last line, its full stop. */
function paints(look: Look | string, along = "url(#along)") {
  if (typeof look === "string") return [look, look, look, look, look];
  const [knot, bullet, stop] = Array.isArray(look.lines) ? look.lines : [look.lines, look.lines, look.lines];
  if (look.along) return [along, look.along[0], along, along, look.along[1]];
  return [look.knot ?? knot, look.dots ?? bullet, bullet, stop, look.dots ?? stop];
}

/** The three lines, in `look`'s colors or all in one, on the 1024 canvas. */
export function glyph(look: Look | string) {
  const [knot, bullet, bulletLine, stopLine, stop] = paints(look);
  return [
    `<path d="${KNOT}" ${LINE} stroke="${knot}"/>`,
    `<circle cx="229.68" cy="601.6" r="${DOT}" fill="${bullet}"/>`,
    `<path d="M357.36 601.6 L694 601.6" ${LINE} stroke="${bulletLine}"/>`,
    `<path d="M214 782.4 L458.32 782.4" ${LINE} stroke="${stopLine}"/>`,
    `<circle cx="558" cy="782.4" r="${DOT}" fill="${stop}"/>`,
  ].join("");
}

/** The same three lines at 32, heavier, for 16 to 24 pixels. */
function markLines(look: Look | string) {
  const [knot, bullet, bulletLine, stopLine, stop] = paints(look, "url(#alongMark)");
  const line = `stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  return [
    `<path d="M3.4 12.2 C3.65 12.37 3.37 13.44 4.88 13.2 C6.4 12.96 10.55 12.11 12.47 10.76 C14.39 9.41 16.39 6.46 16.39 5.1 C16.39 3.74 13.78 2.6 12.47 2.6 C11.17 2.6 8.56 3.74 8.56 5.1 C8.56 6.46 10.55 9.41 12.47 10.76 C14.39 12.11 17.37 12.96 20.06 13.2 C22.75 13.44 27.18 12.37 28.6 12.2" ${line} stroke="${knot}"/>`,
    `<circle cx="4.41" cy="20.8" r="2.81" fill="${bullet}"/>`,
    `<path d="M12.62 20.8 L23.56 20.8" ${line} stroke="${bulletLine}"/>`,
    `<path d="M3.4 29.4 L10.82 29.4" ${line} stroke="${stopLine}"/>`,
    `<circle cx="17.22" cy="29.4" r="2.81" fill="${stop}"/>`,
  ].join("");
}

/** The mark: the small lines in `currentColor`, so they take the color of what they're in. */
export const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">${markLines("currentColor")}</svg>`;

/** Where a gradient along the lines starts and ends, across the 1024 canvas. */
export const ALONG = [214, 814] as const;

/** The gradients a look's lines need along them, at 1024 and at the mark's 32. */
const alongs = (look: Look) =>
  look.along
    ? `<linearGradient id="along" x1="${ALONG[0]}" y1="0" x2="${ALONG[1]}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${look.along[0]}"/><stop offset="1" stop-color="${look.along[1]}"/></linearGradient><linearGradient id="alongMark" x1="3.4" y1="0" x2="28.6" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${look.along[0]}"/><stop offset="1" stop-color="${look.along[1]}"/></linearGradient>`
    : "";

/** The mark in `look`'s colors, plum on a light page and lilac on a dark one for Lines' own: the web app's favicon. */
export function favicon(art: IconArt) {
  const color = (look: Look) => (typeof look.lines === "string" && !look.along && !look.dots && !look.knot ? look.lines : null);
  const [light, dark] = [color(art.light), color(art.dark)];
  // One color for each scheme can follow the browser's; several are drawn as the light icon has them.
  if (light && dark) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><style>svg{color:${light}}@media (prefers-color-scheme:dark){svg{color:${dark}}}</style>${markLines("currentColor")}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><defs>${alongs(art.light)}</defs>${markLines(art.light)}</svg>`;
}

/**
 * Glass lines, inside: their rim's opacity; a core, an inner light and a sheen, each the lines shrunk
 * by `erode`, blurred by `blur` (and the sheen moved up and left); a lit edge `width` wide, lit as
 * `lit` says from the top left corner to the bottom right. scripts/icons.mjs draws the same as vectors
 * for iOS.
 */
export const GLASS = {
  rim: 0.6,
  core: { erode: 6, blur: 5, opacity: 0.7 },
  inner: { erode: 15, blur: 6, opacity: 0.45 },
  sheen: { erode: 17, blur: 4, opacity: 0.45, dx: -6, dy: -9 },
  edge: { width: 2.5, blur: 0.7, opacity: 0.75 },
  lit: `<stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.25"/><stop offset="1" stop-color="#fff" stop-opacity="0.5"/>`,
};

/** The lines as glass: a shadow under them, a tinted body, an inner light, a lit edge and a sheen. */
function glassLines(look: Look) {
  const color = typeof look.lines === "string" ? look.lines : look.lines[0];
  const { rim, core, inner, sheen, edge, lit } = GLASS;
  const shrunk = (id: string, { erode, blur }: { erode: number; blur: number }) =>
    `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feMorphology operator="erode" radius="${erode}"/><feGaussianBlur stdDeviation="${blur}"/></filter>`;
  const defs = `<mask id="inside" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">${glyph("#fff")}</mask><filter id="glassShadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="18"/></filter><filter id="contact" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="6"/></filter>${shrunk("core", core)}${shrunk("inner", inner)}${shrunk("sheen", sheen)}<filter id="edge" x="-5%" y="-5%" width="110%" height="110%"><feMorphology in="SourceAlpha" operator="erode" radius="${edge.width}" result="in"/><feComposite in="SourceAlpha" in2="in" operator="out" result="ring"/><feGaussianBlur in="ring" stdDeviation="${edge.blur}" result="ring2"/><feFlood flood-color="#ffffff"/><feComposite in2="ring2" operator="in"/></filter><linearGradient id="lit" x1="0" y1="0" x2="1" y2="1">${lit}</linearGradient><mask id="litMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="url(#lit)"/></mask>`;
  const body = `<g opacity="0.55" transform="translate(0 20)" filter="url(#glassShadow)">${glyph("#03060f")}</g><g opacity="0.4" transform="translate(0 8)" filter="url(#contact)">${glyph("#03060f")}</g><g mask="url(#inside)"><g opacity="${rim}">${glyph(look.rim ?? color)}</g><g opacity="${core.opacity}" filter="url(#core)">${glyph(color)}</g><g opacity="${inner.opacity}" filter="url(#inner)">${glyph(look.inner ?? color)}</g><g mask="url(#litMask)" opacity="${edge.opacity}" filter="url(#edge)">${glyph("#000")}</g><g opacity="${sheen.opacity}" transform="translate(${sheen.dx} ${sheen.dy})" filter="url(#sheen)">${glyph("#ffffff")}</g></g>`;
  return { defs, body };
}

/** Lines' icons: its own first, then the others to choose from (Settings → Theme → App Icon). */
export const ICONS: IconArt[] = [
  { id: "lilac", light: { bg: ["#e6dbf2", "#cfbfe6"], lines: "#4b2a5e" }, dark: { bg: ["#17121d", "#0c0910"], lines: "#cdb6ec" } },
  { id: "oat", light: { bg: ["#f7f0e1", "#ebdfc8"], lines: "#2b2724" }, dark: { bg: ["#25232c", "#15141a"], lines: "#efe7d8" } },
  { id: "sand", light: { bg: ["#24365f", "#16213d"], lines: "#f1dcb0" }, dark: { bg: ["#121826", "#0a0d16"], lines: "#e8cf9c" } },
  { id: "warm", light: { bg: ["#f7f0e1", "#ebdfc8"], lines: ["#bb5a33", "#946209", "#557a4e"] }, dark: { bg: ["#25232c", "#15141a"], lines: ["#e48d66", "#ebbb5c", "#a9c49f"] } },
  { id: "cool", light: { bg: ["#eef1f4", "#dde4ea"], lines: ["#45688f", "#77599c", "#357a64"] }, dark: { bg: ["#161b24", "#0c1016"], lines: ["#97b4d4", "#bba8e2", "#8fd6bb"] } },
  { id: "bold", light: { bg: ["#fbf5ea", "#f1e6d2"], lines: ["#d0402a", "#a86f00", "#2a4fbf"] }, dark: { bg: ["#121218", "#08080c"], lines: ["#ff7a5c", "#f6c445", "#7d9bff"] } },
  { id: "coral", light: { bg: ["#1d2233", "#10131d"], lines: "#efe7d8", dots: "#ff6f59" }, dark: { bg: ["#111216", "#08090b"], lines: "#e6ded0", dots: "#ff7a66" } },
  { id: "knot", light: { bg: ["#35332f", "#1c1b19"], lines: "#f2ece2", knot: "#f2b632" }, dark: { bg: ["#121211", "#080808"], lines: "#e6e0d6", knot: "#f2b632" } },
  { id: "dusk", light: { bg: ["#5a2d4c", "#c4673f"], diagonal: true, lines: "#fff4ea" }, dark: { bg: ["#1b1219", "#0e090d"], lines: "#f2b9a2" } },
  { id: "sunrise", light: { bg: ["#f8c09c", "#e9849a"], diagonal: true, lines: "#4a1f3a" }, dark: { bg: ["#1d1418", "#0f0a0c"], lines: "#f6b896" } },
  { id: "sea", light: { bg: ["#1d2c55", "#0e7a7e"], diagonal: true, lines: "#f3f7f5" }, dark: { bg: ["#0f1724", "#070b12"], lines: "#7fd8d3" } },
  { id: "forest", light: { bg: ["#1f4a3a", "#55733a"], diagonal: true, lines: "#f4efdc" }, dark: { bg: ["#101a15", "#080e0b"], lines: "#b6d6a0" } },
  { id: "aurora", light: { bg: ["#1b2350", "#46307a", "#13706f"], diagonal: true, lines: "#f2f4ff" }, dark: { bg: ["#10132a", "#0a0a14"], lines: "#b9c8ff" } },
  { id: "cobalt", light: { bg: ["#2f55cf", "#1f3c9e"], lines: "#fbf3e3" }, dark: { bg: ["#0f1426", "#080b16"], lines: "#8fa8ff" } },
  { id: "vermilion", light: { bg: ["#e2482f", "#bf351f"], lines: "#fff4e6" }, dark: { bg: ["#160d0b", "#0b0605"], lines: "#ff8a6e" } },
  { id: "saffron", light: { bg: ["#f4c03e", "#e3a21c"], lines: "#2a2420" }, dark: { bg: ["#16130b", "#0b0905"], lines: "#f4c03e" } },
  { id: "mint", light: { bg: ["#d4eddf", "#b6dcc6"], lines: "#1f4a3a" }, dark: { bg: ["#0e1a15", "#08100c"], lines: "#9fe0bf" } },
  { id: "charcoal", light: { bg: ["#302e2b", "#1b1a18"], lines: "#f5f0e7" }, dark: { bg: ["#111110", "#070707"], lines: "#e8e2d6" } },
  { id: "graphite", light: { bg: ["#f7f5f0", "#e6e3db"], lines: "#3a3a3c" }, dark: { bg: ["#1a1a1b", "#0e0e0f"], lines: "#d9d6cf" } },
  {
    id: "glass",
    glass: true,
    light: { bg: ["#24365f", "#121c35"], lines: "#f1dcb0", rim: "#b89a62", inner: "#fff3d8" },
    dark: { bg: ["#141a29", "#080b13"], lines: "#e8cf9c", rim: "#9c8152", inner: "#fff0cf" },
  },
  { id: "ember", light: { bg: ["#f7f0e1", "#ebdfc8"], along: ["#b5552f", "#946209"], lines: "#b5552f" }, dark: { bg: ["#25232c", "#15141a"], along: ["#e38c66", "#ecb550"], lines: "#e38c66" } },
];

/** Lines' own icon, the one it has until another is chosen. */
export const LILAC = ICONS[0];
export const ICON_IDS = ICONS.map((icon) => icon.id);

/** The icon `id` names, or Lines' own for one it doesn't know. */
export const iconArt = (id: string) => ICONS.find((icon) => icon.id === id) ?? LILAC;

/**
 * How an icon is cut: to the edges (`bleed`, for iOS and Android, which round it themselves),
 * a rounded square (`rounded`, for the web), or the Mac's: an 824 rounded square in the middle of
 * the 1024 canvas, with Apple's shadow under it (`mac`).
 */
export type Frame = "bleed" | "rounded" | "mac";

/** The look's background gradient, as an SVG `<linearGradient>` with the id `bg`. */
export function gradient({ bg, diagonal }: Look) {
  const stops = bg.map((color, i) => `<stop offset="${i / (bg.length - 1)}" stop-color="${color}"/>`).join("");
  return `<linearGradient id="bg" x1="0" y1="0" x2="${diagonal ? 1 : 0}" y2="1">${stops}</linearGradient>`;
}

/** Greys a picture, a little lighter, as iOS asks of an icon it tints. */
const GREY = `<filter id="grey" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.15"/><feFuncG type="linear" slope="1.15"/><feFuncB type="linear" slope="1.15"/></feComponentTransfer></filter>`;

/**
 * The icon as an SVG on 1024: in its light or dark look, or `tinted` (the dark one in greys, which
 * iOS colors with the tint chosen), cut as `frame` says. `small` draws the mark's heavier lines,
 * larger, for an icon shown at 24 pixels or less; `background: false` leaves the lines alone, on
 * nothing (Android's foreground layer).
 */
export function iconSvg(art: IconArt, appearance: "light" | "dark" | "tinted", frame: Frame = "bleed", { small = false, background = true } = {}) {
  const look = appearance === "light" ? art.light : art.dark;
  const glass = art.glass && !small ? glassLines(look) : null;
  const lines = small ? `<g transform="translate(160 160) scale(22)">${markLines(look)}</g>` : (glass?.body ?? glyph(look));
  const defs = gradient(look) + alongs(look) + (glass?.defs ?? "") + (appearance === "tinted" ? GREY : "");
  const tile = !background
    ? lines
    : frame === "bleed"
      ? `<rect width="1024" height="1024" fill="url(#bg)"/>${lines}`
      : frame === "rounded"
        ? `<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>${lines}`
        : `<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#shadow)"/><rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" stroke="#000" stroke-opacity="0.08"/><g transform="translate(100 100) scale(0.8046875)">${lines}</g>`;
  const shadow =
    frame === "mac" && background
      ? `<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity="0.3"/></filter>`
      : "";
  const body = appearance === "tinted" ? `<g filter="url(#grey)">${tile}</g>` : tile;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>${defs}${shadow}</defs>${body}</svg>`;
}

/** The icon as a `data:` address, for an `<img>`. */
export const iconUrl = (art: IconArt, appearance: "light" | "dark", frame: Frame = "rounded") =>
  `data:image/svg+xml,${encodeURIComponent(iconSvg(art, appearance, frame))}`;
