import {
  codeFolding,
  foldedRanges,
  foldEffect,
  foldState,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import { invertedEffects } from "@codemirror/commands";
import { Compartment, EditorState, type Extension, Prec, type StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { mount, unmount } from "svelte";
import Icon from "../icons/Icon.svelte";
import { t } from "../i18n/index.svelte";
import { prefs } from "../prefs.svelte";
import { foldable, readAll, type Section, sectionOn, sections } from "./sections";
import { outlineHeadings } from "./outline.svelte";
import { editedNote } from "./util";

/*
 * Folding a note's sections (Settings → Editor → Fold sections, on to begin with). The chevron
 * beside a heading, or ⌘⌥[ and ⌘⌥] at the cursor (⌃⌥[ and ⌃⌥] for all of them), hides what's under
 * it, the heading showing with "…" after it. It's only how the note shows: its text, what's copied
 * and what's printed have all of it. A fold opens as the cursor goes into it (find, the outline, the
 * arrows past its end), or as a line break is typed or deleted at its edge. Folds are kept for each
 * note on this device (not synced), and come back as it's opened again.
 */

/* What shows in a folded section's place. */

/** "…" after the heading; clicking it unfolds. */
function placeholder(unfold: (event: Event) => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-fold-placeholder";
  // Out of the Tab order, as the chevron is (below).
  button.tabIndex = -1;
  button.textContent = "…";
  button.title = t("editor.fold.folded");
  button.setAttribute("aria-label", t("editor.fold.folded"));
  // Not a click in the text: the cursor stays where it is.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", unfold);
  return button;
}

/** The fold on the line `dom` is drawn in, unfolded. */
function unfoldAt(view: EditorView, dom: HTMLElement) {
  const line = view.lineBlockAt(view.posAtDOM(dom));
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(line.from, line.to, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length) view.dispatch({ effects });
}

/** A fold as it was kept (below): drawn as CodeMirror draws its own. */
class Folded extends WidgetType {
  toDOM(view: EditorView) {
    return placeholder((event) => unfoldAt(view, event.currentTarget as HTMLElement));
  }
  eq() {
    return true;
  }
}

const folded = Decoration.replace({ widget: new Folded() });

/* Kept on this device. */

const KEY = "lines.folds";
/** The most notes whose folds are kept; the ones folded longest ago go first. */
const MOST = 300;

/** A short fingerprint of a fold's first and last lines, so one isn't put back over other text. */
function fingerprint(state: EditorState, from: number, to: number) {
  const text = `${state.doc.lineAt(from).text}\n${state.doc.lineAt(to).text}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

type Kept = Record<string, [from: number, to: number, print: string][]>;

function readKept(): Kept {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Keeps the folds of note `id` as they are in `state`. */
function keep(id: string, state: EditorState) {
  const kept = readKept();
  const ranges: Kept[string] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    ranges.push([from, to, fingerprint(state, from, to)]);
  });
  delete kept[id];
  if (ranges.length) kept[id] = ranges;
  const ids = Object.keys(kept);
  for (const old of ids.slice(0, Math.max(0, ids.length - MOST))) delete kept[old];
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage full: the folds just aren't kept.
  }
}

/** The folds kept for the note in `state`, those that still fit its text. */
function keptFolds(state: EditorState): DecorationSet {
  const id = state.facet(editedNote);
  const ranges = id ? readKept()[id] : undefined;
  if (!ranges) return Decoration.none;
  const { doc } = state;
  const found = ranges
    .filter(([from, to, print]) => from < to && to <= doc.length && doc.lineAt(from).to === from && fingerprint(state, from, to) === print)
    .map(([from, to]) => folded.range(from, to));
  return Decoration.set(found, true);
}

/** Keeps the note's folds as they change: at once when one folds or unfolds, a moment after the text moves them. */
const remember = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    state: EditorState;
    constructor(readonly view: EditorView) {
      this.state = view.state;
      window.addEventListener("pagehide", this.flush);
    }
    update(update: ViewUpdate) {
      this.state = update.state;
      const before = foldedRanges(update.startState);
      const after = foldedRanges(update.state);
      if (before !== after && !update.docChanged) this.flush();
      else if (update.docChanged && (before.size || after.size)) this.later();
    }
    later() {
      clearTimeout(this.timer);
      this.timer = setTimeout(this.flush, 1000);
    }
    flush = () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      const id = this.state.facet(editedNote);
      if (id) keep(id, this.state);
    };
    destroy() {
      if (this.timer !== undefined) this.flush();
      window.removeEventListener("pagehide", this.flush);
    }
  },
);

/* Opening a fold the cursor or typing goes into. */

/**
 * Unfolds where a line break is typed or deleted at a fold's edge (Enter at its heading's end,
 * Backspace on the line after it) or anything inside it changes, and where the cursor lands at its
 * end; CodeMirror opens one the cursor lands inside.
 */
const opening = EditorState.transactionExtender.of((tr) => {
  const ranges = foldedRanges(tr.startState);
  if (!ranges.size) return null;
  const unfolding = new Map<number, number>();
  const unfold = (from: number, to: number) => {
    const at = { from: tr.changes.mapPos(from, 1), to: tr.changes.mapPos(to, -1) };
    if (at.from < at.to) unfolding.set(at.from, at.to);
  };
  if (tr.docChanged && (tr.isUserEvent("input") || tr.isUserEvent("delete"))) {
    const { doc } = tr.startState;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const breaks = inserted.lines > 1 || doc.lineAt(fromA).number !== doc.lineAt(toA).number;
      ranges.between(fromA, toA, (from, to) => {
        if (breaks || (fromA < to && toA > from)) unfold(from, to);
      });
    });
  }
  if (tr.selection) {
    const { head } = tr.selection.main;
    ranges.between(0, tr.startState.doc.length, (from, to) => {
      if (tr.changes.mapPos(to, -1) === head && tr.changes.mapPos(from, 1) < head) unfold(from, to);
    });
  }
  return unfolding.size ? { effects: [...unfolding].map(([from, to]) => unfoldEffect.of({ from, to })) } : null;
});

/* Moving what's folded. */

/** The folds between `from` and `to`, again `by` further on: for lines moved there (a section moved by its heading). */
export function foldsMoved(state: EditorState, from: number, to: number, by: number): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(state).between(from, to, (start, end) => {
    if (start >= from && end <= to) effects.push(foldEffect.of({ from: start + by, to: end + by }));
  });
  return effects;
}

/**
 * Folds a move took out with its lines and put back where they went, put back where they were by
 * ⌘Z, and where they went again by ⇧⌘Z: those of the edit's start that aren't where its changes
 * would leave them.
 */
const foldsThroughHistory = invertedEffects.of((tr) => {
  if (!tr.docChanged || !["move", "undo", "redo"].some((event) => tr.isUserEvent(event))) return [];
  const before = foldedRanges(tr.startState);
  if (!before.size) return [];
  const after = foldedRanges(tr.state);
  const effects: StateEffect<unknown>[] = [];
  before.between(0, tr.startState.doc.length, (from, to) => {
    const [start, end] = [tr.changes.mapPos(from, 1), tr.changes.mapPos(to, -1)];
    let kept = false;
    after.between(start, start, (a, b) => {
      if (a === start && b === end) kept = true;
    });
    if (!kept) effects.push(foldEffect.of({ from, to }));
  });
  return effects;
});

/* Folding and unfolding. */

/** The fold under `section`'s heading, if it's folded: all of it, or as much as was when it folded. */
function foldOf(state: EditorState, section: Section) {
  const found: { from: number; to: number }[] = [];
  foldedRanges(state).between(section.head, section.head, (from, to) => {
    if (from === section.head) found.push({ from, to });
  });
  return found[0] ?? null;
}

/** Folds `section`, the cursor going to its heading if it was in what's hidden. */
function fold(view: EditorView, section: Section) {
  const { head } = view.state.selection.main;
  view.dispatch({
    effects: [foldEffect.of({ from: section.head, to: section.to }), EditorView.announce.of(t("editor.fold.didFold", { title: section.heading.title }))],
    selection: head > section.head && head <= section.to ? { anchor: section.head } : undefined,
  });
  return true;
}

function unfold(view: EditorView, section: Section) {
  const fold = foldOf(view.state, section);
  if (!fold) return false;
  view.dispatch({ effects: [unfoldEffect.of(fold), EditorView.announce.of(t("editor.fold.didUnfold", { title: section.heading.title }))] });
  return true;
}

/** Folds or unfolds the section whose heading starts at `from` (its chevron). */
function toggle(view: EditorView, from: number) {
  readAll(view);
  const section = sections(view.state).find((each) => each.from === from);
  if (!section || !foldable(section)) return;
  if (!unfold(view, section)) fold(view, section);
}

/** The sections the cursor is in, its heading's line or what's under it: the innermost first. */
function sectionsAtCursor(state: EditorState) {
  const { head } = state.selection.main;
  return sections(state)
    .filter((section) => section.from <= head && head <= Math.max(section.to, section.head))
    .reverse();
}

/** ⌘⌥[: folds the innermost section the cursor is in that isn't folded. */
const foldHere = (view: EditorView) => {
  readAll(view);
  const section = sectionsAtCursor(view.state).find((each) => foldable(each) && !foldOf(view.state, each));
  return section ? fold(view, section) : false;
};

/** ⌘⌥]: unfolds the section whose heading the cursor is on, or failing that the innermost folded one around it. */
const unfoldHere = (view: EditorView) => {
  const section = sectionsAtCursor(view.state).find((each) => foldOf(view.state, each));
  return section ? unfold(view, section) : false;
};

/** ⌃⌥[: folds every section, at every level, so opening one shows the ones in it folded. */
const foldAll = (view: EditorView) => {
  readAll(view);
  const { state } = view;
  const list = sections(state).filter((section) => foldable(section) && !foldOf(state, section));
  if (!list.length) return false;
  // The cursor goes to the heading of the outermost one it's in.
  const { head } = state.selection.main;
  const around = list.find((section) => head > section.head && head <= section.to);
  view.dispatch({ effects: list.map((section) => foldEffect.of({ from: section.head, to: section.to })), selection: around ? { anchor: around.head } : undefined });
  return true;
};

/** ⌃⌥]: unfolds them all. */
const unfoldAll = (view: EditorView) => {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length) view.dispatch({ effects });
  return effects.length > 0;
};

/** The keys, as CodeMirror has them, and Settings → Shortcuts lists them. */
const foldKeys = keymap.of([
  { key: "Ctrl-Shift-[", mac: "Mod-Alt-[", run: foldHere },
  { key: "Ctrl-Shift-]", mac: "Mod-Alt-]", run: unfoldHere },
  { key: "Ctrl-Alt-[", run: foldAll },
  { key: "Ctrl-Alt-]", run: unfoldAll },
]);

/* The chevrons beside headings. */

const CHEVRON_WIDTH = 18;
const CHEVRON_HEIGHT = 24;
/** Clear of the grip that dragging a line shows by the text, and the first lane of marks (markers.ts). */
const BESIDE_GRIP = 32;
const fine = matchMedia("(hover: hover) and (pointer: fine)");

interface Placed {
  from: number;
  title: string;
  folded: boolean;
  top: number;
  left: number;
}

/**
 * A chevron beside each heading in view with something under it, that folds or unfolds it: shown
 * as the pointer is over the heading (or the chevron), and always for a folded one, as on a touch
 * screen. Each is a button saying whether it's open, out of the Tab order as the keys do the same
 * from the cursor: Esc and Tab from the note go on to what's after it (its properties, say), not
 * through a button for every heading.
 */
const chevrons = ViewPlugin.fromClass(
  class {
    box = document.createElement("div");
    buttons: { button: HTMLButtonElement; icon: Record<string, unknown> }[] = [];
    placed: Placed[] = [];
    hovered: number | null = null;

    constructor(readonly view: EditorView) {
      this.box.className = "cm-fold-chevrons";
      view.scrollDOM.append(this.box);
      view.scrollDOM.addEventListener("mousemove", this.hover);
      view.scrollDOM.addEventListener("mouseleave", this.leave);
      this.measure();
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        foldedRanges(update.startState) !== foldedRanges(update.state) ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.startState.facet(outlineHeadings) !== update.state.facet(outlineHeadings)
      )
        this.measure();
    }

    measure() {
      this.view.requestMeasure({ key: this, read: () => this.read(), write: (placed) => this.draw(placed) });
    }

    read(): Placed[] {
      const { view } = this;
      const { state } = view;
      const ranges = foldedRanges(state);
      const hidden = (pos: number) => {
        let inside = false;
        ranges.between(pos, pos, (from, to) => {
          if (from < pos && pos <= to) inside = true;
        });
        return inside;
      };
      const { from: shownFrom, to: shownTo } = view.viewport;
      const scroller = view.scrollDOM.getBoundingClientRect();
      const content = view.contentDOM;
      const pad = parseFloat(getComputedStyle(content).paddingLeft);
      const textLeft = content.getBoundingClientRect().left + pad;
      // Left of the grip, where there is one, else where it would be; never past the note's edge.
      const offset = fine.matches && prefs.dragBlocks && !state.readOnly ? BESIDE_GRIP : 4;
      const left = Math.max(scroller.left + 2, textLeft - offset - CHEVRON_WIDTH) - scroller.left + view.scrollDOM.scrollLeft;
      const placed: Placed[] = [];
      for (const section of sections(state)) {
        if (section.from < shownFrom || section.from > shownTo || !foldable(section) || hidden(section.from)) continue;
        const line = state.doc.lineAt(section.from);
        const start = line.from + /^\s*/.exec(line.text)![0].length;
        const coords = view.coordsAtPos(start, 1);
        const centre = coords ? (coords.top + coords.bottom) / 2 : view.documentTop + view.lineBlockAt(start).top + view.defaultLineHeight / 2;
        placed.push({
          from: section.from,
          title: section.heading.title,
          folded: foldOf(state, section) !== null,
          top: centre - scroller.top + view.scrollDOM.scrollTop - CHEVRON_HEIGHT / 2,
          left,
        });
      }
      return placed;
    }

    draw(placed: Placed[]) {
      this.placed = placed;
      while (this.buttons.length < placed.length) this.buttons.push(this.make());
      while (this.buttons.length > placed.length) {
        const { button, icon } = this.buttons.pop()!;
        void unmount(icon);
        button.remove();
      }
      placed.forEach((place, i) => {
        const { button } = this.buttons[i];
        const label = t(place.folded ? "editor.fold.unfold" : "editor.fold.fold", { title: place.title });
        button.dataset.from = String(place.from);
        button.style.top = `${place.top}px`;
        button.style.left = `${place.left}px`;
        button.setAttribute("aria-expanded", String(!place.folded));
        button.setAttribute("aria-label", label);
        button.title = label;
        button.classList.toggle("is-folded", place.folded);
        button.classList.toggle("is-hovered", place.from === this.hovered);
      });
    }

    make() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-fold-chevron";
      button.tabIndex = -1;
      const icon = mount(Icon, { target: button, props: { name: "chevron-down", size: 15, strokeWidth: 2 } });
      // The cursor and focus stay where they are.
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => toggle(this.view, Number(button.dataset.from)));
      this.box.append(button);
      return { button, icon };
    }

    hover = (event: MouseEvent) => {
      const { view } = this;
      if ((event.target as Element).closest?.(".cm-fold-chevron")) return;
      const y = event.clientY - view.documentTop;
      const block = view.lineBlockAtHeight(y);
      const inside = y >= block.top && y <= block.bottom && (event.target as Element).closest?.(".cm-editor") === view.dom;
      const section = inside ? sectionOn(view.state, block.from) : null;
      this.setHovered(section && section.from >= block.from ? section.from : null);
    };

    leave = (event: MouseEvent) => {
      if ((event.relatedTarget as Element | null)?.closest?.(".cm-fold-chevron")) return;
      this.setHovered(null);
    };

    setHovered(from: number | null) {
      if (from === this.hovered) return;
      this.hovered = from;
      for (const { button } of this.buttons) button.classList.toggle("is-hovered", Number(button.dataset.from) === from);
    }

    destroy() {
      this.view.scrollDOM.removeEventListener("mousemove", this.hover);
      this.view.scrollDOM.removeEventListener("mouseleave", this.leave);
      for (const { icon } of this.buttons) void unmount(icon);
      this.box.remove();
    }
  },
);

/** Folding, while Settings has it on (Editor.svelte): in every note's editor, whatever its language says its headings are. */
export const foldingCompartment = new Compartment();

export const folding: Extension = [
  foldState.init(keptFolds),
  codeFolding({ placeholderDOM: (_view, onclick) => placeholder(onclick) }),
  opening,
  foldsThroughHistory,
  remember,
  chevrons,
  Prec.high(foldKeys),
];
