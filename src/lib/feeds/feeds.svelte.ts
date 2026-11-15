import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { speak } from "../a11y";
import { t } from "../i18n/index.svelte";
import { keepCover } from "../library/covers";
import { lookUp } from "../library/lookup";
import { coverOfItem, libraryNote } from "../library/note";
import { addedAgain, inLibrary, libraryNoteOf } from "../library/same";
import { clock, coverOf, known, withCover } from "../library/text";
import { putAttachment } from "../notes/attachments";
import { type Asking, hostOf as hostName, isLocal } from "../outside";
import { dayOf } from "../notes/calendar";
import { propertyOf } from "../notes/properties";
import { isClosed, notes } from "../notes/store.svelte";
import type { Filter } from "../notes/types";
import { plugins } from "../plugins/registry.svelte";
import type { LibraryItem } from "../plugins/types";
import { prefs } from "../prefs.svelte";
import type { SharedFolder } from "../sync/engine.svelte";
import { ui } from "../ui.svelte";
import { fetchFeed, FetchError, type Validators } from "./fetch";
import { findFeed, linkOf, NoFeed } from "./find";
import { FEED_GROUPS, type FeedGroup, groupOf } from "./groups";
import {
  applyMarks,
  CLEAR_MARGIN,
  type Dismissal,
  type FeedMarks,
  type Cleared,
  latestOf,
  type MarkField,
  marked,
  markKey,
  type Marks,
  mergeFeed,
  sharedMarks,
  tidyFeed,
  withoutDismissal,
} from "./marks";
import { readOpml, writeOpml } from "./opml";
import { cleanStream, streamKey, streamsOf, withoutStream, withStream, writeStreams } from "./streams";
import { feedOf } from "./subscribed";
import { plainText } from "./markdown";
import { feedItem } from "./item";
import { isFeed, NotAFeed, readFeed, type Feed } from "./parse";
import { backoff, DAY, merge, newestFirst, type FeedRecord, type KeptPost } from "./posts";
import { feedStorage } from "./storage";

/*
 * Feeds subscribed to, and their posts. A subscription is a note with a `feed:` property, so it
 * syncs as notes do; its posts are fetched in the main window (at start, then as often as
 * Settings → Library says, or when asked) and kept on this device (storage.ts), with which were
 * read and dismissed. What's done with them is marked for other devices too (marks.ts).
 */

/** A feed subscribed to. */
export interface Subscription {
  /** The feed's address, as its note's `feed:` says. */
  url: string;
  /** The note subscribing to it (the one edited last, if several do). */
  note: string;
  title: string;
  /** The streams it's in (streams.ts), as its notes name them. */
  streams: string[];
}

/** A stream (streams.ts): its name, its feeds, and how many of their posts are unread. */
export interface Stream {
  name: string;
  subscriptions: Subscription[];
  unread: number;
}

/** A post, with the feed it's from. */
export interface Row {
  feed: string;
  post: KeptPost;
}

/** What the list shows in the Feeds: posts. */
export type FeedsFilter = Extract<Filter, { kind: "feeds" }>;

/** Whether a post is out of the lists: dismissed. Filters that hide posts would take them out here too. */
export const isOut = (post: KeptPost) => !!post.dismissed;

/** These posts' ids, by their feeds' addresses. */
function byFeed(posts: { feed: string; id: string }[]): Map<string, string[]> {
  const feeds = new Map<string, string[]>();
  for (const { feed, id } of posts) {
    const ids = feeds.get(feed);
    if (ids) ids.push(id);
    else feeds.set(feed, [id]);
  }
  return feeds;
}

const idsOf = (rows: Row[]) => rows.map(({ feed, post }) => ({ feed, id: post.id }));

/** The library source of feeds' own links (src/plugins/feeds). */
export const FEED_SOURCE = "feeds";

/** How many feeds are fetched at once (never two from one site). */
const AT_ONCE = 3;
/** A subscription made by hand is fetched once its `feed:` has been left alone this long. */
const SETTLE = 2000;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export { feedOf };

/**
 * Every subscription as one line each, so typing that changes none leaves it the same and nothing
 * below redraws: its feed, its note, its title and its streams.
 */
function signature() {
  const found = new Map<string, { note: string; title: string; updated: number; streams: string[] }>();
  for (const { note, meta } of notes.entries) {
    if (note.trashed) continue;
    const url = feedOf(meta.properties);
    if (!url) continue;
    const other = found.get(url);
    // A feed's streams are its subscription's, the note edited last: a second note never puts it in two.
    if (!other || note.updatedAt > other.updated) found.set(url, { note: note.id, title: meta.title, updated: note.updatedAt, streams: streamsOf(meta.properties) });
  }
  // A stream's name has no comma (streams.ts).
  return [...found].map(([url, { note, title, streams }]) => `${url}\t${note}\t${title}\t${streams.join(",")}`).join("\n");
}

class Feeds {
  /** Feeds are on: their plugin is, which makes `feed` a kind of the library's (Settings → Plugins). */
  on = $derived(!!plugins.libraryKind("feed"));
  /** What's kept of each feed, by its address. */
  records = $state.raw(new Map<string, FeedRecord>());
  loaded = $state(false);
  /** The feeds being fetched now. */
  fetching = $state.raw(new Set<string>());
  #open = $state<{ feed: string; id: string } | null>(null);
  /** The posts being saved to the Library, by key: each saved once, however often it's asked meanwhile. */
  saving = new SvelteMap<string, Promise<string>>();

  /** What was done with each feed's posts, by its address (marks.ts), as every device has it. */
  #marks: Marks = {};
  /** What each feed's marks are stored under. */
  #markIds = new Map<string, string>();
  /** Each feed's marks being written, so they land in order. */
  #markWrites = new Map<string, Promise<void>>();
  #markListeners = new Set<() => void>();
  /**
   * Whether this tab syncs the marks: one in each browser does (the others' come to it on `#tabs`),
   * as tabs share what sync last read of each file, so two would write over each other's.
   */
  #leading = typeof navigator === "undefined" || !("locks" in navigator);
  /** The browser's other tabs, which send each other every feed's marks as they change, and merge them. */
  #tabs = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("lines.feeds.marks");
  /**
   * Posts dismissed together, most recent last, each as it was, for undo; and for Dismiss All, each
   * feed's cut-off before it (none: null). Until a note is changed.
   */
  #dismissals: { posts: { feed: string; id: string; read: boolean; open: boolean }[]; cleared?: Map<string, Cleared | null> }[] = [];

  /** The post open in the note's place. One left while Settings → Library → Dismiss posts once read is on is dismissed, if it's still read. */
  get open() {
    return this.#open;
  }

  set open(next) {
    const left = this.#open;
    this.#open = next;
    if (!left || !prefs.dismissOnRead || (left.feed === next?.feed && left.id === next.id)) return;
    const post = this.records.get(left.feed)?.posts.find((each) => each.id === left.id);
    if (post?.read && !post.dismissed) this.#dismiss([{ feed: left.feed, post }], "done");
  }

  #signature = $derived(signature());

  /** The feeds subscribed to, by title. */
  subscriptions = $derived<Subscription[]>(
    this.#signature
      ? this.#signature
          .split("\n")
          .map((line) => {
            const [url, note, title, streams] = line.split("\t");
            return { url, note, title, streams: streams ? streams.split(",") : [] };
          })
          .sort((a, b) => a.title.localeCompare(b.title))
      : [],
  );

  #subscribed = $derived(new Set(this.subscriptions.map((subscription) => subscription.url)));

  /** Every post of the feeds subscribed to, newest first. */
  #all = $derived.by(() => {
    const rows: Row[] = [];
    for (const url of this.#subscribed) for (const post of this.records.get(url)?.posts ?? []) rows.push({ feed: url, post });
    return rows.sort((a, b) => newestFirst(a.post, b.post));
  });

  /** How many posts each feed has unread in its list (not dismissed), by its address. */
  unread = $derived(
    new Map([...this.#subscribed].map((url) => [url, this.records.get(url)?.posts.reduce((count, post) => (post.read || isOut(post) ? count : count + 1), 0) ?? 0])),
  );

  totalUnread = $derived([...this.unread.values()].reduce((sum, count) => sum + count, 0));

  /** Which group each feed subscribed to is in (groups.ts), by its address. */
  groupOf = $derived(new Map(this.subscriptions.map(({ url, note }) => [url, groupOf(this.records.get(url), notes.get(note)?.meta.type)])));

  /** The groups with feeds in them, in order, each with its subscriptions and how many of their posts are unread. */
  groups = $derived(
    FEED_GROUPS.map((group) => {
      const subscriptions = this.subscriptions.filter(({ url }) => this.groupOf.get(url) === group);
      return { group, subscriptions, unread: subscriptions.reduce((sum, { url }) => sum + (this.unread.get(url) ?? 0), 0) };
    }).filter(({ subscriptions }) => subscriptions.length),
  );

  /** The streams there are (those their feeds name), by name, each with its feeds and how many of their posts are unread. */
  streams = $derived.by((): Stream[] => {
    const found = new Map<string, { name: string; subscriptions: Subscription[] }>();
    for (const subscription of this.subscriptions) {
      for (const name of subscription.streams) {
        const stream = found.get(streamKey(name)) ?? { name, subscriptions: [] };
        stream.subscriptions.push(subscription);
        found.set(streamKey(name), stream);
      }
    }
    return [...found.values()]
      .map(({ name, subscriptions }) => ({ name, subscriptions, unread: subscriptions.reduce((sum, { url }) => sum + (this.unread.get(url) ?? 0), 0) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** The open post, with its feed. */
  openRow = $derived.by((): Row | null => {
    const open = this.open;
    const post = open && this.records.get(open.feed)?.posts.find((each) => each.id === open.id);
    return post ? { feed: open.feed, post } : null;
  });

  /**
   * The posts the list shows (NoteList.svelte), newest first: those of the feeds the sidebar's row
   * chose, in their list or, in its Dismissed, taken out of it, that have every word searched for
   * in their title, excerpt or feed's name.
   */
  listed = $derived.by((): Row[] => {
    const filter = notes.filter;
    if (filter.kind !== "feeds") return [];
    const out = !!filter.dismissed;
    const terms = notes.query.toLowerCase().split(/\s+/).filter(Boolean);
    const titles = new Map(this.subscriptions.map(({ url, title }) => [url, title.toLowerCase()]));
    const chosen = new Set(this.feedsOf(filter));
    const rows = filter.feed ? this.posts(filter.feed) : filter.group || filter.stream ? this.#all.filter(({ feed }) => chosen.has(feed)) : this.#all;
    return rows.filter(({ feed, post }) => {
      if (isOut(post) !== out) return false;
      if (!terms.length) return true;
      const text = `${post.title.toLowerCase()} ${post.excerpt.toLowerCase()} ${titles.get(feed) ?? ""}`;
      return terms.every((term) => text.includes(term));
    });
  });

  /** Fetches waiting their turn, in order: by feed, whether it was asked for (⟳), which goes even when it was to wait. */
  #queue = new Map<string, boolean>();
  /** What's waiting for each feed queued or being fetched: what it read of it, or null. */
  #waiting = new Map<string, ((feed: Feed | null) => void)[]>();
  /** Each feed's write under way, so they land in order. */
  #writes = new Map<string, Promise<void>>();
  /** Each feed being kept now, by its address: writing everything again (the app lock) waits for them. */
  #taking = new Map<string, Promise<void>>();

  /** The posts of one feed, of one group's, or of all, newest first. */
  posts(feed?: string, group?: FeedGroup): Row[] {
    if (feed) return (this.records.get(feed)?.posts ?? []).map((post) => ({ feed, post }));
    return group ? this.#all.filter((row) => this.groupOf.get(row.feed) === group) : this.#all;
  }

  /** The feeds the sidebar's row `filter` chose: one, a kind's, a stream's, or every one subscribed to. */
  feedsOf(filter: FeedsFilter): string[] {
    if (filter.feed) return [filter.feed];
    const stream = filter.stream && streamKey(filter.stream);
    return this.subscriptions
      .filter(({ url, streams }) => (!filter.group || this.groupOf.get(url) === filter.group) && (!stream || streams.some((name) => streamKey(name) === stream)))
      .map(({ url }) => url);
  }

  /** Whether a feed's posts are among those the sidebar's row `filter` chose. */
  chose(filter: FeedsFilter, feed: string) {
    return this.feedsOf(filter).includes(feed);
  }

  /** Puts a feed in a stream, made if it's new: each note subscribing to it names it. */
  addToStream(url: string, name: string) {
    this.#rewriteStreams((streams, feed) => (feed === url ? withStream(streams, [name]) : streams));
  }

  /** Takes a feed out of a stream. */
  removeFromStream(url: string, name: string) {
    this.#rewriteStreams((streams, feed) => (feed === url ? withoutStream(streams, name) : streams));
  }

  /** Renames a stream: each of its feeds' notes names it so (one in both is in it once), and its list stays shown. */
  renameStream(from: string, to: string) {
    if (!cleanStream(to) || cleanStream(to) === from) return;
    this.#rewriteStreams((streams) => (streams.some((name) => streamKey(name) === streamKey(from)) ? withStream(withoutStream(streams, from), [to]) : streams));
    const filter = notes.filter;
    if (filter.kind === "feeds" && filter.stream && streamKey(filter.stream) === streamKey(from)) notes.setFilter({ ...filter, stream: cleanStream(to) });
  }

  /** Deletes a stream: its feeds' notes no longer name it, and stay subscribed. */
  deleteStream(name: string) {
    this.#rewriteStreams((streams) => withoutStream(streams, name));
    const filter = notes.filter;
    if (filter.kind === "feeds" && filter.stream && streamKey(filter.stream) === streamKey(name)) notes.setFilter({ kind: "feeds" });
  }

  /**
   * Changes the streams of subscriptions' notes (`change` of each's streams and feed), as edits are
   * dated, so sync weighs them as it does any edit, against one made on another device meanwhile.
   */
  #rewriteStreams(change: (streams: string[], feed: string) => string[]) {
    for (const { note, meta } of notes.entries) {
      const feed = !note.trashed && !note.locked && feedOf(meta.properties);
      if (!feed) continue;
      const streams = streamsOf(meta.properties);
      const changed = change(streams, feed);
      if (changed.join("\n") !== streams.join("\n")) notes.setText(note.id, (body) => writeStreams(body, changed));
    }
  }

  subscription(url: string) {
    return this.subscriptions.find((subscription) => subscription.url === url);
  }

  /** Every note subscribing to a feed, but those in the Trash. */
  notesOf(url: string): string[] {
    return notes.entries.filter(({ note, meta }) => !note.trashed && feedOf(meta.properties) === url).map(({ note }) => note.id);
  }

  /**
   * Reads what's kept, letting go of the feeds no note subscribes to any more (a trashed one still
   * keeps its); unless a locked note is closed, which may be one that does.
   */
  async load() {
    let kept = await feedStorage.all();
    if (!notes.entries.some(({ note }) => isClosed(note))) {
      const noted = new Set(notes.entries.map(({ meta }) => feedOf(meta.properties)));
      await Promise.all(kept.filter((record) => !noted.has(record.url)).map((record) => feedStorage.delete(record)));
      kept = kept.filter((record) => noted.has(record.url));
    }
    this.records = new Map(kept.map((record) => [record.url, record]));
    // Each feed's marks, with any another tab sent meanwhile; as one, if two tabs each kept them.
    const doubled = new Set<string>();
    for (const { id, feed, marks } of await feedStorage.marks()) {
      const known = this.#markIds.get(feed);
      if (known && known !== id) {
        doubled.add(feed);
        void feedStorage.deleteMarks(id);
      } else this.#markIds.set(feed, id);
      this.#marks = { ...this.#marks, [feed]: mergeFeed(this.#marks[feed], marks) };
    }
    for (const feed of doubled) this.#keepMarks(feed);
    for (const [feed, marks] of Object.entries(this.#marks)) this.#applyMarks(feed, marks);
    this.loaded = true;
    // Now there's something to sync.
    for (const listener of this.#markListeners) listener();
  }

  /**
   * In the main window, once notes are loaded: fetches the feeds due, then again as often as
   * Settings says, and new subscriptions once their link is typed in.
   */
  async start() {
    // Before reading what's kept, so nothing another tab sends meanwhile is missed.
    this.#tabs?.addEventListener("message", ({ data }: MessageEvent<Marks>) => this.#takeMarks(data, false));
    if (!this.#leading) {
      // Held until this tab closes: then the next tab to ask syncs them, with every tab's marks sent to it.
      void navigator.locks.request("lines.feeds.sync", () => {
        this.#leading = true;
        for (const listener of this.#markListeners) listener();
        return new Promise<void>(() => {});
      });
    }
    await this.load();
    // A note changed makes its undo the one ⌘Z reaches, as typing does.
    notes.onLocalChange(() => (this.#dismissals = []));
    $effect.root(() => {
      $effect(() => {
        const minutes = prefs.feedRefresh;
        if (!minutes || !this.on) return;
        untrack(() => this.refreshDue(minutes));
        const timer = setInterval(() => this.refreshDue(minutes), minutes * 60_000);
        return () => clearInterval(timer);
      });
      $effect(() => {
        const fresh = [...this.#subscribed].filter((url) => !untrack(() => this.records.has(url) || this.fetching.has(url)));
        if (!fresh.length || !prefs.feedRefresh || !this.on) return;
        // Still subscribed to (a link typed in has settled), and not fetched since.
        const timer = setTimeout(() => {
          for (const url of fresh) if (this.#subscribed.has(url) && !this.records.has(url)) void this.#request(url);
        }, SETTLE);
        return () => clearTimeout(timer);
      });
    });
  }

  /**
   * Fetches the feeds subscribed to that are due: not fetched within the last `minutes`, and not
   * waiting, as one said to (429, 503), after failing, or gone (410).
   */
  refreshDue(minutes: number = prefs.feedRefresh || 30) {
    const now = Date.now();
    for (const { url } of this.subscriptions) {
      const record = this.records.get(url);
      if (!record?.checked || (!record.gone && !(record.retryAt && record.retryAt > now) && now - record.checked >= minutes * 60_000 - 30_000)) void this.#request(url);
    }
  }

  /** Fetches these feeds (every one subscribed to, if none are named) as they're asked for: even those waiting, or gone. */
  refresh(urls: string[] = this.subscriptions.map(({ url }) => url)) {
    for (const url of urls) void this.#request(url, true);
  }

  /** A feed fetched in its turn, a few at a time and one per site: what it read, or null if nothing changed or it couldn't be. */
  #request(url: string, asked = false): Promise<Feed | null> {
    const read = new Promise<Feed | null>((resolve) => this.#waiting.set(url, [...(this.#waiting.get(url) ?? []), resolve]));
    if (!this.fetching.has(url)) this.#queue.set(url, asked || !!this.#queue.get(url));
    this.#next();
    return read;
  }

  #next() {
    while (this.fetching.size < AT_ONCE) {
      const busy = new Set([...this.fetching].map(hostOf));
      const url = [...this.#queue.keys()].find((each) => !busy.has(hostOf(each)));
      if (url === undefined) return;
      const asked = this.#queue.get(url)!;
      this.#queue.delete(url);
      this.fetching = new Set([...this.fetching, url]);
      void this.#fetch(url, asked).then((feed) => {
        const fetching = new Set(this.fetching);
        fetching.delete(url);
        this.fetching = fetching;
        for (const resolve of this.#waiting.get(url) ?? []) resolve(feed);
        this.#waiting.delete(url);
        this.#next();
      });
    }
  }

  async #fetch(url: string, asked: boolean): Promise<Feed | null> {
    const record = this.records.get(url);
    if (!asked && (record?.gone || (record?.retryAt && record.retryAt > Date.now()))) return null;
    try {
      const response = await fetchFeed(url, record ?? {}, undefined, { own: record?.own });
      if (!response.changed) {
        this.#update(url, { checked: Date.now(), error: undefined, failures: 0, retryAt: undefined, gone: false });
        return null;
      }
      if (!isFeed(response.text)) throw new NotAFeed(url);
      const feed = readFeed(response.text, response.url);
      await this.take(url, feed, response.validators);
      return feed;
    } catch (error) {
      // Its site answered, but not with the feed (not to be asked again yet, it'd have said): some can be read another way (YouTube's, from its page).
      const missing = error instanceof NotAFeed || (error instanceof FetchError && !!error.status && error.status !== 429 && !error.retryAt);
      const instead = missing ? await feedInstead(url).catch((reason) => void console.warn(`lines: couldn't read the feed ${url} another way`, reason)) : null;
      if (instead) {
        await this.take(url, instead, {});
        return instead;
      }
      console.warn(`lines: couldn't fetch the feed ${url}`, error);
      const now = Date.now();
      const reason = error instanceof NotAFeed ? "not a feed" : error instanceof Error ? error.message : String(error);
      const failures = (record?.failures ?? 0) + 1;
      // Longer after each failure in a row, or as long as it said if that's longer; a day at most.
      const said = error instanceof FetchError ? (error.retryAt ?? 0) : 0;
      const retryAt = Math.min(now + DAY, Math.max(said, now + backoff(failures, (prefs.feedRefresh || 30) * 60_000)));
      this.#update(url, { checked: now, error: reason, failures, retryAt, gone: error instanceof FetchError && error.status === 410 });
      return null;
    }
  }

  /**
   * Keeps a feed as it was just fetched: its posts merged with those kept, which were read or
   * dismissed staying so, and as other devices marked them. One whose address is the person's own
   * (`own`) is asked as theirs from then on (outside.ts).
   */
  take(url: string, feed: Feed, validators: Validators, { own }: Asking = {}): Promise<void> {
    // After the feed's last, so each merges with what the one before kept.
    const taking = (this.#taking.get(url) ?? Promise.resolve()).catch(() => {}).then(() => this.#take(url, feed, validators, own));
    this.#taking.set(url, taking);
    void taking
      .catch(() => {})
      .finally(() => {
        if (this.#taking.get(url) === taking) this.#taking.delete(url);
      });
    return taking;
  }

  async #take(url: string, feed: Feed, validators: Validators, own?: boolean) {
    const fetchedAt = Date.now();
    const { posts, changed, dropped } = merge(this.records.get(url)?.posts ?? [], feed.posts, fetchedAt);
    await feedStorage.putContents(changed.map(({ key, html }) => ({ id: key, html })));
    // As the posts are now: one opened (or marked) while their content was written stays as it was left.
    const now = this.records.get(url);
    const was = new Map(now?.posts.map((post) => [post.id, post]));
    const asLeft = (post: KeptPost): KeptPost => {
      const left = was.get(post.id);
      return left ? { ...withoutDismissal(post), read: left.read, ...(left.dismissed && { dismissed: left.dismissed }) } : post;
    };
    const { posts: _, ...rest } = feed;
    this.#set(url, {
      ...rest,
      id: now?.id ?? crypto.randomUUID(),
      url,
      posts: applyMarks(posts.map(asLeft), this.#marks[url]),
      ...validators,
      checked: fetchedAt,
      fetchedAt,
      error: undefined,
      failures: 0,
      retryAt: undefined,
      gone: false,
      own: own || now?.own,
    });
    // Its marks as the feed is now: those of posts in it said to be, those gone long since let go.
    const marks = this.#marks[url];
    if (marks) {
      const listing = new Set(posts.filter((post) => post.listed === fetchedAt).map((post) => markKey(post.id)));
      const tidied = tidyFeed(marks, listing, fetchedAt);
      if (tidied !== marks) this.#putMarks(url, tidied);
    }
    await feedStorage.deleteContents(dropped);
  }

  /** Changes what's kept of a feed (one not kept yet only once it's been fetched). */
  #update(url: string, change: Partial<FeedRecord>) {
    const record = this.records.get(url) ?? { id: crypto.randomUUID(), url, title: this.subscription(url)?.title ?? url, posts: [] };
    this.#set(url, { ...record, ...change });
  }

  #set(url: string, record: FeedRecord) {
    this.records = new Map(this.records).set(url, record);
    // Each write takes the record as it is by then, so the last one written is the latest.
    const write = (this.#writes.get(url) ?? Promise.resolve()).then(() => feedStorage.put(this.records.get(url)!)).catch((error) => console.error(`lines: couldn't keep the feed ${url}`, error));
    this.#writes.set(url, write);
  }

  /**
   * The feeds' marks, a file for each feed in `feeds/`, which sync merges with other devices' a file
   * at a time (sync/engine.svelte.ts), once what's kept here is read.
   */
  readonly marksFolder: SharedFolder = {
    ...sharedMarks({
      marks: () => this.#marks,
      feeds: () => [...notes.entries.flatMap(({ meta }) => feedOf(meta.properties) ?? []), ...this.records.keys()],
      take: (there) => this.#takeMarks(there),
    }),
    ready: () => this.loaded && this.#leading,
    onChange: (listener) => void this.#markListeners.add(listener),
  };

  /**
   * Takes in these feeds' marks, from sync or another tab: merged with those here, kept, applied to
   * their posts, and sent on to the other tabs (`share`).
   */
  #takeMarks(there: Marks, share = true) {
    for (const [feed, theirs] of Object.entries(there)) {
      const mine = this.#marks[feed];
      const marks = mergeFeed(mine, theirs);
      if (marks === mine) continue;
      this.#putMarks(feed, marks, share);
      this.#applyMarks(feed, marks);
    }
  }

  /** A feed's posts as its marks make them. */
  #applyMarks(feed: string, marks: FeedMarks) {
    const record = this.records.get(feed);
    if (!record) return;
    const posts = applyMarks(record.posts, marks);
    if (posts !== record.posts) this.#set(feed, { ...record, posts });
  }

  /**
   * A feed's marks as they are now: kept, sent to the other tabs (unless they came from one), and,
   * in the tab that syncs them, synced. One from another tab came from a change made there (or a
   * merge it's sending on), which only the tab that syncs has to sync.
   */
  #putMarks(feed: string, marks: FeedMarks, share = true) {
    this.#marks = { ...this.#marks, [feed]: marks };
    this.#keepMarks(feed);
    if (share) this.#tabs?.postMessage({ [feed]: marks });
    if (this.#leading) for (const listener of this.#markListeners) listener();
  }

  /** Writes a feed's marks as they are by then (none: deleted), after its writes under way. */
  #keepMarks(feed: string) {
    const write = (this.#markWrites.get(feed) ?? Promise.resolve())
      .then(async () => {
        const marks = this.#marks[feed];
        let id = this.#markIds.get(feed);
        if (marks) {
          if (!id) this.#markIds.set(feed, (id = crypto.randomUUID()));
          await feedStorage.putMarks({ id, feed, marks });
        } else if (id) {
          this.#markIds.delete(feed);
          await feedStorage.deleteMarks(id);
        }
      })
      .catch((error) => console.error(`lines: couldn't keep what was done with the posts of ${feed}`, error));
    this.#markWrites.set(feed, write);
  }

  /** Changes these posts of a feed, and marks them so (`fields`) for other devices, but those `unmarked` (a Dismiss All's cut-off marks them). */
  #change(feed: string, ids: string[], change: (post: KeptPost) => KeptPost, fields: MarkField[], unmarked?: Set<string>) {
    const record = this.records.get(feed);
    if (!record || !ids.length) return;
    const changing = new Set(ids);
    this.#set(feed, { ...record, posts: record.posts.map((post) => (changing.has(post.id) ? change(post) : post)) });
    const own = this.#marks[feed] ?? { posts: {} };
    const floor = latestOf(own);
    const posts = { ...own.posts };
    for (const id of ids) if (!unmarked?.has(id)) posts[markKey(id)] = marked(posts[markKey(id)], fields, floor);
    this.#putMarks(feed, { ...own, posts });
  }

  /** Marks these posts of a feed read, or unread. */
  setRead(feed: string, ids: string[], read = true) {
    const marking = new Set(ids);
    const changing = (this.records.get(feed)?.posts ?? []).filter((post) => marking.has(post.id) && post.read !== read).map((post) => post.id);
    this.#change(feed, changing, (post) => ({ ...post, read }), [read ? "read" : "unread"]);
  }

  /** Marks every post of these feeds (or of all of them) read. */
  readAll(urls: Iterable<string> = this.#subscribed) {
    for (const url of urls) {
      const posts = this.records.get(url)?.posts ?? [];
      this.setRead(url, posts.filter((post) => !post.read).map((post) => post.id));
    }
  }

  /**
   * Takes these posts out of the lists, done with or not interesting, marking them read; ⌘Z puts
   * them back. Dismissing the open post opens the next one listed (or, at the end, the one before),
   * as a mail app goes on to the next message. How many were dismissed.
   */
  dismiss(rows: Row[], why: Dismissal = "done", unmarked?: Set<string>): number {
    const going = rows.filter(({ post }) => !post.dismissed);
    if (!going.length) return 0;
    const open = this.open;
    const opened = !!open && going.some(({ feed, post }) => feed === open.feed && post.id === open.id);
    const next = opened ? this.#nextBut(new Set(going.map(({ post }) => post.key))) : undefined;
    this.#dismiss(going, why, unmarked);
    if (next) this.show(next.feed, next.post.id);
    else if (opened) this.open = null;
    return going.length;
  }

  /** The post listed after the open one that isn't among `going` (by their keys), or else the one before. */
  #nextBut(going: Set<string>): Row | undefined {
    const open = this.open;
    const listed = this.listed;
    const at = listed.findIndex(({ feed, post }) => feed === open?.feed && post.id === open.id);
    if (at < 0) return undefined;
    const staying = ({ post }: Row) => !going.has(post.key);
    return listed.slice(at + 1).find(staying) ?? listed.slice(0, at).reverse().find(staying);
  }

  #dismiss(rows: Row[], why: Dismissal, unmarked?: Set<string>) {
    const open = this.open;
    this.#dismissals.push({ posts: rows.map(({ feed, post }) => ({ feed, id: post.id, read: post.read, open: open?.feed === feed && open.id === post.id })) });
    for (const [feed, ids] of byFeed(idsOf(rows))) this.#change(feed, ids, (post) => ({ ...post, read: true, dismissed: why }), [why], unmarked);
  }

  /**
   * Every post of these feeds still in their lists, dismissed: how many. Those published more than
   * a little while before are dismissed by a cut-off (marks.ts), rather than marked one by one,
   * so clearing a backlog leaves little to sync.
   */
  dismissAll(urls: Iterable<string>): number {
    const rows = [...urls].flatMap((feed) => (this.records.get(feed)?.posts ?? []).filter((post) => !isOut(post)).map((post) => ({ feed, post })));
    if (!rows.length) return 0;
    const now = Date.now();
    const before = now - CLEAR_MARGIN;
    const was = new Map<string, Cleared | null>();
    for (const feed of new Set(rows.map(({ feed }) => feed))) {
      const own: FeedMarks = this.#marks[feed] ?? { posts: {} };
      was.set(feed, own.cleared?.before ? own.cleared : null);
      const at = Math.max(now, latestOf(own) + 1);
      this.#marks = { ...this.#marks, [feed]: { ...own, cleared: { before, at, set: at } } };
    }
    const count = this.dismiss(rows, "done", new Set(rows.filter(({ post }) => post.date !== undefined && post.date < before).map(({ post }) => post.id)));
    if (count) this.#dismissals.at(-1)!.cleared = was;
    return count;
  }

  /** Puts dismissed posts back in their lists, unread, to be read: dismissing read them. */
  restore(rows: Row[]) {
    for (const [feed, ids] of byFeed(idsOf(rows.filter(({ post }) => post.dismissed)))) {
      this.#change(feed, ids, (post) => ({ ...withoutDismissal(post), read: false }), ["restored", "unread"]);
    }
  }

  /**
   * Puts back the posts dismissed last, together, read or unread as they were, and opens again the
   * one that was open among them while the posts are what's shown; how many, or 0 if none were
   * dismissed since a note was changed.
   */
  undoDismiss(): number {
    const batch = this.#dismissals.pop();
    if (!batch) return 0;
    // Dismiss All's cut-off put back as it was before it, later than it, so it's undone on every device.
    for (const [feed, was] of batch.cleared ?? []) {
      const own: FeedMarks = this.#marks[feed] ?? { posts: {} };
      const set = Math.max(Date.now(), latestOf(own) + 1);
      this.#putMarks(feed, { ...own, cleared: was ? { ...was, set } : { before: 0, at: 0, set } });
    }
    for (const read of [true, false]) {
      for (const [feed, ids] of byFeed(batch.posts.filter((each) => each.read === read))) {
        this.#change(feed, ids, (post) => ({ ...withoutDismissal(post), read }), read ? ["restored"] : ["restored", "unread"]);
      }
    }
    const open = batch.posts.find((each) => each.open);
    if (open && !notes.selectedId) {
      // Leaving the one opened in its place as it is, even with Dismiss posts once read on: it was only opened for it.
      this.#open = { feed: open.feed, id: open.id };
      this.show(open.feed, open.id);
    }
    return batch.posts.length;
  }

  /** Opens a post in the note's place, and marks it read. */
  show(feed: string, id: string) {
    notes.select(null);
    this.open = { feed, id };
    this.setRead(feed, [id]);
  }

  /** A post's content, as HTML. */
  content(post: KeptPost) {
    return feedStorage.content(post.key);
  }

  /**
   * The Library's note of a post, saved or added some other way: an episode by its sound (its link is
   * often its show's page, the same for every episode), anything else by its link.
   */
  savedNote({ post }: Row) {
    if (post.audio) return libraryNoteOf({ type: "episode", properties: [["audio", post.audio.url]] });
    return post.link ? libraryNoteOf({ link: post.link }) : undefined;
  }

  /**
   * Keeps a post in the Library, as a note made as any library note is: an `article`, or an
   * `episode` whose `podcast` mentions its subscription's note; asked again while it's being saved,
   * the same save. Returns the note's id.
   */
  save(row: Row, signal?: AbortSignal): Promise<string> {
    const { key } = row.post;
    let saving = this.saving.get(key);
    if (!saving) {
      saving = this.#save(row, signal).finally(() => this.saving.delete(key));
      this.saving.set(key, saving);
    }
    return saving;
  }

  async #save(row: Row, signal?: AbortSignal): Promise<string> {
    const saved = this.savedNote(row);
    if (saved) return saved.note.id;
    const { feed, post } = row;
    const record = this.records.get(feed);
    const show = this.subscription(feed)?.title || record?.title;
    // A guessed date (`approximate`) isn't one to keep as when it came out.
    const published = post.date && !post.approximate ? dayOf(post.date) : undefined;
    const html = await this.content(post);
    const channel = notes.get(this.subscription(feed)?.note ?? "");
    if (channel?.meta.type === "channel" && post.link) {
      // A channel's video, kept as a link to it is (its source looks it up), its channel the channel's note.
      const found = await lookUp(post.link, signal ?? new AbortController().signal).catch(() => null);
      const video: LibraryItem =
        found?.type === "video"
          ? found
          : {
              type: "video",
              title: post.title,
              link: post.link,
              properties: known([
                ["channel", show],
                ["published", published],
                ["duration", clock(post.duration)],
              ]),
              cover: post.image,
              description: html ? plainText(html) : post.excerpt,
            };
      const page = propertyOf(channel.meta.properties, "link")?.value.trim();
      return this.#write(page ? { ...video, linked: { ...video.linked, channel: page } } : video, signal);
    }
    const item: LibraryItem = post.audio
      ? {
          type: "episode",
          title: post.title,
          link: post.link,
          properties: known([
            ["podcast", show],
            ["published", published],
            ["duration", clock(post.duration)],
            ["audio", post.audio.url],
            ["transcript", post.transcript?.url],
            ["chapters", post.chapters?.url],
          ]),
          cover: post.image ?? record?.image,
          description: html ? plainText(html) : post.excerpt,
        }
      : {
          type: "article",
          title: post.title,
          link: post.link,
          properties: known([
            ["author", post.author],
            ["site", show],
            ["published", published],
          ]),
          cover: post.image,
          description: html ? plainText(html) : post.excerpt,
        };
    return this.#write(item, signal);
  }

  /** A note for `item`, made as any library note is: its text written, then its cover kept with it. Its id. */
  async #write(item: LibraryItem, signal?: AbortSignal): Promise<string> {
    const note = await libraryNote(item, notes.entries, signal);
    const id = crypto.randomUUID();
    const now = Date.now();
    await notes.insert({ id, body: note.text, createdAt: now, updatedAt: now, pinned: false, trashed: false });
    await keepCover(note, id);
    return id;
  }

  /**
   * Subscribes to the feed `input` means (its link, its site's, its podcast's page on Apple
   * Podcasts): a note for it, made as any library note is (its artwork kept with it), with its
   * posts kept from the fetch that found it. One the Library has already is added again instead
   * (`again`). Returns the feed's address: that subscription's own, if it's one already.
   */
  async subscribe(input: string, signal = new AbortController().signal): Promise<{ url: string; again: boolean }> {
    const link = linkOf(input);
    if (!link) throw new NoFeed(input);
    // A subscription of a kind of its own (a YouTube channel), as its source makes it: its feed, or that read another way while it can't be had.
    // Where its source can't say (on the web, which can't read YouTube's pages), the link is a feed's or a page's, as any is.
    const own = await subscriptionOf(link, signal).catch((error) => {
      signal.throwIfAborted();
      console.warn(`lines: couldn't ask what subscribing to ${link} is`, error);
      return null;
    });
    const url = own?.properties.find(([key]) => key === "feed")?.[1];
    if (own && url) {
      // By its feed's address: the channel subscribed to already, or its feed as a site's.
      const there = libraryNoteOf({ type: own.type, properties: [["feed", url]] });
      if (there) {
        addedAgain(there);
        return { url: feedOf(there.meta.properties) ?? url, again: true };
      }
      const found = await findFeed(url, signal).catch(async (error) => {
        const feed = await feedInstead(url, signal).catch(() => null);
        if (!feed) throw error;
        return { url, feed, validators: {} };
      });
      await this.take(url, found.feed, found.validators);
      await this.#write(own, signal);
      return { url, again: false };
    }
    // The link given is the person's own, wherever it is; a feed it names, or a podcast's site's, is the web's.
    const named = await namedFeed(link, signal);
    const found = await findFeed(named ?? link, signal, namedFeed, { own: !named });
    const item = feedItem(found.url, found.feed);
    // By its feed's address: a note of the site it's from (a bookmark) isn't a subscription.
    const there = libraryNoteOf({ type: item.type, properties: [["feed", found.url]] });
    if (there) {
      addedAgain(there);
      return { url: feedOf(there.meta.properties) ?? found.url, again: true };
    }
    await this.take(found.url, found.feed, found.validators, { own: !named && new URL(found.url).origin === new URL(link).origin });
    await this.#write(item, signal);
    return { url: found.url, again: false };
  }

  /**
   * Gives the notes subscribing to a feed its picture where they have none, when asked (a feed's
   * menu): its artwork, or a site's feed with none its site's icon, as a new subscription's note is
   * made with. Never by itself, so a picture taken out of a note stays out. Whether there was one
   * to give.
   */
  async givePicture(url: string): Promise<boolean> {
    const record = this.records.get(url);
    const cover = record && (await coverOfItem(feedItem(url, record)));
    if (!cover) return false;
    try {
      await putAttachment(cover.name, cover.picture);
    } catch (error) {
      console.warn("lines: couldn't keep a feed's picture", error);
      return false;
    }
    for (const id of this.notesOf(url)) {
      // As the note is now: not one locked or trashed meanwhile (a closed locked note's text isn't there to add to), nor one given a picture.
      const entry = notes.get(id);
      if (!entry || entry.note.locked || entry.note.trashed) continue;
      notes.setText(id, (body) => (coverOf(body) ? body : withCover(body, entry.meta.title, cover)), { keepDate: true });
    }
    return true;
  }

  /** Of `urls`, the sites' feeds whose notes have no picture: a podcast's is its artwork, which it's subscribed with or not. */
  withoutPictures(urls: string[]): string[] {
    return urls.filter((url) =>
      this.notesOf(url).some((id) => {
        const entry = notes.get(id);
        return entry?.meta.type === "feed" && !coverOf(entry.note.body);
      }),
    );
  }

  /** Gives each of `urls` its picture (givePicture), a few at a time, as feeds are fetched. How many had one to give. */
  async givePictures(urls: string[]): Promise<number> {
    const left = [...urls];
    let given = 0;
    const turn = async () => {
      for (let url = left.shift(); url; url = left.shift()) if (await this.givePicture(url)) given++;
    };
    await Promise.all(Array.from({ length: AT_ONCE }, turn));
    return given;
  }

  /**
   * Subscribes to the feeds an OPML file lists that aren't already, each fetched in its turn as
   * feeds are refreshed, for what it says of itself; one that can't be, a note of what the file
   * says of it, and why kept as any feed's that failed. One on this computer or its network (by its
   * name, or as asking it finds) isn't subscribed to. How many were added, and left out so.
   */
  async importOpml(text: string): Promise<{ added: number; local: number }> {
    // By their feeds' addresses: a page of a site (a bookmark) isn't a subscription to its feed.
    const listed = readOpml(text).filter(({ url }) => !inLibrary({ type: "feed", properties: [["feed", url]] }));
    // A file isn't the person's word for an address on their own computer or network: they subscribe to one by its link.
    const outlines = listed.filter(({ url }) => !isLocal(hostName(new URL(url))));
    let local = listed.length - outlines.length;
    let added = 0;
    await Promise.all(
      outlines.map(async ({ url, title, site }) => {
        const feed = await this.#request(url);
        if (this.records.get(url)?.error === "local") return void local++;
        await this.#write(feedItem(url, feed ?? { title: title || url, link: site, posts: [] }));
        added++;
      }),
    );
    return { added, local };
  }

  /** Every feed subscribed to, as an OPML file other readers take. */
  exportOpml(): string {
    const outlines = this.subscriptions.map(({ url, note, title }) => {
      const site = propertyOf(notes.get(note)?.meta.properties ?? [], "link")?.value.trim();
      return { url, title, ...(site && /^https?:\/\//i.test(site) && { site }) };
    });
    return writeOpml(t("feeds.opmlTitle"), outlines);
  }

  /** Writes what's kept again, encrypted or not as the app lock now says, once the feeds being kept are. */
  async rewrite() {
    while (this.#taking.size) await Promise.allSettled(this.#taking.values());
    await Promise.all([...this.#writes.values(), ...this.#markWrites.values()]);
    await feedStorage.rewrite();
  }
}

/** A row of feeds' name in the sidebar: its kind's ("RSS Feeds"), or for every feed, "Feeds". */
export const feedRowLabel = (group?: FeedGroup | null) => (group ? t(`feeds.group.${group}` as const) : t("feeds.title"));

/** Why a feed couldn't be fetched (a FetchError's message), as people read it. */
export function feedError(reason: string): string {
  if (reason === "HTTP 410") return t("feeds.errorGone");
  const status = /^HTTP (\d+)$/.exec(reason)?.[1];
  if (status) return t("feeds.errorStatus", { status });
  switch (reason) {
    case "blocked":
      return t("feeds.errorBlocked");
    case "local":
      return t("feeds.errorLocal");
    case "timeout":
      return t("feeds.errorTimeout");
    case "too big":
      return t("feeds.errorTooBig");
    case "not a feed":
      return t("feeds.errorNotFeed");
    default:
      return t("feeds.errorOther", { error: reason });
  }
}

/** Dismisses these posts (`Feeds.dismiss`), and says so, with Undo, in a notice. How many were. */
export function dismissPosts(rows: Row[], why: Dismissal = "done"): number {
  const first = rows.find(({ post }) => !post.dismissed);
  const count = feeds.dismiss(rows, why);
  if (count > 1) sayDismissed(t("feeds.didDismissMany", { count }));
  else if (first) sayDismissed(t(why === "uninteresting" ? "feeds.didDismissUninteresting" : "feeds.didDismiss", { title: first.post.title }));
  return count;
}

/** Dismisses every post of these feeds still in their lists, and says so, with Undo. */
export function dismissAll(urls: string[]) {
  const count = feeds.dismissAll(urls);
  if (count) sayDismissed(t("feeds.didDismissMany", { count }));
}

function sayDismissed(message: string) {
  speak(message);
  ui.notify({
    message,
    action: {
      label: t("feeds.undo"),
      run: () => {
        const undone = undoDismissal();
        if (undone) speak(undone);
      },
    },
  });
}

/** Puts back the posts dismissed last (⌘Z, or the notice's Undo); what's said of it, or null if there were none. */
export function undoDismissal(): string | null {
  const count = feeds.undoDismiss();
  if (!count) return null;
  ui.notify(null);
  return t("feeds.didRestore", { count });
}

/** Saves a post to the Library, and says so, or that it couldn't be; once, if it's being saved already. */
export async function savePost(row: Row) {
  if (feeds.saving.has(row.post.key)) return;
  try {
    await feeds.save(row);
    speak(t("feeds.saved", { title: row.post.title }));
  } catch (error) {
    console.error("lines: couldn't save the post", error);
    speak(t("feeds.couldntSave"));
  }
}

/**
 * The feed a library source says a link names, if one does (`LibrarySource.feed`): a podcast's page
 * on Apple Podcasts, someone's sounds on SoundCloud. Only those sources are asked, as a page's
 * every link may be.
 */
export async function namedFeed(link: string, signal = new AbortController().signal): Promise<string | null> {
  const url = new URL(link);
  for (const source of plugins.librarySources) {
    if (!source.feed || !source.recognizes(url)) continue;
    const feed = await source.feed(url, signal).catch(() => null);
    signal.throwIfAborted();
    if (feed) return feed;
  }
  return null;
}

/** What subscribing to `link` makes where a source says it's a subscription of its own (`LibrarySource.subscription`). */
async function subscriptionOf(link: string, signal: AbortSignal): Promise<LibraryItem | null> {
  const url = new URL(link);
  for (const source of plugins.librarySources) {
    if (!source.subscription || !source.recognizes(url)) continue;
    const item = await source.subscription(url, signal);
    signal.throwIfAborted();
    if (item) return item;
  }
  return null;
}

/** A feed read another way where it can't be had itself, if a source knows it (`LibrarySource.feedInstead`): YouTube's, from the channel's page. */
export async function feedInstead(url: string, signal = new AbortController().signal): Promise<Feed | null> {
  const feed = new URL(url);
  for (const source of plugins.librarySources) {
    const read = await source.feedInstead?.(feed, signal);
    if (read) return read;
  }
  return null;
}

export const feeds = new Feeds();
