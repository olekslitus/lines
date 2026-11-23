import { isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { htmlToMarkdown, type OwnElements } from "../feeds/markdown";
import { parseHtml } from "../feeds/html";
import { escapeMarkdown } from "../notes/escape";
import { prefs } from "../prefs.svelte";
import { placeItems } from "./lists";
import { inMarkdownCode } from "./tables";

/*
 * What's pasted keeps its formatting, as Markdown: the HTML a page, Slack, Google Docs, Notes or
 * Mail copies with the text (its links, lists, headings, emphasis, quotes and code) is read the way
 * feed posts are (feeds/markdown.ts), so nothing in it runs and its words stay only words. Lines of
 * plain text starting with "•" are a list too. The paste goes in as it was copied first, so ⌘Z right
 * after leaves it plain; Settings → Editor → Keep formatting when pasting, off, keeps every paste plain.
 */

/** What HTML has that plain text loses. Code alone isn't: a code editor copies its colors as HTML, and its text is what's wanted. */
const FORMATTED = "a[href], ul, ol, h1, h2, h3, h4, h5, h6, b, strong, em, i, s, del, strike, blockquote, img, hr";
/** A list's bullet as plain text writes it (Slack, Notes, PDFs), and the indentation before it. */
const BULLET = /^([ \t]*)[•◦▪▫‣⁃●○■□][ \t]+/;
/** An emoji, as `alt` of a picture of one says (GitHub's, X's): a pictograph or a flag, and what joins and colors them, but no digits alone. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u;
const PICTURED = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
/** A picture of an emoji named by its code points (Slack's `…/1f44b.png`, Twemoji's `1f44b.svg`). */
const CODE_POINTS = /\/((?:[0-9a-f]{4,6})(?:-[0-9a-f]{4,6})*)\.(?:png|svg)$/i;
/** A block's mark at a line's start: something pasted after text on its line goes on a line of its own. */
const BLOCK_START = /^(?:#{1,6} |[-*+] |\d+[.)] |> |```|---$)/;

/** A picture that's an emoji, as text: the emoji itself where its address or `alt` says which, else its name (`:wave:`). */
function emoji(image: Element): string | null {
  const alt = image.getAttribute("alt")?.trim() ?? "";
  if (EMOJI.test(alt) && PICTURED.test(alt)) return alt;
  if (!image.matches("[data-stringify-emoji], [data-stringify-type=emoji], .c-emoji, .emoji")) return null;
  const points = CODE_POINTS.exec(image.getAttribute("src") ?? "")?.[1];
  if (points) {
    try {
      return String.fromCodePoint(...points.split("-").map((point) => parseInt(point, 16)));
    } catch {
      // Not code points after all.
    }
  }
  return escapeMarkdown(image.getAttribute("data-stringify-text") ?? alt);
}

/** Slack's lists: flat, each level a list of its own after the one above (`data-indent`). Each goes in the item before it, and lists one after another at a level are one. */
function nestFlatLists(body: HTMLElement) {
  const levelOf = (list: Element) => Number(list.getAttribute("data-indent") ?? list.querySelector("li")?.getAttribute("data-stringify-indent") ?? NaN);
  const parents = new Set([...body.querySelectorAll("ul[data-indent], ol[data-indent]")].map((list) => list.parentElement!));
  for (const parent of parents) {
    let open: Element[] = [];
    // A copy: lists are moved out of `children` as it's gone through.
    for (const child of Array.from(parent.children)) {
      const level = levelOf(child);
      if (!(child.localName === "ul" || child.localName === "ol") || Number.isNaN(level)) {
        if (child.textContent?.trim()) open = [];
        continue;
      }
      const same = open[level];
      if (same && same.localName === child.localName && same.isConnected) {
        same.append(...child.children);
        child.remove();
      } else if (level > 0 && open[level - 1]) {
        const above = open[level - 1];
        (above.lastElementChild ?? above).append(child);
        open[level] = child;
      } else open[level] = child;
      open = open.slice(0, level + 1);
    }
  }
}

/** Google Docs' text, all in a `<b>` that isn't bold, its bold and italics written as styles. */
function styledSpans(body: HTMLElement) {
  for (const bold of body.querySelectorAll("b, strong")) {
    if (/font-weight:\s*(?:normal|[1-4]00)\b/.test(bold.getAttribute("style") ?? "")) bold.replaceWith(...bold.childNodes);
  }
  for (const span of body.querySelectorAll("span[style]")) {
    const style = span.getAttribute("style")!;
    const wraps = [/font-weight:\s*(?:bold|[6-9]00)\b/.test(style) && "strong", /font-style:\s*italic/.test(style) && "em", /text-decoration[^;]*line-through/.test(style) && "s"];
    for (const name of wraps) {
      if (!name) continue;
      const wrap = body.ownerDocument.createElement(name);
      wrap.append(...span.childNodes);
      span.append(wrap);
    }
  }
}

/** What's pasted from elsewhere, besides plain HTML: a heading at its own level, Slack's breaks and emoji, flat lists and styled spans made plain HTML first. */
const pasted: OwnElements = {
  prepare(body) {
    nestFlatLists(body);
    styledSpans(body);
  },
  block(element, markdown) {
    const heading = /^h([1-6])$/.exec(element.localName);
    if (!heading) return null;
    const text = markdown.line(element);
    return text ? [`${"#".repeat(Number(heading[1]))} ${text}`] : [];
  },
  inline(element) {
    if (element.getAttribute("data-stringify-type") === "paragraph-break") return "\n\n";
    return element.localName === "img" ? emoji(element) : null;
  },
};

/** Whether HTML has more than its plain text: a link, a list, emphasis, a picture that isn't an emoji. */
function formatted(html: string) {
  return [...parseHtml(html).querySelectorAll(FORMATTED)].some((element) => element.localName !== "img" || emoji(element) === null);
}

/** Plain text's "•" lines as Markdown's list items; null if it has none. */
function bulleted(plain: string) {
  const lines = plain.split("\n");
  if (!lines.some((line) => BULLET.test(line))) return null;
  return lines.map((line) => line.replace(BULLET, "$1- ")).join("\n");
}

/** What's on the clipboard as Markdown, if it says more than its plain text. */
export function pastedMarkdown(html: string, plain: string): string | null {
  if (html && formatted(html)) {
    const markdown = htmlToMarkdown(html, undefined, pasted);
    if (markdown) return markdown;
  }
  return bulleted(plain);
}

export const richPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const { state } = view;
    const data = event.clipboardData;
    if (!data || !prefs.pasteFormatting || state.readOnly || state.selection.ranges.length > 1) return false;
    const plain = data.getData("text/plain").replace(/\r\n?/g, "\n");
    // A link alone is left to what pastes links (an embed, a picture, a link around what's selected).
    if (!plain.trim() || /^\S+:\/\/\S+$/.test(plain.trim())) return false;
    const { from, to } = state.selection.main;
    if (inMarkdownCode(state, from)) return false;
    const markdown = pastedMarkdown(data.getData("text/html"), plain);
    if (markdown === null || markdown === plain.trim()) return false;
    event.preventDefault();
    // Where it goes, worked out before the paste: on an empty item or line, list items take its place.
    const placed = from === to ? placeItems(state, from, markdown) : null;
    let start = from;
    let insert = markdown;
    if (placed) {
      start = placed.from;
      insert = placed.insert;
    } else if (markdown.includes("\n") || BLOCK_START.test(markdown)) {
      // Blocks on lines of their own, apart from text on either side.
      const line = state.doc.lineAt(from);
      if (state.sliceDoc(line.from, from).trim() && BLOCK_START.test(markdown)) insert = `\n${insert}`;
      if (state.sliceDoc(to, state.doc.lineAt(to).to).trim()) insert += "\n";
    }
    // First the paste as it was copied…
    view.dispatch({ changes: { from, to, insert: plain }, selection: { anchor: from + plain.length }, userEvent: "input.paste", scrollIntoView: true });
    // …then, as its own undo step, its Markdown in its place.
    view.dispatch({
      changes: { from: start, to: from + plain.length, insert },
      selection: { anchor: start + insert.length },
      annotations: isolateHistory.of("before"),
      userEvent: "input.paste",
      scrollIntoView: true,
    });
    return true;
  },
});
