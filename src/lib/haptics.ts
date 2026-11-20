import { isMobileApp } from "./platform";

/**
 * A light tap felt in the hand, as iOS gives when a pull down is far enough to refresh: the
 * system's in the iPhone, iPad and Android apps, a short buzz in a browser that can (not Safari).
 */
export function tick() {
  if (isMobileApp) void import("@tauri-apps/plugin-haptics").then(({ impactFeedback }) => impactFeedback("light")).catch(() => {});
  else navigator.vibrate?.(8);
}
