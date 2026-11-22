import type { ListNumbering } from "../prefs.svelte";

/*
 * A numbered list's number as drawn, by how deep it is in numbered lists (Settings → Editor →
 * Numbered sub-lists): an outline's 1., a., i. for each level in turn, or I., A., 1., a., i., or
 * 1. throughout. Only the drawing changes: the Markdown keeps the number written (`2.`, `2)`), so
 * other apps read it as before. Bullet lists between them don't count as a level.
 */

type Counter = "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

const LEVELS: Record<ListNumbering, Counter[]> = {
  outline: ["decimal", "lower-alpha", "lower-roman"],
  classic: ["upper-roman", "upper-alpha", "decimal", "lower-alpha", "lower-roman"],
  numbers: ["decimal"],
};

const ROMAN: [string, number][] = [
  ["m", 1000], ["cm", 900], ["d", 500], ["cd", 400], ["c", 100], ["xc", 90],
  ["l", 50], ["xl", 40], ["x", 10], ["ix", 9], ["v", 5], ["iv", 4], ["i", 1],
];

/** 1 as a, 26 as z, 27 as aa, as CSS's lower-alpha counts. */
function alpha(n: number) {
  let out = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(97 + ((n - 1) % 26)) + out;
  return out;
}

function roman(n: number) {
  let out = "";
  for (const [digits, value] of ROMAN) for (; n >= value; n -= value) out += digits;
  return out;
}

function count(n: number, counter: Counter) {
  // As CSS does, numbers a counter has no letters for are written as numbers.
  if (counter === "decimal" || n < 1 || (counter.endsWith("roman") && n > 3999)) return String(n);
  const written = counter.endsWith("alpha") ? alpha(n) : roman(n);
  return counter.startsWith("upper") ? written.toUpperCase() : written;
}

/** The marker drawn for an item numbered `marker` (`3.`, `3)`), `level` numbered lists deep (1 at the outermost). */
export function listNumber(marker: string, level: number, numbering: ListNumbering) {
  const levels = LEVELS[numbering];
  return count(parseInt(marker, 10), levels[(level - 1) % levels.length]) + marker.slice(-1);
}
