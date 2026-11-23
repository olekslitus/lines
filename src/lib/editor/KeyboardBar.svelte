<script lang="ts">
  import { EditorView, runScopeHandlers } from "@codemirror/view";
  import { untrack } from "svelte";
  import IconButton from "../components/ui/IconButton.svelte";
  import { t } from "../i18n/index.svelte";
  import type { IconName } from "../icons/icons";
  import { keyboard } from "../keyboard.svelte";
  import { prefs } from "../prefs.svelte";
  import { ui } from "../ui.svelte";
  import { dockFormatBar, FORMATS, type FormatId, formatsHere, isFormatted, toggleFormat } from "./formatting";
  import { type ListKind, listKind, toggleList } from "./listToggles";
  import { inBar, typing } from "./typing.svelte";

  /*
   * A bar on top of the keyboard while a note's written in (Settings → Editor), as Notes and Bear
   * have: on a phone, and on a tablet while its keyboard is on the screen. Its buttons are the toolbar
   * over selected text's, which it takes the place of (that's where iOS's own menu for the selection
   * goes on a phone), and what a keyboard on the screen has no keys for: lists, Tab and ⇧Tab, and
   * putting the keyboard away. Each acts on what's selected, or where the cursor is, as its shortcut
   * would. It follows the keyboard's top edge as it comes up and goes, and the text keeps clear of it.
   */

  interface Action {
    id: string;
    label: string;
    icon: IconName;
    run: (view: EditorView) => unknown;
    /** Whether what it turns on is on where the cursor is; left out for what isn't turned on. */
    on?: boolean;
  }

  const LISTS: { kind: ListKind; label: string; icon: IconName }[] = [
    { kind: "bullet", label: t("editor.slash.bulletList"), icon: "list" },
    { kind: "numbered", label: t("editor.slash.numberedList"), icon: "list-ordered" },
    { kind: "todo", label: t("editor.slash.todo"), icon: "list-todo" },
  ];

  /** Tab or ⇧Tab in the note, as the keys there would do it: an item nested or moved back out, a line indented. */
  const tab = (shift: boolean) => (view: EditorView) => runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Tab", code: "Tab", shiftKey: shift }), "editor");

  /** Room between it and the line being written, as that's scrolled up over it, px. */
  const CLEARANCE = 8;

  const view = $derived(typing.view);
  /** The note's editor state, as it changes. */
  const note = $derived.by(() => {
    void typing.changes;
    return view?.state ?? null;
  });
  /** In place of the toolbar over selected text: on a phone, or a tablet with its keyboard up. */
  const docks = $derived(prefs.keyboardBar && (ui.layout === "narrow" || keyboard.up));
  const shown = $derived(docks && !!note && !note.readOnly);

  const groups = $derived.by((): Action[][] => {
    if (!note) return [];
    const nesting: Action[] = [
      { id: "outdent", label: t("editor.keyboardBar.outdent"), icon: "list-indent-decrease", run: tab(true) },
      { id: "indent", label: t("editor.keyboardBar.indent"), icon: "list-indent-increase", run: tab(false) },
    ];
    // Plain text and LaTeX have no Markdown to format with.
    if (!formatsHere(note)) return [nesting];
    const kind = listKind(note);
    return [
      (Object.keys(FORMATS) as FormatId[]).map((id) => ({ id, label: FORMATS[id].name, icon: FORMATS[id].icon, on: isFormatted(note, id), run: toggleFormat(id) })),
      LISTS.map((list) => ({ id: list.kind, label: list.label, icon: list.icon, on: kind === list.kind, run: toggleList(list.kind) })),
      nesting,
    ];
  });

  const actions = $derived(groups.flat());

  let bar = $state<HTMLElement>();
  let height = $state(0);
  /** The button Tab stops on (the last, Hide Keyboard, after the actions); the arrow keys move between them. */
  let current = $state(0);
  const stop = $derived(Math.min(current, actions.length));

  // The toolbar over selected text stays away while this has its buttons.
  $effect(() => {
    const target = view;
    const dock = docks;
    if (target) untrack(() => target.dispatch({ effects: dockFormatBar.of(dock) }));
  });

  /** Its top edge as it last was. */
  let lastTop = Infinity;

  // What it and the keyboard cover of the page, which the note's text keeps clear of: there's room
  // under its last line to scroll it up over them (app.css), the cursor's kept above it as it's
  // scrolled into view (typing.svelte.ts), and as it comes up, the line being written comes up too.
  $effect(() => {
    const top = shown ? keyboard.bottom - height : Infinity;
    typing.barTop = top;
    document.documentElement.style.setProperty("--keyboard-cover", `${top === Infinity ? 0 : Math.max(0, innerHeight - top)}px`);
    const target = view;
    if (target && top < lastTop) untrack(() => target.dispatch({ effects: EditorView.scrollIntoView(target.state.selection.main.head, { y: "nearest", yMargin: CLEARANCE }) }));
    lastTop = top;
  });

  function run(action: Action) {
    if (!view) return;
    action.run(view);
    if (!view.hasFocus) view.focus();
  }

  function hide() {
    view?.contentDOM.blur();
    typing.view = null;
  }

  /** A toolbar's keys: ← and → (and Home and End) between its buttons, Esc back to the text. */
  function onkeydown(event: KeyboardEvent) {
    const buttons = [...bar!.querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      view?.focus();
      return;
    }
    const next =
      event.key === "ArrowRight" ? (at + 1) % buttons.length
      : event.key === "ArrowLeft" ? (at - 1 + buttons.length) % buttons.length
      : event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : -1;
    if (next < 0 || at < 0) return;
    event.preventDefault();
    current = next;
    buttons[next].focus();
  }

  /** Focus leaving the bar for somewhere other than the note leaves the note. */
  function onfocusout(event: FocusEvent) {
    const to = event.relatedTarget as Element | null;
    if (!inBar(to) && !view?.contentDOM.contains(to)) typing.view = null;
  }
</script>

<!--
  Over the panes, under menus and dialogs. Pressing a button leaves the keyboard in the note
  (mousedown's focus kept from it); a screen reader's focus can go into it and come back. Hidden, it
  waits below the screen, out of reach.
-->
<div
  bind:this={bar}
  bind:offsetHeight={height}
  class={[
    "keyboard-bar fixed inset-x-0 top-0 z-20 flex items-center border-t border-line bg-panel pr-[max(4px,env(safe-area-inset-right))] pl-[max(4px,env(safe-area-inset-left))]",
    "transition-[translate,visibility] duration-250 ease-keyboard",
    !keyboard.up && "pb-[env(safe-area-inset-bottom)]",
    !shown && "invisible",
  ]}
  style:translate={shown ? `0 calc(${keyboard.bottom}px - 100%)` : "0 100vh"}
  role="toolbar"
  tabindex="-1"
  aria-label={t("editor.keyboardBar")}
  inert={!shown}
  onmousedown={(event) => event.preventDefault()}
  {onkeydown}
  {onfocusout}
>
  <div class="flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
    {#each groups as group, g (group[0].id)}
      {#if g > 0}<span class="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>{/if}
      {#each group as action (action.id)}
        <IconButton
          class="size-11!"
          icon={action.icon}
          iconSize={20}
          label={action.label}
          on={action.on}
          aria-pressed={action.on}
          tabindex={actions.indexOf(action) === stop ? 0 : -1}
          onclick={() => run(action)}
        />
      {/each}
    {/each}
  </div>
  <span class="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
  <IconButton class="size-11!" icon="keyboard-off" iconSize={20} label={t("editor.keyboardBar.hide")} tabindex={stop === actions.length ? 0 : -1} onclick={hide} />
</div>
