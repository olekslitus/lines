import { fractionOf, type Scale, scoreIn, scoreText } from "../editor/scores";

/*
 * Keeping a site's list (AniList's, MyAnimeList's) and the Library's notes in step: how a rating on a
 * kind's scale reads on the site's, and the other way, and which way a change goes. What was last
 * exchanged with the site is kept for each entry, both sides of it, so a side has changed when it's
 * no longer that, as lines' sync tells notes apart; where both have, the later change wins. A value
 * that reads the same on both sides (`4/5` and 8 out of 10) is left as it is, so nothing churns.
 */

/** Why a list's site couldn't be asked: it didn't take the token, it said to wait (until, ms), it answered something else, or it couldn't be reached. */
export class ListError extends Error {
  constructor(
    readonly reason: "token" | "wait" | "status" | "offline",
    message: string,
    readonly until?: number,
  ) {
    super(message);
  }
}

/** How a site scores: out of `max`, by `step` (AniList's "10 point decimal" is out of 10 by tenths, MyAnimeList's out of 10, whole). 0 is none, on every site. */
export interface SiteScale {
  max: number;
  step: number;
}

/** `value` to the nearest `step`, halves up, without a float's dust (`0.30000000000000004`). */
const near = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(2));

/**
 * A rating, as written on `scale`, on a site's: the same share of the way up, to its step, and never
 * 0 (none) for one that's rated; words go from the site's lowest score, the worst, to its top, the
 * best. 0 for no rating, or one that doesn't fit the scale.
 */
export function toSite(written: string | undefined, scale: Scale, site: SiteScale): number {
  const score = written ? scoreIn(written, scale) : null;
  if (!score) return 0;
  const lowest = site.step;
  const value = score.label === undefined ? fractionOf(score) * site.max : lowest + fractionOf(score) * (site.max - lowest);
  return Math.min(site.max, Math.max(lowest, near(value, site.step)));
}

/**
 * A site's score as `scale` writes it: the same share of the way up, to the scale's step (marks by
 * halves, points out of 10 or less by tenths, more by ones), or the word nearest; none for 0.
 */
export function fromSite(score: number, scale: Scale, site: SiteScale): string | undefined {
  if (!(score > 0)) return undefined;
  if (scale.kind === "labels") {
    const lowest = site.step;
    const up = site.max > lowest ? Math.min(1, Math.max(0, (score - lowest) / (site.max - lowest))) : 1;
    return scale.labels[Math.round((1 - up) * (scale.labels.length - 1))];
  }
  const step = scale.kind === "marks" ? 0.5 : scale.of > 10 ? 1 : 0.1;
  return scoreText(near((score / site.max) * scale.of, step), scale);
}

/** What a note says of something on a list: its status, rating and progress, as written; a property it hasn't got, undefined. */
export interface Said {
  status?: string;
  rating?: string;
  progress?: string;
}

/** What a site has of it: its status in lines' words (null, none it knows), its score in its own (0, none), how far through (episodes, chapters). */
export interface Held {
  status: string | null;
  score: number;
  progress: number;
}

/** Both sides of an entry as they were when they were last made alike. */
export interface Exchanged {
  note: Said;
  site: Held;
}

/** What settling an entry does: what to write in the note (null takes a property out), and what to save on the site, if anything. */
export interface Settled {
  note: Partial<Record<keyof Said, string | null>>;
  site: Held | null;
}

const FIELDS = [
  ["status", "status"],
  ["rating", "score"],
  ["progress", "progress"],
] as const;

/**
 * Which way each of an entry's status, rating and progress goes, now that the note says `note` and
 * the site has `site`, against what they were when `last` exchanged. A side that changed alone
 * carries; where both did, the later (`times`, ms); where they read alike, nothing. Never exchanged
 * yet, the site's carries where it has one. `scale` is the note's kind's, `site` the site's.
 */
export function settle(
  now: { note: Said; site: Held },
  last: Exchanged | undefined,
  times: { note: number; site: number },
  scales: { scale: Scale; site: SiteScale },
): Settled {
  const settled: Settled = { note: {}, site: null };
  const wanted: Held = { ...now.site };
  for (const [said, held] of FIELDS) {
    const written = now.note[said]?.trim() || undefined;
    const value = now.site[held];
    const alike =
      held === "status" ? (written ?? null) === value : held === "score" ? toSite(written, scales.scale, scales.site) === value : (Number(written) || 0) === value;
    if (alike) continue;
    const noteChanged = !last || (last.note[said]?.trim() || undefined) !== written;
    const siteChanged = !last || last.site[held] !== value;
    // Neither changed, but they don't read alike (the kind's scale changed since): left as they are.
    if (!noteChanged && !siteChanged) continue;
    // The first time, what the site has comes first, and the note fills in only what it hasn't: a note
    // made from a link, which starts `to watch`, mustn't undo a list kept for years.
    const fromNote = last ? noteChanged && (!siteChanged || times.note > times.site) : !value;
    // A rating written that doesn't fit the kind's scale (`great` in stars) says nothing to the site: it keeps its score.
    if (fromNote && held === "score" && written !== undefined && !toSite(written, scales.scale, scales.site)) continue;
    if (!fromNote) {
      settled.note[said] = held === "status" ? now.site.status : held === "score" ? (fromSite(now.site.score, scales.scale, scales.site) ?? null) : now.site.progress ? String(now.site.progress) : null;
    } else if (held === "status") {
      // A status the site has no word for (one of your own) stays the note's.
      if (written !== undefined) wanted.status = written;
    } else if (held === "score") wanted.score = toSite(written, scales.scale, scales.site);
    else wanted.progress = Math.max(0, Math.floor(Number(written) || 0));
  }
  if (FIELDS.some(([, held]) => wanted[held] !== now.site[held])) settled.site = wanted;
  return settled;
}
