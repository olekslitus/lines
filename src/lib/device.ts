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
