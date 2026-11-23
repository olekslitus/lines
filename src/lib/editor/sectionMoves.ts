import { EditorSelection, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { prefs } from "../prefs.svelte";
import { foldsMoved } from "./folding";
import { swapLines } from "./listMoves";
import { readAll, type Section, sectionOn, sections } from "./sections";
import { parsedFirst } from "./util";

/*
 * Moving a heading moves its section (Settings → Editor → Move a heading with its section, on to
 * begin with): ⌥↑ and ⌥↓ on a heading's line move it and everything under it, the sections inside
 * it too, past the whole section of its size above or below it, as a list item moves with its
 * sub-items (listMoves.ts), which it shares the swap with. At the first or last of its size in what
 * it's under, it stays. A folded section moves folded. Dragging a heading by its grip does the same
 * (dragBlocks.ts). Off, a heading's line moves alone, as any line does.
 */

/** The section of the same size next to `section`, after it or before it, in what they're both under. */
function beside(all: Section[], section: Section, after: boolean, lineStart: (pos: number) => number) {
  return (
    all.find((other) =>
      other.level === section.level &&
      other.heading.within === section.heading.within &&
      (after ? lineStart(other.from) === section.next : other.next === lineStart(section.from)),
    ) ?? null
  );
}

/** Moves the section whose heading the cursor's on up (or down) past the one of its size there. */
function moveSection(view: EditorView, up: boolean) {
  const { state } = view;
  const { main } = state.selection;
  if (!prefs.moveSections || state.readOnly || state.selection.ranges.length > 1) return false;
  const { doc } = state;
  const section = sectionOn(state, main.from);
  // A selection past its heading's lines moves lines, as it does elsewhere.
  if (!section || doc.lineAt(main.to).number > doc.lineAt(section.head).number) return false;
  readAll(view);
  const all = sections(view.state);
  const moving = all.find((each) => each.from === section.from);
  if (!moving) return false;
  const lineStart = (pos: number) => doc.lineAt(pos).from;
  const other = beside(all, moving, !up, lineStart);
  // The first or last of its size: it stays where it is.
  if (!other) return true;
  const lines = (each: Section): [number, number] => [doc.lineAt(each.from).number, doc.lineAt(each.to).number];
  const { changes, by } = swapLines(doc, lines(moving), lines(other), up);
  view.dispatch({
    changes,
    selection: EditorSelection.single(main.anchor + by, main.head + by),
    effects: foldsMoved(view.state, lineStart(moving.from), moving.to, by),
    scrollIntoView: true,
    userEvent: "move.section",
  });
  return true;
}

export const sectionMoveKeymap = Prec.high(
  keymap.of([
    // Read as far as the cursor first: on a busy device, a heading just moved may not be read yet, and
    // the key would move its line alone.
    { key: "Alt-ArrowUp", run: parsedFirst((view) => moveSection(view, true)) },
    { key: "Alt-ArrowDown", run: parsedFirst((view) => moveSection(view, false)) },
  ]),
);
