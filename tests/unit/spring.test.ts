import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE, springCurve } from "../../src/lib/spring";

/*
 * The springs slides finish on (spring.ts): setting off at the finger's speed, with no jump, and
 * coming to rest without passing the end; and the CSS curve tapped slides use (app.css), close to
 * the same spring from rest.
 */

const STEP = 1000 / 120;
/** How hard the spring pulls at the start, the whole way per second², from where it's let go: ω². */
const PULL = ((2 * Math.PI) / SLIDE.response) ** 2;
/** How fast it's going at the start, the whole way per second. */
const startSpeed = (points: number[]) => (points[1] - points[0]) / (STEP / 1000);

test("let go at the finger's speed, it carries on at that speed: no jump, and no ease-in", () => {
  for (const velocity of [0.5, 2, 4]) {
    const { points } = springCurve(velocity);
    expect(points[0]).toBe(0);
    // The finger's speed, but for what the spring's own pull adds in the first 8 ms.
    expect(Math.abs(startSpeed(points) - velocity)).toBeLessThan(PULL * (STEP / 1000));
  }
  // From rest, it sets off slowly but is quickly going: a spring, not a fixed curve's ease.
  const still = springCurve(0).points;
  expect(startSpeed(still)).toBeLessThan((PULL * (STEP / 1000)) / 2 + 0.01);
  expect(still[Math.round(64 / STEP)]).toBeGreaterThan(0.1);
});

test("it comes to rest at the end, without passing it, in about half a second from rest; faster let go, sooner", () => {
  const still = springCurve(0);
  expect(still.points.at(-1)).toBe(1);
  expect(Math.max(...still.points)).toBe(1);
  expect(still.duration).toBeGreaterThan(450);
  expect(still.duration).toBeLessThan(700);
  // As good as there well before it's done settling.
  expect(still.arrives).toBeLessThan(still.duration);
  expect(still.arrives).toBeGreaterThan(350);
  const flicked = springCurve(5);
  expect(Math.max(...flicked.points)).toBe(1);
  expect(flicked.arrives).toBeLessThan(still.arrives);
  // Moving away when let go, it goes on that way a little before it turns.
  const back = springCurve(-2);
  expect(Math.min(...back.points)).toBeLessThan(0);
  expect(back.points.at(-1)).toBe(1);
});

test("never stopping before it's there, nor shaking at the end, whatever the speed", () => {
  for (const velocity of [-6, -1, 0, 0.3, 1, 3, 10, 40]) {
    const { points, duration, arrives } = springCurve(velocity, SLIDE, { distance: 390 });
    expect(points.every(Number.isFinite)).toBe(true);
    expect(arrives).toBeLessThanOrEqual(duration);
    expect(duration).toBeLessThan(1500);
    // Once at the end, clamped there.
    const first = points.indexOf(1);
    expect(points.slice(first).every((at) => at === 1)).toBe(true);
  }
});

test("a slide tapped is close to the same spring from rest, as a curve WebKit can run off the page (cubic-bezier)", () => {
  const css = readFileSync(new URL("../../src/app.css", import.meta.url), "utf8");
  const [, x1, y1, x2, y2] = /--ease-spring: cubic-bezier\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)/.exec(css)!.map(Number);
  const duration = Number(/--spring-duration: (\d+)ms/.exec(css)![1]);
  const { points } = springCurve(0);
  // The curve's y for x, by bisection on its parameter.
  const bezier = (x: number) => {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 40; i++) {
      const t = (low + high) / 2;
      if (3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3 < x) low = t;
      else high = t;
    }
    const t = (low + high) / 2;
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  };
  points.forEach((at, i) => expect(Math.abs(bezier(Math.min(1, (i * STEP) / duration)) - at)).toBeLessThan(0.03));
});
