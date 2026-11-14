import { hostIsPublic, isTauri, webFetch } from "./platform";

/*
 * Asking the web for what something there named (a feed, a page, its pictures, icons, transcripts
 * and feeds it links to). The apps can reach this computer and the network it's on, as web pages
 * can't, so there nothing the web gives is followed onto them: not an address it names, nor a
 * redirect, nor a name that stands for one of their addresses (`127.0.0.1.nip.io`, which the
 * system is asked about: src-tauri's addresses.rs). Only an address the person gave themselves
 * (`own`: typed or pasted into Subscribe or a note, chosen from a link's menu) is asked as it is,
 * wherever it is: and if that's on this computer or its network, so are its redirects.
 */

/** How many redirects are followed, as browsers do. */
const REDIRECTS = 10;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** What's never sent on to another site at a redirect, as browsers do: who's asking. */
const CREDENTIALS = ["authorization", "cookie", "proxy-authorization"];

/** A request something on the web led to this computer or its network, which isn't made. */
export class LocalAddress extends Error {}

/** How an address is asked for. */
export interface Asking {
  /**
   * It's the person's own: typed or pasted (Subscribe, a note that's just the link), or chosen (a
   * link's menu), not found in what the web gave. Asked wherever it is; its redirects as well, if
   * it's on this computer or its network, and else checked as anything from the web is.
   */
  own?: boolean;
}

/** A site's name as it's compared: as the address reads it (lowercase, its international letters in ASCII), without the dot a name can end with. */
export const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/\.+$/, "");

/**
 * Whether a site's name is this computer's, or one on its network, by the name alone: `localhost`,
 * `printer`, `nas.local`, `192.168.1.10`, `[::1]`. Only what's sure: any other name is the system's
 * to say, as `outsideFetch` asks it.
 */
export function isLocal(host: string): boolean {
  const name = host.toLowerCase().replace(/\.+$/, "");
  // A name with a dot in it (not `localhost`, nor an IPv6 address, `[::1]`) that isn't a local network's.
  if (!/^[^[\]]+\.[^.]+$/.test(name) || /\.(?:local|localhost|internal|home|lan|arpa)$/.test(name)) return true;
  const ipv4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(name);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Whether `host` is this computer's or its network's, by its name or by what the system says it stands for. Rejects where the system can't say. */
async function onThisNetwork(host: string, signal: AbortSignal | null | undefined) {
  return isLocal(host) || !(await hostIsPublic(host, signal ?? undefined));
}

/**
 * `fetch` for an address something on the web gave, or the person did (`own`). In the apps, each
 * redirect is followed here, and none of the addresses on the way may be on this computer or its
 * network, by name or by what the name stands for, but an own address on it and where it leads;
 * who's asking (a token, a cookie) isn't told to another site. Elsewhere, the browser's own.
 */
export async function outsideFetch(url: string, init: RequestInit = {}, { own = false }: Asking = {}): Promise<Response> {
  const fetch = await webFetch();
  if (!isTauri) return fetch(url, init);
  let { method } = init;
  let headers = new Headers(init.headers);
  // The person's own address on this computer or its network: what it leads to is theirs as well.
  let trusted = false;
  for (let redirects = 0; ; redirects++) {
    const here = new URL(url);
    if (own && redirects === 0) trusted = await onThisNetwork(hostOf(here), init.signal);
    else if (!trusted && (await onThisNetwork(hostOf(here), init.signal))) throw new LocalAddress(`${here.host} is on this computer or its network`);
    // The plugin's own option (src-tauri: tauri-plugin-http), which isn't fetch's.
    const response = await fetch(url, { ...init, method, headers, maxRedirections: 0 } as RequestInit);
    const location = REDIRECT.has(response.status) ? response.headers.get("location") : null;
    if (!location) return response;
    if (redirects === REDIRECTS) throw new TypeError("too many redirects");
    void response.body?.cancel().catch(() => {});
    const next = new URL(location, here);
    if (next.origin !== here.origin) {
      headers = new Headers(headers);
      for (const name of CREDENTIALS) headers.delete(name);
    }
    url = next.href;
    if (response.status === 303 && method !== "HEAD") method = "GET";
  }
}
