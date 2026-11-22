import { keychain } from "../keychain";
import { isFolder, type BucketConfig, type FolderConfig, type SyncConfig } from "./providers";
import type { LibraryKey } from "./sealed";

/*
 * The sync connection's keys, the bucket's secret key and the end-to-end encryption key, are kept in
 * the system's keychain where there is one (keychain.ts), and the rest of the connection where it
 * always was (engine.svelte.ts). Where there's none, or it won't take them, the keys stay with the
 * rest, as before.
 */

/**
 * A connection as saved: with its keys, or without them and `inKeychain`. Without them means
 * without the fields at all, so a Lines from before finds no bucket key and no encryption key to
 * use, rather than empty ones it would try.
 */
export type SavedConfig =
  | SyncConfig
  | ((Omit<BucketConfig, "secretAccessKey" | "encryption"> | Omit<FolderConfig, "encryption">) & {
      encryption?: Pick<LibraryKey, "id">;
      inKeychain: true;
    });

interface Keys {
  secretAccessKey?: string;
  encryption?: string;
}

const NAME = "sync";

/** The connection as it's saved: its keys in the keychain, where it takes them. */
export async function stashKeys(config: SyncConfig): Promise<SavedConfig> {
  if (!(await keychain.available())) return config;
  const { encryption, ...rest } = config;
  const keys: Keys = { encryption: encryption?.key };
  const saved = { ...rest, ...(encryption ? { encryption: { id: encryption.id } } : {}), inKeychain: true as const };
  if (!isFolder(config)) {
    keys.secretAccessKey = config.secretAccessKey;
    delete (saved as Partial<BucketConfig>).secretAccessKey;
  }
  const json = JSON.stringify(keys);
  try {
    await keychain.set(NAME, json);
    // Only left out of the rest once they're surely there.
    if ((await keychain.get(NAME)) !== json) throw new Error("the keychain gave back something else");
  } catch (error) {
    console.error("lines: couldn't keep the sync keys in the keychain", error);
    return config;
  }
  return saved;
}

/**
 * A saved connection, with its keys. One whose keys the keychain no longer has comes without them:
 * the bucket refuses it until they're entered again, and encrypted notes wait for the passphrase,
 * as on a new device. Throws if the keychain can't be read now, rather than give a connection
 * without keys that saving would then put in place of them.
 */
export async function withKeys(saved: SavedConfig): Promise<SyncConfig> {
  if (!("inKeychain" in saved)) return saved;
  const { inKeychain: _, encryption, ...config } = saved;
  const json = await keychain.get(NAME);
  const keys: Keys = json ? JSON.parse(json) : {};
  const library = encryption && keys.encryption ? { encryption: { id: encryption.id, key: keys.encryption } } : {};
  if (isFolder(config as SyncConfig)) return { ...(config as FolderConfig), ...library };
  return { ...(config as BucketConfig), secretAccessKey: keys.secretAccessKey ?? "", ...library };
}

/** Takes the keys out of the keychain, once the connection's gone. */
export async function forgetKeys() {
  if (await keychain.available()) await keychain.delete(NAME).catch((error: unknown) => console.error("lines: couldn't remove the sync keys from the keychain", error));
}
