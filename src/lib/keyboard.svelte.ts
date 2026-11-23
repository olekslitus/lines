import { isMobile } from "./platform";

/*
 * A phone's or tablet's keyboard on the screen: whether it's up, and where the part of the page it
 * leaves showing ends, from the visual viewport. On iPhone and iPad the keyboard is over the page,
 * which keeps its height while the visual viewport above the keyboard shrinks (and moves, as iOS
 * scrolls what has focus into it); on Android the app's web view is made shorter instead
 * (MainActivity.kt), as a browser's page is (index.html's `interactive-widget`). Either way what
 * shows of the page ends at the keyboard's top edge.
 */

/**
 * How much shorter than the window's tallest the part showing is when there's a keyboard under it,
 * px: more than the bar of shortcuts an iPad shows over a keyboard of its own, or browser bars
 * coming and going.
 */
const KEYBOARD = 150;

class Keyboard {
  /** Where what shows of the page ends, from the top of the page: the keyboard's top edge while it's up, px. */
  bottom = $state(innerHeight);
  /** A keyboard is up on the screen. */
  up = $state(false);
  /** The tallest the window has been at this width (turning the device starts again), px. */
  #tallest = 0;
  #width = 0;

  constructor() {
    const viewport = window.visualViewport;
    if (!isMobile || !viewport) return;
    const measure = () => this.#measure(viewport);
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    addEventListener("resize", measure);
    measure();
  }

  #measure(viewport: VisualViewport) {
    if (innerWidth !== this.#width) {
      this.#width = innerWidth;
      this.#tallest = 0;
    }
    // As tall as at its usual size: pinching into Safari's page shrinks the viewport too, but not what shows.
    const showing = viewport.height * viewport.scale;
    this.#tallest = Math.max(this.#tallest, innerHeight, showing);
    this.up = this.#tallest - showing > KEYBOARD;
    this.bottom = viewport.offsetTop + viewport.height;
  }
}

export const keyboard = new Keyboard();
