import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { keymap } from "@codemirror/view";
import { parsedFirst } from "./util";

/**
 * Markdown's Enter, CodeMirror's: it continues a list or a quote, and on an empty item ends the list
 * (a nested one moves out a level), its second item too (rather than putting a blank line before it).
 */
export const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** Markdown's Enter and Backspace, which go by the syntax tree: parsed as far as the cursor first. */
export const markdownKeymap = keymap.of([
  { key: "Enter", run: parsedFirst(continueMarkup) },
  { key: "Backspace", run: parsedFirst(deleteMarkupBackward) },
]);
