import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BucketConfig } from "../../src/lib/sync/providers";

/** The system's keychain, as the apps that have one keep secrets in it: in memory, and able to be missing or refuse. */
const keychain = {
  items: new Map<string, string>(),
  there: true,
  refusing: false,
};
mock.module("../../src/lib/keychain", () => ({
  keychain: {
    available: async () => keychain.there,
    get: async (name: string) => {
      if (keychain.refusing) throw new Error("The user name or passphrase you entered is not correct.");
      return keychain.items.get(name) ?? null;
    },
    set: async (name: string, value: string) => {
      if (keychain.refusing) throw new Error("The user name or passphrase you entered is not correct.");
      keychain.items.set(name, value);
    },
    delete: async (name: string) => void keychain.items.delete(name),
  },
}));
// After the keychain's stand-in, which the sync engine it loads imports.
const { sync } = await import("./sync");

const CONFIG_KEY = "lines.sync";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const bucket: BucketConfig = {
  kind: "bucket",
  provider: "r2",
  endpoint: "https://example.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "notes",
  prefix: "lines/",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: SECRET,
  encryption: { id: "library", key: "bGlicmFyeSBrZXk=" },
};

const stored = () => localStorage.getItem(CONFIG_KEY) ?? "";

beforeEach(() => {
  Object.assign(keychain, { there: true, refusing: false });
  keychain.items.clear();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(bucket));
});

describe("the sync connection's keys", () => {
  test("saved with the rest before Lines kept them in the keychain, they move there as it starts, and the connection is as it was", async () => {
    await sync.load();
    expect(sync.config).toEqual(bucket);
    // Not even empty: a Lines from before, opened again, finds no keys to try, rather than wrong ones.
    const { secretAccessKey: _, ...rest } = bucket;
    expect(JSON.parse(stored())).toEqual({ ...rest, encryption: { id: bucket.encryption!.id }, inKeychain: true });
    expect(JSON.parse(keychain.items.get("sync")!)).toEqual({ secretAccessKey: SECRET, encryption: bucket.encryption!.key });
    await sync.load();
    expect(sync.config).toEqual(bucket);
  });

  test("a cloud drive folder's encryption key moves there too", async () => {
    const folder = { kind: "folder", provider: "icloud", name: "iCloud Drive", path: "/drive/lines", encryption: bucket.encryption } as const;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(folder));
    await sync.load();
    expect([sync.config, JSON.parse(stored()).encryption, JSON.parse(keychain.items.get("sync")!)]).toEqual([folder, { id: "library" }, { encryption: bucket.encryption!.key }]);
  });

  test("where the keychain won't take them, they stay where they were", async () => {
    keychain.refusing = true;
    await sync.load();
    expect([sync.config, JSON.parse(stored())]).toEqual([bucket, bucket]);
  });

  test("without a keychain, as on the web, nothing changes", async () => {
    keychain.there = false;
    await sync.load();
    expect([sync.config, JSON.parse(stored()), keychain.items.size]).toEqual([bucket, bucket, 0]);
  });

  test("where the keychain can't be read for now, the connection isn't used without them, and they're kept", async () => {
    await sync.load();
    const kept = [stored(), keychain.items.get("sync")];
    keychain.refusing = true;
    await sync.load();
    expect(sync.config).toBeNull();
    keychain.refusing = false;
    expect([stored(), keychain.items.get("sync")]).toEqual(kept);
    await sync.load();
    expect(sync.config).toEqual(bucket);
  });

  test("gone from the keychain, the connection comes without them: the bucket asks for its key, and the notes for their passphrase", async () => {
    await sync.load();
    keychain.items.clear();
    await sync.load();
    expect(sync.config).toEqual({ ...bucket, secretAccessKey: "", encryption: undefined });
  });

  test("disconnecting takes them out of the keychain", async () => {
    await sync.load();
    await sync.configure(null);
    expect([stored(), keychain.items.size]).toEqual(["", 0]);
  });
});
