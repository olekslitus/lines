import type { Attachment } from "svelte/attachments";
import { tick } from "./haptics";
import { isIOS, reducedMotion } from "./platform";
import { prefs } from "./prefs.svelte";
import { SLIDE, SLIDE_EASE, SLIDE_MS, springCurve } from "./spring";

/*
 * Touch screens' gestures, as iOS has them: swipes that follow the finger (back from a note to the
 * list, the sidebar in and out) and pulls down past a list's or a note's top (to search, find or
 * refresh). They're extras: what each does has a button too, and they're touch only, so a mouse
 * never starts one. Settings → General turns them off.
 *
 * A finger that's selecting text or dragging something isn't taken: one held still before it
 * moves, or one on something that follows the finger itself (`touch-action: none`: a line's grip,
 * a picture's corner), or on something it can scroll that way (a wide table or code block).
 */

/** How far from the screen's edge a swipe from it starts, about as far as UIKit's. */
export const EDGE = 24;
/** How far a finger moves before it's a swipe or a pull rather than a tap. */
const SLOP = 10;
/** A finger held this long before it moves is selecting text or dragging, not swiping. */
const HOLD = 400;
/** How fast a flick is, px/ms: a swipe flicked its way is done, however far it went. */
const FLICK = 0.4;
/** How far a pull goes before letting go does what it's for, px as it's drawn. */
export const PULL = 64;
/** How much room a pull keeps open while what it started runs (the spinner's). */
const PULL_HOLD = 52;

/**
 * Rubber band: the further past the end, the stiffer, never more than `size` (the curve iOS
 * uses, with its constant).
 */
export const rubberBand = (distance: number, size: number) => (1 - 1 / ((distance * 0.55) / size + 1)) * size;

/** How long a pull takes to slide back, along the spring tapped slides use (spring.ts). */
const settles = () => (reducedMotion.matches ? 0 : SLIDE_MS);

/**
 * Whether something between `target` and `root` takes this finger itself: it follows the finger
 * (`touch-action: none`), or on the axis, has room to scroll `toward` (+1: the finger moves right
 * or down).
 */
function takenInside(target: EventTarget | null, root: Element, axis: "x" | "y", toward: number) {
  for (let element = target instanceof Element ? target : null; element && element !== root; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.touchAction === "none" || (axis === "y" && style.touchAction === "pan-x")) return true;
    if (element instanceof HTMLInputElement && element.type === "range") return true;
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const [at, room] = axis === "x" ? [element.scrollLeft, element.scrollWidth - element.clientWidth] : [element.scrollTop, element.scrollHeight - element.clientHeight];
    if (room > 1 && (toward > 0 ? at > 0 : at < room - 1)) return true;
  }
  return false;
}

/** A swipe sideways that follows the finger, as a pane slides. */
export interface Swipe {
  /** Which way: +1 rightward, -1 leftward. */
  direction: 1 | -1;
  /** How far the finger goes for it to be all the way, px. */
  distance: number;
  /** The finger has started it. */
  begin(): void;
  /** Where it is: 0 as it started, 1 all the way. */
  move(progress: number): void;
  /**
   * Let go: whether it's done or goes back, and how fast the finger was going its way, the whole
   * distance per second (0 if it had stopped, or the system took the touch), for the slide to carry
   * on from.
   */
  end(done: boolean, velocity: number): void;
}

/** What swipe a finger put down at (x, y) would start, if any. */
type SwipeAt = (x: number, y: number) => Swipe | null;
const swipeFinders = new Set<SwipeAt>();

/** Whether a finger put down at (x, y) would start a swipe, which then comes before a row's own. */
export const swipeStartsAt = (x: number, y: number) => prefs.gestures && [...swipeFinders].some((at) => at(x, y));

/**
 * Swipes over `root`: `at` says which, if any, a finger put down there starts. It follows the
 * finger once it moves its way, and on letting go is done past halfway or flicked, else goes back.
 */
export function swipes(at: SwipeAt): Attachment<HTMLElement> {
  return (root) => {
    swipeFinders.add(at);
    let finger: {
      id: number;
      swipe: Swipe;
      x: number;
      y: number;
      t: number;
      following: boolean;
      progress: number;
      lastX: number;
      lastT: number;
      velocity: number;
    } | null = null;

    const ours = (event: TouchEvent) => finger && [...event.changedTouches].find((touch) => touch.identifier === finger!.id);

    function start(event: TouchEvent) {
      // Another finger on the way doesn't take over a swipe the first is moving.
      if (finger?.following) return;
      finger = null;
      if (!prefs.gestures || event.touches.length !== 1) return;
      const { identifier: id, clientX: x, clientY: y } = event.touches[0];
      const swipe = at(x, y);
      if (!swipe || takenInside(event.target, root, "x", swipe.direction)) return;
      finger = { id, swipe, x, y, t: event.timeStamp, following: false, progress: 0, lastX: x, lastT: event.timeStamp, velocity: 0 };
    }

    function move(event: TouchEvent) {
      const touch = ours(event);
      if (!touch || !finger) return;
      if (event.touches.length > 1) return cancel();
      const dx = touch.clientX - finger.x;
      const dy = touch.clientY - finger.y;
      const { swipe } = finger;
      if (!finger.following) {
        // Clearly sideways, or it's a scroll: WebKit decides on a touch's first move whether the
        // page may scroll, and a scroll whose first move is stopped is lost, however it goes on.
        const sideways = dx * swipe.direction > 0 && Math.abs(dx) >= 2 * Math.abs(dy);
        // Not sideways its way, too late to stop the page scrolling, or held first: not a swipe.
        if (!event.cancelable || event.timeStamp - finger.t > HOLD || (Math.hypot(dx, dy) >= SLOP && !sideways)) {
          finger = null;
          return;
        }
        // Its way so far: the page isn't to start scrolling.
        if (sideways) event.preventDefault();
        if (Math.hypot(dx, dy) < SLOP) return;
        finger.following = true;
        swipe.begin();
      }
      event.preventDefault();
      const dt = event.timeStamp - finger.lastT;
      if (dt > 0) finger.velocity = 0.6 * ((touch.clientX - finger.lastX) / dt) + 0.4 * finger.velocity;
      finger.lastX = touch.clientX;
      finger.lastT = event.timeStamp;
      finger.progress = Math.min(1, Math.max(0, (dx * swipe.direction) / swipe.distance));
      swipe.move(finger.progress);
    }

    function end(event: TouchEvent) {
      if (!ours(event) || !finger) return;
      const { following, swipe, progress, lastT } = finger;
      // A finger that stopped before it was lifted wasn't flicked.
      const velocity = event.type === "touchend" && event.timeStamp - lastT < 80 ? finger.velocity * swipe.direction : 0;
      finger = null;
      if (!following) return;
      const done = event.type === "touchend" && (velocity > FLICK || (progress > 0.5 && velocity > -FLICK));
      swipe.end(done, (velocity * 1000) / swipe.distance);
    }

    function cancel() {
      if (finger?.following) finger.swipe.end(false, 0);
      finger = null;
    }

    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", end);
    root.addEventListener("touchcancel", end);
    return () => {
      cancel();
      swipeFinders.delete(at);
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", end);
    };
  };
}

/** How each element looks `shown` of the way along a slide: its `translate` and `opacity`, which run off the page. */
export type Frames = (shown: number) => [HTMLElement, Keyframe][];

/**
 * Slides what `frames` draws from `from` of the way to `to` along SLIDE, setting off at
 * `velocity` (the whole way per second, toward `to`), `distance` px being the whole way on screen.
 * Each element is left styled as at `to`, with no transition of its own; `arrived` resolves once
 * it's as good as there, and `finished` once it's at rest (both at once with Reduce Motion);
 * `cancel` stops it where it is.
 */
export function slide(frames: Frames, from: number, to: number, velocity: number, distance: number) {
  const end = frames(to);
  for (const [element, style] of end) {
    element.style.transition = "none";
    for (const [property, value] of Object.entries(style)) element.style.setProperty(property, String(value));
  }
  const span = to - from;
  if (reducedMotion.matches || !span) return { arrived: Promise.resolve(), finished: Promise.resolve(), cancel() {} };
  const curve = springCurve(velocity / Math.abs(span), SLIDE, { distance: Math.abs(span) * distance });
  const all = curve.points.map((at) => frames(from + span * at));
  const animations = end.map(([element], i) => element.animate(all.map((each) => each[i][1]), { duration: curve.duration, easing: "linear" }));
  return {
    arrived: new Promise<void>((resolve) => setTimeout(resolve, curve.arrives)),
    finished: Promise.all(animations.map((animation) => animation.finished)).then(
      () => {},
      () => {},
    ),
    cancel: () => animations.forEach((animation) => animation.cancel()),
  };
}

/** A pull down past a scroller's top. */
export interface Pull {
  /** What scrolls: the list, or the note. */
  scroller(): HTMLElement | null | undefined;
  /**
   * What shows in the room the pull opens, a child of the attachment's element placed at the
   * scroller's top. It's given `--pull`, how far down the scroller is (a length), and `--pulled`,
   * how far towards doing what it's for (0 to 1); `data-armed` once letting go would, and
   * `data-busy` while what it started runs.
   */
  indicator(): HTMLElement | null | undefined;
  /** Whether a pull does anything now. */
  enabled?(): boolean;
  /** Whether it ticks in the hand as it's pulled far enough. */
  haptic?(): boolean;
  /** Let go far enough. A promise keeps the room open, with the indicator busy in it, until it settles. */
  release(): unknown;
  /** Let go short of that, `distance` px down as it's drawn. */
  letGo?(distance: number): void;
}

/**
 * A pull down past the top of a scroller in `root` (positioned, for the indicator). On iPhone and
 * iPad a scroller with more than fits bounces past its top by itself, and the pull is how far it
 * has; elsewhere, or one with less, it's moved down here, stretching like a rubber band.
 */
export function pull(options: Pull): Attachment<HTMLElement> {
  /**
   * Whether it stops the page scrolling as it pulls. Not on iPhone and iPad, where what's pulled
   * bounces by itself: there it only watches, so WebKit needn't wait on it before scrolling.
   */
  const stops = !isIOS;
  return (root) => {
    let finger: { id: number; y: number; x: number; t: number; scroller: HTMLElement; native: boolean; following: boolean } | null = null;
    let armed = false;
    let busy = false;
    /** How far down it's drawn. */
    let shown = 0;
    /** The scroller moved down here, if it is. */
    let moved: HTMLElement | null = null;

    const ours = (event: TouchEvent) => finger && [...event.changedTouches].find((touch) => touch.identifier === finger!.id);

    /** Shows the pull `distance` down, sliding there over `duration` ms (0: at once, following the finger). */
    function show(distance: number, duration = 0, scroller?: HTMLElement) {
      shown = distance;
      const transition = duration ? `${duration}ms ${SLIDE_EASE}` : "";
      if (scroller) {
        moved = distance ? scroller : null;
        scroller.style.transition = transition && `translate ${transition}`;
        scroller.style.translate = distance ? `0 ${distance}px` : "";
      }
      const indicator = options.indicator();
      if (!indicator) return;
      indicator.style.transition = transition && `--pull ${transition}, --pulled ${transition}`;
      indicator.style.setProperty("--pull", `${distance}px`);
      indicator.style.setProperty("--pulled", String(Math.min(1, distance / PULL)));
      const now = distance >= PULL;
      if (now === armed) return;
      armed = now;
      indicator.toggleAttribute("data-armed", armed);
      if (armed && finger && options.haptic?.()) tick();
    }

    /** At the scroller's top, where the room opens. */
    function place(scroller: HTMLElement) {
      const indicator = options.indicator();
      if (indicator) indicator.style.top = `${scroller.getBoundingClientRect().top - root.getBoundingClientRect().top}px`;
    }

    function start(event: TouchEvent) {
      if (finger || busy || event.touches.length !== 1 || !prefs.gestures || options.enabled?.() === false) return;
      const scroller = options.scroller();
      if (!scroller || !scroller.contains(event.target as Node) || takenInside(event.target, scroller, "y", 1)) return;
      const { identifier: id, clientX: x, clientY: y } = event.touches[0];
      finger = { id, x, y, t: event.timeStamp, scroller, native: isIOS && scroller.scrollHeight > scroller.clientHeight, following: false };
      place(scroller);
    }

    function move(event: TouchEvent) {
      const touch = ours(event);
      if (!touch || !finger || finger.native) return;
      const dx = touch.clientX - finger.x;
      const dy = touch.clientY - finger.y;
      if (!finger.following) {
        const far = Math.hypot(dx, dy) >= SLOP;
        // Not down from the top, too late to stop the page scrolling, or held first: not a pull.
        if (event.touches.length > 1 || finger.scroller.scrollTop > 0 || !event.cancelable || (far && (dy <= 0 || Math.abs(dx) > dy)) || event.timeStamp - finger.t > HOLD) {
          finger = null;
          return;
        }
        // Down at the top already: the page isn't to scroll, nor bounce, from here.
        if (dy > 0 && stops) event.preventDefault();
        if (!far) return;
        finger.following = true;
      }
      if (stops) event.preventDefault();
      show(rubberBand(Math.max(0, dy), root.clientHeight), 0, finger.scroller);
    }

    /** iPhone's own bounce past the top. */
    function scrolled(event: Event) {
      const scroller = event.target as HTMLElement;
      if (busy || !prefs.gestures || options.enabled?.() === false || scroller !== options.scroller() || (!finger?.native && !armed && scroller.scrollTop >= 0)) return;
      show(Math.max(0, -scroller.scrollTop));
    }

    function end(event: TouchEvent) {
      if (!ours(event) || !finger) return;
      const { native, following, scroller } = finger;
      const go = event.type === "touchend" && armed;
      finger = null;
      if (!native && !following) return;
      if (!go) {
        options.letGo?.(shown);
        if (!native) show(0, settles(), scroller);
        return;
      }
      const result = options.release();
      if (!(result instanceof Promise)) {
        // On iPhone the bounce back is followed as it scrolls.
        if (!native) show(0, settles(), scroller);
        return;
      }
      busy = true;
      const indicator = options.indicator();
      indicator?.toggleAttribute("data-busy", true);
      show(PULL_HOLD, settles(), scroller);
      // Long enough to be seen to spin, however soon it's done.
      void Promise.all([result.catch(() => {}), new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : 500))]).then(() => {
        indicator?.toggleAttribute("data-busy", false);
        const duration = settles();
        show(0, duration, scroller);
        setTimeout(() => (busy = false), duration);
      });
    }

    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: !stops });
    root.addEventListener("touchend", end);
    root.addEventListener("touchcancel", end);
    // Scrolling doesn't bubble, but it's seen on its way down.
    root.addEventListener("scroll", scrolled, { capture: true, passive: true });
    return () => {
      if (moved) show(0, 0, moved);
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", end);
      root.removeEventListener("scroll", scrolled, { capture: true });
    };
  };
}
