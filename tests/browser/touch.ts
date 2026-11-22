import type { Page } from "playwright";

/*
 * A finger on the page, for the touch screen's gestures (gestures.ts): touch events dispatched
 * where it goes, at a finger's pace, timed in the page. Chromium makes them as a phone's browser
 * would; Playwright's WebKit can't make a Touch, so there they're events that say the same.
 *
 * Each event's timeStamp is when the finger's pace has it, not when the page's timer ran: on a busy
 * machine a timer can run hundreds of milliseconds late, and the gestures, which read how fast and
 * how soon the finger moved from the events' timeStamps, would see a finger held before it moved,
 * slowed, or stopped before it was lifted.
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

/**
 * Puts a finger down at `from` and moves it to `to`, then lifts it unless told not to. Whether the
 * page stopped its first move, which in WebKit decides whether the touch can scroll the page at all.
 */
export function drag(page: Page, from: Point, to: Point, { steps = 10, duration = 160, lift = true }: Moves = {}) {
  return page.evaluate(
    async ([from, to, steps, duration, lift]) => {
      const target = document.elementFromPoint(from.x, from.y)!;
      const start = performance.now();
      const interval = duration / steps;
      const fire = (type: string, { x, y }: Point, step: number) => {
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
        Object.defineProperty(event, "timeStamp", { value: start + step * interval });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const pause = () => new Promise((resolve) => setTimeout(resolve, interval));
      fire("touchstart", from, 0);
      let stopped = false;
      for (let step = 1; step <= steps; step++) {
        await pause();
        const move = fire("touchmove", { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }, step);
        if (step === 1) stopped = move;
      }
      // Lifted as it got there, however long after that `lift` is.
      (window as unknown as { liftFinger: () => void }).liftFinger = () => fire("touchend", to, steps);
      if (lift) fire("touchend", to, steps);
      return stopped;
    },
    [from, to, steps, duration, lift] as const,
  );
}

/** Lifts the finger `drag` left down. */
export const lift = (page: Page) => page.evaluate(() => (window as unknown as { liftFinger: () => void }).liftFinger());

/**
 * A finger put down on `selector`'s first element, held `ms` (moved `moveBy` px down partway, as a scroll starts), then
 * lifted: pointer events, as a long press is read (longPress.ts). What the page saw: how long after
 * the finger went down a menu opened (null if none did), how far the element had sunk just before
 * it would open, and when a timer for the long press's 0.4 s, set as the finger went down, ran
 * (later than that on a busy machine, as the long press's own is).
 */
export function hold(page: Page, selector: string, { ms = 600, moveBy = 0, pointerType = "touch" }: { ms?: number; moveBy?: number; pointerType?: string } = {}) {
  return page.evaluate(
    async ([selector, ms, moveBy, pointerType]) => {
      const target = document.querySelector<HTMLElement>(selector)!;
      const box = target.getBoundingClientRect();
      const at = (dy: number) => ({ clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 + dy, pointerId: 7, pointerType, isPrimary: true, bubbles: true, cancelable: true });
      const start = performance.now();
      const seen = { opened: null as number | null, due: null as number | null };
      let sunk = 1;
      // When the menu's put in the page: as it happens, not at the next frame, which a busy page can
      // be slow to draw.
      const menus = new MutationObserver(() => {
        if (seen.opened === null && document.querySelector('[role="menu"]')) seen.opened = performance.now() - start;
      });
      menus.observe(document.body, { childList: true, subtree: true });
      target.dispatchEvent(new PointerEvent("pointerdown", at(0)));
      setTimeout(() => (seen.due = performance.now() - start), 400);
      // Held `ms`, and at least until that timer's run, and a moment after it.
      while (performance.now() - start < ms || seen.due === null || performance.now() - start < seen.due + 50) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const elapsed = performance.now() - start;
        if (moveBy && elapsed > 100) target.dispatchEvent(new PointerEvent("pointermove", at(moveBy)));
        if (elapsed < 360) sunk = Number(getComputedStyle(target).scale) || 1;
      }
      menus.disconnect();
      target.dispatchEvent(new PointerEvent("pointerup", at(moveBy)));
      target.click();
      return { opened: seen.opened, sunk, due: seen.due, scale: getComputedStyle(target).scale };
    },
    [selector, ms, moveBy, pointerType] as const,
  );
}
