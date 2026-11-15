import { t } from "../../lib/i18n/index.svelte";
import type { ListEntry, ListSite } from "../../lib/plugins/types";
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

interface ListItem {
  mediaId: number;
  status?: string | null;
  score?: number | null;
  progress?: number | null;
  updatedAt?: number | null;
  media?: Media | null;
}

/** Scores are read and written out of 100 (AniList keeps them so), whichever format someone shows theirs in, which they can change there whenever. */
const ENTRY = `mediaId status score(format: POINT_100) progress updatedAt media { ${MEDIA} description(asHtml: false) }`;

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
  scale: { max: 100, step: 1 },

  async connect(token, signal) {
    const given = token?.trim() ?? "";
    const { Viewer } = await ask<{ Viewer: { id: number; name: string } }>("query { Viewer { id name } }", {}, signal, given);
    return { name: Viewer.name, token: given, user: Viewer.id };
  },

  async entries(account, signal) {
    const { MediaListCollection } = await ask<{ MediaListCollection: { lists: { entries: ListItem[] }[] } }>(
      `query ($user: Int) { MediaListCollection(userId: $user, type: ANIME) { lists { entries { ${ENTRY} } } } }`,
      { user: account.user },
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
    // What isn't sent isn't changed: a rating given while watching again (REPEATING) leaves it that.
    const { SaveMediaListEntry } = await ask<{ SaveMediaListEntry: ListItem }>(
      `mutation ($id: Int, $status: MediaListStatus, $score: Int, $progress: Int) {
        SaveMediaListEntry(mediaId: $id, status: $status, scoreRaw: $score, progress: $progress) { ${ENTRY} } }`,
      { id: change.id, ...(status && { status }), ...(change.score !== undefined && { score: Math.round(change.score) }), ...(change.progress !== undefined && { progress: change.progress }) },
      signal,
      account.token,
    );
    return entryOf(SaveMediaListEntry)!;
  },
};
