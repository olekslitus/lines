import { EditorSelection, type EditorState, type Line, type StateCommand } from "@codemirror/state";
import { frontMatterField } from "./objects";
import { ancestors, parsedTo, selectedLines } from "./util";

/*
 * Lines made a list's items and back, from the bar above a phone's keyboard (KeyboardBar.svelte),
 * where there are no keys to type a marker with: a bullet list, a numbered one, or todos. Each line
 * keeps its indentation, the quote it's in and its text; a marker of another kind, or a heading's,
 * gives way to the new one. Lines that are all one kind already go back to plain text.
 */

export type ListKind = "bullet" | "numbered" | "todo";

/** A line's quote markers and indentation, then the block marker it starts with, if any. */
const LEAD = /^((?:[ \t]*>[ ]?)*[ \t]*)(#{1,6}(?:[ \t]+|$)|[-*+][ \t]+\[[ xX]\](?:[ \t]+|$)|[-*+](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$))?/;

/** Where a marker would be text, or change what something is: code, math, a table, raw HTML. */
const NOT_LISTABLE = new Set(["FencedCode", "CodeBlock", "MathBlock", "Table", "HTMLBlock", "CommentBlock"]);

interface ListLine {
  line: Line;
  /** The quote markers and indentation before the marker. */
  lead: string;
  marker: string;
  kind: ListKind | null;
}

function kindOf(marker: string): ListKind | null {
  if (/^[-*+][ \t]+\[/.test(marker)) return "todo";
  if (/^[-*+]/.test(marker)) return "bullet";
  if (/^\d/.test(marker)) return "numbered";
  return null;
}

function read(line: Line): ListLine {
  const [, lead, marker = ""] = LEAD.exec(line.text)!;
  return { line, lead, marker, kind: kindOf(marker) };
}

function listable(state: EditorState, line: Line) {
  const front = state.field(frontMatterField, false);
  if (front && line.number <= front.lines) return false;
  for (const node of ancestors(state, line.from, 1)) if (NOT_LISTABLE.has(node.name)) return false;
  return true;
}

/** The selected lines a marker can go on: not blank ones among others, nor ones in code, a table or the properties. */
function listLines(given: EditorState): ListLine[] {
  const lines = selectedLines(given);
  const state = parsedTo(given, lines[lines.length - 1].to);
  const some = lines.length > 1 ? lines.filter((line) => line.text.trim()) : lines;
  return some.filter((line) => listable(state, line)).map(read);
}

/** The kind of list the selected lines are all items of, if they are. */
export function listKind(state: EditorState): ListKind | null {
  const lines = listLines(state);
  const kind = lines[0]?.kind ?? null;
  return lines.every((line) => line.kind === kind) ? kind : null;
}

/** The number a numbered item put on `first` takes: one more than the item right above it at the same depth, or 1. */
function firstNumber(state: EditorState, first: ListLine) {
  if (first.line.number === 1) return 1;
  const above = read(state.doc.line(first.line.number - 1));
  return above.kind === "numbered" && above.lead === first.lead ? Number.parseInt(above.marker, 10) + 1 : 1;
}

/** Makes the selected lines items of a `kind` of list, or plain lines again if they all are already. */
export function toggleList(kind: ListKind): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const lines = listLines(state);
    if (!lines.length) return false;
    const off = lines.every((line) => line.kind === kind);
    let number = firstNumber(state, lines[0]);
    const changes = [];
    for (const { line, lead, marker, kind: was } of lines) {
      // A todo stays ticked or not, and a bullet as it is; numbers are counted again.
      if (!off && was === kind && kind !== "numbered") continue;
      const insert = off ? "" : kind === "bullet" ? "- " : kind === "todo" ? "- [ ] " : `${number++}. `;
      const from = line.from + lead.length;
      changes.push({ from, to: from + marker.length, insert });
    }
    const set = state.changes(changes);
    // A cursor where a marker goes ends up after it, at the start of the text.
    const selection = EditorSelection.create(
      state.selection.ranges.map((range) => range.map(set, 1)),
      state.selection.mainIndex,
    );
    dispatch(state.update({ changes: set, selection, scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}
