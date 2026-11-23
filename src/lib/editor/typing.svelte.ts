import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { isMobile } from "../platform";

/*
 * The note being written in on a phone or tablet, for the bar above its keyboard (KeyboardBar.svelte):
 * its editor while its text has focus (or the bar's buttons do, as a screen reader moves there), and
 * where the bar's top edge is, which the cursor is scrolled into view above.
 */

class Typing {
  view = $state.raw<EditorView | null>(null);
  /** Goes up as its text or selection changes, for what the bar shows as on. */
  changes = $state(0);
  /** The bar's top edge while it shows, from the top of the page, px. */
  barTop = Infinity;
}

export const typing = new Typing();

/** In the bar, where focus can go from the note without it being left. */
export const inBar = (element: Element | null) => !!element?.closest(".keyboard-bar");

const follow = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      if (view.hasFocus) typing.view = view;
    }
    update(update: ViewUpdate) {
      if (update.focusChanged) {
        if (this.view.hasFocus) typing.view = this.view;
        else if (typing.view === this.view && !inBar(document.activeElement)) typing.view = null;
      }
      if ((update.docChanged || update.selectionSet) && typing.view === this.view) typing.changes++;
    }
    destroy() {
      if (typing.view === this.view) typing.view = null;
    }
  },
);

/**
 * While the bar shows, the cursor (or what's scrolled to) is scrolled into the part of the note's
 * scroller above it, and only the scroller is: CodeMirror would scroll it into the scroller's whole
 * box, which goes on under the bar and the keyboard, and then scroll the page itself to bring it into
 * the visual viewport, taking the note's title bar off the top of the screen.
 */
const aboveBar = EditorView.scrollHandler.of((view, range, { y, yMargin }) => {
  if (typing.view !== view || typing.barTop === Infinity) return false;
  // Measured once the update scrolling it is over, as the layout can't be read during one.
  view.requestMeasure({
    read: () => {
      // Its line's place in the note when it isn't drawn, far from what's in sight.
      const block = view.lineBlockAt(range.head);
      const drawn = view.coordsAtPos(range.head, range.assoc || (range.head > range.anchor ? -1 : 1));
      const rect = drawn ?? { top: view.documentTop + block.top, bottom: view.documentTop + block.bottom };
      return { rect, box: view.scrollDOM.getBoundingClientRect() };
    },
    write: ({ rect, box }) => {
      const top = box.top + yMargin;
      const bottom = Math.min(box.bottom, typing.barTop) - yMargin;
      const move =
        y === "center" ? (rect.top + rect.bottom - top - bottom) / 2
        : y === "start" ? rect.top - top
        : y === "end" ? rect.bottom - bottom
        : rect.top < top ? rect.top - top
        : rect.bottom > bottom ? rect.bottom - bottom
        : 0;
      if (move) view.scrollDOM.scrollTop += move;
    },
  });
  return true;
});

/** A note's editor, followed for the bar on phones and tablets; nothing elsewhere. */
export const typingIn: Extension = isMobile ? [follow, aboveBar] : [];
