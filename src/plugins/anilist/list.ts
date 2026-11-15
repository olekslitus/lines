import { t } from "../../lib/i18n/index.svelte";
import type { ListAccount, ListEntry, ListSite } from "../../lib/plugins/types";
import { animeOf } from "./anime";
import { ask, MEDIA, type Media } from "./api";

/*
 * Your anime list on AniList, kept in step with the Library (lib/library/lists.svelte.ts). Signing in
 * is AniList's "pin" way: you say yes on AniList, which then shows a token to paste into Settings,
 * so it works the same in the apps and on the web, with nothing listening for it. The token lasts a
 * year. lines' client id on AniList is set when it's built (VITE_ANILIST_CLIENT_ID).
 */

const CLIENT: string | undefined = import.meta.env.VITE_ANILIST_CLIENT_ID;

/** Where lines' statuses are on AniList, and back (watching again is watching). */
const STATUSES = [
  ["to watch", "PLANNING"],
  ["watching", "CURRENT"],
  ["watched", "COMPLETED"],
  ["on hold", "PAUSED"],
  ["dropped", "DROPPED"],
] as const;
const statusOf = (status: string | null | undefined) => (status === "REPEATING" ? "watching" : (STATUSES.find(([, there]) => there === status)?.[0] ?? null));

/** How someone scores on AniList, as they chose there: out of 100, 10 (by tenths, or whole), 5, or 3 (smileys). */
const FORMATS: Record<string, ListAccount["scale"]> = {
  POINT_100: { max: 100, step: 1 },
  POINT_10_DECIMAL: { max: 10, step: 0.1 },
  POINT_10: { max: 10, step: 1 },
  POINT_5: { max: 5, step: 1 },
  POINT_3: { max: 3, step: 1 },
};
const formatOf = (scale: ListAccount["scale"]) => Object.entries(FORMATS).find(([, each]) => each.max === scale.max && each.step === scale.step)?.[0] ?? "POINT_100";

interface ListItem {
  mediaId: number;
  status?: string | null;
  score?: number | null;
  progress?: number | null;
  updatedAt?: number | null;
  media?: Media | null;
}

const ENTRY = `mediaId status score(format: $format) progress updatedAt media { ${MEDIA} description(asHtml: false) }`;

function entryOf(item: ListItem): ListEntry | null {
  const anime = item.media && animeOf(item.media);
  if (!anime) return null;
  return {
    id: item.mediaId,
    ...(item.media?.idMal && { ids: { mal: item.media.idMal } }),
    status: statusOf(item.status),
    score: item.score ?? 0,
    progress: item.progress ?? 0,
    updated: (item.updatedAt ?? 0) * 1000,
    item: anime,
  };
}

export const list: ListSite = {
  id: "anilist",
  name: "AniList",
  kind: "anime",
  key: "anilist",
  unavailable: CLIENT ? undefined : t("library.list.notInBuild", { name: "AniList" }),
  signIn: { page: `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(CLIENT ?? "")}&response_type=token` },

  async connect(token, signal) {
    const given = token?.trim() ?? "";
    const { Viewer } = await ask<{ Viewer: { id: number; name: string; mediaListOptions?: { scoreFormat?: string } } }>(
      "query { Viewer { id name mediaListOptions { scoreFormat } } }",
      {},
      signal,
      given,
    );
    return { name: Viewer.name, token: given, user: Viewer.id, scale: FORMATS[Viewer.mediaListOptions?.scoreFormat ?? ""] ?? FORMATS.POINT_100 };
  },

  async entries(account, signal) {
    const { MediaListCollection } = await ask<{ MediaListCollection: { lists: { entries: ListItem[] }[] } }>(
      `query ($user: Int, $format: ScoreFormat) { MediaListCollection(userId: $user, type: ANIME) { lists { entries { ${ENTRY} } } } }`,
      { user: account.user, format: formatOf(account.scale) },
      signal,
      account.token,
    );
    // Something in a list of your own is in its status's list too: once each.
    const found = new Map<number, ListEntry>();
    for (const { entries } of MediaListCollection.lists) {
      for (const item of entries) {
        const entry = found.has(item.mediaId) ? null : entryOf(item);
        if (entry) found.set(entry.id, entry);
      }
    }
    return [...found.values()];
  },

  async save(account, change, signal) {
    const status = STATUSES.find(([here]) => here === change.status)?.[1];
    const { SaveMediaListEntry } = await ask<{ SaveMediaListEntry: ListItem }>(
      `mutation ($id: Int, $status: MediaListStatus, $score: Float, $progress: Int, $format: ScoreFormat) {
        SaveMediaListEntry(mediaId: $id, status: $status, score: $score, progress: $progress) { ${ENTRY} } }`,
      { id: change.id, ...(status && { status }), score: change.score, progress: change.progress, format: formatOf(account.scale) },
      signal,
      account.token,
    );
    return entryOf(SaveMediaListEntry)!;
  },
};
