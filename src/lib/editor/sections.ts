import { forceParsing, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type Heading, outlineHeadings } from "./outline.svelte";

/*
 * A note's sections: each heading and what's under it, up to the next heading of its level or a
 * larger one, or the end of what it's in (a quote, a LaTeX environment) or of the note. Headings
 * are where the note's language says (`outlineHeadings`), so code and the properties have none.
 * Folding (folding.ts) hides a section's lines under its heading.
 */

export interface Section {
  heading: Heading;
  level: number;
  /** Where its heading starts. */
  from: number;
  /** The end of its heading's last line, where what folds away starts. */
  head: number;
  /** The end of its last line with anything on it. */
  to: number;
  /** Where what's after it starts: the next section's heading, the end of what it's in, or the note's end. */
  next: number;
}

/** Whether a section has anything under its heading to fold away. */
export const foldable = (section: Section) => section.to > section.head;

/** The end of the last line with text in [`head`, `next`], or `head` if there's none after it. */
function lastText(doc: Text, head: number, next: number) {
  let line = doc.lineAt(next);
  if (line.from === next && next > head) line = doc.lineAt(next - 1);
  while (line.from > head && !line.text.trim()) line = doc.line(line.number - 1);
  return Math.max(head, Math.min(line.to, next));
}

const read = new WeakMap<EditorState, Section[]>();

/** The note's sections, in order of their headings, as far as it's parsed. */
export function sections(state: EditorState): Section[] {
  let found = read.get(state);
  if (found) return found;
  const { doc } = state;
  const headings = state.facet(outlineHeadings)?.(state) ?? [];
  found = [];
  // The sections not ended yet, in what each is in.
  const open = new Map<number | undefined, Section[]>();
  for (const heading of headings) {
    let stack = open.get(heading.within);
    if (!stack) open.set(heading.within, (stack = []));
    const start = doc.lineAt(heading.from).from;
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop()!.next = start;
    const section: Section = { heading, level: heading.level, from: heading.from, head: doc.lineAt(heading.to ?? heading.from).to, to: 0, next: -1 };
    stack.push(section);
    found.push(section);
  }
  for (const section of found) {
    if (section.next < 0) section.next = Math.min(section.heading.within ?? doc.length, doc.length);
    section.to = lastText(doc, section.head, section.next);
  }
  read.set(state, found);
  return found;
}

/** The section whose heading is on the line at `pos`. */
export const sectionOn = (state: EditorState, pos: number) => {
  const line = state.doc.lineAt(pos);
  return sections(state).find((section) => section.from <= line.to && section.head >= line.from) ?? null;
};

/** The note read to its end, so a section ends where its next heading is rather than where reading stopped. */
export function readAll(view: EditorView) {
  if (!syntaxTreeAvailable(view.state, view.state.doc.length) && syntaxTree(view.state).length) forceParsing(view, view.state.doc.length, 300);
}
