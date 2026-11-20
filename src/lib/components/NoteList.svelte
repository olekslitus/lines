<script lang="ts">
  import { flushSync, untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { speak } from "../a11y";
  import { locale, t } from "../i18n/index.svelte";
  import Icon from "../icons/Icon.svelte";
  import { dismissPosts, feedError, feedRowLabel, feeds, type FeedsFilter, type Row } from "../feeds/feeds.svelte";
  import type { Dismissal } from "../feeds/marks";
  import { shelves } from "../library/shelves.svelte";
  import { dateOf } from "../notes/calendar";
  import { typeLabel } from "../notes/properties";
  import { notes } from "../notes/store.svelte";
  import { isApple, isMobile, isTauri, newNoteKey, reducedMotion } from "../platform";
  import { deletePicked, inboxPicked, pinPicked, restorePicked, tagPicked, trashPicked } from "../notes/picked";
  import { pull } from "../gestures";
  import { SLIDE_EASE, SLIDE_MS } from "../spring";
  import { prefs } from "../prefs.svelte";
  import { today } from "../today.svelte";
  import { ui } from "../ui.svelte";
  import AddButton from "./AddButton.svelte";
  import CalendarMonth from "./CalendarMonth.svelte";
  import { ListWindow } from "./listWindow.svelte";
  import MiniPlayer from "./MiniPlayer.svelte";
  import NoteRow from "./NoteRow.svelte";
  import PostRow from "./PostRow.svelte";
  import PullIndicator from "./PullIndicator.svelte";
  import SidebarToggle from "./SidebarToggle.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";

  let { searchInput = $bindable() }: { searchInput?: HTMLInputElement } = $props();

  const title = $derived.by(() => {
    const f = notes.filter;
    if (f.kind === "tag") return `#${f.tag}`;
    if (f.kind === "type") return typeLabel(f.type);
    if (f.kind === "library") return shelves.get(f.shelf)?.label ?? typeLabel(f.shelf);
    if (f.kind === "calendar") return t("sidebar.calendar");
    if (f.kind === "feeds") return (f.feed && feeds.subscription(f.feed)?.title) || f.stream || feedRowLabel(f.group);
    return { inbox: t("sidebar.inbox"), all: t("sidebar.notes"), todo: t("sidebar.todo"), untagged: t("sidebar.untagged"), trash: t("sidebar.trash") }[f.kind];
  });

  /**
   * Which row Tab lands on: the open note's, else the first. The others are reached with the arrow
   * keys, so the list is one stop on the way through the app rather than one per note.
   */
  const tabStop = $derived(Math.max(0, notes.visible.findIndex((e) => e.note.id === notes.selectedId)));

  /** The Feeds (Library), where the list is of posts: every feed's, a kind's, or one's. */
  const feedView = $derived(notes.filter.kind === "feeds" ? notes.filter : null);
  /** The same feeds' posts still in the list. */
  function withoutDismissed(view: FeedsFilter): FeedsFilter {
    const { dismissed: _, ...filter } = view;
    return filter;
  }
  /** The feeds whose posts are listed. */
  const listedFeeds = $derived(feedView ? feeds.feedsOf(feedView) : []);
  const posts = $derived(feeds.listed);
  /** Whether the feeds listed have posts but every one is dismissed. */
  const caughtUp = $derived(!!feedView && !feedView.dismissed && listedFeeds.some((url) => feeds.records.get(url)?.posts.length));
  /** Where the open post is in the list, if it is. */
  const openPost = $derived.by(() => {
    const open = feeds.open;
    return open ? posts.findIndex(({ feed, post }) => feed === open.feed && post.id === open.id) : -1;
  });
  /** The feed listed, if it's one, as it was last fetched. */
  const record = $derived(feedView?.feed ? feeds.records.get(feedView.feed) : undefined);

  /** The box to subscribe in, under the button pressed: lined up with the header's at its right, centered under the empty list's. */
  function openSubscribe(event: MouseEvent & { currentTarget: HTMLElement }, align: "center" | "end" = "end") {
    const box = event.currentTarget.getBoundingClientRect();
    ui.subscribePrompt = { x: align === "end" ? box.right : box.left + box.width / 2, y: box.bottom + 4, align };
  }

  // Screen readers hear how many notes (or posts) a search finds, once typing pauses.
  $effect(() => {
    if (!notes.query.trim()) return;
    const count = feedView ? posts.length : notes.visible.length;
    const timer = setTimeout(() => speak(t("list.results", { count })), 700);
    return () => clearTimeout(timer);
  });

  function emptyTrash() {
    void notes.emptyTrash();
    speak(t("list.trashEmptied"));
    // Its button goes with the notes; the search field is what's left to hold focus.
    searchInput?.focus();
  }

  // Only a new day re-renders the rows' dates; a new Date for each edit would redo every row.
  const now = $derived(dateOf(today.day));

  /** The space between rows, where their divider is (the styles below). */
  const ROW_GAP = 6;

  let list: HTMLUListElement;
  let titleBar = $state<HTMLElement>();
  let pulled = $state<HTMLElement>();
  /**
   * On a phone, the round + at the list's bottom (Settings → Layout), but in the Trash, where
   * nothing is made.
   */
  const addButton = $derived(prefs.addButton && ui.layout === "narrow" && notes.ready && notes.filter.kind !== "trash");
  /** What the list says when it has no posts to show. */
  let empty = $state<HTMLElement>();
  /*
   * On a phone the search field waits above the list, as iOS's Mail and Notes keep theirs: the list
   * starts with its first row. A pull down past the top shows it (a long one searches, as before),
   * as does a fling that reaches the top, or going to it (the Search shortcut, Tab, a screen
   * reader); it stays while the list's at its top, and goes as it scrolls down, unless it's
   * searching or in use. Tablets and computers always show it.
   */
  const tucks = $derived(isMobile && ui.layout === "narrow");
  let searchShown = $state(false);
  let searchFocused = $state(false);
  const searchOut = $derived(!tucks || searchShown || searchFocused || !!notes.query);
  /** How far a pull that falls short of searching goes to show the field, px. */
  const SHOWS_SEARCH = 24;
  /** How far down the list scrolls before the field goes, px: about its own height. */
  const HIDES_SEARCH = 44;
  let searchBox: HTMLElement;
  /** A finger's on the list: it's dragged, not flung. */
  let touching = false;
  let lastScrollTop = 0;

  // Another list starts with its first row too.
  $effect(() => {
    void notes.filter;
    untrack(() => (searchShown = false));
  });

  /** What's below the field, and how far down each was before it came or went, to slide on from there. */
  let slid: [HTMLElement, number][] = [];
  $effect.pre(() => {
    void searchOut;
    untrack(() => {
      if (!searchBox) return;
      const below: HTMLElement[] = [];
      for (let next = searchBox.nextElementSibling; next && !next.contains(list); next = next.nextElementSibling) below.push(next as HTMLElement);
      slid = [...below, list].map((element) => [element, element.getBoundingClientRect().top]);
    });
  });
  $effect(() => {
    void searchOut;
    untrack(() => {
      const was = slid;
      slid = [];
      if (reducedMotion.matches) return;
      const timing = { duration: SLIDE_MS, easing: SLIDE_EASE };
      for (const [element, top] of was) {
        const moved = top - element.getBoundingClientRect().top;
        if (!element.isConnected || Math.abs(moved) < 1) continue;
        // From where it shows, which for the list may be a pull's way down as it springs back.
        const [, pulled = "0"] = getComputedStyle(element).translate.split(" ");
        element.animate([{ translate: `0 ${moved + parseFloat(pulled)}px` }, { translate: "0 0" }], timing);
      }
      if (searchOut && was.length) searchBox.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    });
  });

  /** Shows the field as a fling reaches the top, and puts it away as the list scrolls down. */
  function scrolled() {
    const top = list.scrollTop;
    if (tucks && !touching && top <= 0 && lastScrollTop > 0) searchShown = true;
    else if (searchShown && top > HIDES_SEARCH) searchShown = false;
    lastScrollTop = top;
  }

  /** Whether a finger's on the list, watched without holding up its scrolling (passive). */
  const watchTouches: Attachment<HTMLElement> = (element) => {
    const watch = (event: TouchEvent) => (touching = event.touches.length > 0);
    const options = { passive: true };
    for (const type of ["touchstart", "touchend", "touchcancel"] as const) element.addEventListener(type, watch, options);
    return () => {
      for (const type of ["touchstart", "touchend", "touchcancel"] as const) element.removeEventListener(type, watch);
    };
  };

  /** The row that's swiped open, if any. */
  let swipedId = $state<string | null>(null);

  /**
   * The rows drawn: those in view and some way around, and the one Tab lands on wherever it is, so
   * focus can go to it (Tab, F6, after a note is trashed) and stay on it as the list scrolls.
   */
  const rows = new ListWindow({
    element: () => list,
    items: () => notes.visible,
    key: (entry) => entry.note.id,
    keep: () => tabStop,
    gap: ROW_GAP,
    overscan: 1500,
  });

  // A note opened from elsewhere (a mention, a search, a new note) is shown in the list too.
  $effect(() => {
    const id = notes.selectedId;
    untrack(() => rows.show(notes.visible.findIndex((e) => e.note.id === id)));
  });

  const postStop = $derived(Math.max(0, openPost));
  const postRows = new ListWindow({
    element: () => list,
    items: () => posts,
    key: (row) => row.post.key,
    keep: () => postStop,
    gap: ROW_GAP,
    overscan: 1500,
  });
  const drawnRows = $derived(feedView ? postRows : rows);

  // A post opened (from the mini player, or the next after a dismiss) is shown in the list too; one
  // that only moves, as a row above it goes, isn't scrolled to.
  $effect(() => {
    void feeds.open;
    untrack(() => postRows.show(openPost));
  });

  const picked = $derived(notes.pickedEntries);
  const inTrash = $derived(notes.filter.kind === "trash");

  // A new search lets go of the notes picked in the last one.
  $effect(() => {
    void notes.query;
    untrack(() => notes.clearPicks());
  });

  // Screen readers hear how many are picked, once picking pauses.
  $effect(() => {
    const count = picked.length;
    if (count < 2) return;
    const timer = setTimeout(() => speak(t("list.pickedCount", { count })), 400);
    return () => clearTimeout(timer);
  });

  /** Focus on the open note's row, or the row Tab lands on, once the list has redrawn. */
  function focusList() {
    requestAnimationFrame(() => {
      const row = list.querySelector<HTMLElement>(`[data-id="${notes.selectedId}"]`) ?? list.querySelector<HTMLElement>('.item[tabindex="0"]');
      row?.focus({ preventScroll: true });
    });
  }

  /**
   * ↑ and ↓ open the note above or below, Home and End the first and last; with ⇧ they pick every
   * note on the way. ⌘A picks them all, Esc lets them go, and ⌫ moves the picked notes (or the
   * open one) to the Trash.
   */
  function onListKeydown(event: KeyboardEvent) {
    const mod = isApple ? event.metaKey : event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      notes.pickAll();
      return;
    }
    if (event.key === "Escape" && notes.picked.size) {
      event.preventDefault();
      notes.clearPicks();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && !mod && !inTrash) {
      event.preventDefault();
      if (picked.length > 1) trashPicked();
      else if (notes.selectedId) {
        notes.trashMany([notes.selectedId]);
        speak(t("list.didTrash"));
      }
      focusList();
      return;
    }
    const entries = notes.visible;
    const to = step(event.key, entries.findIndex((e) => e.note.id === notes.selectedId), entries.length);
    if (to === null) return;
    event.preventDefault();
    const next = entries[to]?.note.id;
    if (!next) return;
    if (event.shiftKey) notes.pickRange(next);
    else {
      notes.clearPicks();
      notes.select(next);
    }
    // Its row is drawn now, as the one Tab lands on, wherever it is; focus scrolls to it.
    flushSync();
    list.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus();
  }

  /**
   * ↑ and ↓ open the post above or below, Home and End the first and last. E and ⌫ dismiss the
   * post focused, N as not interesting.
   */
  function onPostKeydown(event: KeyboardEvent, row: Row) {
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !feedView?.dismissed) {
      const key = event.key.toLowerCase();
      const why: Dismissal | null = key === "e" || key === "backspace" || key === "delete" ? "done" : key === "n" ? "uninteresting" : null;
      if (why) {
        event.preventDefault();
        dismissRow(row, why);
        return;
      }
    }
    // From the row focused, which is the open one but after a dismiss or a click on another's button.
    const to = step(event.key, posts.findIndex(({ post }) => post.key === row.post.key), posts.length);
    const next = to === null ? undefined : posts[to];
    if (!next) return;
    event.preventDefault();
    feeds.show(next.feed, next.post.id);
    flushSync();
    list.querySelector<HTMLElement>(`[data-post="${next.post.key}"]`)?.focus();
  }

  /**
   * Dismisses a post (`why`), or puts a dismissed one back (null). If focus was in the list, it goes
   * to the row that takes its place (the post opened there, if it was the open one), the list staying
   * where it was.
   */
  function dismissRow(row: Row, why: Dismissal | null) {
    const index = posts.findIndex(({ post }) => post.key === row.post.key);
    const focused = list.contains(document.activeElement);
    if (why) dismissPosts([row], why);
    else {
      feeds.restore([row]);
      speak(t("feeds.didRestore", { count: 1 }));
    }
    flushSync();
    if (!focused) return;
    const next = posts[Math.min(index, posts.length - 1)];
    const target = next && list.querySelector<HTMLElement>(`[data-post="${next.post.key}"]`);
    // With none left, the button to see those dismissed, or the search field.
    (target ?? empty?.querySelector("button") ?? searchInput)?.focus({ preventScroll: true });
  }

  /** The row ↑, ↓, Home or End go to from row `index` (-1 for none) of `count`; null for another key. */
  function step(key: string, index: number, count: number): number | null {
    const to = key === "ArrowDown" ? index + 1 : key === "ArrowUp" ? index - 1 : key === "Home" ? 0 : key === "End" ? count - 1 : null;
    return to === null ? null : Math.max(0, Math.min(count - 1, to));
  }
</script>

<section class="note-list flex h-full flex-col" aria-labelledby="note-list-title">
  <header class="titlebar flex h-(--titlebar-h) shrink-0 items-center gap-1.5 pt-(--titlebar-pad-top) pr-3 pl-4" data-tauri-drag-region bind:this={titleBar}>
    <!-- The sidebar's button, on the sidebar's side. -->
    {#if ui.sidebarToggle === "list" && prefs.sidebarSide === "left"}
      <SidebarToggle />
    {/if}
    <h1 id="note-list-title" class="m-0 min-w-0 flex-1 truncate text-md font-semibold" data-tauri-drag-region>{title}</h1>
    {#if feedView}
      <IconButton
        icon="refresh"
        iconSize={16}
        busy={listedFeeds.some((url) => feeds.fetching.has(url))}
        label={feedView.feed ? t("feeds.refreshOne") : t("feeds.refresh")}
        onclick={() => feeds.refresh(listedFeeds)}
      />
      <!-- On a phone the round + at the bottom (AddButton.svelte) is this button, in reach of a thumb. -->
      {#if !addButton}
        <IconButton icon="plus" label={t("feeds.subscribe")} open={!!ui.subscribePrompt} onclick={openSubscribe} />
      {/if}
    {:else if notes.filter.kind !== "trash" && !addButton}
      <IconButton
        icon="square-pen"
        label={t("list.newNote")}
        tooltip={t("list.newNoteWithKey", { key: newNoteKey })}
        onclick={() => notes.create()}
      />
    {/if}
    {#if ui.sidebarToggle === "list" && prefs.sidebarSide === "right"}
      <SidebarToggle />
    {/if}
  </header>

  <!-- Put away, it's still in the page, for Tab and screen readers to reach; reached, it shows. -->
  <div class={["relative mx-3 flex items-center text-faint", searchOut ? "mt-0.5 mb-2.5" : "h-0 overflow-hidden opacity-0"]} bind:this={searchBox}>
    <Icon name="search" size={15} class="pointer-events-none absolute left-2.5" />
    <input
      bind:this={searchInput}
      bind:value={notes.query}
      class="ui-field h-[34px] w-full rounded-lg border border-transparent bg-input pr-[30px] pl-8 text-base text-fg outline-none transition-colors focus:border-accent-soft focus:bg-bg coarse:pr-11 [&::-webkit-search-cancel-button]:hidden"
      type="search"
      placeholder={t("list.search")}
      aria-label={t("list.searchLabel")}
      autocomplete="off"
      spellcheck="false"
      onfocus={() => (searchFocused = searchShown = true)}
      onblur={() => (searchFocused = false)}
      onkeydown={(e) => e.key === "Escape" && ((notes.query = ""), focusList())}
    />
    {#if notes.query}
      <!-- As tall as the field, and wide enough for a finger. -->
      <button
        class="absolute right-[5px] grid size-6 place-items-center rounded-sm text-faint coarse:right-0 coarse:h-[34px] coarse:w-11"
        onclick={() => ((notes.query = ""), searchInput?.focus())}
        aria-label={t("list.clearSearch")}
        title={t("list.clearSearch")}
      >
        <Icon name="x" size={14} />
      </button>
    {/if}
  </div>

  <!-- Several notes picked: how many, and what can be done to them all. -->
  {#if picked.length > 1}
    <div class="mx-3 mb-2 flex items-center gap-0.5 rounded-lg bg-input py-1 pr-1 pl-3" role="toolbar" aria-label={t("list.pickedActions")}>
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">{t("list.pickedCount", { count: picked.length })}</span>
      {#if inTrash}
        <IconButton icon="restore" iconSize={16} label={t("list.restore")} onclick={restorePicked} />
        <IconButton icon="trash" iconSize={16} danger label={t("list.deleteForever")} onclick={deletePicked} />
      {:else}
        {@const pin = picked.some((e) => !e.note.pinned)}
        {@const file = picked.some((e) => e.note.inbox)}
        <IconButton
          icon="hash"
          iconSize={16}
          label={t("list.addTag")}
          onclick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            tagPicked(box.right, box.bottom + 4, "end");
          }}
        />
        <IconButton icon={pin ? "pin" : "pin-off"} iconSize={16} label={pin ? t("list.pin") : t("list.unpin")} onclick={pinPicked} />
        <IconButton icon={file ? "archive" : "inbox"} iconSize={16} label={file ? t("list.file") : t("list.toInbox")} onclick={inboxPicked} />
        <IconButton
          icon="trash"
          iconSize={16}
          danger
          label={t("list.trash")}
          onclick={() => {
            trashPicked();
            focusList();
          }}
        />
      {/if}
      <IconButton icon="x" iconSize={16} label={t("list.clearPicks")} onclick={() => notes.clearPicks()} />
    </div>
  {/if}

  {#if notes.filter.kind === "trash" && notes.visible.length}
    <div class="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg bg-input px-2.5 py-2 text-xs text-muted">
      <span>{t("list.trashHint")}</span>
      <button class="-my-1 min-h-6 font-semibold whitespace-nowrap text-danger coarse:-my-3 coarse:min-h-11" onclick={emptyTrash}>
        {t("list.emptyTrash")}
      </button>
    </div>
  {/if}

  {#if notes.filter.kind === "calendar"}
    <CalendarMonth day={notes.filter.day} today={today.day} />
  {/if}

  {#if feedView}
    <!-- Why a feed couldn't be fetched; on the web, that most can't be. -->
    {#if record?.error}
      <p class="mx-3 mb-2 rounded-lg bg-input px-2.5 py-2 text-xs leading-normal text-muted" role="status">{feedError(record.error)}</p>
    {:else if !isTauri && !feedView.feed && listedFeeds.some((url) => feeds.records.get(url)?.error === "blocked")}
      <p class="mx-3 mb-2 rounded-lg bg-input px-2.5 py-2 text-xs leading-normal text-muted">{t("feeds.webHint")}</p>
    {/if}
    <!-- The posts dismissed, as the Trash's notes are shown: what they are, and the way back to the list. -->
    {#if feedView.dismissed}
      <div class="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg bg-input px-2.5 py-2 text-xs text-muted">
        <span>{t("feeds.outHint")}</span>
        <button class="-my-1 min-h-6 font-semibold whitespace-nowrap text-accent coarse:-my-3 coarse:min-h-11" onclick={() => notes.setFilter(withoutDismissed(feedView))}>
          {t("feeds.hideDismissed")}
        </button>
      </div>
    {/if}
    {#if !posts.length}
      <div class="mx-6 my-8 flex flex-col items-center gap-3 text-center text-base text-faint" data-list-empty bind:this={empty}>
        {#if notes.query}
          <p class="m-0">{t("feeds.noMatches", { query: notes.query })}</p>
        {:else if !feeds.subscriptions.length}
          <p class="m-0">{t("feeds.none")}</p>
          <Button variant="quiet" icon="plus" onclick={(event) => openSubscribe(event, "center")}>{t("feeds.subscribe")}</Button>
        {:else if feedView.dismissed}
          <p class="m-0">{t("feeds.noneOut")}</p>
        {:else if caughtUp}
          <p class="m-0">{t("feeds.allCaughtUp")}</p>
          <Button variant="quiet" icon="archive" onclick={() => notes.setFilter({ ...feedView, dismissed: true })}>{t("feeds.showDismissed")}</Button>
        {:else}
          <p class="m-0">{listedFeeds.some((url) => feeds.fetching.has(url)) ? t("feeds.fetching") : t("feeds.noPosts")}</p>
        {/if}
      </div>
    {/if}
  {:else if notes.ready && !notes.visible.length}
    <p class="mx-6 my-8 text-center text-base text-faint">
      {#if notes.query}{t("list.noMatches", { query: notes.query })}{:else if notes.filter.kind === "trash"}{t(
          "list.trashIsEmpty",
        )}{:else if notes.filter.kind === "inbox"}{t("list.inboxEmpty")}{:else if notes.filter.kind === "calendar"}{t("calendar.nothing", {
          date: dateOf(notes.filter.day).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" }),
        })}{:else}{t("list.noNotes")}{/if}
    </p>
  {/if}

  <!-- Pulled down past its top on a touch screen, the list searches, or in the Feeds refreshes them. -->
  <div
    class="relative flex min-h-0 flex-1 flex-col"
    {@attach pull({
      scroller: () => list,
      indicator: () => pulled,
      haptic: () => !!feedView,
      enabled: () => !feedView || listedFeeds.length > 0,
      release: () => {
        searchShown = true;
        return feedView ? feeds.refresh(listedFeeds) : searchInput?.focus();
      },
      letGo: (distance) => {
        if (distance >= SHOWS_SEARCH) searchShown = true;
      },
    })}
  >
    <PullIndicator kind={feedView ? "refresh" : "search"} bind:element={pulled} />
    <!-- The same inset as the search field, so the rows line up under it. The rows not drawn are
         space above and below the drawn ones (the styles below), so it scrolls as far as all of them;
         under the + on a phone, as far as the last row clears it, and at the bottom of the screen
         (nothing playing under it), clear of the home indicator. -->
    <ul
      class={[
        "items relative flex-1 overflow-y-auto overscroll-contain px-3 outline-none",
        addButton ? "pb-[calc(88px+env(safe-area-inset-bottom))]" : "pb-6 in-[.note-list>:last-child]:pb-[calc(24px+env(safe-area-inset-bottom))]",
      ]}
      style:--before="{drawnRows.before}px"
      style:--after="{drawnRows.after}px"
      bind:this={list}
      bind:clientHeight={() => drawnRows.viewHeight, (height) => (rows.viewHeight = postRows.viewHeight = height)}
      aria-labelledby="note-list-title"
      onscroll={() => {
        swipedId = null;
        drawnRows.scrolled();
        scrolled();
      }}
      {@attach watchTouches}
    >
      {#if feedView}
        {#each postRows.drawn as { item: row, index, top } (row.post.key)}
          <PostRow
            {row}
            {now}
            {index}
            count={posts.length}
            {top}
            measure={postRows.measure(row.post.key)}
            selected={index === openPost}
            tabbable={index === postStop}
            onkeydown={(event) => onPostKeydown(event, row)}
            ondismiss={(why) => dismissRow(row, why)}
          />
        {/each}
      {:else}
      {#each rows.drawn as { item: entry, index, top } (entry.note.id)}
        {@const id = entry.note.id}
        <NoteRow
          {entry}
          {now}
          {index}
          count={notes.visible.length}
          {top}
          measure={rows.measure(id)}
          selected={id === notes.selectedId}
          picked={notes.picked.has(id)}
          tabbable={index === tabStop}
          open={swipedId === id}
          onswipe={(open) => (swipedId = open ? id : swipedId === id ? null : swipedId)}
          onkeydown={onListKeydown}
        />
      {/each}
      {/if}
      <!-- Lets the list always bounce on iPhone and iPad (app.css), as its own ::after is the room under the rows. -->
      <li class="bounce-floor" aria-hidden="true"></li>
    </ul>
    {#if addButton}
      <AddButton bar={titleBar} />
    {/if}
  </div>
  {#if !ui.playerInSidebar}
    <MiniPlayer class="pb-[calc(8px_+_env(safe-area-inset-bottom))]" />
  {/if}
</section>

<style>
  /*
   * The space of the rows not drawn. It's in the list's flow, so the browser's scroll anchoring
   * keeps the rows in view still as it changes.
   */
  .items::before,
  .items::after {
    content: "";
    display: block;
  }

  .items::before {
    height: var(--before);
  }

  .items::after {
    height: var(--after);
  }

  /*
   * A gap above every row but the list's first (ROW_GAP), with a divider centered in it, which
   * hides next to a highlighted, swiped or right-clicked row. It's CSS because it depends on the
   * rows beside.
   */
  .items > :global(li[aria-posinset]:not([aria-posinset="1"])) {
    padding-top: 6px;
  }

  .items > :global(li[aria-posinset]:not([aria-posinset="1"])::before) {
    content: "";
    position: absolute;
    top: 2.5px;
    left: 12px;
    right: 12px;
    height: 1px;
    background: var(--border);
  }

  .items > :global(li:is(.menu-target, :has(.selected, .swiped))::before),
  .items > :global(li:is(.menu-target, :has(.selected, .swiped)) + li::before) {
    opacity: 0;
  }

  @media (hover: hover) {
    .items > :global(li:has(.item:hover, .item ~ :hover)::before),
    .items > :global(li:has(.item:hover, .item ~ :hover) + li::before) {
      opacity: 0;
    }
  }
</style>
