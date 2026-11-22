import { AwsClient } from "aws4fetch";
import { t } from "../i18n/index.svelte";
import { isTauri, webFetch } from "../platform";
import { SyncError, type Remote, type RemoteObject } from "./remote";

/** Any S3-compatible bucket: Amazon S3, Cloudflare R2, Backblaze B2, MinIO, … */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  /** Folder inside the bucket, e.g. `lines/`. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const unquote = (etag: string | null) => etag?.replace(/^(W\/)?"|"$/g, "") ?? null;

function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Buckets found this session not to do conditional writes, or deletes, though they don't ignore them: written to as before. */
const unconditional = { PUT: new Set<string>(), DELETE: new Set<string>() };

/** Why the app's native side couldn't transfer a file: the bucket's answer, or none (status null). */
interface Failure {
  status: number | null;
  text: string;
}

/**
 * Sends a request whose body or response is a file from the app's native side, with the file as
 * bytes both ways (src-tauri/src/bucket_sync.rs). The HTTP plugin (`webFetch`) would send the body
 * as JSON, a number for each byte: a 50 MB file was 180 MB of text, seconds to write and nearly
 * 2 GB of memory to read. The response has the bucket's status and body, not its headers.
 */
async function transfer(request: Request): Promise<Response> {
  const { invoke } = await import("@tauri-apps/api/core");
  const signed = { method: request.method, url: request.url, headers: [...request.headers] };
  try {
    const body = await invoke<ArrayBuffer>("sync_bucket_transfer", new Uint8Array(await request.arrayBuffer()), {
      headers: { "x-request": encodeURIComponent(JSON.stringify(signed)) },
    });
    return new Response(body);
  } catch (error) {
    const { status, text } = error as Failure;
    if (typeof status === "number") return new Response(text, { status });
    throw new Error(text ?? String(error), { cause: error });
  }
}

export class S3Remote implements Remote {
  #client: AwsClient;
  #base: string;

  constructor(readonly config: S3Config) {
    this.#client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region || "auto",
      service: "s3",
    });
    // Path-style URLs work across S3, R2, B2 and MinIO.
    this.#base = `${config.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(config.bucket)}`;
  }

  /**
   * A failure is thrown as an error, but for the statuses in `answers` (404: there's nothing there).
   * `file`: its body or response is a file (an attachment).
   */
  async #request(path: string, init: RequestInit = {}, answers = [404], file = false) {
    const signed = await this.#client.sign(this.#base + path, init);
    let response: Response;
    try {
      // In the browser the bucket must allow this app's origin (CORS).
      response = await (file && isTauri ? transfer(signed) : (await webFetch())(signed));
    } catch (error) {
      console.error("lines: storage request failed", error);
      throw new SyncError(
        isTauri ? t("sync.error.unreachableApp") : t("sync.error.unreachableBrowser"),
      );
    }
    if (!response.ok && !answers.includes(response.status)) {
      const text = await response.text().catch(() => "");
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
      throw new SyncError(
        code === "SignatureDoesNotMatch" || code === "InvalidAccessKeyId"
          ? t("sync.error.wrongKey")
          : code === "NoSuchBucket"
            ? t("sync.error.noBucket", { bucket: this.config.bucket })
            : code === "AccessDenied" || response.status === 403
              ? t("sync.error.denied")
              : // The status as text, so it isn't written as a number ("1 000").
                message
                ? t("sync.error.service", { status: String(response.status), message })
                : t("sync.error.status", { status: String(response.status) }),
      );
    }
    return response;
  }

  /** Every object under `prefix`, following pagination. */
  async list(prefix: string): Promise<RemoteObject[]> {
    const objects: RemoteObject[] = [];
    let token: string | null = null;
    do {
      const params = new URLSearchParams({ "list-type": "2", prefix });
      if (token) params.set("continuation-token", token);
      const response = await this.#request(`?${params}`);
      if (response.status === 404) throw new SyncError(t("sync.error.noBucket", { bucket: this.config.bucket }));
      const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
      // Anything else (a proxy's login page, a misconfigured endpoint) would read as an empty bucket.
      if (xml.documentElement.localName !== "ListBucketResult") {
        throw new SyncError(t("sync.error.notS3"));
      }
      for (const item of xml.getElementsByTagName("Contents")) {
        const key = item.getElementsByTagName("Key")[0]?.textContent;
        const etag = unquote(item.getElementsByTagName("ETag")[0]?.textContent ?? null);
        if (key && etag) objects.push({ key, etag });
      }
      const truncated = xml.getElementsByTagName("IsTruncated")[0]?.textContent === "true";
      token = truncated ? (xml.getElementsByTagName("NextContinuationToken")[0]?.textContent ?? null) : null;
    } while (token);
    return objects;
  }

  async get(key: string): Promise<{ text: string; etag: string | null } | null> {
    const response = await this.#request(`/${encodeKey(key)}`);
    if (response.status === 404) return null;
    return { text: await response.text(), etag: unquote(response.headers.get("etag")) };
  }

  /** Returns the new ETag, if the server exposes it. */
  async put(key: string, text: string, expected?: string | null) {
    return this.#put(key, text, "text/markdown; charset=utf-8", expected);
  }

  async getFile(key: string) {
    const response = await this.#request(`/${encodeKey(key)}`, {}, [404], true);
    return response.status === 404 ? null : response.blob();
  }

  async putFile(key: string, data: Blob) {
    await this.#put(key, data, data.type || "application/octet-stream");
  }

  async #put(key: string, body: string | Blob, contentType: string, expected?: string | null): Promise<string | null | false> {
    const response = await this.#conditional(key, { method: "PUT", body, headers: { "content-type": contentType } }, expected, body instanceof Blob);
    return response && unquote(response.headers.get("etag"));
  }

  /**
   * Sends a write or a delete only if the object is still as `expected` (its ETag; null: not there),
   * where that's given (If-Match, or If-None-Match): false if not, another device having written it
   * since. A service that ignores the condition writes anyway, as before; one that turns it down
   * (400, 501), or refuses it though the object is as expected (412), which would leave it never
   * written, is sent the request as before, for the rest of the session.
   */
  async #conditional(key: string, init: RequestInit & { method: "PUT" | "DELETE"; headers?: Record<string, string> }, expected?: string | null, file = false): Promise<Response | false> {
    const skipped = unconditional[init.method];
    if (skipped.has(this.#base)) expected = undefined;
    const condition: Record<string, string> = expected === undefined ? {} : expected === null ? { "if-none-match": "*" } : { "if-match": `"${expected}"` };
    const response = await this.#request(`/${encodeKey(key)}`, { ...init, headers: { ...init.headers, ...condition } }, expected === undefined ? [404] : [400, 404, 409, 412, 501], file);
    // 409: written just as this was.
    if (response.status === 409 || (response.status === 412 && (await this.#etag(key)) !== expected)) return false;
    if ([400, 412, 501].includes(response.status)) {
      skipped.add(this.#base);
      return this.#conditional(key, init, undefined, file);
    }
    return response;
  }

  /** The object's ETag now, or null if it isn't there. From the listing where the bucket doesn't show the header to this page (CORS). */
  async #etag(key: string) {
    const response = await this.#request(`/${encodeKey(key)}`, { method: "HEAD" });
    if (response.status === 404) return null;
    return unquote(response.headers.get("etag")) ?? (await this.list(key)).find((object) => object.key === key)?.etag ?? null;
  }

  async delete(key: string, expected?: string) {
    return (await this.#conditional(key, { method: "DELETE" }, expected)) !== false;
  }
}
