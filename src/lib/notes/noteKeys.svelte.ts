import {
  aesKey,
  fromBase64,
  fromUtf8,
  hmac,
  isLockedKey,
  lockKey,
  open,
  randomBytes,
  seal,
  subkey,
  toBase64,
  unlockKey,
  Unreadable,
  utf8,
  WrongPassphrase,
  type Bytes,
} from "../crypto";
import { t } from "../i18n/index.svelte";
import { plugins } from "../plugins/registry.svelte";
import { referencedAttachments } from "./attachments";
import type { Note, NoteLock, WrappedKey } from "./types";

/*
 * Keys for locked notes. A locked note's Markdown is encrypted with a random key, and the note
 * carries that key locked with the password (see `NoteLock`), so it opens on any device where
 * the password is typed, synced or not, encrypted sync or not. Notes locked with one password
 * share one key; changing the password locks that same key again, in every note that has it.
 *
 * Copies of a key come in with synced notes, so anyone who can write to where notes sync could put
 * a bad one among them. None is taken on trust: a copy is used once the password opens it, or once
 * the key itself vouches for it (`WrappedKey.check`); one that holds another key than the one this
 * device has by that id is refused; and this device's own copy is only ever given up for a newer one
 * that holds the same key.
 *
 * Keys only live in memory, and only while locked notes are open (see locked.svelte.ts).
 */

const SETTINGS = "lines.lockedNotes";
/** Authenticated with every locked note, so nothing else encrypted with the key passes for one. */
const CONTEXT = "lines locked note";
/** What a key's check of its copies is made for, so the key is used for nothing else that way. */
const CHECK = "lines locked note key copy";

/** This device's password for locked notes: the key it locks notes with. */
export interface NotesPassword {
  key: WrappedKey;
  /** Touch ID opens locked notes too (the Mac app). */
  touchId: boolean;
}

export function isWrappedKey(value: unknown): value is WrappedKey {
  const v = value as WrappedKey | null;
  return isLockedKey(v) && typeof v.id === "string" && typeof v.changed === "number" && (v.check === undefined || typeof v.check === "string");
}

async function checkOf(raw: Bytes, copy: WrappedKey) {
  const key = await subkey(raw, CHECK, "HMAC");
  return toBase64(await hmac(key, JSON.stringify([copy.id, copy.changed, copy.kdf, copy.iterations, copy.salt, copy.key])));
}

/** Whether `copy` was made by someone who had the key `raw`. */
const vouches = async (raw: Bytes, copy: WrappedKey) => !!copy.check && copy.check === (await checkOf(raw, copy));

const signed = async (raw: Bytes, copy: WrappedKey): Promise<WrappedKey> => ({ ...copy, check: await checkOf(raw, copy) });

/** A new copy of a key, locked with `password`, that the key vouches for. */
export async function keyCopy(raw: Bytes, id: string, password: string): Promise<WrappedKey> {
  return signed(raw, { id, changed: Date.now(), ...(await lockKey(raw, password)) });
}

const sameCopy = (a: WrappedKey, b: WrappedKey) => a.salt === b.salt && a.key === b.key && a.changed === b.changed && a.check === b.check;

const sameBytes = (a: Bytes, b: Bytes) => a.length === b.length && a.every((byte, i) => byte === b[i]);

function read(): NotesPassword | null {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS) ?? "null");
    return isWrappedKey(settings?.key) ? { touchId: false, ...settings } : null;
  } catch {
    return null;
  }
}

/** An open key, and the newest copy of it known to hold it, which notes are sealed with. */
interface OpenKey {
  key: CryptoKey;
  raw: Bytes;
  copy: WrappedKey;
}

class NoteKeys {
  settings = $state.raw<NotesPassword | null>(read());
  /** Bumped as keys open and close. */
  revision = $state(0);
  #open = new Map<string, OpenKey>();
  /** Every copy of each key seen in notes: from this device, another one, or someone else. */
  #seen = new Map<string, WrappedKey[]>();

  isOpen(id: string) {
    void this.revision;
    return this.#open.has(id);
  }

  get anyOpen() {
    void this.revision;
    return this.#open.size > 0;
  }

  /** Whether this device's own key is open, so notes can be locked right away. */
  get ready() {
    return !!this.settings && this.isOpen(this.settings.key.id);
  }

  /** Whether there's a password to ask for: this device's, or one notes synced here were locked with. */
  get known() {
    void this.revision;
    return !!this.settings || this.#seen.size > 0;
  }

  save(settings: NotesPassword | null) {
    this.settings = settings;
    if (settings) localStorage.setItem(SETTINGS, JSON.stringify(settings));
    else localStorage.removeItem(SETTINGS);
  }

  /** Keeps track of a locked note's copy of its key, which may be a password changed on another device. */
  notice(note: Note) {
    const copy = note.locked?.key;
    if (!copy) return;
    const copies = this.#seen.get(copy.id) ?? [];
    if (copies.some((seen) => sameCopy(seen, copy))) return;
    this.#seen.set(copy.id, [...copies, copy]);
    if (!copies.length) this.revision++;
    void this.#vouch(copy.id);
  }

  /** Opens a key with a copy known to hold it: this device's own, or another window's. */
  async add(raw: Bytes, copy: WrappedKey) {
    this.#open.set(copy.id, { key: await aesKey(raw), raw, copy });
    this.revision++;
    await this.#vouch(copy.id);
  }

  clear() {
    if (!this.#open.size) return;
    for (const { raw } of this.#open.values()) raw.fill(0);
    this.#open.clear();
    this.revision++;
  }

  raw(id: string) {
    return this.#open.get(id)?.raw;
  }

  /** The open keys, to hand to the app's other windows. */
  shared() {
    return [...this.#open.values()].map(({ raw, copy }) => ({ raw: toBase64(raw), copy }));
  }

  /** Opens every key the password opens; the ids it opened. */
  async unlock(password: string): Promise<string[]> {
    const ids = new Set([...(this.settings ? [this.settings.key.id] : []), ...this.#seen.keys()]);
    const opened: string[] = [];
    for (const id of ids) {
      if (!this.#open.has(id) && (await this.openWith(id, password))) opened.push(id);
    }
    // A device without a password of its own takes the one it was just given, for notes it locks.
    if (!this.settings && opened.length) {
      const newest = opened.map((id) => this.#open.get(id)!.copy).sort((a, b) => b.changed - a.changed)[0];
      this.save({ key: newest, touchId: false });
    }
    return opened;
  }

  /**
   * Whether the password opens the key, with a copy of it that holds the key this device has by
   * that id (open, or vouched for by its own copy). The key is open afterwards.
   */
  async openWith(id: string, password: string): Promise<boolean> {
    const known = this.#open.get(id)?.raw;
    const own = this.settings?.key.id === id ? this.settings.key : undefined;
    for (const copy of this.#copies(id)) {
      let raw: Bytes;
      try {
        raw = await unlockKey(copy, password);
      } catch (error) {
        // Another password's, or a key this version of lines can't open: other copies may still open.
        if (error instanceof WrongPassphrase || error instanceof Unreadable) continue;
        throw error;
      }
      const holds = known
        ? sameBytes(raw, known)
        : (!own?.check || (await vouches(raw, own))) && (!copy.check || (await vouches(raw, copy)));
      if (!holds) {
        raw.fill(0);
        this.#refuse(copy);
        continue;
      }
      if (known) raw.fill(0);
      else await this.add(raw, copy);
      return true;
    }
    return false;
  }

  /** A new key, locked with `password`, and open. */
  async create(password: string): Promise<{ raw: Bytes; key: WrappedKey }> {
    const raw = randomBytes(32);
    const key = await keyCopy(raw, crypto.randomUUID(), password);
    await this.add(raw, key);
    return { raw: raw.slice(), key };
  }

  /** Locks an open key with a new password. */
  async rewrap(id: string, password: string): Promise<WrappedKey> {
    const open = this.#open.get(id);
    if (!open) throw new Error(t("lock.notes.notOpen"));
    open.copy = await keyCopy(open.raw, id, password);
    return open.copy;
  }

  /** Encrypts an open note's Markdown, and what the list shows of it. */
  async seal(note: Note): Promise<NoteLock> {
    const lock = note.locked!;
    const open = this.#open.get(lock.key.id);
    if (!open) throw new Error(t("lock.notes.notOpen"));
    return {
      ...lock,
      key: open.copy,
      title: plugins.meta(note.format, note.body).title,
      files: [...referencedAttachments([note.body])],
      sealed: toBase64(await seal(open.key, utf8(note.body), CONTEXT)),
    };
  }

  /** A locked note's Markdown, if its key is open. */
  async open(lock: NoteLock): Promise<string | null> {
    const open = this.#open.get(lock.key.id);
    if (!open || !lock.sealed) return null;
    return fromUtf8(await openSealed(open.key, lock.sealed));
  }

  /** The copies of a key to try, newest first: this device's own, and those seen since that are newer (a password changed elsewhere). */
  #copies(id: string): WrappedKey[] {
    const own = this.settings?.key.id === id ? this.settings.key : undefined;
    const seen = (this.#seen.get(id) ?? []).filter((copy) => !own || copy.changed > own.changed);
    return [...(own ? [own] : []), ...seen].sort((a, b) => b.changed - a.changed);
  }

  /**
   * With a key open: takes the newest copy of it the key vouches for (a password changed on another
   * device), refuses copies that say they're the key's but aren't, and has the key vouch for the
   * copy notes are sealed with, if it doesn't yet (one made before copies were checked).
   */
  async #vouch(id: string) {
    const open = this.#open.get(id);
    if (!open) return;
    for (const copy of this.#seen.get(id) ?? []) {
      if (!copy.check || sameCopy(copy, open.copy)) continue;
      if (!(await vouches(open.raw, copy))) this.#refuse(copy);
      else if (copy.changed > open.copy.changed) open.copy = copy;
    }
    if (!open.copy.check) open.copy = await signed(open.raw, open.copy);
    const own = this.settings;
    if (own?.key.id === id && open.copy.changed >= own.key.changed && !sameCopy(own.key, open.copy)) this.save({ ...own, key: open.copy });
  }

  /** Forgets a copy of a key that doesn't hold it: put among the notes by someone else. */
  #refuse(copy: WrappedKey) {
    console.warn(`lines: refused a copy of locked notes' key ${copy.id} that doesn't hold that key`);
    this.#seen.set(
      copy.id,
      (this.#seen.get(copy.id) ?? []).filter((seen) => !sameCopy(seen, copy)),
    );
  }
}

const openSealed = (key: CryptoKey, sealed: string) => open(key, fromBase64(sealed), CONTEXT);

export const noteKeys = new NoteKeys();
