import { beforeAll, describe, expect, test } from "bun:test";
import { stubApp } from "./stubs";

/*
 * Spreadsheets' cells (lib/sheets/): CSV as blocks and files keep them, filling cells along a
 * series, rows and columns put in and taken out, and the formulas IronCalc (plugins/ironcalc/)
 * works out and moves, as copying, cutting and putting in rows do in Excel.
 */

stubApp();
const { parseCsv, sniffDelimiter, trimCells, writeCsv } = await import("../../src/lib/sheets/csv");
const { movedCells, shiftCells, shifted } = await import("../../src/lib/sheets/cells");
const { continueCells } = await import("../../src/lib/sheets/fill");
const calc = await import("../../src/plugins/ironcalc/calc");

beforeAll(() => calc.start());

describe("CSV", () => {
  test("what's written, read back, is the same cells: commas, quotes, line breaks and spaces at either end included", () => {
    const cells = [
      ["Item", "Note", "Cost"],
      ["Rent, flat", 'the "big" one', "1200"],
      ["Food", "milk\neggs", " 450 "],
      ["", "", "=SUM(C2:C3)"],
    ];
    const text = writeCsv(cells);
    expect(text).toBe('Item,Note,Cost\n"Rent, flat","the ""big"" one",1200\nFood,"milk\neggs"," 450 "\n,,=SUM(C2:C3)');
    expect(parseCsv(text)).toEqual(cells);
  });

  test("written without the empty rows and columns at its end, unless they're kept; rows as wide as the widest", () => {
    const cells = [["a", "", ""], ["b"], ["", ""], [""]];
    expect(writeCsv(cells)).toBe("a\nb");
    expect(writeCsv(cells, ",", true)).toBe("a,,\nb,,\n,,\n,,");
    expect(trimCells([["a"], ["b", "c"]])).toEqual([
      ["a", ""],
      ["b", "c"],
    ]);
  });

  test("read as other apps write it: \\r\\n, a byte order mark, spaces after commas, a last line break; semicolons and tabs found", () => {
    expect(parseCsv('﻿Rent, 1200\r\nFood,  "450 "\r\n')).toEqual([
      ["Rent", "1200"],
      ["Food", "450 "],
    ]);
    expect(sniffDelimiter("Rent;1200,50\nFood;450\nGas;30,5")).toBe(";");
    expect(sniffDelimiter("Rent\t1200\nFood\t450")).toBe("\t");
    expect(sniffDelimiter("Rent,1200\nFood,450")).toBe(",");
    expect(parseCsv("Rent;1200,50", ";")).toEqual([["Rent", "1200,50"]]);
    expect(writeCsv([["Rent", "1200,50"]], ";")).toBe("Rent;1200,50");
  });
});

describe("cells", () => {
  const cells = () => [
    ["a", "b", "c"],
    ["d", "e", "f"],
    ["g", "h", "i"],
  ];

  test("rows and columns put in and taken out, the rest moving with them", () => {
    expect(shiftCells(cells(), "row", 1, 1)).toEqual([["a", "b", "c"], [], ["d", "e", "f"], ["g", "h", "i"]]);
    expect(shiftCells(cells(), "row", 0, -2)).toEqual([["g", "h", "i"]]);
    expect(shiftCells(cells(), "column", 1, 2)).toEqual([
      ["a", "", "", "b", "c"],
      ["d", "", "", "e", "f"],
      ["g", "", "", "h", "i"],
    ]);
    expect(shiftCells(cells(), "column", 2, -1)).toEqual([
      ["a", "b"],
      ["d", "e"],
      ["g", "h"],
    ]);
    // A row ending where columns go in after it takes them too.
    expect(shiftCells([["a"], ["b", "c"]], "column", 1, 1)).toEqual([
      ["a", ""],
      ["b", "", "c"],
    ]);
  });

  test("where a cell goes then: before them it stays, after them it moves, among those taken out it's gone", () => {
    expect(shifted(0, 2, "row", 1, 2)).toEqual([0, 2]);
    expect(shifted(1, 2, "row", 1, 2)).toEqual([3, 2]);
    expect(shifted(1, 2, "column", 1, -1)).toEqual([1, 1]);
    expect(shifted(1, 1, "column", 1, -1)).toBeNull();
    expect(shifted(2, 0, "row", 1, -1)).toEqual([1, 0]);
  });

  test("moved, over what's there, leaving where they were empty", () => {
    expect(movedCells(cells(), { top: 0, left: 0, bottom: 1, right: 0 }, 1, 2)).toEqual([
      ["", "b", "c"],
      ["", "e", "a"],
      ["g", "h", "d"],
    ]);
    // Past the end, the rows grow to take them.
    expect(movedCells([["a"]], { top: 0, left: 0, bottom: 0, right: 0 }, 2, 1)).toEqual([[""], [], ["", "a"]]);
  });
});

describe("filling cells", () => {
  const moved = (formula: string, steps: number) => `${formula}+${steps}`;
  const fill = (cells: string[], count: number, other = false) => continueCells(cells, count, { moved, other, locale: "en" });

  test("numbers go on along their trend; one repeats, unless swapped, and then a series repeats", () => {
    expect(fill(["1", "3"], 3)).toEqual(["5", "7", "9"]);
    expect(fill(["0.5", "1"], 2)).toEqual(["1.5", "2.0"]);
    expect(fill(["10", "8"], 2)).toEqual(["6", "4"]);
    expect(fill(["7"], 2)).toEqual(["7", "7"]);
    expect(fill(["7"], 2, true)).toEqual(["8", "9"]);
    expect(fill(["1", "3"], 3, true)).toEqual(["1", "3", "1"]);
  });

  test("text ending in a number counts on, keeping its zeros; days, months and dates go on", () => {
    expect(fill(["Item 1"], 2)).toEqual(["Item 2", "Item 3"]);
    expect(fill(["Room 007", "Room 009"], 1)).toEqual(["Room 011"]);
    expect(fill(["Mon"], 2)).toEqual(["Tue", "Wed"]);
    expect(fill(["Saturday"], 2)).toEqual(["Sunday", "Monday"]);
    expect(fill(["January", "March"], 2)).toEqual(["May", "July"]);
    expect(fill(["2026-01-30"], 3)).toEqual(["2026-01-31", "2026-02-01", "2026-02-02"]);
    // A month apart: by months, the 31st the last day of a shorter one.
    expect(fill(["2026-01-31", "2026-02-28"], 1)).toEqual(["2026-03-28"]);
    expect(fill(["2025-11-30", "2025-12-30"], 2)).toEqual(["2026-01-30", "2026-02-28"]);
  });

  test("anything else repeats, formulas moved as many cells on as they're copied", () => {
    expect(fill(["x", "y"], 3)).toEqual(["x", "y", "x"]);
    expect(fill(["=A1", "z"], 3)).toEqual(["=A1+2", "z", "=A1+4"]);
  });
});

describe("formulas, as IronCalc works them out", () => {
  const values = (cells: string[][]) => {
    const sheet = calc.sheet();
    try {
      sheet.update(cells);
      return cells.map((row, r) => row.map((_, c) => sheet.value(r, c).text));
    } finally {
      sheet.free();
    }
  };

  test("work out, error and all, and again as the cells change", () => {
    expect(values([["2", "3", "=A1*B1", "=SUM(A1:C1)", "=A1/0"]])).toEqual([["2", "3", "6", "11", "#DIV/0!"]]);
    const sheet = calc.sheet();
    try {
      sheet.update([["2", "=A1*10"]]);
      expect(sheet.value(0, 1).text).toBe("20");
      sheet.update([["5", "=A1*10"]]);
      expect(sheet.value(0, 1).text).toBe("50");
      sheet.update([["5", "=A1*10", "=B1+1"]]);
      expect(sheet.value(0, 2).text).toBe("51");
      // Emptied: a number gone is nothing, a formula gone is nothing at all.
      sheet.update([["", "=A1*10", "=B1+1"]]);
      expect([sheet.value(0, 1).text, sheet.value(0, 2).text]).toEqual(["0", "1"]);
      sheet.update([["5"]]);
      expect([sheet.value(0, 1).text, sheet.value(0, 2).text]).toEqual(["", ""]);
    } finally {
      sheet.free();
    }
  });

  test("copied, their relative references move with them, absolute ones stay; off the sheet is #REF!", () => {
    expect(calc.move("=A1+$B$2+C$3+$D4", 2, 1)).toBe("=B3+$B$2+D$3+$D6");
    expect(calc.move("=SUM(B2:B4)", 1, 0)).toBe("=SUM(B3:B5)");
    expect(calc.move("=SUM(A:A)", 0, 1)).toBe("=SUM(B:B)");
    expect(calc.move("=Budget!B4*2", 1, 0)).toBe("=Budget!B5*2");
    expect(calc.move("=A1", -1, 0)).toBe("=#REF!");
    expect(calc.move("12", 3, 3)).toBe("12");
  });

  test("rows and columns put in or taken out: formulas still point at the same cells, those at cells taken out at #REF!", () => {
    const cells = [
      ["Rent", "1200"],
      ["Food", "450"],
      ["Gas", "80"],
      ["Total", "=SUM(B1:B3)"],
      ["Half", "=B4/2"],
    ];
    expect(calc.shift(cells, "row", 1, 1)).toEqual([["Rent", "1200"], [], ["Food", "450"], ["Gas", "80"], ["Total", "=SUM(B1:B4)"], ["Half", "=B5/2"]]);
    expect(calc.shift(cells, "row", 1, -1)).toEqual([
      ["Rent", "1200"],
      ["Gas", "80"],
      ["Total", "=SUM(B1:B2)"],
      ["Half", "=B3/2"],
    ]);
    expect(calc.shift(cells, "column", 0, 1)).toEqual([
      ["", "Rent", "1200"],
      ["", "Food", "450"],
      ["", "Gas", "80"],
      ["", "Total", "=SUM(C1:C3)"],
      ["", "Half", "=C4/2"],
    ]);
    expect(calc.shift(cells, "row", 3, -1)[3]).toEqual(["Half", "=#REF!/2"]);
    // A formula whose references don't change stays as it was written.
    expect(calc.shift([["=sum( A1 )"], ["1"]], "row", 1, 1)).toEqual([["=sum( A1 )"], [], ["1"]]);
  });

  test("cells moved, as cut and pasted: formulas pointing at them follow, theirs point where they did", () => {
    const cells = [
      ["1", "=A1*2"],
      ["2", ""],
      ["=A1+A2", ""],
    ];
    // A1:A2 moved one column across, to B1:B2, over B1's formula.
    expect(calc.moveCells(cells, { top: 0, left: 0, bottom: 1, right: 0 }, 0, 1)).toEqual([
      ["", "1"],
      ["", "2"],
      ["=B1+B2", ""],
    ]);
    // The total moved down a row: still the sum of the same cells.
    expect(calc.moveCells(cells, { top: 2, left: 0, bottom: 2, right: 0 }, 1, 0)).toEqual([["1", "=A1*2"], ["2", ""], ["", ""], ["=A1+A2"]]);
    // Moved down by one, onto itself in part: each formula still points at the cell it did.
    expect(calc.moveCells(cells, { top: 0, left: 0, bottom: 1, right: 1 }, 1, 0)).toEqual([
      ["", ""],
      ["1", "=A2*2"],
      ["2", ""],
    ]);
    const crossed = [
      ["1", "=A2"],
      ["2", "=A1"],
      ["3", ""],
    ];
    expect(calc.moveCells(crossed, { top: 0, left: 0, bottom: 1, right: 1 }, 1, 0)).toEqual([
      ["", ""],
      ["1", "=A3"],
      ["2", "=A2"],
    ]);
  });
});
