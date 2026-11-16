import { readDuration } from "../../lib/feeds/dates";

/*
 * What YouTube's pages say in their own data (`ytInitialData`, and the same shapes in what its
 * pages ask for more), read as JSON, nothing of it run. It's YouTube's own and changes as YouTube
 * likes, so what's wanted is looked for anywhere in it, in each of the shapes it's been written in,
 * and what doesn't read as it should is left out, never guessed at.
 */

export const VIDEO_ID = /^[\w-]{11}$/;

const SECOND = 1000;
const DAY = 86_400 * SECOND;
/** "3 days ago" as YouTube writes it, in English (its pages are asked for in English), short or long: `9d ago`, `2 weeks ago`. */
const AGO = /(\d+)\s*([a-z]+)\s+ago\b/i;
/** Each unit's length, by how its word starts: `mo` before `m`. */
const UNITS: [RegExp, number][] = [
  [/^mo/, 30 * DAY],
  [/^(?:mi|m$)/, 60 * SECOND],
  [/^s/, SECOND],
  [/^h/, 3600 * SECOND],
  [/^d/, DAY],
  [/^w/, 7 * DAY],
  [/^y/, 365 * DAY],
];

/** Whether a link is to youtube.com (www., m.). */
export const onYouTube = (url: URL) => /^(?:(?:www|m)\.)?youtube\.com$/.test(url.hostname);

/** When "3 days ago" (or `9d ago`) was, from `now`; undefined for words it doesn't read. */
export function agoDate(text: string, now: number): number | undefined {
  const match = AGO.exec(text);
  const unit = match && UNITS.find(([starts]) => starts.test(match[2].toLowerCase()))?.[1];
  return unit ? now - Number(match[1]) * unit : undefined;
}

export type Json = Record<string, unknown>;
export const object = (value: unknown): Json | undefined => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined);
export const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
/** A text as YouTube's data writes one: `{ content }`, `{ simpleText }` or `{ runs: [{ text }] }`. */
export const words = (value: unknown): string | undefined => {
  const said = object(value);
  if (!said) return text(value);
  const runs = Array.isArray(said.runs) ? said.runs.map((run) => object(run)?.text ?? "").join("") : undefined;
  return text(said.content) ?? text(said.simpleText) ?? text(runs);
};

/** A page's own data (`var ytInitialData = {…};`), or null where it has none that reads. */
export function initialData(html: string): Json | null {
  const start = /ytInitialData"?\]?\s*=\s*\{/.exec(html);
  if (!start) return null;
  const from = start.index + start[0].length - 1;
  const end = html.indexOf(";</script>", from);
  try {
    return object(JSON.parse(html.slice(from, end < 0 ? undefined : end))) ?? null;
  } catch {
    return null;
  }
}

/** Every object under `root`, depth first, each once: where YouTube puts its lists moves, so they're looked for anywhere. */
export function* objects(root: unknown): Generator<Json> {
  const stack: unknown[] = [root];
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) stack.push(...[...value].reverse());
    else if (value && typeof value === "object") {
      yield value as Json;
      stack.push(...Object.values(value).reverse());
    }
  }
}

/** A video in one of YouTube's lists: a channel's videos, a playlist's. */
export interface ListedVideo {
  id: string;
  title: string;
  /** When it came out, as near as "3 days ago" says. */
  date?: number;
  /** In seconds. */
  duration?: number;
  /** Whose it is, by name and its page (by handle, as YouTube links to it), where the list says. */
  channel?: { name: string; link: string };
}

/** A video a list holds that can't be watched: one deleted or made private since it was listed. */
const GONE = /^\[(?:deleted|private) video\]$/i;

/** The channel a text in a list links to (its byline): its name, and its page as YouTube links to it. */
function channelOf(holder: unknown): ListedVideo["channel"] {
  for (const part of objects(holder)) {
    const name = words(part.text) ?? (Array.isArray(part.runs) ? words(part) : undefined);
    if (!name) continue;
    const path = [...objects(part)].map((each) => text(object(each.browseEndpoint)?.canonicalBaseUrl)).find((each) => each?.startsWith("/@") || each?.startsWith("/channel/"));
    if (path) return { name, link: `https://www.youtube.com${path}` };
  }
  return undefined;
}

/**
 * A video as YouTube's lists have written one: a `lockupViewModel` (now), or a `videoRenderer` or
 * `playlistVideoRenderer` (before). `gone` for one listed that can't be watched; null for anything
 * else (a playlist, a Short's shelf).
 */
export function listedVideo(holder: Json, now: number): ListedVideo | "gone" | null {
  const lockup = object(holder.lockupViewModel);
  if (lockup) {
    const id = text(lockup.contentId);
    if (!id || !VIDEO_ID.test(id) || lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
    const metadata = object(object(lockup.metadata)?.lockupMetadataViewModel);
    const title = words(metadata?.title);
    if (!title || GONE.test(title)) return "gone";
    const rows = object(metadata?.metadata);
    const said = [...objects(rows)].map((part) => words(part.text)).filter((each) => each !== undefined);
    const badges = [...objects(lockup.contentImage)].map((part) => text(object(part.thumbnailBadgeViewModel)?.text)).filter((each) => each !== undefined);
    const ago = said.find((each) => AGO.test(each));
    return { id, title, date: ago ? agoDate(ago, now) : undefined, duration: badges.map(readDuration).find(Boolean), channel: channelOf(rows) };
  }
  const renderer = object(holder.videoRenderer) ?? object(holder.playlistVideoRenderer);
  const id = text(renderer?.videoId);
  if (!renderer || !id || !VIDEO_ID.test(id)) return null;
  const title = words(renderer.title);
  if (!title || GONE.test(title) || renderer.isPlayable === false) return "gone";
  const ago = words(renderer.publishedTimeText);
  const seconds = Number(text(renderer.lengthSeconds));
  return {
    id,
    title,
    date: ago ? agoDate(ago, now) : undefined,
    duration: seconds > 0 ? seconds : readDuration(words(renderer.lengthText)),
    channel: channelOf(renderer.shortBylineText ?? renderer.ownerText),
  };
}

/** Every video `data` lists, each once, in its order, and how many it lists that are gone. */
export function videosIn(data: unknown, now: number): { videos: ListedVideo[]; gone: number } {
  const videos = new Map<string, ListedVideo>();
  let gone = 0;
  for (const holder of objects(data)) {
    const video = listedVideo(holder, now);
    if (video === "gone") gone++;
    else if (video && !videos.has(video.id)) videos.set(video.id, video);
  }
  return { videos: [...videos.values()], gone };
}
