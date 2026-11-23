import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { type ChangeSpec, EditorSelection, type EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { parsedFirst } from "./util";

/**
 * Markdown's Enter, CodeMirror's: it continues a list or a quote, and on an empty item ends the list
 * (a nested one moves out a level), its second item too (rather than putting a blank line before it).
 */
const markdownEnter = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** A change's text that starts on a new line with a blank line first: what Enter puts before an item in a loose list. */
const BLANK_FIRST = /^(\r?\n)[ \t>]*\r?\n/;

/**
 * Markdown's Enter, with a new item right under the one Enter was pressed on, as in Obsidian and Bear,
 * however the list is spaced. CodeMirror's puts a blank line first in a list with one between any of
 * its items (Markdown's loose list), which shows as an empty row nobody typed.
 */
export const continueMarkup: StateCommand = ({ state, dispatch }) => markdownEnter({ state, dispatch: (tr) => dispatch(withoutBlankLine(state, tr)) });

function withoutBlankLine(state: EditorState, tr: Transaction): Transaction {
  const changes: ChangeSpec[] = [];
  const cuts: { at: number; length: number }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
    const text = inserted.toString();
    const blank = BLANK_FIRST.exec(text);
    if (blank) cuts.push({ at: toB, length: blank[0].length - blank[1].length });
    changes.push({ from: fromA, to: toA, insert: blank ? blank[1] + text.slice(blank[0].length) : text });
  });
  if (!cuts.length) return tr;
  const shift = (pos: number) => pos - cuts.reduce((sum, cut) => sum + (cut.at <= pos ? cut.length : 0), 0);
  const ranges = tr.selection!.ranges.map((range) => EditorSelection.range(shift(range.anchor), shift(range.head)));
  return state.update({ changes, selection: EditorSelection.create(ranges, tr.selection!.mainIndex), scrollIntoView: true, userEvent: "input" });
}

/** Markdown's Enter and Backspace, which go by the syntax tree: parsed as far as the cursor, and through the list it's in, first. */
export const markdownKeymap = keymap.of([
  { key: "Enter", run: parsedFirst(continueMarkup) },
  { key: "Backspace", run: parsedFirst(deleteMarkupBackward) },
]);
