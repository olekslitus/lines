import type { Attachment } from "svelte/attachments";
import { pressed } from "./haptics";
import { reducedMotion } from "./platform";

/**
 * How long a finger is held still for a long press, ms: Android's (ViewConfiguration's long-press
 * timeout, 400 ms since Android 12). iOS gives its context menus no number; they open sooner than
 * UILongPressGestureRecognizer's 0.5 s default, at about this.
 */
export const LONG_PRESS = 400;
/** Before what's held starts to sink, so a finger about to scroll doesn't flash it (UIScrollView holds a touch back 150 ms for the same). */
const SINKS_AFTER = 100;
/** How far the finger moves before it's scrolling or swiping instead, px: UIKit's and Android's touch slop are about this. */
const SLOP = 10;
/** A finger put down this soon after a list scrolled is stopping it, not pressing what's under it, ms. */
const SCROLL_SETTLE = 150;
/** As far as what's held sinks, as iOS shows it before its menu opens. */
const SUNK = { scale: "0.97", opacity: "0.8" };

let scrolled = -Infinity;
let watching = false;

/**
 * Calls `handler` when a finger is held still on the element, since touch screens have no
 * right-click: sinking a little as it's held, felt in the hand as it opens, as iOS's context menus
 * are. Moving, a second finger, or the page starting to scroll calls it off. The click that
 * follows the press is swallowed. `sinks: false` for something that shows being pressed itself.
 */
export function longPress(handler: (x: number, y: number) => void, { sinks = true } = {}): Attachment<HTMLElement> {
  return (node) => {
    if (!watching) {
      watching = true;
      addEventListener("scroll", (event) => (scrolled = event.timeStamp), { capture: true, passive: true });
    }
    let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; sinking?: Animation } | null = null;
    let fired = false;
    // Held, iOS would select the text or show a link's preview: the press is ours.
    node.style.setProperty("-webkit-touch-callout", "none");

    /** Calls the press off, what's held rising back from wherever it sank to. */
    function letGo() {
      if (!press) return;
      clearTimeout(press.timer);
      const { sinking } = press;
      press = null;
      if (!sinking) return;
      const { scale, opacity } = getComputedStyle(node);
      sinking.cancel();
      if (!reducedMotion.matches) node.animate([{ scale, opacity }, { scale: "1", opacity: "1" }], { duration: 200, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    }

    function fire() {
      if (!press) return;
      const { x, y } = press;
      letGo();
      fired = true;
      pressed();
      handler(x, y);
    }

    const down = (event: PointerEvent) => {
      letGo();
      fired = false;
      if (event.pointerType === "mouse" || !event.isPrimary || event.timeStamp - scrolled < SCROLL_SETTLE) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(fire, LONG_PRESS) };
      if (sinks && !reducedMotion.matches) {
        press.sinking = node.animate([{ scale: "1", opacity: "1" }, SUNK], { duration: LONG_PRESS - SINKS_AFTER, delay: SINKS_AFTER, easing: "ease-out", fill: "forwards" });
      }
    };
    const move = (event: PointerEvent) => {
      if (press && event.pointerId === press.id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP) letGo();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === press?.id) letGo();
    };
    // Android's WebView opens a context menu on a long press too, as soon or sooner: it's the one
    // menu, then, felt the same.
    const menu = () => {
      if (!press) return;
      letGo();
      pressed();
    };
    const click = (event: MouseEvent) => {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    // Passive: none of them stop the page scrolling, so WebKit and Chromium needn't wait on them to.
    const passive = { passive: true };
    node.addEventListener("pointerdown", down, passive);
    node.addEventListener("pointermove", move, passive);
    node.addEventListener("pointerup", up, passive);
    node.addEventListener("pointercancel", up, passive);
    node.addEventListener("contextmenu", menu);
    node.addEventListener("click", click, true);
    return () => {
      letGo();
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("contextmenu", menu);
      node.removeEventListener("click", click, true);
    };
  };
}
