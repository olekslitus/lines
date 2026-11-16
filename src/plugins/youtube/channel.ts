import type { Feed, Post } from "../../lib/feeds/parse";
import { readPage } from "../../lib/library/page";
import { initialData, type ListedVideo, object, onYouTube, text, videosIn } from "./data";

/*
 * YouTube's channels: the links to one, its feed, and its page (its Videos tab) read as text
 * (data.ts): what it says of itself, and the videos it lists, for when its feed can't be had
 * (YouTube's go missing for hours or days). A page that doesn't read as a channel's is no channel
 * and no feed, never one of guesses.
 */

const CHANNEL_ID = /^UC[\w-]{22}$/;

/**
 * The channel a link to YouTube is, as the path to its page: `@handle`, `channel/UC…`, `c/name` or
 * `user/name`, whichever of its tabs the link is to (`/videos`, `/featured`…). Null for any other.
 */
export function channelPath(url: URL): string | null {
  if (!onYouTube(url)) return null;
  const path = /^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)(?:\/[\w-]+)?\/?$/.exec(url.pathname)?.[1];
  return path ?? null;
}

/** A channel's feed, by its id: its 15 newest videos, Shorts among them. */
export const channelFeed = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

/** The channel whose feed `url` is, by its id; null for any other address. */
export function feedChannel(url: URL): string | null {
  const id = onYouTube(url) && url.pathname === "/feeds/videos.xml" ? url.searchParams.get("channel_id") : null;
  return id && CHANNEL_ID.test(id) ? id : null;
}

/** The page of a channel's videos, by its path (channelPath). */
export const channelPage = (path: string) => `https://www.youtube.com/${path}/videos`;

export interface Channel {
  /** Its id, `UC…`. */
  id: string;
  title: string;
  /** Its page, by its handle (`https://www.youtube.com/@veritasium`), as YouTube links to it from its videos; else by its id. */
  link: string;
  description?: string;
  /** Its picture (avatar). */
  picture?: string;
  /** The videos its page lists, newest first. */
  videos: ListedVideo[];
}

/**
 * What a channel's page (`html`, from `url`) says of it: its id, name, link, description and
 * picture, from its tags and its data, and the videos it lists. Throws where it isn't a channel's
 * page that reads as one does: one of another kind, or one YouTube changed.
 */
export function readChannelPage(html: string, url: string, now = Date.now()): Channel {
  const page = readPage(html, url);
  const data = initialData(html);
  const about = object(object(data?.metadata)?.channelMetadataRenderer);
  const canonical = page.links.find((link) => link.rel === "canonical")?.href;
  const id = [page.meta.get("identifier"), text(about?.externalId), canonical && /\/channel\/(UC[\w-]{22})/.exec(canonical)?.[1]].find((each) => each && CHANNEL_ID.test(each));
  const title = text(about?.title) ?? text(page.meta.get("og:title"));
  if (!id || !title) throw new Error("not a channel's page, or not one as YouTube writes them");
  const handle = /\/(@[^/?#]+)/.exec(text(about?.vanityChannelUrl) ?? "")?.[1];
  return {
    id,
    title,
    link: `https://www.youtube.com/${handle ?? `channel/${id}`}`,
    description: text(about?.description) ?? text(page.meta.get("og:description")),
    picture: text(page.meta.get("og:image")),
    videos: videosIn(data, now).videos,
  };
}

/** A channel's page as its feed would be, its videos' dates a guess (`approximate`): what's read when the feed can't be. */
export function channelAsFeed(channel: Channel): Feed {
  if (!channel.videos.length) throw new Error("the channel's page lists no videos");
  const posts = channel.videos.map(({ id, title, date, duration }): Post => {
    const link = `https://www.youtube.com/watch?v=${id}`;
    // Its id as YouTube's feed gives it, so the two are one post.
    return { id: `yt:video:${id}`, title, link, author: channel.title, date, approximate: true, html: "", base: link, excerpt: "", image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration };
  });
  return { title: channel.title, format: "atom", link: channel.link, description: channel.description, image: channel.picture, posts };
}
