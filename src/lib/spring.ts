/*
 * Springs, as UIKit's slides move: a pane let go carries on at the finger's speed and comes to rest
 * as a damped spring does, rather than taking a set time along a set curve (which jumps to its own
 * speed the moment the finger lifts). Played as keyframes a frame apart with nothing eased between
 * them, which WebKit and Chromium run off the main thread for `translate` and `opacity`; a CSS
 * `linear()` easing would say the same, but WebKit's Core Animation (iPhone, iPad, Mac) can't run
 * one, and leaves it to the page.
 */

export interface Spring {
  /** How long one swing takes, s: what UIKit and SwiftUI call its response (SwiftUI's `duration`). */
  response: number;
  /** 1 comes to rest without passing the end (critically damped); less overshoots a little. */
  damping: number;
}

/**
 * Panes and the sidebar sliding: critically damped, a little quicker than SwiftUI's `.smooth`
 * (0.5 s, no bounce), as UIKit's navigation slides read.
 */
export const SLIDE: Spring = { response: 0.4, damping: 1 };

/** How far along it is between keyframes, s: two for each frame at 60 Hz, one at 120. */
const STEP = 1 / 120;
/** How close to the end it's at rest, as a share of the distance: half a pixel of a phone's width. */
const REST = 0.5 / 400;

export interface Curve {
  /** How far along it is (0 where it was let go, 1 at the end), each `STEP` from the start. */
  points: number[];
  /** How long it takes, ms. */
  duration: number;
  /** When it's as good as there, ms: within a pixel of the end, never to leave it again. */
  arrives: number;
}

/**
 * Where a spring goes from 0 to 1, setting off at `velocity` (the whole way per second, positive
 * toward the end). `distance`, px, is how far that is on screen, for when it's at rest; `clamp`
 * stops it at the end rather than letting it pass, for a pane that would show a gap beyond.
 */
export function springCurve(velocity = 0, { response, damping }: Spring = SLIDE, { distance = 400, clamp = true } = {}): Curve {
  const omega = (2 * Math.PI) / response;
  const zeta = Math.min(1, Math.max(0.05, damping));
  // What's left (1 to 0) at time t, and how fast it's shrinking.
  const left = (t: number) => {
    const decay = Math.exp(-zeta * omega * t);
    if (zeta === 1) return (1 + (omega - velocity) * t) * decay;
    const swing = omega * Math.sqrt(1 - zeta * zeta);
    return decay * (Math.cos(swing * t) + ((zeta * omega - velocity) / swing) * Math.sin(swing * t));
  };
  const rest = Math.max(REST, 0.5 / Math.max(distance, 1));
  const near = Math.max(REST, 1 / Math.max(distance, 1));
  const points: number[] = [];
  let reached = false;
  let settled = 0;
  let arrived = 0;
  for (let t = 0; t <= 3; t += STEP) {
    let at = 1 - left(t);
    if (clamp && (reached || at >= 1)) {
      reached = true;
      at = 1;
    }
    points.push(at);
    const off = Math.abs(1 - at);
    if (off >= rest) settled = points.length;
    if (off >= near) arrived = points.length;
  }
  points.length = Math.min(points.length, settled + 1);
  points[points.length - 1] = 1;
  return { points, duration: Math.round((points.length - 1) * STEP * 1000), arrives: Math.round(Math.min(arrived, points.length - 1) * STEP * 1000) };
}

/**
 * SLIDE from rest as a curve WebKit runs off the page, for what slides when it's tapped (the same
 * in app.css as `--ease-spring` and `--spring-duration`): within 3% of the spring all the way.
 */
export const SLIDE_EASE = "cubic-bezier(0.285, 0.458, 0.044, 1)";
export const SLIDE_MS = 573;
