import type { Cells } from "../../lib/plugins/types";
import type { Point } from "./pointing.svelte";

/*
 * Copied cells go on the clipboard as tab-separated values, as other spreadsheet apps paste them,
 * and as an HTML table of what they show (a table elsewhere), each cell with what's written in it
 * (`data-input`, a formula say) and the table with where they were copied from. Pasted into a sheet
 * in another window or tab, they keep their formulas, moved as copying moves them.
 */

/** Cells copied from a sheet: what's written in them, and where the first was. */
export interface CopiedCells extends Point {
  inputs: Cells;
}

/** The cells' `values` as an HTML table, with what's written in each and where they were. */
export function cellsHtml(values: Cells, { inputs, row, column }: CopiedCells): string {
  const table = document.createElement("table");
  table.dataset.linesCells = `${row},${column}`;
  values.forEach((line, r) => {
    const tr = table.insertRow();
    line.forEach((value, c) => {
      const td = tr.insertCell();
      td.textContent = value;
      td.dataset.input = inputs[r][c];
    });
  });
  return table.outerHTML;
}

/** Cells copied from a sheet, read from the clipboard's HTML; null if they weren't. */
export function readCellsHtml(html: string): CopiedCells | null {
  if (!html.includes("data-lines-cells")) return null;
  const table = new DOMParser().parseFromString(html, "text/html").querySelector<HTMLTableElement>("table[data-lines-cells]");
  const [row, column] = (table?.dataset.linesCells ?? "").split(",").map(Number);
  if (!table || !Number.isInteger(row) || !Number.isInteger(column)) return null;
  return { inputs: [...table.rows].map((tr) => [...tr.cells].map((td) => td.dataset.input ?? td.textContent ?? "")), row, column };
}
