import { syntaxTree } from "@codemirror/language";
import { type ChangeSpec, EditorSelection, EditorState, Prec, type Text, type Transaction } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { prefs } from "../prefs.svelte";
import { beside, itemNumber, itemOn, numbered, QUOTES, shifted } from "./lists";
import { frontMatterField } from "./objects";
import { treeThrough, treeTo } from "./util";

/*
 * Moving list items. ⌥↑ and ⌥↓ on an item (or on items selected together) move it past the item
 * above or below, its sub-items going with it, as dragging its grip does; with no item that way,
 * past the line there. A numbered list an item is moved into or out of, by those keys, a grip,
 * dragging text, cutting, pasting or deleting it, is numbered again in its new order
 * (Settings → Editor → Renumber lists when items move): from the number it started at, keeping its
 * `.` or `)`. A list numbered the same throughout (`1.`, `1.`, `1.`) stays so. A heading moves its
 * section the same way, with the same swap (sectionMoves.ts).
 */

const propertyLines = (state: EditorState) => state.field(frontMatterField, false)?.lines ?? 0;

/** Whether line `n` has nothing on it, but for a quote's `>`. */
function blank(doc: Text, n: number) {
  const { text } = doc.line(n);
  return !text.slice(QUOTES.exec(text)![0].length).trim();
}

/** An item's first line and its last with anything on it. */
function linesOf(doc: Text, item: SyntaxNode): [number, number] {
  const first = doc.lineAt(item.from).number;
  let last = doc.lineAt(Math.max(item.from, item.to - 1)).number;
  while (last > first && blank(doc, last)) last--;
  return [first, last];
}

/** The item before (or after) `item` in its list. */
function sibling(item: SyntaxNode, after: boolean) {
  const next = beside(item, after);
  return next?.name === "ListItem" ? next : null;
}

/**
 * Swaps lines `top`–`bottom` with lines `from`–`to` just above them (`up`) or below them, the blank
 * lines between them staying between them: the changes, and how far lines `top`–`bottom` move.
 */
export function swapLines(doc: Text, [top, bottom]: [number, number], [from, to]: [number, number], up: boolean): { changes: ChangeSpec[]; by: number } {
  const text = (a: number, b: number) => doc.sliceString(doc.line(a).from, doc.line(b).to);
  const [above, below] = up ? [from, top] : [top, from];
  const [aboveEnd, belowEnd] = up ? [to, bottom] : [bottom, to];
  const gap = aboveEnd + 1 < below ? `${text(aboveEnd + 1, below - 1)}\n` : "";
  if (up) {
    return {
      changes: [
        { from: doc.line(above).from, insert: `${text(below, belowEnd)}\n${gap}` },
        { from: doc.line(aboveEnd).to, to: doc.line(belowEnd).to },
      ],
      by: doc.line(above).from - doc.line(below).from,
    };
  }
  return {
    changes: [
      { from: doc.line(above).from, to: doc.line(below).from },
      { from: doc.line(belowEnd).to, insert: `\n${gap}${text(above, aboveEnd)}` },
    ],
    by: doc.line(belowEnd).to - doc.line(below).from + 1 + gap.length,
  };
}

/** Moves the items the selection starts on up (or down) past the item there, or the line, with what's under them. */
function moveItems(view: EditorView, up: boolean) {
  const { state } = view;
  const { main } = state.selection;
  if (state.readOnly || state.selection.ranges.length > 1) return false;
  const { doc } = state;
  const first = itemOn(state, doc.lineAt(main.from));
  const properties = propertyLines(state);
  if (!first || doc.lineAt(first.from).number <= properties) return false;
  // As with lines, a selection ending at a line's start leaves that line where it is.
  const end = doc.lineAt(main.to > main.from && doc.lineAt(main.to).from === main.to ? main.to - 1 : main.to).number;
  let last = first;
  for (let next = sibling(last, true); next && doc.lineAt(next.from).number <= end; next = sibling(next, true)) last = next;
  const [top] = linesOf(doc, first);
  const [, bottom] = linesOf(doc, last);
  // Selected past its items: lines, moved as lines are.
  if (end > bottom) return false;
  const other = sibling(up ? first : last, !up);
  const [from, to] = other ? linesOf(doc, other) : up ? [top - 1, top - 1] : [bottom + 1, bottom + 1];
  if (from <= properties || to > doc.lines) return true;

  const { changes, by } = swapLines(doc, [top, bottom], [from, to], up);
  view.dispatch({
    changes,
    selection: EditorSelection.single(main.anchor + by, main.head + by),
    scrollIntoView: true,
    userEvent: "move.line",
  });
  return true;
}

export const listMoveKeymap = Prec.high(
  keymap.of([
    { key: "Alt-ArrowUp", run: (view) => moveItems(view, true) },
    { key: "Alt-ArrowDown", run: (view) => moveItems(view, false) },
  ]),
);

/** Edits that can take items out of a list or put them in: moving lines, dropping, pasting, deleting. */
const MOVES = ["move", "input.paste", "input.drop", "delete"];

/** Whether a change takes away or puts in a line break, which moving an item does. */
function crossesLines(tr: Transaction) {
  const before = tr.startState.doc;
  let crosses = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    crosses ||= inserted.lines > 1 || before.lineAt(fromA).number !== before.lineAt(toA).number;
  });
  return crosses;
}

/** The item whose marker starts at `pos`. */
function itemMarkedAt(tree: Tree, pos: number) {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "ListItem") return node.getChild("ListMark")?.from === pos ? node : null;
  }
  return null;
}

/**
 * The changes that number the numbered lists `tr` moved items into or out of again in their new
 * order. An item that was there before keeps its place in the list it was in: the list starts at
 * the number the first of them was in, and if that list was numbered the same throughout, it all
 * is. A number that gets a digit longer or shorter moves the lines under it along, so its sub-items
 * stay under it.
 */
function renumbering(tr: Transaction): ChangeSpec[] {
  const { state, startState, changes } = tr;
  const { doc } = state;
  const arrivals: [number, number][] = [];
  let tree = syntaxTree(state);
  changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (toB > fromB) arrivals.push([fromB, toB]);
    // Read whole, the lists the change is in or next to: each parse goes on from the last.
    tree = treeThrough(state, Math.max(0, fromB - 1));
    tree = treeThrough(state, Math.min(doc.length, toB + 1));
  });

  // The numbered lists around each change.
  const lists = new Map<number, SyntaxNode>();
  changes.iterChanges((_fromA, _toA, fromB, toB) => {
    tree.iterate({
      from: Math.max(0, fromB - 1),
      to: Math.min(doc.length, toB + 1),
      enter: (node) => {
        if (node.name === "OrderedList") lists.set(node.from, node.node);
        return node.name !== "Paragraph";
      },
    });
  });

  const properties = propertyLines(state);
  const back = changes.invertedDesc;
  // The note before, read as far as the lists were.
  const reach = Math.max(0, ...[...lists.values()].map((list) => back.mapPos(list.to)));
  const treeBefore = treeTo(startState, Math.min(startState.doc.length, reach + 1));
  const arrived = (pos: number) => arrivals.some(([from, to]) => pos >= from && pos < to);
  const renumbered: ChangeSpec[] = [];
  // How far each line's moved along, under a number that's grown or shrunk.
  const shifts = new Map<number, number>();
  for (const list of lists.values()) {
    if (doc.lineAt(list.from).number <= properties) continue;
    const items = list.getChildren("ListItem");
    let came = false;
    let first: SyntaxNode | null = null;
    const origins = new Set<number>();
    let stayed = 0;
    for (const item of items) {
      const mark = item.getChild("ListMark")!.from;
      const was = arrived(mark) ? null : itemMarkedAt(treeBefore, back.mapPos(mark, 1))?.parent;
      if (was?.name !== "OrderedList") {
        came = true;
        continue;
      }
      first ??= was;
      origins.add(was.from);
      stayed++;
    }
    // Only new items, or the same ones as before, in the same order.
    if (!first || (!came && origins.size === 1 && first.getChildren("ListItem").length === stayed)) continue;
    const before = first.getChildren("ListItem").map((item) => itemNumber(startState.doc, item));
    const start = before[0];
    const same = before.length > 1 && before.every((n) => n === start);
    items.forEach((item, i) => {
      const n = same ? start : start + i;
      const change = numbered(doc, item, n);
      if (!change.length) return;
      renumbered.push(...change);
      const mark = item.getChild("ListMark")!;
      const grown = String(n).length - (mark.to - 1 - mark.from);
      const [line, last] = linesOf(doc, item);
      if (grown) for (let k = line + 1; k <= last; k++) shifts.set(k, (shifts.get(k) ?? 0) + grown);
    });
  }
  for (const [line, by] of shifts) if (by) renumbered.push(...shifted(doc, line, line, by));
  return renumbered;
}

/** Numbers the numbered lists an edit moved items into or out of again, in their new order, unless that's turned off. */
export const renumberMoved = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !prefs.renumberLists || !MOVES.some((event) => tr.isUserEvent(event)) || !crossesLines(tr)) return tr;
  const changes = renumbering(tr);
  return changes.length ? [tr, { changes, sequential: true }] : tr;
});
