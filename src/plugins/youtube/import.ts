import { readAtMost } from "../../lib/feeds/fetch";
import type { ImportWork } from "../../lib/imports/imports.svelte";
import { clock, known } from "../../lib/library/text";
import { dayOf } from "../../lib/notes/calendar";
import { getJson, LookupError, request } from "../../lib/library/web";
import { propertyValue } from "../../lib/notes/escape";
import { propertyOf } from "../../lib/notes/properties";
import type { Entry } from "../../lib/notes/store.svelte";
import { pacing, pause } from "../../lib/pacing";
import type { LibraryItem } from "../../lib/plugins/types";
import type { ListedVideo } from "./data";
import { askForMore, playlistPage, readPlaylistMore, readPlaylistPage } from "./playlist";
import type { TakeoutPlaylist } from "./takeout";

/*
 * A YouTube playlist into the Library (Settings → Library → YouTube): its videos read, a page at a
 * time (playlist.ts), or from Google Takeout's file of one (takeout.ts) looked up one by one; then
 * a `video` note of each the Library hasn't, with the playlist it's in and when it was added, and
 * the playlist added to the `playlist` of each it has. Imported again, only what's new is added.
 */

/** The most of a playlist that's read: YouTube's own limit is 5,000. */
export const MOST = 5000;
/** How long between asking YouTube for a playlist's pages, or about each of Takeout's videos. */
const PAGE_SPACING = 1000;
const LOOKUP_SPACING = 200;
/** The most of a page that's read: its data is in its first megabyte or two. */
const PAGE_BYTES = 5_000_000;

/** A video to import: what a playlist lists of it, and when it was added there. */
export interface PlaylistVideo extends ListedVideo {
  added?: number;
}

/** What an import of a playlist gives `imports.start`: its name, its videos, the latest added first, and how many it lists that are gone. */
export interface PlaylistInput {
  playlist: string;
  videos: PlaylistVideo[];
  gone: number;
}

/** How reading a playlist is getting on: how many of its videos are read, of how many there are where that's known. */
export interface Reading {
  read: number;
  of?: number;
}

/** The Library's note of a video, by its link, as the Library tells what's the same (library/same.ts: any link to it, a bookmark of it too). */
export type NoteOfVideo = (link: string) => Entry | undefined;

/** A video's link, by its id. */
export const videoLink = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** A note's playlists, as its `playlist` lists them (`Watch later, Physics`). */
const playlistsOf = (entry: Entry) =>
  (propertyOf(entry.meta.properties, "playlist")?.value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

/** A video as the Library keeps one from a playlist: what the playlist says of it, without asking about it again. */
export function playlistVideoItem(video: PlaylistVideo, playlist: string): LibraryItem {
  return {
    type: "video",
    title: video.title,
    link: videoLink(video.id),
    properties: known([
      ["channel", video.channel?.name],
      ["duration", clock(video.duration)],
      ["playlist", playlist],
      ["added", video.added ? dayOf(video.added) : undefined],
    ]),
    ...(video.channel && { linked: { channel: video.channel.link } }),
    cover: `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
  };
}

/** What importing a playlist does: what it writes, and how many of its videos are new, are added to, and are there with it already. */
export interface PlaylistPlan {
  work: ImportWork;
  adding: number;
  joining: number;
  there: number;
}

/** What importing `input` writes, against the notes there are (`noteOf`): each video's note made, or its `playlist` added to. */
export function planPlaylist({ playlist, videos }: PlaylistInput, noteOf: NoteOfVideo): PlaylistPlan {
  const work: ImportWork = { add: [], append: [], change: [] };
  let there = 0;
  for (const video of videos) {
    const entry = noteOf(videoLink(video.id));
    if (!entry) work.add.push({ item: playlistVideoItem(video, playlist), created: video.added });
    else if (playlistsOf(entry).includes(playlist)) there++;
    else work.change!.push({ id: entry.note.id, properties: { playlist: propertyValue([...playlistsOf(entry), playlist].join(", ")) } });
  }
  return { work, adding: work.add.length, joining: work.change!.length, there };
}

/**
 * A playlist's videos, read from its page and then YouTube's answers for each page after it, one a
 * second, up to MOST; `progress` hears how it's going. Throws where it can't be read (on the web, or
 * a page that isn't a playlist's).
 */
export async function readPlaylist(id: string, signal: AbortSignal, progress: (reading: Reading) => void): Promise<PlaylistInput> {
  const response = await request(playlistPage(id), signal, { headers: { accept: "text/html", "accept-language": "en" } });
  if (!response.ok) throw new LookupError(`www.youtube.com answered ${response.status}`);
  const page = readPlaylistPage(new TextDecoder().decode(await readAtMost(response.body, PAGE_BYTES)), response.url || playlistPage(id));
  const videos = new Map(page.videos.map((video) => [video.id, video]));
  let { gone, next } = page;
  progress({ read: videos.size });
  while (next && page.client && videos.size < MOST) {
    await pause(PAGE_SPACING, signal);
    const answer = await request("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", signal, {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "en" },
      body: JSON.stringify(askForMore(next, page.client)),
    });
    if (!answer.ok) throw new LookupError(`www.youtube.com answered ${answer.status}`);
    const more = readPlaylistMore(await answer.json());
    for (const video of more.videos) if (!videos.has(video.id)) videos.set(video.id, video);
    gone += more.gone;
    // An answer that says what's next but lists nothing new would go round for ever.
    next = more.videos.length ? more.next : null;
    progress({ read: videos.size });
  }
  return { playlist: page.title, videos: [...videos.values()].slice(0, MOST), gone };
}

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
}

/**
 * Takeout's playlist with what each video the Library hasn't is, from YouTube's oEmbed (which web
 * pages may ask too), five a second; one that isn't there any more (deleted, or private) counted
 * as gone. Those the Library has aren't asked about: only their `playlist` changes.
 */
export async function lookUpTakeout(
  takeout: TakeoutPlaylist,
  playlist: string,
  noteOf: NoteOfVideo,
  channelLink: (author: string | undefined) => string | undefined,
  signal: AbortSignal,
  progress: (reading: Reading) => void,
): Promise<PlaylistInput> {
  const paced = pacing(LOOKUP_SPACING);
  const videos: PlaylistVideo[] = [];
  let gone = 0;
  let asked = 0;
  const asking = takeout.videos.filter(({ id }) => !noteOf(videoLink(id))).length;
  for (const { id, added } of takeout.videos.slice(0, MOST)) {
    if (noteOf(videoLink(id))) {
      // Known: its note's there, and only the playlist is added to it.
      videos.push({ id, title: "", added });
      continue;
    }
    const link = videoLink(id);
    // Gone or private: oEmbed has nothing (404), or won't say (401, 403).
    const found = await paced(() => getJson<OEmbed>(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link)}`, signal).catch((error: unknown) => {
      if (error instanceof LookupError && / 40[13]$/.test(error.message)) return null;
      throw error;
    }), signal);
    progress({ read: ++asked, of: asking });
    const channel = channelLink(found?.author_url);
    if (!found?.title) gone++;
    else videos.push({ id, title: found.title, channel: found.author_name && channel ? { name: found.author_name, link: channel } : undefined, added });
  }
  return { playlist, videos, gone };
}
