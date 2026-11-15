import { t } from "../../lib/i18n/index.svelte";
import type { LibraryItem, LibrarySource, Plugin } from "../../lib/plugins/types";
import { animeIn, animeOf } from "./anime";
import { ask, MEDIA, type Media } from "./api";
import { lookupSeries, searchComics, seriesIn } from "./manga";

export { animeIn, seriesIn };

/*
 * AniList (anilist.co), an open catalog of anime and of manga, manhwa and manhua, asked without a key:
 * an anime or a series by a link to it (manga.ts says which links a series' are), and either searched
 * for in Add to Library, with their ids on AniList and MyAnimeList, so each is known on both. Only the
 * id in the link, or the words searched for, is sent. It answers web pages too.
 */

async function lookupAnime(id: number, signal: AbortSignal): Promise<LibraryItem | null> {
  const found = await ask<{ Media: Media | null }>(`query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA} description(asHtml: false) } }`, { id }, signal);
  return found.Media ? animeOf(found.Media) : null;
}

/** Anime `text` names, the best match first, their covers small; none for adults only. */
async function searchAnime(text: string, signal: AbortSignal): Promise<LibraryItem[]> {
  const found = await ask<{ Page: { media: Media[] } }>(
    `query ($search: String) { Page(perPage: 15) { media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ${MEDIA} } } }`,
    { search: text },
    signal,
  );
  return found.Page.media.flatMap((media) => animeOf(media, media.coverImage?.medium ?? media.coverImage?.large) ?? []);
}

const source: LibrarySource = {
  id: "anilist",
  name: "AniList",
  recognizes: (url) => animeIn(url) !== null || seriesIn(url) !== null,
  // As the kinds' properties say it (library/keys.ts), so a note of it is found however it was added:
  // AniList's ids are one numbering, MyAnimeList's an anime's (`mal`) and a series' (`myanimelist`) apart.
  key: (url) => {
    const anime = animeIn(url);
    if (anime !== null) return `anilist:${anime}`;
    const found = seriesIn(url);
    if (!found) return null;
    return "id" in found ? `anilist:${found.id}` : "mal" in found ? `myanimelist:${found.mal}` : `mangadex:${found.mangadex}`;
  },
  lookup: (url, signal) => {
    const anime = animeIn(url);
    return anime !== null ? lookupAnime(anime, signal) : lookupSeries(url, signal);
  },
  searches: ["anime", "comic"],
  search: (type, text, signal) => (type === "anime" ? searchAnime(text, signal) : searchComics(text, signal)),
};

export const anilist = (): Plugin => ({
  id: "anilist",
  name: "AniList",
  description: t("plugins.anilist.description"),
  icon: "book-image",
  enabledByDefault: true,
  requires: ["library"],
  contributes: { librarySources: [source] },
});
