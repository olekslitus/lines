<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { on } from "svelte/events";
  import { feeds } from "../feeds/feeds.svelte";
  import { t } from "../i18n/index.svelte";
  import Icon from "../icons/Icon.svelte";
  import { longPress } from "../longPress";
  import { typeLooks } from "../notes/looks.svelte";
  import { typeLabel } from "../notes/properties";
  import { notes } from "../notes/store.svelte";
  import { player } from "../player/player.svelte";
  import { plugins } from "../plugins/registry.svelte";
  import { type MenuItem, ui } from "../ui.svelte";

  /*
   * On a phone, a round + at the bottom of the note list, in reach of a thumb: what the title bar's
   * button does there (a new note, as the list makes one; Add to Library on a shelf; subscribing in
   * the Feeds), its boxes opening where that button's do, under `bar`. Held (or right-clicked, or the
   * menu key), a menu of the other kinds to make. It goes as the list scrolls down, or the keyboard
   * is up, and comes back as it scrolls up; it's over the mini player, not under it.
   */

  let { bar }: { bar: HTMLElement | undefined } = $props();

  const filter = $derived(notes.filter);
  const label = $derived(filter.kind === "library" ? t("library.add.title") : filter.kind === "feeds" ? t("feeds.subscribe") : t("list.newNote"));

  /** Scrolled down, until it's scrolled up again or another list is shown. */
  let away = $derived.by(() => {
    void notes.filter;
    return false;
  });
  /**
   * A text field has focus, so on a phone the keyboard is up. Reset as a note or post opens or
   * closes, since WebKit lets go of focus in the pane that slides away without a focusout.
   */
  let typing = $derived.by(() => {
    void notes.selectedId;
    void feeds.open;
    return false;
  });
  let button = $state<HTMLButtonElement>();

  /** How far the list has to scroll one way before the button goes or comes back. */
  const SCROLL_STEP = 8;

  /** The list it's over (its neighbor), as it scrolls: scrolling doesn't bubble, but it's caught on the way down. */
  const followScroll: Attachment<HTMLElement> = (node) => {
    let last = 0;
    return on(
      node.parentElement!,
      "scroll",
      (event) => {
        const list = event.target as HTMLElement;
        const top = list.scrollTop;
        // Bouncing past either end (iOS) isn't scrolling either way.
        if (top < 0 || top > list.scrollHeight - list.clientHeight) return;
        if (Math.abs(top - last) < SCROLL_STEP && top > 0) return;
        away = top > last && top > 0;
        last = top;
      },
      { capture: true, passive: true },
    );
  };

  const editable = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "file"].includes(target.type)));

  /** Opens a box where the title bar's button opens it: under the bar, at its right. */
  const underBar = () => {
    const box = (bar ?? button!).getBoundingClientRect();
    return { right: box.right - 12, bottom: box.bottom + 4 };
  };

  function addToLibrary(shelf?: string) {
    ui.addToLibrary = { x: 8, y: underBar().bottom, button: button!, shelf };
  }

  function subscribe() {
    const { right, bottom } = underBar();
    ui.subscribePrompt = { x: right, y: bottom, align: "end" };
  }

  function add() {
    if (filter.kind === "library") addToLibrary(filter.shelf);
    else if (filter.kind === "feeds") subscribe();
    else notes.create();
  }

  /** The other kinds to make, in a menu over it: a plain note, one of each type of your own, and the Library's. */
  function openKinds(event?: MouseEvent) {
    event?.preventDefault();
    if (!button) return;
    const box = button.getBoundingClientRect();
    const types: MenuItem[] = notes.types
      .filter(({ type }) => !plugins.libraryKind(type))
      .map(({ type }) => ({ label: typeLabel(type), icon: typeLooks.icon(type), run: () => notes.create(undefined, { type }) }));
    ui.openMenu({
      x: box.left + box.width / 2,
      y: box.top - 8,
      align: "center",
      anchor: button,
      label: t("list.newKinds"),
      items: [
        { label: t("list.newKindNote"), icon: "file-text", run: () => notes.create(undefined, {}) },
        ...types,
        "separator",
        { label: t("library.add.title"), icon: "plus", run: () => addToLibrary() },
        ...(feeds.on ? [{ label: t("feeds.subscribe"), icon: "rss" as const, run: subscribe }] : []),
      ],
    });
  }
</script>

<svelte:document onfocusin={(event) => (typing = editable(event.target))} onfocusout={() => (typing = false)} />

<!--
  Above the home indicator, or the mini player, which has room for it already; and above a notice
  (Undo) while there's one. Gone, it's still reached by Tab, and comes back as it's focused.
-->
<button
  bind:this={button}
  type="button"
  aria-label={label}
  title={label}
  class={[
    "add-button absolute left-1/2 z-10 grid size-14 -translate-x-1/2 place-items-center rounded-[min(50%,calc(28px*var(--radius-scale)))] bg-accent text-on-accent shadow-menu outline-offset-3 select-none [-webkit-touch-callout:none]",
    "transition-[translate,scale,opacity,bottom] duration-220 ease-sheet active:scale-90 active:duration-100",
    player.episode ? "bottom-4" : ui.notice ? "bottom-[calc(76px+env(safe-area-inset-bottom))]" : "bottom-[calc(16px+env(safe-area-inset-bottom))]",
    (away || typing) && "pointer-events-none translate-y-[calc(100%+24px)] scale-75 opacity-0 focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:scale-100 focus-visible:opacity-100",
  ]}
  onclick={add}
  oncontextmenu={openKinds}
  onfocus={() => (away = false)}
  {@attach longPress(() => openKinds(), { sinks: false })}
  {@attach followScroll}
>
  <Icon name="plus" size={26} strokeWidth={2.25} />
</button>

<style>
  /* With icons off it says what it does, in a pill as round. */
  :global(:root[data-no-icons]) .add-button {
    padding-inline: 20px;
    font-weight: 600;
  }
</style>
