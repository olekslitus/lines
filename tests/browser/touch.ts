import type { Page } from "playwright";

/*
 * A finger on the page, for the touch screen's gestures (gestures.ts): touch events dispatched
 * where it goes, at a finger's pace, timed in the page. Chromium makes them as a phone's browser
 * would; Playwright's WebKit can't make a Touch, so there they're events that say the same.
 */

type Point = { x: number; y: number };

export interface Moves {
  /** How many moves between the first point and the last. */
  steps?: number;
  /** How long from the first to the last, ms. */
  duration?: number;
  /** Whether the finger is lifted at the end; if not, `lift` does it later. */
  lift?: boolean;
}

/** Puts a finger down at `from` and moves it to `to`, then lifts it unless told not to. */
export function drag(page: Page, from: Point, to: Point, { steps = 10, duration = 160, lift = true }: Moves = {}) {
  return page.evaluate(
    async ([from, to, steps, duration, lift]) => {
      const target = document.elementFromPoint(from.x, from.y)!;
      const fire = (type: string, { x, y }: Point) => {
        const point = { identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y };
        const touches = type === "touchend" ? [] : [point];
        let event: Event;
        try {
          const touch = new Touch(point);
          event = new TouchEvent(type, { touches: touches.length ? [touch] : [], changedTouches: [touch], targetTouches: touches.length ? [touch] : [], bubbles: true, cancelable: true });
        } catch {
          event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: [point] }, targetTouches: { value: touches } });
        }
        target.dispatchEvent(event);
      };
      const pause = () => new Promise((resolve) => setTimeout(resolve, duration / steps));
      fire("touchstart", from);
      for (let step = 1; step <= steps; step++) {
        await pause();
        fire("touchmove", { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
      }
      (window as unknown as { liftFinger: () => void }).liftFinger = () => fire("touchend", to);
      if (lift) fire("touchend", to);
    },
    [from, to, steps, duration, lift] as const,
  );
}

/** Lifts the finger `drag` left down. */
export const lift = (page: Page) => page.evaluate(() => (window as unknown as { liftFinger: () => void }).liftFinger());
