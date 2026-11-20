import { viewport } from "./device";
import { isIOS, isMobileApp } from "./platform";

/** iOS's body text at its usual size (Large), in px. */
const BODY = 17;
/** The sizes of it lines follows, xSmall to xxxLarge: the accessibility sizes past them need layouts of their own. */
const BODY_RANGE = { min: 14, max: 23 };

/**
 * The page as phones and tablets have it: zoomed only as `viewport` says; and on iPhone and iPad,
 * marked for app.css (`data-platform="ios"`: lists and notes that always bounce), with lines' own
 * text scaled by the text size chosen in iOS's Settings, as other apps' is.
 */
export function fitToDevice() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta) meta.content = viewport(meta.content, { app: isMobileApp, ios: isIOS });
  if (!isIOS) return;
  document.documentElement.dataset.platform = "ios";
  if (CSS.supports("font", "-apple-system-body")) followTextSize();
}

/**
 * Dynamic Type: WebKit gives its body size as the `-apple-system-body` font, which app.css's
 * --type-scale is over the usual 17px. A letter in it, out of sight, changes size as it does, in
 * Settings or Control Center, which tells lines to read it again.
 */
function followTextSize() {
  const probe = document.createElement("span");
  probe.textContent = "x";
  probe.ariaHidden = "true";
  Object.assign(probe.style, { font: "-apple-system-body", position: "fixed", visibility: "hidden", pointerEvents: "none" });
  document.body.append(probe);
  const read = () => {
    const size = parseFloat(getComputedStyle(probe).fontSize);
    if (!size) return;
    const body = Math.min(BODY_RANGE.max, Math.max(BODY_RANGE.min, size));
    document.documentElement.style.setProperty("--type-scale", String(body / BODY));
  };
  read();
  new ResizeObserver(read).observe(probe);
}
