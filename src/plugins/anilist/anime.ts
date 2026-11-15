import { known, names, seasonOf, yearOf } from "../../lib/library/text";
import type { LibraryItem } from "../../lib/plugins/types";
import type { Media } from "./api";

/* What AniList says of an anime, as the Library writes it: looked up (index.ts), and on a list (list.ts). */

/** The anime a link is to on AniList, by its id: `anilist.co/anime/154587/Sousou-no-Frieren`. */
export function animeIn(url: URL): number | null {
  if (!/^(?:www\.)?anilist\.co$/i.test(url.hostname)) return null;
  const id = /^\/anime\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
  return id ? Number(id) : null;
}

/** AniList's formats as a note writes them. */
const FORMATS: Record<string, string> = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };

/** An anime as a library item: its English title where it has one, else as it's written in Japanese, in Latin letters. */
export function animeOf(media: Media, cover = media.coverImage?.extraLarge ?? media.coverImage?.large): LibraryItem | null {
  const title = media.title?.english ?? media.title?.romaji ?? media.title?.native;
  if (!title) return null;
  const year = media.seasonYear ?? media.startDate?.year;
  return {
    type: "anime",
    title,
    link: media.siteUrl ?? `https://anilist.co/anime/${media.id}`,
    properties: known([
      ["format", media.format ? (FORMATS[media.format] ?? media.format) : undefined],
      ["studio", names(media.studios?.nodes?.map((studio) => studio.name) ?? [])],
      ["year", yearOf(year ?? undefined)],
      ["season", seasonOf(media.season, year)],
      ["episodes", media.episodes || undefined],
      ["anilist", media.id],
      ["mal", media.idMal || undefined],
    ]),
    cover: cover ?? undefined,
    description: media.description ?? undefined,
  };
}
