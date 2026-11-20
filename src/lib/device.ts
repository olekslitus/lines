import type { OpenLinks } from "./prefs.svelte";

/**
 * Whether a browser is a phone's or a tablet's, from its user agent and touch points. An iPad's
 * says it's a Mac, so it's told by its touch screen, which no Mac has; Windows and Linux laptops
 * can have one and are still computers.
 */
export const onPhoneOrTablet = (ua: string, touchPoints: number) => /iPhone|iPad|Android/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);

/**
 * The page's viewport (index.html's, `content`) as lines has it where it runs. No app zooms its
 * whole screen, so the iPhone, iPad and Android apps (`app`) never do: not by pinching, nor into a
 * field that takes focus, which iOS does for text under 16px with no way back but pinching. Safari
 * on iPhone and iPad (`ios`) still lets people pinch-zoom whatever a page asks, an accessibility
 * feature lines keeps, and holds `maximum-scale` only for what it zooms by itself: into fields. Other
 * browsers keep their zooming, all of it.
 */
export function viewport(content: string, { app, ios }: { app: boolean; ios: boolean }) {
  if (app) return `${content}, maximum-scale=1, user-scalable=no`;
  return ios ? `${content}, maximum-scale=1` : content;
}

/** Where an address lines opens goes: over lines, in the browser, or to the system's app for it. */
export type LinkRoute = "lines" | "browser" | "system";

/**
 * Where an address goes (platform.ts's openExternal): a web page over lines, in a browser view of
 * its own, in the iPhone, iPad and Android apps (`phoneApp`) unless Settings → General says the
 * browser (`openLinks`) or the browser is asked for (`inBrowser`), else in the browser; mail and
 * phone numbers to the system, for their apps; and anything else nowhere, as a note can link to
 * what isn't safe to open.
 */
export function linkRoute(url: string, { phoneApp, openLinks, inBrowser = false }: { phoneApp: boolean; openLinks: OpenLinks; inBrowser?: boolean }): LinkRoute | null {
  if (/^(mailto|tel):/i.test(url)) return "system";
  if (!/^https?:\/\/\S/i.test(url)) return null;
  return phoneApp && openLinks === "lines" && !inBrowser ? "lines" : "browser";
}
