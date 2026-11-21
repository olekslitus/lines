/*
 * Lines' icon, drawn as SVG: three hand-drawn lines on 1024, top to bottom a line with a knot in it,
 * a bullet then a line, and a line ending in a full stop. Every platform's icon is made from these
 * (scripts/icons.mjs), and the app draws them where it shows its icon.
 */

/** The lines' weight on 1024. */
const STROKE = 56;
const LINE = `stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

/** The five shapes, top to bottom: the knot's line, the bullet, its line, the last line, its full stop. */
const KNOT =
  "M214 420.8 C228.17 420.97 265.15 426.28 298.99 421.8 C332.83 417.32 387.21 416.19 417.04 393.92 C446.87 371.65 477.97 313.58 477.97 288.19 C477.97 262.81 437.35 241.6 417.04 241.6 C396.73 241.6 356.11 262.81 356.11 288.19 C356.11 313.58 387.21 371.65 417.04 393.92 C446.87 416.19 474.93 417.32 535.09 421.8 C595.25 426.28 737.51 420.97 778 420.8";
const DOT = 43.68;

/** The three lines in `color`, on the 1024 canvas. */
export function glyph(color: string) {
  return [
    `<path d="${KNOT}" ${LINE} stroke="${color}"/>`,
    `<circle cx="229.68" cy="601.6" r="${DOT}" fill="${color}"/>`,
    `<path d="M357.36 601.6 L694 601.6" ${LINE} stroke="${color}"/>`,
    `<path d="M214 782.4 L458.32 782.4" ${LINE} stroke="${color}"/>`,
    `<circle cx="558" cy="782.4" r="${DOT}" fill="${color}"/>`,
  ].join("");
}

/** The same three lines at 32, heavier, for 16 and 32 pixels. */
const markLines = (color: string) =>
  `<g stroke="${color}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 12.2 C3.65 12.37 3.37 13.44 4.88 13.2 C6.4 12.96 10.55 12.11 12.47 10.76 C14.39 9.41 16.39 6.46 16.39 5.1 C16.39 3.74 13.78 2.6 12.47 2.6 C11.17 2.6 8.56 3.74 8.56 5.1 C8.56 6.46 10.55 9.41 12.47 10.76 C14.39 12.11 17.37 12.96 20.06 13.2 C22.75 13.44 27.18 12.37 28.6 12.2"/><path d="M12.62 20.8 L23.56 20.8"/><path d="M3.4 29.4 L10.82 29.4"/></g><g fill="${color}"><circle cx="4.41" cy="20.8" r="2.81"/><circle cx="17.22" cy="29.4" r="2.81"/></g>`;

/** The mark: the small lines in `currentColor`, so they take the color of what they're in. */
export const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">${markLines("currentColor")}</svg>`;

/** An icon's colors in one appearance: its background's gradient, top to bottom, and its lines'. */
export interface Look {
  bg: [string, string];
  lines: string;
}

/** An app icon: its colors in light and in dark. */
export interface IconArt {
  id: string;
  light: Look;
  dark: Look;
}

/** Plum on lilac, Lines' own. */
export const LILAC: IconArt = {
  id: "lilac",
  light: { bg: ["#e6dbf2", "#cfbfe6"], lines: "#4b2a5e" },
  dark: { bg: ["#17121d", "#0c0910"], lines: "#cdb6ec" },
};

/**
 * How an icon is cut: to the edges (`bleed`, for iOS and Android, which round it themselves),
 * a rounded square (`rounded`, for the web), or the Mac's: an 824 rounded square in the middle of
 * the 1024 canvas, with Apple's shadow under it (`mac`).
 */
export type Frame = "bleed" | "rounded" | "mac";

/** The look's background gradient, as an SVG `<linearGradient>` with the id `bg`. */
const gradient = ({ bg }: Look) =>
  `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient>`;

/** Greys a picture, a little lighter, as iOS asks of an icon it tints. */
const GREY = `<filter id="grey" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.15"/><feFuncG type="linear" slope="1.15"/><feFuncB type="linear" slope="1.15"/></feComponentTransfer></filter>`;

/**
 * The icon as an SVG on 1024: in its light or dark look, or `tinted` (the dark one in greys, which
 * iOS colors with the tint chosen), cut as `frame` says. `small` draws the mark's heavier lines,
 * larger, for an icon shown at 32 pixels or less.
 */
export function iconSvg(art: IconArt, appearance: "light" | "dark" | "tinted", frame: Frame = "bleed", small = false) {
  const look = appearance === "light" ? art.light : art.dark;
  const lines = small ? `<g transform="translate(160 160) scale(22)">${markLines(look.lines)}</g>` : glyph(look.lines);
  const defs = gradient(look) + (appearance === "tinted" ? GREY : "");
  const tile =
    frame === "bleed"
      ? `<rect width="1024" height="1024" fill="url(#bg)"/>${lines}`
      : frame === "rounded"
        ? `<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>${lines}`
        : `<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#shadow)"/><rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" stroke="#000" stroke-opacity="0.08"/><g transform="translate(100 100) scale(0.8046875)">${lines}</g>`;
  const shadow =
    frame === "mac"
      ? `<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity="0.3"/></filter>`
      : "";
  const body = appearance === "tinted" ? `<g filter="url(#grey)">${tile}</g>` : tile;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>${defs}${shadow}</defs>${body}</svg>`;
}

/** The icon as a `data:` address, for an `<img>`. */
export const iconUrl = (art: IconArt, appearance: "light" | "dark", frame: Frame = "rounded") =>
  `data:image/svg+xml,${encodeURIComponent(iconSvg(art, appearance, frame))}`;
