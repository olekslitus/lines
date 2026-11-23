import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, StateField } from "@codemirror/state";
import { type Command, type EditorView, keymap, showTooltip, type Tooltip, type TooltipView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { mount, unmount } from "svelte";
import Icon from "../icons/Icon.svelte";
import type { IconName } from "../icons/icons";
import { t } from "../i18n/index.svelte";
import { isApple } from "../platform";
import { drawnAsBlock } from "./attachments";
import LinkEditor from "./LinkEditor.svelte";
import { copyAddress, openHref } from "./links";
import { focused } from "./util";

/*
 * Editing a link in a Markdown note without its Markdown: ⌘K (Ctrl+K) opens a box for its text and
 * address (LinkEditor.svelte), and with Markdown hidden (hiddenMarkdown.ts), where the address never
 * shows, a bar under a link the cursor is in shows it, with buttons to edit, open, copy and remove
 * it. Over text that isn't a link, ⌘K makes it one.
 */

/** A link, a picture or an address in `<>`, and where its parts are. */
export interface MarkdownLink {
  kind: "link" | "image" | "autolink";
  from: number;
  to: number;
  /** Its text: a picture's description, an autolink's address. */
  textFrom: number;
  textTo: number;
  urlFrom: number;
  urlTo: number;
  href: string;
}

/** The link `node` is, if it's one with an address. */
export function linkOf(state: EditorState, node: SyntaxNode): MarkdownLink | null {
  const url = node.getChild("URL");
  if (!url) return null;
  const href = state.sliceDoc(url.from, url.to);
  const at = { from: node.from, to: node.to, urlFrom: url.from, urlTo: url.to, href };
  if (node.name === "Autolink") return { kind: "autolink", textFrom: url.from, textTo: url.to, ...at };
  const marks = node.getChildren("LinkMark");
  if ((node.name !== "Link" && node.name !== "Image") || marks.length < 2) return null;
  return { kind: node.name === "Link" ? "link" : "image", textFrom: marks[0].to, textTo: marks[1].from, ...at };
}

/** The link `from`–`to` is in, or a cursor there is beside: the innermost, a picture rather than the link around it. */
export function linkAround(state: EditorState, from: number, to = from): MarkdownLink | null {
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, side); node; node = node.parent) {
      const link = linkOf(state, node);
      if (link && link.from <= from && to <= link.to) return link;
    }
  }
  return null;
}

/**
 * What of a link hidden Markdown never shows (livePreview.ts draws it so, hiddenMarkdown.ts steps
 * over it): what's before its text and after it, its `[` and its `](address)`, an autolink's `<` and
 * `>`. One with no text shows its address.
 */
export function linkMarks(link: MarkdownLink): [open: { from: number; to: number }, close: { from: number; to: number }] {
  const [from, to] = link.textFrom < link.textTo ? [link.textFrom, link.textTo] : [link.urlFrom, link.urlTo];
  return [
    { from: link.from, to: from },
    { from: to, to: link.to },
  ];
}

/** Whether hidden Markdown draws `node`, a link, with its marks hidden: not a picture, nor a link drawn as a block of its own. */
export const hidesMarks = (state: EditorState, node: SyntaxNode) => node.name !== "Image" && !drawnAsBlock(state, node);

/** An address as a link's destination: what would end it early (a space, a bracket) written as `%20`, `%29`. */
const destination = (href: string) => href.trim().replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

/** Text as a link's, its brackets escaped. */
const linkText = (text: string) => text.replace(/[[\]]/g, "\\$&");

/** Changes `link` to have this text and address, or makes `from`–`to` a link with them. */
function writeLink(view: EditorView, target: MarkdownLink | { from: number; to: number }, text: string, href: string) {
  const { state } = view;
  const url = destination(href);
  if ("kind" in target) {
    const was = state.sliceDoc(target.textFrom, target.textTo);
    if (target.kind === "autolink") {
      const insert = text === was || !text ? `<${url}>` : `[${linkText(text)}](${url})`;
      return view.dispatch({ changes: { from: target.from, to: target.to, insert }, selection: { anchor: target.from + insert.length }, userEvent: "input" });
    }
    const changes = [
      ...(text !== was ? [{ from: target.textFrom, to: target.textTo, insert: linkText(text) }] : []),
      ...(url !== target.href ? [{ from: target.urlFrom, to: target.urlTo, insert: url }] : []),
    ];
    if (!changes.length) return;
    const set = state.changes(changes);
    return view.dispatch({ changes: set, selection: { anchor: set.mapPos(target.to, 1) }, userEvent: "input" });
  }
  const insert = `[${linkText(text || href.trim())}](${url})`;
  view.dispatch({ changes: { from: target.from, to: target.to, insert }, selection: { anchor: target.from + insert.length }, userEvent: "input", scrollIntoView: true });
}

/** Leaves a link's text, without the link. */
function removeLink(view: EditorView, link: MarkdownLink) {
  const text = view.state.sliceDoc(link.textFrom, link.textTo);
  view.dispatch({ changes: { from: link.from, to: link.to, insert: text }, selection: { anchor: link.from + text.length }, userEvent: "delete" });
}

/** Where the link box opens: under the link's (or the selection's) start. */
function boxAt(view: EditorView, pos: number) {
  const at = view.coordsAtPos(pos, 1) ?? view.coordsAtPos(pos) ?? view.contentDOM.getBoundingClientRect();
  return { x: at.left, y: at.bottom + 4 };
}

/** Opens the box to edit the link at the selection, or to make the selection one. */
function openEditor(view: EditorView, link: MarkdownLink | null) {
  const { state } = view;
  const range = state.selection.main;
  const target = link ?? { from: range.from, to: range.to };
  const text = link ? state.sliceDoc(link.textFrom, link.textTo) : state.sliceDoc(range.from, range.to);
  const mounted = mount(LinkEditor, {
    target: document.body,
    props: {
      ...boxAt(view, target.from),
      text,
      href: link?.href ?? "",
      image: link?.kind === "image",
      adding: !link,
      onsave: (text: string, href: string) => writeLink(view, target, text, href),
      onremove: link && link.kind !== "image" ? () => removeLink(view, link) : undefined,
      onopen: (href: string) => openHref(href, text),
      oncopy: (href: string) => copyAddress(href),
      onclose() {
        if (view.dom.isConnected) view.focus();
        // Once it has finished closing.
        setTimeout(() => void unmount(mounted));
      },
    },
  });
}

/** ⌘K: edits the link the cursor's in or beside, or makes the selected text a link. */
export const editLink: Command = (view) => {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length > 1) return false;
  const range = state.selection.main;
  const link = linkAround(state, range.from, range.to);
  if (!link && state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number) return false;
  openEditor(view, link);
  return true;
};

/** The shortcut, as `aria-keyshortcuts` writes it, and as it's shown. */
const KEYS = isApple ? "Meta+K" : "Control+K";
const SHORTCUT = isApple ? "⌘K" : "Ctrl+K";

/** The link the cursor's in while Markdown is hidden: in its text, not at either end, where typing goes outside it. */
function linkInside(state: EditorState) {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1 || !state.field(focused, false)) return null;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.head, 1); node; node = node.parent) {
    if (node.name !== "Link") continue;
    const link = linkOf(state, node);
    return link && link.from < range.head && range.head < link.to && hidesMarks(state, node) ? link : null;
  }
  return null;
}

/** The bar under a link: its address, and Edit, Open, Copy and Remove. */
function createBar(view: EditorView, link: MarkdownLink): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-link-bar";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", t("editor.link.label"));
  // Keep the editor focused and the cursor where it is.
  dom.addEventListener("mousedown", (event) => event.preventDefault());
  const icons: Record<string, unknown>[] = [];
  const button = (label: string, icon: IconName | null, run: () => void, cls = "") => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = cls;
    el.title = label;
    el.setAttribute("aria-label", label);
    if (icon) icons.push(mount(Icon, { target: el, props: { name: icon, size: 16, strokeWidth: 2 } }));
    el.addEventListener("click", run);
    dom.append(el);
    return el;
  };
  const edit = () => openEditor(view, linkAround(view.state, link.from + 1));
  const address = button(t("editor.link.editWithShortcut", { shortcut: SHORTCUT }), "link", edit, "cm-link-address");
  address.append(Object.assign(document.createElement("span"), { textContent: link.href }));
  address.setAttribute("aria-label", `${t("editor.link.edit")}: ${link.href}`);
  address.setAttribute("aria-keyshortcuts", KEYS);
  button(t("editor.link.open"), "external-link", () => openHref(link.href, view.state.sliceDoc(link.textFrom, link.textTo)));
  button(t("editor.link.copy"), "copy", () => copyAddress(link.href));
  if (!view.state.readOnly) {
    button(t("editor.link.remove"), "trash", () => {
      const now = linkAround(view.state, link.from + 1);
      if (now) removeLink(view, now);
      view.focus();
    });
  }
  return {
    dom,
    offset: { x: 0, y: 4 },
    destroy() {
      for (const icon of icons) void unmount(icon);
    },
  };
}

/** The bar for the link the cursor's in, kept while it's the same link, so it doesn't flicker as the cursor moves. */
const linkBar = StateField.define<{ link: MarkdownLink; tooltip: Tooltip } | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && tr.startState.field(focused, false) === tr.state.field(focused, false)) return value;
    const link = linkInside(tr.state);
    if (!link) return null;
    if (value && value.link.from === link.from && value.link.to === link.to && value.link.href === link.href) return value;
    return { link, tooltip: { pos: link.from, end: link.to, above: false, strictSide: false, arrow: false, create: (view) => createBar(view, link) } };
  },
  provide: (field) => showTooltip.from(field, (value) => value?.tooltip ?? null),
});

/** ⌘K, in every way Markdown shows. */
export const linkKeymap = keymap.of([{ key: "Mod-k", run: editLink, preventDefault: true }]);

/** The bar under a link the cursor's in, for hidden Markdown, where its address never shows. */
export const linkBarWhileHidden: Extension = [focused, linkBar];
