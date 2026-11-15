import { decodeEntities } from "../../lib/library/page";
import { known, names } from "../../lib/library/text";
import { getJson } from "../../lib/library/web";
import { isTauri } from "../../lib/platform";
import type { LibraryItem } from "../../lib/plugins/types";
import { ask } from "./api";

/*
 * Manga, manhwa and manhua on AniList, as the Library's comics (index.ts): a series by a link to it
 * there, to MyAnimeList (whose ids AniList keeps), or in the apps to MangaDex (which says AniList's
 * id; it doesn't let web pages ask it); and searched from Add to Library's Comics. A series' MyAnimeList
 * id is `myanimelist`, not an anime's `mal`: MyAnimeList numbers manga apart from anime.
 */

/** A series, as lines asks AniList for one. */
const SERIES = `id idMal format countryOfOrigin title { romaji english } startDate { year } chapters
  staff(perPage: 8, sort: [RELEVANCE]) { edges { role node { name { full } } } }
  coverImage { extraLarge large } description siteUrl`;

interface Series {
  id: number;
  idMal?: number | null;
  format?: string | null;
  countryOfOrigin?: string | null;
  title: { romaji?: string | null; english?: string | null };
  startDate?: { year?: number | null } | null;
  chapters?: number | null;
  staff?: { edges: { role?: string | null; node?: { name?: { full?: string | null } } | null }[] } | null;
  coverImage?: { extraLarge?: string | null; large?: string | null } | null;
  description?: string | null;
  siteUrl?: string;
}

/** What a link says the series is: AniList's id, MyAnimeList's, or MangaDex's. */
export function seriesIn(url: URL): { id: number } | { mal: number } | { mangadex: string } | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const [, section, id] = url.pathname.split("/");
  if (host === "anilist.co" && section === "manga" && /^\d+$/.test(id)) return { id: Number(id) };
  if (host === "myanimelist.net" && section === "manga" && /^\d+$/.test(id)) return { mal: Number(id) };
  // MangaDex doesn't let web pages ask it, so only the apps can.
  if (isTauri && host === "mangadex.org" && section === "title" && /^[0-9a-f-]{36}$/i.test(id)) return { mangadex: id.toLowerCase() };
  return null;
}

/** The form a series comes in, by the country it's from: Japan's manga, Korea's manhwa, China's and Taiwan's manhua. */
const FORMATS: Record<string, string> = { JP: "manga", KR: "manhwa", CN: "manhua", TW: "manhua" };

/** Its staff's names in `roles`, in their order, however AniList qualifies a role ("Art (chs 1-179)"). */
function staffIn(series: Series, roles: string[]) {
  const edges = series.staff?.edges ?? [];
  const roleOf = (role: string | null | undefined) => role?.replace(/\s*\(.*\)$/, "");
  return names(roles.flatMap((role) => edges.filter((edge) => roleOf(edge.role) === role).map((edge) => edge.node?.name?.full ?? undefined)));
}

/** What a series is known as, by the Library (library/same.ts): its id here, and MyAnimeList's, which a link there says. */
const idsOf = (series: Series) => [`anilist:${series.id}`, ...(series.idMal ? [`myanimelist:${series.idMal}`] : [])];

/** A series as a library item: a light novel's a book, the rest comics. */
function itemOf(series: Series, link: string, cover: string | null | undefined): LibraryItem {
  const title = series.title.english ?? series.title.romaji ?? "";
  // Who it's from first: a webtoon made from a novel, the novel's author.
  const author = staffIn(series, ["Original Creator", "Original Story", "Story & Art", "Story"]);
  const artist = staffIn(series, ["Story & Art", "Art"]);
  const year = series.startDate?.year ?? undefined;
  const description = series.description ? decodeEntities(series.description) : undefined;
  const ids = idsOf(series);
  if (series.format === "NOVEL") return { type: "book", title, link, properties: known([["author", author], ["year", year]]), ids, cover: cover ?? undefined, description };
  return {
    type: "comic",
    title,
    link,
    properties: known([
      ["author", author],
      // One who both writes and draws it is its author.
      ["artist", artist === author ? undefined : artist],
      ["format", FORMATS[series.countryOfOrigin ?? ""] ?? "comic"],
      ["year", year],
      ["chapters", series.chapters ?? undefined],
      ["anilist", series.id],
      ["myanimelist", series.idMal ?? undefined],
    ]),
    ids,
    cover: cover ?? undefined,
    description,
  };
}

/** AniList's id of a MangaDex series, or MyAnimeList's, as MangaDex says. */
async function fromMangadex(id: string, signal: AbortSignal): Promise<{ id: number } | { mal: number } | null> {
  const manga = await getJson<{ data?: { attributes?: { links?: { al?: string; mal?: string } | null } } }>(`https://api.mangadex.org/manga/${id}`, signal);
  const links = manga?.data?.attributes?.links;
  if (links?.al && /^\d+$/.test(links.al)) return { id: Number(links.al) };
  if (links?.mal && /^\d+$/.test(links.mal)) return { mal: Number(links.mal) };
  return null;
}

/** A series by a link to it on AniList, MyAnimeList or MangaDex. */
export async function lookupSeries(url: URL, signal: AbortSignal): Promise<LibraryItem | null> {
  const said = seriesIn(url);
  const found = said && "mangadex" in said ? await fromMangadex(said.mangadex, signal) : said;
  if (!found) return null;
  const answer = await ask<{ Media?: Series | null }>(
    `query ($id: Int, $mal: Int) { Media(id: $id, idMal: $mal, type: MANGA) { ${SERIES} } }`,
    "id" in found ? { id: found.id } : { mal: found.mal },
    signal,
  );
  const series = answer?.Media;
  return series ? itemOf(series, url.href, series.coverImage?.extraLarge ?? series.coverImage?.large) : null;
}

/** Comics titled `text`, the best match first, light novels left out (they're books). */
export async function searchComics(text: string, signal: AbortSignal): Promise<LibraryItem[]> {
  const answer = await ask<{ Page?: { media?: Series[] } }>(
    `query ($search: String) { Page(perPage: 15) { media(search: $search, type: MANGA, format_not: NOVEL, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${SERIES} } } }`,
    { search: text },
    signal,
  );
  return (answer?.Page?.media ?? []).map((series) => itemOf(series, series.siteUrl ?? `https://anilist.co/manga/${series.id}`, series.coverImage?.large));
}

