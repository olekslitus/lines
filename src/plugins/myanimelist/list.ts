import { t } from "../../lib/i18n/index.svelte";
import { ListError } from "../../lib/library/lists";
import { known, names, seasonOf, yearOf } from "../../lib/library/text";
import { request } from "../../lib/library/web";
import { pacing } from "../../lib/pacing";
import { isTauri, openExternal } from "../../lib/platform";
import type { ListAccount, ListEntry, ListSite } from "../../lib/plugins/types";

/*
 * Your anime list on MyAnimeList, kept in step with the Library (lib/library/lists.svelte.ts), through
 * MyAnimeList's own API. It doesn't answer web pages, so only the apps can. Signing in is OAuth 2 with
 * PKCE, as MyAnimeList has it for apps without a secret: lines opens MyAnimeList's page in the
 * browser, and listens on this computer, at REDIRECT, for the browser to come back with a code
 * (src-tauri/src/oauth.rs), which it trades for a token, then refreshes as it runs out. lines'
 * client id there is set when it's built (VITE_MAL_CLIENT_ID).
 */

const CLIENT: string | undefined = import.meta.env.VITE_MAL_CLIENT_ID;
const API = "https://api.myanimelist.net/v2";
const OAUTH = "https://myanimelist.net/v1/oauth2";
/** Where MyAnimeList sends the browser back to, as it's registered there: a port of lines' own on this computer. */
export const PORT = 45291;
export const REDIRECT = `http://127.0.0.1:${PORT}/myanimelist`;
/** It says nothing of how often it may be asked; once a second keeps well clear. */
const paced = pacing(1000);

/** Where lines' statuses are on MyAnimeList, and back. */
const STATUSES = [
  ["to watch", "plan_to_watch"],
  ["watching", "watching"],
  ["watched", "completed"],
  ["on hold", "on_hold"],
  ["dropped", "dropped"],
] as const;
const statusOf = (status: string | undefined) => STATUSES.find(([, there]) => there === status)?.[0] ?? null;

const FIELDS = "list_status,alternative_titles,media_type,num_episodes,start_season,studios,synopsis,main_picture";

interface Anime {
  id: number;
  title: string;
  alternative_titles?: { en?: string };
  media_type?: string;
  num_episodes?: number;
  start_season?: { year?: number; season?: string };
  studios?: { name: string }[];
  synopsis?: string;
  main_picture?: { large?: string; medium?: string };
}

interface ListStatus {
  status?: string;
  score?: number;
  num_episodes_watched?: number;
  is_rewatching?: boolean;
  updated_at?: string;
}

/** MyAnimeList's media types as a note writes them (as its site does). */
const TYPES: Record<string, string> = { tv: "TV", movie: "Movie", ova: "OVA", ona: "ONA", special: "Special", music: "Music", tv_special: "TV Special" };

function entryOf(anime: Anime, status: ListStatus): ListEntry {
  const year = anime.start_season?.year;
  return {
    id: anime.id,
    status: status.is_rewatching ? "watching" : statusOf(status.status),
    score: status.score ?? 0,
    progress: status.num_episodes_watched ?? 0,
    updated: Date.parse(status.updated_at ?? "") || 0,
    item: {
      type: "anime",
      title: anime.alternative_titles?.en || anime.title,
      link: `https://myanimelist.net/anime/${anime.id}`,
      properties: known([
        ["format", anime.media_type ? (TYPES[anime.media_type] ?? anime.media_type) : undefined],
        ["studio", names(anime.studios?.map((studio) => studio.name) ?? [])],
        ["year", yearOf(year)],
        ["season", seasonOf(anime.start_season?.season, year)],
        ["episodes", anime.num_episodes || undefined],
        ["mal", anime.id],
      ]),
      cover: anime.main_picture?.large ?? anime.main_picture?.medium,
      description: anime.synopsis?.replace(/\s*\[Written by MAL Rewrite\]\s*$/i, "") || undefined,
    },
  };
}

/** A token, and when it runs out, as MyAnimeList gives them. */
async function tokens(form: Record<string, string>, signal: AbortSignal): Promise<Pick<ListAccount, "token" | "refresh" | "expires">> {
  const response = await request(`${OAUTH}/token`, signal, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT ?? "", ...form }).toString(),
  });
  if (response.status === 400 || response.status === 401) throw new ListError("token", `MyAnimeList answered ${response.status}`);
  if (!response.ok) throw new ListError("status", `MyAnimeList answered ${response.status}`);
  const answer = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return { token: answer.access_token, refresh: answer.refresh_token, expires: Date.now() + (answer.expires_in ?? 3600) * 1000 };
}

/** The account's token, refreshed first if it's run out, or about to. */
async function fresh(account: ListAccount, signal: AbortSignal) {
  if (!account.refresh || (account.expires ?? Infinity) > Date.now() + 60_000) return;
  Object.assign(account, await tokens({ grant_type: "refresh_token", refresh_token: account.refresh }, signal));
}

/** What MyAnimeList answers, as whoever's signed in: once refreshed and again where it says the token's run out. */
async function ask<T>(account: ListAccount, url: string, signal: AbortSignal, init: RequestInit = {}): Promise<T> {
  await fresh(account, signal);
  for (let tried = 0; ; tried++) {
    const response = await paced(() => request(url, signal, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${account.token}` } }), signal);
    if (response.ok) return (await response.json()) as T;
    if (response.status === 401 && account.refresh && !tried) {
      Object.assign(account, await tokens({ grant_type: "refresh_token", refresh_token: account.refresh }, signal));
      continue;
    }
    const said = `MyAnimeList answered ${response.status}`;
    if (response.status === 401) throw new ListError("token", said);
    if (response.status === 429 || response.status === 403) throw new ListError("wait", said, Date.now() + (Number(response.headers.get("retry-after")) || 300) * 1000);
    throw new ListError("status", said);
  }
}

/** A random string for PKCE's verifier and the state, of the characters it allows. */
function random(length: number) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => characters[byte % characters.length]).join("");
}

export const list: ListSite = {
  id: "myanimelist",
  name: "MyAnimeList",
  kind: "anime",
  key: "mal",
  unavailable: !isTauri ? t("library.list.appsOnly", { name: "MyAnimeList" }) : !CLIENT ? t("library.list.notInBuild", { name: "MyAnimeList" }) : undefined,
  signIn: { browser: true },
  scale: { max: 10, step: 1 },

  async connect(_token, signal) {
    const verifier = random(96);
    const state = random(32);
    const { invoke } = await import("@tauri-apps/api/core");
    // Listening before the browser's sent there, so its coming back isn't missed.
    const back = invoke<string>("oauth_wait", { port: PORT, path: "/myanimelist", done: t("library.list.signedInPage", { name: "MyAnimeList" }) });
    signal.addEventListener("abort", () => void invoke("oauth_cancel"), { once: true });
    const page = new URL(`${OAUTH}/authorize`);
    page.search = new URLSearchParams({ response_type: "code", client_id: CLIENT ?? "", state, redirect_uri: REDIRECT, code_challenge: verifier, code_challenge_method: "plain" }).toString();
    await openExternal(page.href);
    const query = new URLSearchParams(await back);
    signal.throwIfAborted();
    if (query.get("state") !== state || !query.get("code")) throw new ListError("token", "MyAnimeList didn't say yes");
    const account: ListAccount = {
      name: "",
      ...(await tokens({ grant_type: "authorization_code", code: query.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier }, signal)),
    };
    account.name = (await ask<{ name: string }>(account, `${API}/users/@me`, signal)).name;
    return account;
  },

  async entries(account, signal) {
    const found: ListEntry[] = [];
    let next: string | undefined = `${API}/users/@me/animelist?fields=${FIELDS}&limit=1000&nsfw=true`;
    while (next) {
      const page: { data: { node: Anime; list_status: ListStatus }[]; paging?: { next?: string } } = await ask(account, next, signal);
      found.push(...page.data.map(({ node, list_status }) => entryOf(node, list_status)));
      next = page.paging?.next;
    }
    return found;
  },

  async save(account, change, signal) {
    const status = STATUSES.find(([here]) => here === change.status)?.[1];
    // What isn't sent isn't changed: a rating given while rewatching leaves it rewatching.
    const form = new URLSearchParams({
      ...(status && { status }),
      ...(change.score !== undefined && { score: String(Math.round(change.score)) }),
      ...(change.progress !== undefined && { num_watched_episodes: String(change.progress) }),
    });
    const saved = await ask<ListStatus>(account, `${API}/anime/${change.id}/my_list_status`, signal, {
      method: "PATCH",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const { status: now, score, progress } = entryOf({ id: change.id, title: "" }, saved);
    return { status: now, score, progress };
  },
};
