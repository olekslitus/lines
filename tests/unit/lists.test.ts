import { describe, expect, test } from "bun:test";
import { stubApp } from "./stubs";

stubApp();
const { fromSite, settle, toSite } = await import("../../src/lib/library/lists");
type Scale = import("../../src/lib/editor/scores").Scale;

/*
 * Keeping AniList's and MyAnimeList's lists in step with the Library (lib/library/lists.ts): a
 * rating on each scale and each site's, and which way a change goes.
 */

const stars: Scale = { kind: "marks", of: 5 };
const ten: Scale = { kind: "points", of: 10 };
const hundred: Scale = { kind: "points", of: 100 };
const grades: Scale = { kind: "labels", labels: ["S", "A", "B", "C", "D", "F"] };
const thumbs: Scale = { kind: "labels", labels: ["thumbs up", "thumbs down"] };
const MAL = { max: 10, step: 1 };
const POINT_100 = { max: 100, step: 1 };
const POINT_10_DECIMAL = { max: 10, step: 0.1 };
const POINT_5 = { max: 5, step: 1 };
const POINT_3 = { max: 3, step: 1 };

describe("ratings on a site's scale", () => {
  test("stars with halves are MyAnimeList's 0 to 10 exactly, both ways", () => {
    for (let mal = 1; mal <= 10; mal++) expect(toSite(fromSite(mal, stars, MAL), stars, MAL)).toBe(mal);
    expect(toSite("3.5/5", stars, MAL)).toBe(7);
    expect(fromSite(7, stars, MAL)).toBe("3.5/5");
    expect(fromSite(0, stars, MAL)).toBeUndefined();
    expect(toSite(undefined, stars, MAL)).toBe(0);
    // Rated, if as low as can be: never 0, which is no score.
    expect(toSite("0/5", stars, MAL)).toBe(1);
    expect(toSite("0.5/5", stars, POINT_3)).toBe(1);
  });

  test("each of AniList's formats, rounded half up to its step", () => {
    expect(toSite("4/5", stars, POINT_100)).toBe(80);
    expect(fromSite(85, stars, POINT_100)).toBe("4.5/5");
    expect(fromSite(84, stars, POINT_100)).toBe("4/5");
    expect(toSite("7.5/10", ten, POINT_10_DECIMAL)).toBe(7.5);
    expect(fromSite(7.3, ten, POINT_10_DECIMAL)).toBe("7.3/10");
    expect(fromSite(73, hundred, POINT_100)).toBe("73/100");
    expect(fromSite(7.3, hundred, POINT_10_DECIMAL)).toBe("73/100");
    expect(toSite("73/100", hundred, POINT_5)).toBe(4);
    expect(toSite("4/5", stars, POINT_3)).toBe(2);
    expect(toSite("5/5", stars, POINT_3)).toBe(3);
    expect(fromSite(2, stars, POINT_3)).toBe("3.5/5");
  });

  test("words: the best the site's top, the worst its lowest", () => {
    expect([..."SABCDF"].map((grade) => toSite(grade, grades, MAL))).toEqual([10, 8, 6, 5, 3, 1]);
    expect([10, 8, 6, 5, 3, 1].map((score) => fromSite(score, grades, MAL))).toEqual([..."SABCDF"]);
    expect(toSite("thumbs up", thumbs, POINT_100)).toBe(100);
    expect(toSite("thumbs down", thumbs, POINT_100)).toBe(1);
    expect(fromSite(70, thumbs, POINT_100)).toBe("thumbs up");
    expect(fromSite(30, thumbs, POINT_100)).toBe("thumbs down");
  });

  test("a rating that doesn't fit the kind's scale is no score to the site", () => {
    expect(toSite("A", stars, MAL)).toBe(0);
    expect(toSite("8/10", stars, MAL)).toBe(0);
  });
});

describe("which way a change goes", () => {
  const scales = { scale: stars, site: MAL };
  const last = { note: { status: "watching", rating: "3/5", progress: "4" }, site: { status: "watching", score: 6, progress: 4 } };
  const at = { note: 100, site: 50 };

  test("a change on one side alone carries to the other", () => {
    expect(settle({ note: { ...last.note, rating: "4/5", progress: "5" }, site: last.site }, last, at, scales)).toEqual({
      note: {},
      site: { status: "watching", score: 8, progress: 5 },
    });
    expect(settle({ note: last.note, site: { status: "watched", score: 9, progress: 12 } }, last, at, scales)).toEqual({
      note: { status: "watched", rating: "4.5/5", progress: "12" },
      site: null,
    });
  });

  test("a change on both, the later wins, field by field; what reads alike is left alone", () => {
    const now = { note: { ...last.note, rating: "5/5", progress: "6" }, site: { ...last.site, score: 2, status: "on hold" } };
    // The note changed later: its rating and progress go to the site; the status only the site changed comes to the note.
    expect(settle(now, last, { note: 200, site: 100 }, scales)).toEqual({ note: { status: "on hold" }, site: { status: "on hold", score: 10, progress: 6 } });
    // The site changed later: its rating comes to the note too.
    expect(settle(now, last, { note: 100, site: 200 }, scales)).toEqual({ note: { status: "on hold", rating: "1/5" }, site: { status: "on hold", score: 2, progress: 6 } });
    // `4/5` and 8 read alike: nothing's written either way, whatever changed.
    expect(settle({ note: { ...last.note, rating: "4/5" }, site: { ...last.site, score: 8 } }, last, at, scales)).toEqual({ note: {}, site: null });
  });

  test("never exchanged: the site's comes first, however newer the note, and the note fills in what the site hasn't; a score taken out on the site takes the rating out of the note", () => {
    expect(settle({ note: { status: "to watch", rating: "3/5" }, site: { status: "watching", score: 8, progress: 3 } }, undefined, { note: 2, site: 1 }, scales)).toEqual({
      note: { status: "watching", rating: "4/5", progress: "3" },
      site: null,
    });
    expect(settle({ note: { status: "watched", rating: "4.5/5", progress: "12" }, site: { status: null, score: 0, progress: 0 } }, undefined, { note: 1, site: 2 }, scales)).toEqual({
      note: {},
      site: { status: "watched", score: 9, progress: 12 },
    });
    expect(settle({ note: last.note, site: { ...last.site, score: 0 } }, last, at, scales)).toEqual({ note: { rating: null }, site: null });
  });

  test("a rating written that doesn't fit the kind's scale doesn't take the site's score away", () => {
    expect(settle({ note: { ...last.note, rating: "great" }, site: last.site }, last, at, scales)).toEqual({ note: {}, site: null });
  });

  test("neither side changed, though they read differently now (the kind's scale changed): left as they are", () => {
    const graded = { note: { ...last.note, rating: "A" }, site: last.site };
    expect(settle(graded, { ...last, note: graded.note }, at, scales)).toEqual({ note: {}, site: null });
  });
});
