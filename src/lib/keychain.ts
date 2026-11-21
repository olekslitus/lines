import { isTauri } from "./platform";

/*
 * Lines' own secrets in the system's keychain, in the apps that have one here (src-tauri/src/keychain.rs):
 * the Mac, iPhone and iPad, and Windows. The web app, and the Linux and Android apps for now, keep
 * them with the rest of their settings.
 */

let available: Promise<boolean> | undefined;

const invoke = async <T>(command: string, args?: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(command, args);

export const keychain = {
  available: () => (available ??= isTauri ? invoke<boolean>("keychain_available").catch(() => false) : Promise.resolve(false)),
  /** The secret kept as `name`, or null if none is. */
  get: (name: string) => invoke<string | null>("keychain_get", { name }),
  set: (name: string, value: string) => invoke<void>("keychain_set", { name, value }),
  delete: (name: string) => invoke<void>("keychain_delete", { name }),
};
