import { isolateHistory } from "@codemirror/commands";
import { type ChangeSpec, type EditorState, type Line, Prec, type Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { inCode } from "./fences";
import { frontMatterField } from "./objects";
import { ancestors } from "./util";

/*
 * Tab and Shift-Tab on a list item nest it under the item above, or move it back out a level,
 * taking its own sub-items along. The indentation is whatever Markdown needs for that (two
 * spaces under "- ", three under "1. "); the editor draws each level the same, wider step.
 * Numbered items are numbered again, in the list they leave and the one they join.
 * Backspace right after an item's marker moves a nested item out a level, and turns a top-level
 * one into plain text. Enter there puts an empty item above it. A number typed there makes a bullet
 * item numbered, and a bullet a numbered one a bullet (listMarkerInput). List items pasted on an
 * empty one take its place, at its level (listPaste). Moving items, and numbering them again where
 * they go, is listMoves.ts's.
 */

/** The list item whose marker is on `line`. */
export function itemOn(state: EditorState, line: Line): SyntaxNode | null {
  for (const node of ancestors(state, line.to, -1)) {
    if (node.name !== "ListItem") continue;
    const mark = node.getChild("ListMark");
    if (mark && state.doc.lineAt(mark.from).number === line.number) return node;
  }
  return null;
}

/** The list item whose marker is on the cursor's line. */
function itemAt(state: EditorState): SyntaxNode | null {
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  return state.doc.lineAt(main.anchor).number === line.number ? itemOn(state, line) : null;
}

/** The column where an item's marker starts. */
function markerColumn(doc: Text, item: SyntaxNode) {
  const mark = item.getChild("ListMark")!;
  return mark.from - doc.lineAt(mark.from).from;
}

/** An ordered list item's number. */
export function itemNumber(doc: Text, item: SyntaxNode) {
  const mark = item.getChild("ListMark")!;
  return parseInt(doc.sliceString(mark.from, mark.to), 10);
}

/** The change that numbers an ordered list's item `number`, if it isn't already. */
export function numbered(doc: Text, item: SyntaxNode, number: number) {
  const mark = item.getChild("ListMark")!;
  return itemNumber(doc, item) === number ? [] : [{ from: mark.from, to: mark.to - 1, insert: String(number) }];
}

/**
 * The changes that number an ordered list's items from `item` on, starting at `number`, as far as
 * they were numbered one after another.
 */
function renumber(doc: Text, item: SyntaxNode | null, number: number) {
  const changes = [];
  for (let last = -1; item; item = item.nextSibling) {
    if (item.name !== "ListItem") continue;
    const written = itemNumber(doc, item);
    if (last >= 0 && written !== last + 1) break;
    last = written;
    changes.push(...numbered(doc, item, number++));
  }
  return changes;
}

/** The number for an item put after `item`'s own numbered sub-items: one more than the last, or 1. */
function numberAfter(doc: Text, item: SyntaxNode) {
  const list = item.lastChild;
  let last = list?.name === "OrderedList" ? list.lastChild : null;
  while (last && last.name !== "ListItem") last = last.prevSibling;
  return last ? itemNumber(doc, last) + 1 : 1;
}

/** The node before (or after) `node`, a list item's or a list's: in a quote, each line's `>` sits between them. */
export function beside(node: SyntaxNode, after: boolean) {
  let next = after ? node.nextSibling : node.prevSibling;
  while (next?.name === "QuoteMark") next = after ? next.nextSibling : next.prevSibling;
  return next;
}

/** Quote markers a line starts with; indentation goes after them. */
export const QUOTES = /^(?:[ \t]*>[ ]?)*/;

/** The changes that shift lines `first` to `last` by `delta` columns, after a quote's `>`. */
export function shifted(doc: Text, first: number, last: number, delta: number) {
  const changes = [];
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    const from = line.from + QUOTES.exec(line.text)![0].length;
    if (delta > 0) changes.push({ from, insert: " ".repeat(delta) });
    else changes.push({ from, to: from + Math.min(-delta, /^ */.exec(doc.sliceString(from, line.to))![0].length) });
  }
  return changes;
}

/** Shifts every line of `item` (and its sub-items) by `delta` columns, numbering items again as `renumbered` says. */
function shift(view: EditorView, item: SyntaxNode, delta: number, renumbered: ChangeSpec[] = []) {
  const { doc } = view.state;
  const changes = shifted(doc, doc.lineAt(item.from).number, doc.lineAt(item.to).number, delta);
  view.dispatch({ changes: [...changes, ...renumbered], scrollIntoView: true, userEvent: delta > 0 ? "input.indent" : "delete.dedent" });
}

function indentItem(view: EditorView) {
  const { state } = view;
  const item = state.readOnly ? null : itemAt(state);
  if (!item) return false;
  const above = beside(item, false);
  // The first item of a list has nothing to go under; keep Tab from typing spaces anyway.
  if (above?.name !== "ListItem") return true;
  // Line it up with the text of the item above, which is what makes it that item's child.
  const { doc } = state;
  const mark = above.getChild("ListMark")!;
  const target = mark.to + 1 - doc.lineAt(mark.from).from;
  // Numbered, it counts on from the items it goes under (or from 1), and the items after it count down.
  const renumbered = item.parent?.name === "OrderedList" ? [...numbered(doc, item, numberAfter(doc, above)), ...renumber(doc, item.nextSibling, itemNumber(doc, item))] : [];
  shift(view, item, target - markerColumn(doc, item), renumbered);
  return true;
}

function outdentItem(view: EditorView) {
  const { state } = view;
  const item = state.readOnly ? null : itemAt(state);
  if (!item) return false;
  const parent = item.parent?.parent;
  if (parent?.name !== "ListItem") return true;
  const { doc } = state;
  const renumbered = [];
  if (item.parent!.name === "OrderedList") {
    // The items after it stay where they are, now under it, after its own.
    renumbered.push(...renumber(doc, item.nextSibling, numberAfter(doc, item)));
    // It goes after the item it was under, counting on from it, and the items after that count up.
    if (parent.parent?.name === "OrderedList") {
      const number = itemNumber(doc, parent) + 1;
      renumbered.push(...numbered(doc, item, number), ...renumber(doc, parent.nextSibling, number + 1));
    }
  }
  shift(view, item, markerColumn(doc, parent) - markerColumn(doc, item), renumbered);
  return true;
}

/** The space and checkbox after a list marker. */
const AFTER_MARK = /^[ \t]*(?:\[[ xX]\](?=\s|$)[ \t]*)?/;

function deleteMarker(view: EditorView) {
  const { state } = view;
  const { main } = state.selection;
  const item = main.empty && !state.readOnly ? itemAt(state) : null;
  if (!item) return false;
  const mark = item.getChild("ListMark")!;
  const line = state.doc.lineAt(mark.from);
  if (main.head !== mark.to + AFTER_MARK.exec(state.doc.sliceString(mark.to, line.to))![0].length) return false;
  if (item.parent?.parent?.name === "ListItem") return outdentItem(view);
  const from = line.from + QUOTES.exec(line.text)![0].length;
  view.dispatch({ changes: { from, to: main.head }, scrollIntoView: true, userEvent: "delete.backward" });
  return true;
}

/**
 * Enter at the start of an item's text puts an empty item above it, the item keeping its checkbox
 * as it was. Right under a paragraph, a blank line goes first: an empty item there would be read as
 * part of the paragraph, and a `-` as a heading's underline.
 */
function itemAbove(view: EditorView) {
  const { state } = view;
  const { main } = state.selection;
  const item = main.empty && state.selection.ranges.length === 1 && !state.readOnly ? itemAt(state) : null;
  if (!item) return false;
  const { doc } = state;
  const mark = item.getChild("ListMark")!;
  const line = doc.lineAt(mark.from);
  const start = mark.to + AFTER_MARK.exec(doc.sliceString(mark.to, line.to))![0].length;
  if (main.head !== start || !doc.sliceString(start, line.to).trim()) return false;
  const list = item.parent!;
  const before = beside(list, false);
  const underParagraph =
    list.firstChild?.from === item.from && list.parent?.name !== "ListItem" && before?.name === "Paragraph" && doc.lineAt(before.to).number === line.number - 1;
  const blank = underParagraph ? `${QUOTES.exec(line.text)![0].trimEnd()}\n` : "";
  const changes = [{ from: line.from, to: line.from, insert: `${blank}${line.text.slice(0, start - line.from).replace(/\[[xX]\]/, "[ ]")}\n` }];
  if (list.name === "OrderedList") changes.push(...renumber(doc, item, itemNumber(doc, item) + 1));
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input" });
  return true;
}

export const listKeymap = Prec.high(
  keymap.of([
    { key: "Tab", run: indentItem, shift: outdentItem },
    { key: "Backspace", run: deleteMarker },
    { key: "Enter", run: itemAbove },
  ]),
);

/** A number's marker typed at the start of a bullet item's text, up to the cursor; a bullet typed at a numbered one's. */
const NUMBER_TYPED = /^[-*+][ \t]+(\d{1,9})([.)])$/;
const BULLET_TYPED = /^\d{1,9}[.)][ \t]+([-*+])$/;

/** A list's first (or last) item. */
function endItem(list: SyntaxNode, last: boolean) {
  let item = last ? list.lastChild : list.firstChild;
  while (item && item.name !== "ListItem") item = last ? item.prevSibling : item.nextSibling;
  return item;
}

/** An ordered list item's `.` or `)`. */
function delimiterOf(doc: Text, item: SyntaxNode) {
  const mark = item.getChild("ListMark")!;
  return doc.sliceString(mark.to - 1, mark.to);
}

/**
 * Whether a numbered list starting with `item` has to start at 1: right under a line of text, and
 * not within another numbered list, Markdown reads any other number as more of that text.
 */
function startsAtOne(state: EditorState, item: SyntaxNode) {
  for (let node = item.parent?.parent; node; node = node.parent) if (node.name === "OrderedList") return false;
  const line = state.doc.lineAt(item.from);
  if (line.number === 1) return false;
  const above = state.doc.line(line.number - 1);
  return [...ancestors(state, above.to, -1)].some((node) => node.name === "Paragraph" || node.name === "Task");
}

/**
 * A list item's marker typed over: `1. ` (or `1) `) typed at the start of a bullet item's text makes
 * it a numbered item, and `- ` (`* `, `+ `) at a numbered item's makes it a bullet, rather than a
 * list inside it (`- 1. Milk`), as `## ` typed on a heading changes its level. Its sub-items move
 * with its text. A number counts on from a numbered list just above, in its style (`3)`), and the
 * numbered items after it count on from it; else it's the number typed, or 1 where only 1 makes a
 * list. A numbered item made a bullet leaves the ones after it a list of their own, from 1, which
 * Markdown, unlike other numbers, reads as a list right under the bullet's text. A todo's text
 * keeps what's typed, which Markdown reads as text there. ⌘Z just after leaves it as typed.
 */
export const listMarkerInput = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  const { main } = state.selection;
  if (text !== " " || from !== to || !main.empty || main.head !== from || state.selection.ranges.length > 1 || state.readOnly) return false;
  const item = itemAt(state);
  if (!item) return false;
  const { doc } = state;
  const line = doc.lineAt(from);
  const front = state.field(frontMatterField, false);
  if (front && line.number <= front.lines) return false;
  const mark = item.getChild("ListMark")!;
  const typed = doc.sliceString(mark.from, from);
  const list = item.parent!;
  let marker: string;
  const renumbered = [];
  if (list.name === "BulletList") {
    const number = NUMBER_TYPED.exec(typed);
    if (!number) return false;
    const above = beside(item, false) ? null : beside(list, false);
    const run = above?.name === "OrderedList" ? endItem(above, true)! : null;
    const n = run ? itemNumber(doc, run) + 1 : startsAtOne(state, item) ? 1 : parseInt(number[1], 10);
    const delimiter = run ? delimiterOf(doc, run) : number[2];
    marker = `${n}${delimiter}`;
    const below = beside(item, true) ? null : beside(list, true);
    const next = below?.name === "OrderedList" ? endItem(below, false)! : null;
    if (next && delimiterOf(doc, next) === delimiter) renumbered.push(...renumber(doc, next, n + 1));
  } else {
    const bullet = BULLET_TYPED.exec(typed);
    if (!bullet) return false;
    marker = bullet[1];
    renumbered.push(...renumber(doc, beside(item, true), 1));
  }
  // Its sub-items and the rest of its text line up with its text where it now starts.
  const textFrom = from - /\S+$/.exec(typed)![0].length;
  const delta = mark.from + marker.length + 1 - textFrom;
  const last = doc.lineAt(item.to).number;
  const moved = delta ? shifted(doc, line.number + 1, last, delta) : [];
  const space = state.changes({ from, insert: " " });
  view.dispatch({ changes: space, selection: { anchor: from + 1 }, userEvent: "input.type" });
  view.dispatch({
    changes: state.changes([{ from: mark.from, to: from, insert: marker }, ...moved, ...renumbered]).map(space),
    selection: { anchor: mark.from + marker.length + 1 },
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
});

/** The start of a line that's a list item: its indentation, then its marker (a checkbox too) and the space after. */
const ITEM_START = /^([ \t]*)((?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]+)/;
const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].length;

/**
 * List items pasted on an empty item, as copied from another list: they take its place, rather
 * than going inside it (`- - Copied`, a list in an item), and however deep they were nested where
 * they came from, the first starts at its level and the rest keep their places under it. Pasted on
 * an empty line, they start at its indentation the same way.
 */
export const listPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    const text = data?.getData("text/plain");
    const { state } = view;
    const { main } = state.selection;
    if (!data || !text || data.files.length || state.readOnly || !main.empty) return false;
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    const first = ITEM_START.exec(lines[0]);
    if (!first) return false;
    const line = state.doc.lineAt(main.head);
    const before = line.text.slice(0, main.head - line.from);
    const item = ITEM_START.exec(before);
    // Right after an empty item's marker, or on a line with nothing on it.
    const empty = !line.text.slice(main.head - line.from).trim() && (item?.[0] === before || !before.trim());
    if (!empty || inCode(state, main.head)) return false;
    const indent = item ? item[1] : before;
    const base = first[1].length;
    const insert = lines.map((each) => (each.trim() ? indent + " ".repeat(Math.max(0, indentOf(each) - base)) + each.trimStart() : "")).join("\n");
    view.dispatch({
      changes: { from: line.from, to: main.head, insert },
      selection: { anchor: line.from + insert.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    return true;
  },
});
