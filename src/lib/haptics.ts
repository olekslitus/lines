import { isMobileApp } from "./platform";

/** The system's haptics, in the iPhone, iPad and Android apps; loaded with the first, so the next is felt at once. */
let haptics: Promise<typeof import("@tauri-apps/plugin-haptics")> | undefined;

function impact(style: "light" | "medium", buzz: number) {
  if (!isMobileApp) return void navigator.vibrate?.(buzz);
  haptics ??= import("@tauri-apps/plugin-haptics");
  void haptics.then(({ impactFeedback }) => impactFeedback(style)).catch(() => {});
}

/**
 * A light tap felt in the hand, as iOS gives when a pull down is far enough to refresh: the
 * system's in the iPhone, iPad and Android apps, a short buzz in a browser that can (not Safari).
 */
export const tick = () => impact("light", 8);

/** A firmer one, as a long press opens its menu (UIContextMenuInteraction's, Android's long press). */
export const pressed = () => impact("medium", 12);
