import { ListError } from "../../lib/library/lists";
import { request } from "../../lib/library/web";
import { pacing } from "../../lib/pacing";

/*
 * AniList's GraphQL API (docs.anilist.co), which answers web pages too and needs no key to read; a
 * list is read and written with the token of whoever's signed in (list.ts). Everything asked of it,
 * anime, comics and a list alike, goes through one pace: it asks for no more than 30 requests a
 * minute while it's busy (90 when it isn't), so one every two seconds keeps under it; and when it
 * says to wait, lines waits.
 */

export const API = "https://graphql.anilist.co";
const paced = pacing(2000);

/**
 * What AniList answers to `query` with `variables`, as whoever `token` is if it's given; what isn't
 * there is null in it (a 404's). Rejects offline, and with a ListError on AniList's errors: the
 * token not taken, a wait (until when it says), or anything else.
 */
export function ask<T>(query: string, variables: Record<string, unknown>, signal: AbortSignal, token?: string): Promise<T> {
  return paced(async () => {
    const response = await request(API, signal, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ query, variables }),
    });
    const answer = (await response.json().catch(() => null)) as { data?: T; errors?: { message: string; status?: number }[] } | null;
    if ((response.ok || response.status === 404) && answer?.data) return answer.data;
    const said = `AniList answered ${response.status}${answer?.errors?.[0] ? `: ${answer.errors[0].message}` : ""}`;
    if (response.status === 401 || (token && response.status === 400 && /token/i.test(said))) throw new ListError("token", said);
    if (response.status === 429) {
      // Retry-After isn't one a web page may read; the time it resets is.
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000 || Date.now() + Number(response.headers.get("retry-after") || 60) * 1000;
      throw new ListError("wait", said, reset);
    }
    throw new ListError("status", said);
  }, signal);
}

/** Something on AniList, as lines asks for it. */
export interface Media {
  id: number;
  idMal?: number | null;
  format?: string | null;
  episodes?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  startDate?: { year?: number | null } | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  coverImage?: { extraLarge?: string | null; large?: string | null; medium?: string | null } | null;
  description?: string | null;
  siteUrl?: string | null;
  studios?: { nodes?: { name: string }[] } | null;
}

/** What lines asks of an anime: what its note says of it. */
export const MEDIA = `id idMal format episodes season seasonYear startDate { year } title { romaji english native }
  coverImage { extraLarge large medium } siteUrl studios(isMain: true) { nodes { name } }`;
