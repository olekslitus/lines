import type { SharedFolder } from "../sync/engine.svelte";
import { DAY, fingerprint, type KeptPost } from "./posts";

/*
 * What was done with feeds' posts, as every device has it: read or unread, dismissed (done with,
 * or not interesting) or restored, and Dismiss All. Synced as a small file for each feed in a
 * folder beside the notes, `feeds/` (docs/sync.md), so a mark sends only its feed's file. Each mark
 * says when it was made, so two devices' merge field by field, the later winning, and each device
 * applies them to the posts it keeps.
 *
 * A mark is kept while its post is in its feed: a device that fetches the feed says so (`listed`),
 * a day at a time. Once its post has been gone from the feed for GONE_FOR, it's let go: the device
 * that fetched moves the feed's horizon (`gone`) past it, and every device that reads the file lets
 * go of its marks from before the horizon, which only moves on. So what's let go is the file's to
 * say, not each device's clock or fetches: one that never fetches the feed lets go of the same marks,
 * and none writes back what another let go. Dismiss All is a cut-off, rather than a mark a post.
 */

/** The folder beside the notes the marks are in, a file for each feed (`shardOf`). */
export const MARKS_DIR = "feeds/";

/** Why a post was dismissed: done with it, or not interesting (what a filter that learns would learn from). */
export type Dismissal = "done" | "uninteresting";

/** When each was last done to a post, in milliseconds: the latest of read and unread says which it is, as the latest of dismissing and restoring does. */
export interface Mark {
  read?: number;
  unread?: number;
  done?: number;
  uninteresting?: number;
  restored?: number;
  /** When a fetch last had its post in the feed, by any device's account (said again a day at a time). */
  listed?: number;
}

export type MarkField = Exclude<keyof Mark, "listed">;
const FIELDS: MarkField[] = ["read", "unread", "done", "uninteresting", "restored"];
/** A mark's fields, in the order a file has them. */
const ALL: (keyof Mark)[] = [...FIELDS, "listed"];

/** Dismiss All: every post published before `before` is dismissed as of `at`, but one marked since. */
export interface Cleared {
  before: number;
  at: number;
  /** When it was set: the later of two devices' wins. Dismiss All's `at`, or when it was undone (to the one before it, or none: `before` 0). */
  set: number;
}

/** What was done with one feed's posts: each one's marks, by its key (`markKey`), Dismiss All's, and the horizon marks from before are let go at. */
export interface FeedMarks {
  posts: Record<string, Mark>;
  cleared?: Cleared;
  gone?: number;
}

/** Each feed's marks, by its address. */
export type Marks = Record<string, FeedMarks>;

/** How long a mark is kept once its post is no longer in its feed: a device away for less finds it. */
export const GONE_FOR = 90 * DAY;
/** How old a listed post's mark's `listed` gets before a fetch says so again (all of the feed's at once), so the file changes once a day at most. */
export const LISTED_EVERY = DAY;
/**
 * Dismiss All's cut-off is this long before it: posts published since are marked one by one, as
 * an aggregator's (Hacker News') can be listed a while after they're published.
 */
export const CLEAR_MARGIN = 3 * DAY;

/**
 * The key a post's marks are under: a short fingerprint of its id, the same on every device that
 * reads the feed. It hides nothing: a post's id is usually its public link or guid, so with
 * encryption off, anyone who can read the synced folder can tell which posts were read and dismissed.
 */
export const markKey = (id: string) => fingerprint(id);

/** The file a feed's marks are synced in, in MARKS_DIR: named by a fingerprint of its address, so feeds that share one share the file. */
export const shardOf = (feed: string) => `${fingerprint(feed)}.json`;

/** The latest of `fields` the mark has. */
function latest<F extends MarkField>(mark: Mark, fields: F[]): F | undefined {
  let found: F | undefined;
  for (const field of fields) {
    const at = mark[field];
    if (at !== undefined && (found === undefined || at > mark[found]!)) found = field;
  }
  return found;
}

/** What a post's marks make it: read or not (dismissing reads it), and dismissed, and why, or not; nothing where they don't say. */
export function stateOf(mark: Mark): { read?: boolean; dismissed?: Dismissal | null } {
  const reading = latest(mark, ["read", "unread", "done", "uninteresting"]);
  const dismissal = latest(mark, ["done", "uninteresting", "restored"]);
  return {
    ...(reading && { read: reading !== "unread" }),
    ...(dismissal && { dismissed: dismissal === "restored" ? null : dismissal }),
  };
}

/** A post's marks with its feed's Dismiss All counted in, if it was published before its cut-off. */
export function withCleared(mark: Mark | undefined, date: number | undefined, cleared: Cleared | undefined): Mark | undefined {
  if (!cleared || date === undefined || date >= cleared.before) return mark;
  return { ...mark, done: Math.max(mark?.done ?? 0, cleared.at) };
}

/** When anything was last marked in a feed: what a mark made after is later than, whatever this device's clock says. */
export function latestOf(marks: FeedMarks | undefined): number {
  let at = Math.max(marks?.cleared?.at ?? 0, marks?.cleared?.set ?? 0);
  for (const mark of Object.values(marks?.posts ?? {})) for (const field of FIELDS) at = Math.max(at, mark[field] ?? 0);
  return at;
}

/** A mark with `fields` done now: later than anything marked in its feed (`floor`, `latestOf`), so it wins wherever it's merged, whatever another device's clock said. */
export function marked(mark: Mark | undefined, fields: MarkField[], floor: number, now = Date.now()): Mark {
  const at = Math.max(now, floor + 1);
  return { ...mark, ...Object.fromEntries(fields.map((field) => [field, at])) };
}

/** When a mark was last made, or its post last listed. */
const lastOf = (mark: Mark) => Math.max(...ALL.map((field) => mark[field] ?? 0));

/**
 * Whether a mark keeps a post it covers out of its feed's Dismiss All (restored, or marked unread,
 * since): kept while the cut-off stands, however old, or the post would be dismissed (or read) by it
 * again. One that only says why (not interesting) goes as any does: the cut-off dismisses its post
 * anyway. Which posts it covers is their dates', which marks don't keep.
 */
function against(mark: Mark, cleared: Cleared | undefined): boolean {
  if (!cleared?.before) return false;
  const { read, dismissed } = stateOf({ ...mark, done: Math.max(mark.done ?? 0, cleared.at) });
  return read === false || dismissed === null;
}

/** A feed's marks without those from before its horizon (but those against its Dismiss All); the same object if none are. */
function settled(marks: FeedMarks): FeedMarks {
  const { gone, cleared } = marks;
  if (!gone) return marks;
  const kept = Object.entries(marks.posts).filter(([, mark]) => lastOf(mark) >= gone || against(mark, cleared));
  return kept.length === Object.keys(marks.posts).length ? marks : { ...marks, posts: Object.fromEntries(kept) };
}

/** The later of two Dismiss Alls (or undoings of one). */
const laterCleared = (here: Cleared | undefined, there: Cleared | undefined) =>
  !there || (here && (here.set !== there.set ? here.set > there.set : here.at !== there.at ? here.at > there.at : here.before >= there.before)) ? here : there;

/**
 * Two devices' marks of a feed as one: each post's field by field, the later winning (and the
 * latest it was listed); the later Dismiss All; the later horizon, and the marks from before it let
 * go. The same object as `here` if that's what it already was.
 */
export function mergeFeed(here: FeedMarks | undefined, there: FeedMarks): FeedMarks {
  const own = here?.posts ?? {};
  let posts: Record<string, Mark> | undefined;
  for (const [key, mark] of Object.entries(there.posts)) {
    const mine = own[key];
    const later = ALL.filter((field) => {
      const at = mark[field];
      const before = mine?.[field];
      return at !== undefined && (before === undefined || at > before);
    });
    if (!later.length) continue;
    posts ??= { ...own };
    posts[key] = { ...mine, ...Object.fromEntries(later.map((field) => [field, mark[field]])) };
  }
  const cleared = laterCleared(here?.cleared, there.cleared);
  const gone = Math.max(here?.gone ?? 0, there.gone ?? 0) || undefined;
  if (here && !posts && cleared === here.cleared && gone === here.gone) return settled(here);
  return settled({ posts: posts ?? own, ...(cleared && { cleared }), ...(gone && { gone }) });
}

/**
 * A feed's marks as fetching it found its posts (`listing`, by key, at `fetchedAt`): those listed
 * said to be, all at once, if any hadn't been for LISTED_EVERY; and, if any mark's post has been
 * gone GONE_FOR, the horizon moved on to then (in whole days), letting it go. The same object if
 * nothing changed, so a fetch changes the file once a day at most.
 */
export function tidyFeed(marks: FeedMarks, listing: Set<string>, fetchedAt: number): FeedMarks {
  const shown = Object.keys(marks.posts).filter((key) => listing.has(key));
  const stale = shown.some((key) => (marks.posts[key].listed ?? 0) < fetchedAt - LISTED_EVERY);
  const posts = stale ? { ...marks.posts, ...Object.fromEntries(shown.map((key) => [key, { ...marks.posts[key], listed: Math.max(marks.posts[key].listed ?? 0, fetchedAt) }])) } : marks.posts;
  const horizon = Math.floor((fetchedAt - GONE_FOR) / DAY) * DAY;
  const going = horizon > (marks.gone ?? 0) && Object.values(posts).some((mark) => lastOf(mark) < horizon && !against(mark, marks.cleared));
  if (!stale && !going) return marks;
  return settled({ ...marks, posts, ...(going && { gone: horizon }) });
}

/** A post back in its list. */
export function withoutDismissal(post: KeptPost): KeptPost {
  const { dismissed: _, ...rest } = post;
  return rest;
}

/** A feed's posts as its marks make them; the same array if none changed. */
export function applyMarks(posts: KeptPost[], marks: FeedMarks | undefined): KeptPost[] {
  if (!marks) return posts;
  let changed = false;
  const applied = posts.map((post) => {
    const mark = withCleared(marks.posts[markKey(post.id)], post.date, marks.cleared);
    if (!mark) return post;
    const { read = post.read, dismissed = post.dismissed ?? null } = stateOf(mark);
    if (read === post.read && dismissed === (post.dismissed ?? null)) return post;
    changed = true;
    return { ...withoutDismissal(post), read, ...(dismissed && { dismissed }) };
  });
  return changed ? applied : posts;
}

/** The entries of `value` if it's an object, else none. */
const entries = (value: unknown): [string, unknown][] => (value && typeof value === "object" ? Object.entries(value) : []);

/** What a file's object says of a feed's marks, but what isn't a time. */
function readFeed(value: unknown): FeedMarks {
  const posts: Record<string, Mark> = {};
  for (const [key, mark] of entries((value as { posts?: unknown })?.posts)) {
    const read: Mark = Object.fromEntries(entries(mark).filter(([field, at]) => ALL.includes(field as keyof Mark) && Number.isFinite(at)));
    if (Object.keys(read).length) posts[key] = read;
  }
  const { before, at, set = at } = ((value as { cleared?: Partial<Cleared> })?.cleared ?? {}) as Partial<Cleared>;
  const gone = (value as { gone?: unknown })?.gone;
  return {
    posts,
    ...(Number.isFinite(before) && Number.isFinite(at) && Number.isFinite(set) && { cleared: { before: before!, at: at!, set: set! } }),
    ...(typeof gone === "number" && Number.isFinite(gone) && gone > 0 && { gone }),
  };
}

/** A file of marks as written (`writeShard`): its feeds' (normally one), or none if it can't be read. */
export function readShard(text: string): Marks {
  try {
    return Object.fromEntries(entries(JSON.parse(text)?.feeds).map(([feed, value]) => [feed, readFeed(value)]));
  } catch {
    return {};
  }
}

/** A feed's marks as a file has them: posts in order, each mark's fields in one order, nothing that isn't there. */
function written({ posts, cleared, gone }: FeedMarks) {
  const mark = (each: Mark) => Object.fromEntries(ALL.flatMap((field) => (each[field] === undefined ? [] : [[field, each[field]]])));
  return {
    ...(cleared && { cleared: { before: cleared.before, at: cleared.at, set: cleared.set } }),
    ...(gone && { gone }),
    posts: Object.fromEntries(
      Object.keys(posts)
        .sort()
        .map((key) => [key, mark(posts[key])]),
    ),
  };
}

/** As a file: on one line, short, and the same marks always written the same, however they came to be, so a file is written only when what it says changes. */
export function writeShard(marks: Marks): string {
  const feeds = Object.fromEntries(
    Object.keys(marks)
      .sort()
      .map((feed) => [feed, written(marks[feed])]),
  );
  return JSON.stringify({ format: "lines-feed-marks", version: 1, feeds }) + "\n";
}

/**
 * A device's marks as sync shares them (sync/engine.svelte.ts): a file for each feed with any, and
 * each file read taken in (`take`). Reading one says what it says, as this device would write it
 * (its marks from before its horizon let go), so sync writes a file back only when this device
 * knows more than it says: marks newer than the file's, or a horizon moved on by a fetch here;
 * never marks the file let go.
 */
export function sharedMarks(device: { marks(): Marks; feeds(): Iterable<string>; take(there: Marks): void }): Pick<SharedFolder, "dir" | "names" | "files" | "merge"> {
  return {
    dir: MARKS_DIR,
    names: () => [...new Set([...device.feeds(), ...Object.keys(device.marks())].map(shardOf))],
    files: () => {
      const shards = new Map<string, Marks>();
      for (const [feed, marks] of Object.entries(device.marks())) shards.set(shardOf(feed), { ...shards.get(shardOf(feed)), [feed]: marks });
      return new Map([...shards].map(([name, marks]) => [name, writeShard(marks)]));
    },
    merge: (_, text) => {
      const there = readShard(text);
      device.take(there);
      return writeShard(Object.fromEntries(Object.entries(there).map(([feed, marks]) => [feed, settled(marks)])));
    },
  };
}
