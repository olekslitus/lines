import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension, findClusterBreak, type Line, Prec, RangeSet } from "@codemirror/state";
import { type Command, EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { INLINE_STYLES, livePreview } from "./livePreview";
import { hidesMarks, linkBarWhileHidden, linkMarks, linkOf } from "./linkEditing";
import { isCardFence } from "./cards";
import { frontMatterField } from "./objects";

/*
 * Hidden Markdown (Settings → Editor → Show Markdown), as in Bear or Notion: Markdown is typed and
 * stays in the note but never shows, even under the cursor (livePreview.ts): what styles text, its
 * `**`, a heading's `#`, a list's marker, a link's `[` and `](address)` (linkEditing.ts edits those),
 * math's `$`, an escape's backslash, and the fences of code, math and cards. So the cursor never
 * stops in it, where typing would break it: it goes over it as over nothing, stays after a line's
 * marks (on a heading's text, never before its `#`), at either end of styled text, outside it, and
 * past a line that's all a fence. Backspace and Delete beside marks take the text past them, but
 * never join a line to a fence; Backspace at the start of a heading's text makes it text again.
 */

/** Marks hidden next to each other on a line, and where the cursor stops in them (`at`). */
interface Run {
  from: number;
  to: number;
  at: number;
  /** Marks starting the line: its `>`, a list's marker and checkbox, a heading's `#` (from `heading`), a code block's fence. */
  lead: boolean;
  heading?: number;
  /**
   * A line that's all a fence, a block's top or bottom: a card's `:::`, math's `$$`, the ``` closing
   * code. Typing there would break the block, so the cursor goes past it as past a line that isn't there.
   */
  fence?: "top" | "bottom";
}

/** What live preview draws without looking inside, so its marks show. */
const OPAQUE = new Set(["Table", "Image", "FencedCode", "CodeBlock", "MathBlock", "InlineMath", "Mention", "Tag", "Autolink", "HTMLBlock", "CommentBlock"]);
/** Marks that start a line. */
const LEADS = new Set(["HeaderMark", "QuoteMark", "ListMark", "TaskMarker"]);

/**
 * Whether `line` is a block's fence, and which: one that's all fence, at the block's top or bottom (a
 * card's `:::` lines, math's `$$`, a code block's closing ```), or a code block's opening ```, whose
 * language stays as a label to change.
 */
function fenceOf(state: EditorState, line: Line): Run["fence"] | "label" | undefined {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    if (node.name === "Card") {
      const first = state.doc.lineAt(node.from).number;
      const last = state.doc.lineAt(node.to).number;
      if (isCardFence(line.text, line.number, first, last)) return line.number === first ? "top" : "bottom";
      return;
    }
    if (node.name === "MathBlock" || node.name === "FencedCode") {
      const marks = node.getChildren(node.name === "MathBlock" ? "MathMark" : "CodeMark");
      const on = marks.find((mark) => mark.from >= line.from && mark.to <= line.to);
      if (!on) return;
      if (node.name === "FencedCode" && on === marks[0]) return "label";
      if (state.sliceDoc(line.from, line.to).trim() !== state.sliceDoc(on.from, on.to)) return;
      return on !== marks[0] ? "bottom" : marks.length > 1 ? "top" : undefined;
    }
  }
}

/** The runs of hidden marks on `line`. */
function runsOn(state: EditorState, line: Line): Run[] {
  const { doc } = state;
  const fence = fenceOf(state, line);
  if (fence === "top" || fence === "bottom") return [{ from: line.from, to: line.to, at: line.to, lead: true, fence }];
  const front = state.field(frontMatterField, false);
  const inProperties = !!front && line.number <= front.lines;
  const spaceAfter = (pos: number) => (doc.sliceString(pos, pos + 1) === " " ? pos + 1 : pos);
  const leads = new Map<number, { to: number; heading: boolean }>();
  const marks: { from: number; to: number; closing: boolean }[] = [];
  const within = (from: number, to: number) => from >= line.from && to <= line.to;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(ref) {
      const link = (ref.name === "Link" || ref.name === "Autolink") && hidesMarks(state, ref.node) && linkOf(state, ref.node);
      if (link) {
        // Its `[` and `](address)`, as opening and closing marks: the cursor stops outside the link.
        for (const [i, part] of linkMarks(link).entries()) if (part.from < part.to && within(part.from, part.to)) marks.push({ ...part, closing: i === 1 });
      }
      if (ref.name === "InlineMath") {
        // Its `$`s, around its source, which shows with the cursor in it.
        const dollars = ref.node.getChildren("MathMark");
        if (dollars.length > 1) for (const [i, mark] of [dollars[0], dollars[dollars.length - 1]].entries()) if (within(mark.from, mark.to)) marks.push({ from: mark.from, to: mark.to, closing: i === 1 });
        return false;
      }
      // A backslash that escapes, or makes a line break: the cursor stops before it.
      if ((ref.name === "Escape" || (ref.name === "HardBreak" && doc.sliceString(ref.from, ref.from + 1) === "\\")) && within(ref.from, ref.from + 1)) {
        marks.push({ from: ref.from, to: ref.from + 1, closing: false });
        return false;
      }
      if (ref.name === "FencedCode") {
        // A code block's opening ```, before its language.
        const open = ref.node.getChild("CodeMark");
        if (open && within(open.from, open.to)) leads.set(open.from, { to: open.to, heading: false });
      }
      if (OPAQUE.has(ref.name)) return false;
      const parent = ref.node.parent;
      if (!parent || ref.from < line.from || ref.to > line.to) return;
      if (LEADS.has(ref.name)) {
        if (ref.name !== "HeaderMark") leads.set(ref.from, { to: spaceAfter(ref.to), heading: false });
        else if (!parent.name.startsWith("ATXHeading")) return;
        // A heading's `#`s at its start; those at its end show (livePreview.ts).
        else if (ref.from === parent.from) leads.set(ref.from, { to: spaceAfter(ref.to), heading: true });
        return;
      }
      const style = INLINE_STYLES[parent.name];
      if (style && ref.name === style[1]) marks.push({ from: ref.from, to: ref.to, closing: ref.to === parent.to });
    },
  });

  const runs: Run[] = [];
  let lead = line.from;
  let heading: number | undefined;
  for (;;) {
    const at = lead + /^[ \t]*/.exec(doc.sliceString(lead, line.to))![0].length;
    const mark = !inProperties && leads.get(at);
    if (!mark) break;
    if (mark.heading) heading = at;
    lead = mark.to;
  }
  if (lead > line.from) runs.push({ from: line.from, to: lead, at: lead, lead: true, heading });
  // Marks next to each other make one run, which the cursor stops in after those that close
  // styled text, before those that open it: outside both. Not the line's own marks' run, which the
  // cursor never goes back into: `- **bold**` is two, both stopping before the `**`.
  for (const mark of marks.sort((a, b) => a.from - b.from)) {
    const last = runs.at(-1);
    if (last && !last.lead && mark.from <= last.to) {
      if (mark.closing && last.at === last.to) last.at = mark.to;
      last.to = Math.max(last.to, mark.to);
    } else {
      runs.push({ from: mark.from, to: mark.to, at: mark.closing ? mark.to : mark.from, lead: false });
    }
  }
  return runs;
}

/** The run `pos` is in: where two meet, the first, or going `forward`, the second. */
function runAt(state: EditorState, pos: number, forward = false) {
  const runs = runsOn(state, state.doc.lineAt(pos)).filter((run) => run.from <= pos && pos <= run.to);
  return forward ? runs.at(-1) : runs[0];
}

/** The next character's edge from `pos` on its line, or the next line's start or the last's end. */
function beyond(state: EditorState, pos: number, forward: boolean) {
  const line = state.doc.lineAt(pos);
  if (forward ? pos === line.to : pos === line.from) return Math.max(0, Math.min(state.doc.length, pos + (forward ? 1 : -1)));
  return line.from + findClusterBreak(line.text, pos - line.from, forward);
}

/**
 * Where a cursor at `pos` goes: where it stops in hidden marks it's in. One the arrow keys moved
 * from there across them (`from`) goes on to the character beyond, as they look like nothing. An
 * edit only moves one inside marks, or before a line's, so styled text just typed or ended (`**`
 * after it) isn't left.
 */
function settle(state: EditorState, pos: number, edited: boolean, from?: number) {
  const run = runAt(state, pos);
  if (run?.fence) return pastFence(state, pos, run.fence, from);
  if (!run || pos === run.at) return pos;
  if (edited) return run.lead || (run.from < pos && pos < run.to) ? run.at : pos;
  if (run.lead || from !== run.at) return run.at;
  const next = beyond(state, pos > from ? run.to : run.from, pos > from);
  const further = runAt(state, next);
  return further ? further.at : next;
}

/**
 * Where a cursor on a fence's line goes: on to the line past it the way the arrow keys moved it
 * (from `from`), or else into the block, onto the line after its top or before its bottom. Past
 * fences next to each other (a card's in a card), to the first line that isn't one.
 */
function pastFence(state: EditorState, pos: number, fence: "top" | "bottom", from?: number): number {
  const { doc } = state;
  const forward = from === undefined ? fence === "top" : pos > from;
  for (const way of [forward, !forward]) {
    for (let n = doc.lineAt(pos).number + (way ? 1 : -1); n >= 1 && n <= doc.lines; n += way ? 1 : -1) {
      const line = doc.line(n);
      const edge = fenceOf(state, line);
      if (edge !== "top" && edge !== "bottom") return settle(state, way ? line.from : line.to, true);
    }
  }
  return pos;
}

/** A selection's end the arrow keys moved (from `from`) only across hidden marks goes on to the character beyond. */
function extend(state: EditorState, head: number, from?: number) {
  const run = runAt(state, head);
  if (!run || from === undefined || from === head || from < run.from || from > run.to) return head;
  return beyond(state, head > from ? run.to : run.from, head > from);
}

/** Keeps each cursor where it stops in hidden marks, and selections from ending on them alone. */
const settleCursors = EditorState.transactionFilter.of((tr) => {
  if ((!tr.selection && !tr.docChanged) || tr.isUserEvent("input.type.compose")) return tr;
  const { state } = tr;
  // An arrow key's step, not a click or a jump.
  const step = !tr.docChanged && tr.isUserEvent("select") && !tr.isUserEvent("select.pointer");
  const before = tr.startState.selection.ranges;
  let moved = false;
  const ranges = state.selection.ranges.map((range, i) => {
    const from = step ? before[i]?.head : undefined;
    const head = range.empty ? settle(state, range.head, tr.docChanged, before[i]?.empty ? from : undefined) : extend(state, range.head, from);
    if (head === range.head) return range;
    moved = true;
    return range.empty ? EditorSelection.cursor(head) : EditorSelection.range(range.anchor, head);
  });
  return moved ? [tr, { selection: EditorSelection.create(ranges, state.selection.mainIndex), sequential: true }] : tr;
});

/** Where the text `node` styles or links is, between its marks: if it's styled text or a link. */
function styledText(state: EditorState, node: SyntaxNode): [from: number, to: number] | null {
  const style = INLINE_STYLES[node.name];
  if (style) {
    const marks = node.getChildren(style[1]);
    return marks.length > 1 ? [marks[0].to, marks[marks.length - 1].from] : null;
  }
  const link = node.name === "Link" ? linkOf(state, node) : null;
  return link && [link.textFrom, link.textTo];
}

/** Backspace or Delete beside marks takes the character past them, and the marks too if it's all they styled. */
const deleteBeside =
  (forward: boolean): Command =>
  (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
    const pos = range.head;
    const run = runAt(state, pos, forward);
    if (!run) return false;
    if (run.lead && !forward) {
      // At the start of a heading's text, Backspace makes it text: its `#` go. A list's and a quote's
      // marks are Markdown's own Backspace's.
      if (pos !== run.at || run.heading === undefined) return false;
      view.dispatch({ changes: { from: run.heading, to: run.at }, userEvent: "delete.backward", scrollIntoView: true });
      return true;
    }
    if (forward ? pos >= run.to : pos <= run.from) return false;
    const edge = forward ? run.to : run.from;
    const line = state.doc.lineAt(pos);
    if (forward ? edge >= line.to : edge <= line.from) return false;
    const other = beyond(state, edge, forward);
    let [from, to] = forward ? [edge, other] : [other, edge];
    // Styled text, or a link, of only that character goes with it, and what styles or links that, so on out.
    for (let node = syntaxTree(state).resolveInner(from, 1); node.parent; node = node.parent) {
      const text = styledText(state, node);
      if (!text) continue;
      if (text[0] !== from || text[1] !== to) break;
      [from, to] = [node.from, node.to];
    }
    const changes = state.changes({ from, to });
    view.dispatch({ changes, selection: { anchor: changes.mapPos(pos) }, userEvent: forward ? "delete.forward" : "delete.backward", scrollIntoView: true });
    return true;
  };

/**
 * Backspace at a line's start, or Delete at its end, beside a fence's line, never joins the two,
 * which would break the block: an empty line goes, and the cursor with it to the line past the
 * fence; one with text in it stays as it is.
 */
const besideFence =
  (forward: boolean): Command =>
  (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
    const { doc } = state;
    const line = doc.lineAt(range.head);
    const n = line.number + (forward ? 1 : -1);
    if (range.head !== (forward ? line.to : line.from) || n < 1 || n > doc.lines || !fenceOf(state, doc.line(n))) return false;
    if (!line.length) {
      const changes = forward ? { from: line.from, to: line.to + 1 } : { from: line.from - 1, to: line.to };
      view.dispatch({ changes, userEvent: forward ? "delete.forward" : "delete.backward", scrollIntoView: true });
    }
    return true;
  };

/** ← at the start of a line's text goes to the end of the line before, not into its marks. */
const leftOfMarks: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) return false;
  const run = runAt(state, range.head);
  if (!run?.lead || range.head !== run.at) return false;
  if (run.from > 0) view.dispatch({ selection: { anchor: run.from - 1 }, scrollIntoView: true, userEvent: "select" });
  return true;
};

/** Return at the start of a heading's text puts a line above it, rather than leaving its `#` there. */
const lineAboveHeading: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
  const run = runAt(state, range.head);
  if (!run?.lead || run.heading === undefined || range.head !== run.at || run.at === state.doc.lineAt(run.at).to) return false;
  view.dispatch({ changes: { from: run.from, insert: "\n" }, selection: { anchor: range.head + 1 }, userEvent: "input", scrollIntoView: true });
  return true;
};

/** Hidden Markdown's cursor and keys, over what live preview draws. */
export const hiddenMarkdown: Extension = [
  settleCursors,
  linkBarWhileHidden,
  // What's drawn in place of Markdown (a mention, a list's bullet) the cursor goes over in one step.
  EditorView.atomicRanges.of((view) => view.plugin(livePreview)?.atoms ?? RangeSet.empty),
  Prec.highest(
    keymap.of([
      { key: "Backspace", run: besideFence(false) },
      { key: "Delete", run: besideFence(true) },
      { key: "Backspace", run: deleteBeside(false) },
      { key: "Delete", run: deleteBeside(true) },
      { key: "ArrowLeft", run: leftOfMarks },
      { key: "Enter", run: lineAboveHeading },
    ]),
  ),
];
