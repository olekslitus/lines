import { beforeEach, describe, expect, mock, test } from "bun:test";
import { stubApp } from "./stubs";

/*
 * Asking the web in the apps (src/lib/outside.ts): redirects followed one at a time, and nothing the
 * web gives followed onto this computer or its network, by an address, a redirect or a name the
 * system says stands for one of its addresses; only an address the person gave themselves is asked
 * wherever it is. The app's requests and the system's answers are the test's.
 */

/** What each address answers: a status and where it leads, or a body. */
const answers = new Map<string, { status?: number; location?: string; body?: string }>();
const asked: { url: string; method?: string; redirects?: number; authorization?: string | null }[] = [];
/** The names the system says stand for an address on this computer or its network, and those it can't look up. */
const localNames = new Set(["127.0.0.1.nip.io", "router.example", "nas.tailnet.ts.net"]);
const unknownNames = new Set(["flaky.example"]);

stubApp({
  isTauri: true,
  hostIsPublic: async (host: string) => {
    if (unknownNames.has(host)) throw new Error(`couldn't look up ${host}`);
    return !localNames.has(host);
  },
  webFetch: async () => async (url: string, init?: RequestInit & { maxRedirections?: number }) => {
    asked.push({ url, method: init?.method, redirects: init?.maxRedirections, authorization: new Headers(init?.headers).get("authorization") });
    const answer = answers.get(url);
    if (!answer) return new Response("", { status: 404 });
    return new Response(answer.body ?? "", { status: answer.status ?? 200, headers: answer.location ? { location: answer.location } : {} });
  },
});
mock.module("../../src/lib/release", () => ({ VERSION: "0.0.0", REPO: "https://github.com/olekslitus/lines" }));
const { isLocal, LocalAddress, outsideFetch } = await import("../../src/lib/outside");
const { fetchFeed } = await import("../../src/lib/feeds/fetch");

beforeEach(() => {
  answers.clear();
  asked.length = 0;
});

describe("asking the web in the apps", () => {
  test("a site's name is this computer's or its network's by the name alone: no dot, a local network's, or a private address", () => {
    for (const host of ["localhost", "printer", "nas.local", "home.lan", "router.home.arpa", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.100.0.1", "0.0.0.0", "240.0.0.1", "[::1]", "[fd00::1]", "localhost."]) {
      expect(isLocal(host), host).toBe(true);
    }
    // What a name stands for is the system's to say.
    for (const host of ["example.com", "example.com.", "8.8.8.8", "172.32.0.1", "127.0.0.1.nip.io"]) expect(isLocal(host), host).toBe(false);
  });

  test("redirects are followed here, one at a time, keeping a HEAD a HEAD", async () => {
    answers.set("https://blog.example/feed", { status: 301, location: "https://www.blog.example/feed" });
    answers.set("https://www.blog.example/feed", { status: 302, location: "/feed.xml" });
    answers.set("https://www.blog.example/feed.xml", { body: "<rss/>" });
    const response = await outsideFetch("https://blog.example/feed", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(asked.map(({ url, method, redirects }) => ({ url, method, redirects }))).toEqual([
      { url: "https://blog.example/feed", method: "HEAD", redirects: 0 },
      { url: "https://www.blog.example/feed", method: "HEAD", redirects: 0 },
      { url: "https://www.blog.example/feed.xml", method: "HEAD", redirects: 0 },
    ]);
  });

  test("an address on the web never leads to this computer or its network: by a redirect, or by a name that stands for one of its addresses", async () => {
    answers.set("https://blog.example/feed", { status: 302, location: "http://127.0.0.1:8080/admin" });
    await expect(outsideFetch("https://blog.example/feed")).rejects.toBeInstanceOf(LocalAddress);
    expect(asked.map(({ url }) => url)).toEqual(["https://blog.example/feed"]);

    asked.length = 0;
    answers.set("https://blog.example/picture", { status: 307, location: "https://router.example/status" });
    await expect(outsideFetch("https://blog.example/picture")).rejects.toBeInstanceOf(LocalAddress);
    expect(asked.map(({ url }) => url)).toEqual(["https://blog.example/picture"]);

    asked.length = 0;
    await expect(outsideFetch("https://127.0.0.1.nip.io/feed")).rejects.toBeInstanceOf(LocalAddress);
    expect(asked).toEqual([]);
  });

  test("an address the web gives that's on this computer, by its look, is never asked: only the person's own is", async () => {
    // A page naming this as its feed, a transcript's, Apple's feedUrl, an OPML entry: none is the person's.
    answers.set("http://127.0.0.1:8080/admin/reset", { body: "done" });
    await expect(outsideFetch("http://127.0.0.1:8080/admin/reset")).rejects.toBeInstanceOf(LocalAddress);
    await expect(fetchFeed("http://localhost:8080/feed.xml")).rejects.toMatchObject({ message: "local" });
    expect(asked).toEqual([]);

    // A feed the person runs, given as theirs: asked, and so is where it leads on this computer.
    answers.set("http://localhost:8080/feed", { status: 302, location: "http://127.0.0.1:8080/feed.xml" });
    answers.set("http://127.0.0.1:8080/feed.xml", { body: "<rss/>" });
    expect((await outsideFetch("http://localhost:8080/feed", {}, { own: true })).status).toBe(200);
    // Theirs under a name that stands for their network (a tailnet's, split-horizon DNS): theirs too.
    answers.set("https://nas.tailnet.ts.net/feed.xml", { body: "<rss/>" });
    expect((await outsideFetch("https://nas.tailnet.ts.net/feed.xml", {}, { own: true })).status).toBe(200);
  });

  test("an address the person gave on the web at large is checked where it leads, as any from the web is", async () => {
    answers.set("https://blog.example/feed", { status: 302, location: "http://127.0.0.1:8080/admin" });
    await expect(outsideFetch("https://blog.example/feed", {}, { own: true })).rejects.toBeInstanceOf(LocalAddress);
    expect(asked.map(({ url }) => url)).toEqual(["https://blog.example/feed"]);
  });

  test("a name ending in a dot is the name it is, checked as such", async () => {
    answers.set("https://evil.example./feed", { status: 302, location: "http://127.0.0.1/" });
    await expect(outsideFetch("https://evil.example./feed")).rejects.toBeInstanceOf(LocalAddress);
    expect(asked.map(({ url }) => url)).toEqual(["https://evil.example./feed"]);
  });

  test("a name the system can't look up isn't asked: a second answer could be this computer's", async () => {
    await expect(outsideFetch("https://flaky.example/feed")).rejects.toThrow("couldn't look up flaky.example");
    expect(asked).toEqual([]);
  });

  test("who's asking (a token, a cookie) isn't told to another site a redirect leads to", async () => {
    answers.set("https://readwise.io/api/v2/export/", { status: 302, location: "https://readwise.io/api/v2/export/?page=2" });
    answers.set("https://readwise.io/api/v2/export/?page=2", { status: 302, location: "https://cdn.example/export.json" });
    answers.set("https://cdn.example/export.json", { body: "{}" });
    await outsideFetch("https://readwise.io/api/v2/export/", { headers: { authorization: "Token secret" } });
    expect(asked.map(({ url, authorization }) => [url, authorization])).toEqual([
      ["https://readwise.io/api/v2/export/", "Token secret"],
      ["https://readwise.io/api/v2/export/?page=2", "Token secret"],
      ["https://cdn.example/export.json", null],
    ]);
  });

  test("ten redirects, and no more", async () => {
    for (let i = 0; i < 12; i++) answers.set(`https://loop.example/${i}`, { status: 302, location: `/${i + 1}` });
    await expect(outsideFetch("https://loop.example/0")).rejects.toThrow("too many redirects");
    expect(asked.length).toBe(11);
  });

  test("a feed that leads onto this computer's network couldn't be fetched, and says why", async () => {
    answers.set("https://blog.example/feed", { status: 301, location: "https://192.168.1.1/feed" });
    await expect(fetchFeed("https://blog.example/feed")).rejects.toMatchObject({ message: "local" });
  });
});
