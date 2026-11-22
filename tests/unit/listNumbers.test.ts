import { describe, expect, test } from "bun:test";
import { listNumber } from "../../src/lib/editor/listNumbers";

describe("a numbered sub-list's numbers, as drawn", () => {
  test("an outline numbers each level 1., a., i. in turn, then 1. again", () => {
    expect([1, 2, 3, 4, 5].map((level) => listNumber("2.", level, "outline"))).toEqual(["2.", "b.", "ii.", "2.", "b."]);
  });

  test("the classic outline numbers them I., A., 1., a., i.", () => {
    expect([1, 2, 3, 4, 5, 6].map((level) => listNumber("4.", level, "classic"))).toEqual(["IV.", "D.", "4.", "d.", "iv.", "IV."]);
  });

  test("numbers throughout leave them as written, a ) too", () => {
    expect([1, 2, 3].map((level) => listNumber("7)", level, "numbers"))).toEqual(["7)", "7)", "7)"]);
    expect(listNumber("3)", 2, "outline")).toBe("c)");
  });

  test("letters go on past z, as aa; numbers with no letters stay numbers", () => {
    expect(["26.", "27.", "52.", "53.", "702.", "703."].map((marker) => listNumber(marker, 2, "outline"))).toEqual(["z.", "aa.", "az.", "ba.", "zz.", "aaa."]);
    expect(["9.", "14.", "49.", "1994.", "3999."].map((marker) => listNumber(marker, 3, "outline"))).toEqual(["ix.", "xiv.", "xlix.", "mcmxciv.", "mmmcmxcix."]);
    expect(listNumber("4000.", 3, "outline")).toBe("4000.");
    expect(listNumber("0.", 2, "outline")).toBe("0.");
  });
});
