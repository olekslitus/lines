import { readPage } from "../../lib/library/page";
import { initialData, type ListedVideo, object, objects, onYouTube, text, videosIn } from "./data";

/*
 * A YouTube playlist: the links to one, and its page and the pages after it read as text (data.ts),
 * for importing its videos into the Library (import.ts). Its page lists its first hundred; each
 * page says how to ask for the next (a continuation, which YouTube's own page asks its API for).
 */

/** The playlist a link to YouTube is, by its id: `playlist?list=`, or a video's link in one (`watch?v=…&list=`). Not a Mix made for whoever's watching (`RD…`), nor one only its owner can see (Watch Later, `WL`; Liked, `LL`). */
export function playlistIn(url: URL): string | null {
  const host = url.hostname.replace(/^(?:www|m)\./, "");
  if (!onYouTube(url) && host !== "youtu.be") return null;
  const id = url.searchParams.get("list");
  return id && /^[\w-]{10,64}$/.test(id) && !/^(?:RD|WL$|LL$|UL)/.test(id) ? id : null;
}

/** A playlist's page, by its id, in English (how its dates would read). */
export const playlistPage = (id: string) => `https://www.youtube.com/playlist?list=${id}`;

/** One page of a playlist: its videos, how many it lists that are gone, and how to ask for the next, if there's one. */
export interface PlaylistPart {
  videos: ListedVideo[];
  gone: number;
  next: string | null;
}

/** A playlist's first page: its title, its part, and the client version YouTube's own page asks for more as. */
export interface PlaylistStart extends PlaylistPart {
  title: string;
  client: string | null;
}

/** The token a list gives for asking what comes after it. */
function nextOf(data: unknown): string | null {
  for (const part of objects(data)) {
    const token = text(object(object(object(part.continuationItemRenderer)?.continuationEndpoint)?.continuationCommand)?.token);
    if (token) return token;
  }
  return null;
}

/** What a playlist's page (`html`) lists. Throws where it isn't one that reads as YouTube writes them. */
export function readPlaylistPage(html: string, url: string, now = Date.now()): PlaylistStart {
  const data = initialData(html);
  const title = text(object(object(data?.metadata)?.playlistMetadataRenderer)?.title) ?? text(readPage(html, url).meta.get("og:title"));
  if (!data || !title) throw new Error("not a playlist's page, or not one as YouTube writes them");
  const { videos, gone } = videosIn(data, now);
  if (!videos.length && !gone) throw new Error("the playlist's page lists nothing");
  return { title, videos, gone, next: nextOf(data), client: /"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/.exec(html)?.[1] ?? null };
}

/** What YouTube's API gives for a continuation (`next`): the next part of the playlist. */
export function readPlaylistMore(answer: unknown, now = Date.now()): PlaylistPart {
  const { videos, gone } = videosIn(answer, now);
  return { videos, gone, next: nextOf(answer) };
}

/** What YouTube's API is asked for the next part of a playlist, as its own page asks it. */
export const askForMore = (next: string, client: string) => ({ context: { client: { clientName: "WEB", clientVersion: client, hl: "en" } }, continuation: next });
