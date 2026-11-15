import { afterEach, expect, test } from "bun:test";
import type { Route } from "playwright";
import { type App, noErrors, openApp } from "./app";

/*
 * Keeping an anime list on AniList and the Library in step (lib/library/lists.svelte.ts), against an
 * AniList of the test's own, answered here: signing in with a token, importing the list, and a change
 * on each side reaching the other. Nothing reaches the real AniList, nor any account.
 */

let app: App;
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const CORS = { "access-control-allow-origin": "*" };
const now = Math.floor(Date.now() / 1000);

/** An entry on the list, as AniList answers it (trimmed). */
const entryOf = (mediaId: number, idMal: number, title: string, status: string, score: number, progress: number, updatedAt: number) => ({
  mediaId,
  status,
  score,
  progress,
  updatedAt,
  media: { id: mediaId, idMal, format: "TV", episodes: 28, title: { english: title }, siteUrl: `https://anilist.co/anime/${mediaId}`, studios: { nodes: [{ name: "MADHOUSE" }] } },
});

/** AniList as the test's: whoever `tok` is, `ada`, scoring out of 10, and her list; what was saved to it. */
async function aniList(page: App["page"]) {
  const list = [
    entryOf(154587, 52991, "Frieren: Beyond Journey's End", "CURRENT", 8, 5, now - 3600),
    entryOf(5114, 5114, "Fullmetal Alchemist: Brotherhood", "COMPLETED", 10, 64, now - 86400),
    entryOf(1, 1, "Cowboy Bebop", "COMPLETED", 0, 26, now - 86400),
  ];
  const saved: Record<string, unknown>[] = [];
  await page.route("https://graphql.anilist.co/", async (route: Route) => {
    const { query, variables } = JSON.parse(route.request().postData() ?? "{}");
    const signedIn = route.request().headers().authorization === "Bearer tok";
    if (/Viewer|MediaListCollection|SaveMediaListEntry/.test(query) && !signedIn) return route.fulfill({ status: 401, headers: CORS, json: { errors: [{ message: "Invalid token", status: 401 }] } });
    if (query.includes("Viewer")) return route.fulfill({ headers: CORS, json: { data: { Viewer: { id: 7, name: "ada", mediaListOptions: { scoreFormat: "POINT_10" } } } } });
    if (query.includes("MediaListCollection")) return route.fulfill({ headers: CORS, json: { data: { MediaListCollection: { lists: [{ entries: list }] } } } });
    if (query.includes("SaveMediaListEntry")) {
      saved.push(variables);
      const entry = list.find((each) => each.mediaId === variables.id)!;
      Object.assign(entry, { ...(variables.status && { status: variables.status }), score: variables.score, progress: variables.progress, updatedAt: Math.floor(Date.now() / 1000) });
      return route.fulfill({ headers: CORS, json: { data: { SaveMediaListEntry: entry } } });
    }
    return route.fulfill({ status: 400, headers: CORS, json: { errors: [{ message: "Unexpected" }] } });
  });
  return { list, saved };
}

const bodyOf = (page: App["page"], id: string) => page.evaluate((id) => window.testing.notes.get(id)?.note.body ?? "", id);

test("signed in to AniList, the list is imported as notes, and a change on either side reaches the other", async () => {
  app = await openApp();
  const { page } = app;
  const { list, saved } = await aniList(page);
  // An anime the Library has already, from before, by its AniList id.
  const frieren = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    await window.testing.notes.insert({ id, body: "---\ntype: anime\nanilist: 154587\nstatus: to watch\n---\n# Frieren\n", createdAt: 1000, updatedAt: 1000, pinned: false, trashed: false });
    return id;
  });
  // And one added from a MyAnimeList link, which knows only its MyAnimeList id: the Library's same-check finds it by that.
  const bebop = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    await window.testing.notes.insert({ id, body: "---\ntype: anime\nmal: 1\nlink: https://myanimelist.net/anime/1\n---\n# Cowboy Bebop\n", createdAt: 1000, updatedAt: 1000, pinned: false, trashed: false });
    return id;
  });

  const settings = await app.settings("Library");
  const group = settings.getByRole("region", { name: "AniList" });
  await group.getByLabel("Sign in").fill("wrong");
  await group.getByRole("button", { name: "Sign In", exact: true }).click();
  await group.getByText("AniList didn’t take the token, or it’s run out. Sign in again.").waitFor();
  // The browser says AniList's 401 in the console itself; lines says it only in Settings.
  expect(app.errors.splice(0)).toEqual(["Failed to load resource: the server responded with a status of 401 (Unauthorized)"]);
  await group.getByLabel("Sign in").fill("tok");
  await group.getByRole("button", { name: "Sign In", exact: true }).click();
  await group.getByText("Signed in as ada").waitFor();

  // At once, what importing would do.
  await group.getByText("3 anime on your AniList list").waitFor();
  await group.getByText("2 are in the Library already, kept in step as they are").waitFor();
  // Meanwhile the one there is in step: its status, rating (8 of 10 is 4 of 5 stars) and progress came from AniList, which changed later.
  await page.waitForFunction((id) => window.testing.notes.get(id)?.note.body.includes("\nstatus: watching\nrating: 4/5\nprogress: 5\n"), frieren);
  // The one from MyAnimeList has its AniList id now, and what the list says of it (no rating there, so none here).
  await page.waitForFunction((id) => window.testing.notes.get(id)?.note.body.includes("\nanilist: 1\nstatus: watched\nprogress: 26\n"), bebop);
  expect(saved).toEqual([]);

  await group.getByRole("button", { name: "Import 1 Anime" }).click();
  await group.getByText("Imported 1 anime.").waitFor();
  const fma = await page.evaluate(() => window.testing.notes.entries.find((entry) => entry.meta.title === "Fullmetal Alchemist: Brotherhood")!.note.id);
  expect(await bodyOf(page, fma)).toStartWith("---\ntype: anime\nformat: TV\nstudio: MADHOUSE\nepisodes: 28\nanilist: 5114\nmal: 5114\nrating: 5/5\nprogress: 64\nlink: https://anilist.co/anime/5114\nstatus: watched\n---\n# Fullmetal Alchemist: Brotherhood");
  await app.closeSettings();

  // Rated here: a moment later, on AniList, on its scale.
  await page.evaluate((id) => window.testing.notes.select(id), frieren);
  await page.waitForFunction(() => window.testing.text()?.includes("# Frieren"));
  await page.evaluate(() => window.testing.place());
  await page.locator(".editor-pane .cm-lp-score[aria-label='4 out of 5'] .cm-lp-score-mark").nth(4).click();
  await page.waitForFunction(() => window.testing.text()?.includes("\nrating: 5/5\n"));
  const deadline = Date.now() + 15_000;
  while (!saved.length && Date.now() < deadline) await page.waitForTimeout(200);
  expect(saved).toEqual([{ id: 154587, status: "CURRENT", score: 10, progress: 5, format: "POINT_10" }]);

  // Watched to the end on AniList: in the note once it's asked again.
  Object.assign(list[0], { status: "COMPLETED", progress: 28, updatedAt: Math.floor(Date.now() / 1000) + 5 });
  const again = await app.settings("Library");
  await again.getByRole("region", { name: "AniList" }).getByRole("button", { name: "Sync Now" }).click();
  await page.waitForFunction((id) => window.testing.notes.get(id)?.note.body.includes("\nstatus: watched\nrating: 5/5\nprogress: 28\n"), frieren);
  expect(saved).toHaveLength(1);
});
