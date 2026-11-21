import { keychain } from "../keychain";
import type { SyncConfig } from "./providers";

/*
 * The sync connection's keys, the bucket's secret key and the end-to-end encryption key, are kept in
 * the system's keychain where there is one (keychain.ts), and the rest of the connection where it
 * always was (engine.svelte.ts). Where there's none, or it won't take them, the keys stay with the
 * rest, as before.
 */

/** A connection as saved: with its keys, or without them and `inKeychain`. */
export type SavedConfig = SyncConfig & { inKeychain?: true };

interface Keys {
  secretAccessKey?: string;
  encryption?: string;
}

const NAME = "sync";

const keysOf = (config: SyncConfig): Keys => ({
  ...("secretAccessKey" in config ? { secretAccessKey: config.secretAccessKey } : {}),
  ...(config.encryption ? { encryption: config.encryption.key } : {}),
});

/** The connection as it's saved: its keys in the keychain, where it takes them. */
export async function stashKeys(config: SyncConfig): Promise<SavedConfig> {
  if (!(await keychain.available())) return config;
  const keys = JSON.stringify(keysOf(config));
  try {
    await keychain.set(NAME, keys);
    // Only left out of the rest once they're surely there.
    if ((await keychain.get(NAME)) !== keys) throw new Error("the keychain gave back something else");
  } catch (error) {
    console.error("lines: couldn't keep the sync keys in the keychain", error);
    return config;
  }
  const saved: SavedConfig = { ...config, inKeychain: true };
  if ("secretAccessKey" in saved) saved.secretAccessKey = "";
  if (saved.encryption) saved.encryption = { ...saved.encryption, key: "" };
  return saved;
}

/**
 * A saved connection, with its keys. One whose keys the keychain no longer has comes without them:
 * the bucket refuses it until they're entered again, and encrypted notes wait for the passphrase,
 * as on a new device. Throws if the keychain can't be read now, rather than give a connection
 * without keys that saving would then put in place of them.
 */
export async function withKeys(saved: SavedConfig): Promise<SyncConfig> {
  const { inKeychain, ...config } = saved;
  if (!inKeychain) return config;
  const json = await keychain.get(NAME);
  const keys: Keys = json ? JSON.parse(json) : {};
  if ("secretAccessKey" in config) config.secretAccessKey = keys.secretAccessKey ?? "";
  if (config.encryption && keys.encryption) config.encryption = { ...config.encryption, key: keys.encryption };
  else delete config.encryption;
  return config;
}

/** Takes the keys out of the keychain, once the connection's gone. */
export async function forgetKeys() {
  if (await keychain.available()) await keychain.delete(NAME).catch((error: unknown) => console.error("lines: couldn't remove the sync keys from the keychain", error));
}
