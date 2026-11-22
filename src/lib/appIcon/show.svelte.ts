import { prefs } from "../prefs.svelte";
import { isDesktopApp, isIOSApp, isMacApp, isTauri } from "../platform";
import { favicon, type IconArt, iconArt, iconSvg, LILAC } from "./art";

/*
 * Shows the app icon chosen in Settings → Theme → App Icon, as each platform lets it:
 *
 *   iPhone, iPad   one of the alternate icons in the asset catalog (src-tauri/src/app_icon.rs);
 *                  iOS says it's changed it
 *   Android        the launcher's, through an activity alias for each icon (MainActivity.kt)
 *   Mac            the Dock's while Lines is open, light or dark as the Mac is (macOS draws the
 *                  bundle's own by its icon style, which stays light in dark mode unless changed);
 *                  Finder keeps the bundle's
 *   Windows, Linux the window's, in the taskbar, while Lines is open
 *   web            the tab's favicon
 *
 * It's this device's: an icon is part of the device's home screen or Dock, not of the notes.
 */

/** The page's own favicons, to put back when Lines' own icon is chosen again. */
let pageIcons: HTMLLinkElement[] | null = null;

function showFavicon(art: IconArt) {
  pageIcons ??= [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
  document.querySelector("link[data-app-icon]")?.remove();
  if (art === LILAC) return document.head.append(...pageIcons);
  for (const link of pageIcons) link.remove();
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.dataset.appIcon = art.id;
  link.href = `data:image/svg+xml,${encodeURIComponent(favicon(art))}`;
  document.head.append(link);
}

/** `svg` drawn at `size`: on a Mac as a PNG's bytes, elsewhere as its pixels (RGBA), which the app needs no decoder for. */
async function picture(svg: string, size: number) {
  const image = new Image(size, size);
  image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  if (!isMacApp) return [...context.getImageData(0, 0, size, size).data];
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  return blob ? [...new Uint8Array(await blob.arrayBuffer())] : null;
}

/** The icon last shown, and in which appearance, so the desktop apps leave the bundle's alone until another is chosen. */
let shown: string = LILAC.id;

async function show(id: string, systemDark: boolean) {
  const art = iconArt(id);
  if (!isTauri) return showFavicon(art);
  if (window.linesAppIcon) return void window.linesAppIcon.set(art.id);
  const { invoke } = await import("@tauri-apps/api/core");
  if (isIOSApp) return invoke("set_app_icon", { alternate: art === LILAC ? null : `AppIcon-${art.id}`, picture: null, size: 0 });
  // The Dock is light or dark as the Mac is, not as Lines is; Lines' own light is the bundle's.
  const appearance = isMacApp && systemDark ? "dark" : "light";
  const bundle = art === LILAC && appearance === "light";
  const key = bundle ? LILAC.id : `${art.id} ${appearance}`;
  if (!isDesktopApp || key === shown) return;
  shown = key;
  // The Mac's shape, as the bundle's icon has (and Windows' and Linux's .ico and PNGs), as large as
  // the bundle's largest (512 points at 2×), so the Dock never draws it softer, magnified too; or a
  // taskbar's largest.
  const size = isMacApp ? 1024 : 256;
  return invoke("set_app_icon", { alternate: null, picture: bundle ? null : await picture(iconSvg(art, appearance, "mac"), size), size });
}

$effect.root(() => {
  $effect(() => {
    show(prefs.appIcon, prefs.systemDark).catch((error) => console.error("Couldn't show the app icon:", error));
  });
});
