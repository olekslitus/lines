import { type ImportWork, imports, type NewLibraryNote, newLibraryNote } from "../imports/imports.svelte";
import { readSecret, writeSecret } from "../lock/vault";
import { propertyOf, setProperties } from "../notes/properties";
import { type Entry, isClosed, notes } from "../notes/store.svelte";
import { plugins } from "../plugins/registry.svelte";
import type { ListAccount, ListEntry, ListSite } from "../plugins/types";
import { prefs } from "../prefs.svelte";
import { sync } from "../sync/engine.svelte";
import { type Exchanged, fromSite, type Held, ListError, type Said, settle, toSite } from "./lists";
import { OVERALL, ratings } from "./ratings.svelte";
import { libraryNoteOf } from "./same";

/*
 * Lists on other sites (AniList's, MyAnimeList's: plugins' `lists`), kept in step with the Library's
 * notes of their kind once you've signed in, in the main window: at start, as often as feeds are
 * fetched (Settings → Library), and a moment after a note's status, rating or progress changes here.
 * Each pass reads the whole list, settles each entry against its note (lists.ts: whichever side
 * changed since they were last alike, the later where both did), puts on the list what the Library
 * has of its kind that it hasn't, and makes notes of what's been put on it since you signed in.
 * Your list's older entries come in by importing it (Settings, through imports/imports.svelte.ts).
 *
 * The account and what was last exchanged for each entry are this device's, never synced (a token
 * is a device's own): each device signed in compares with what it last exchanged, and a change one
 * makes reaches the others through the site and through the notes alike, so they agree rather than
 * fight. Nothing here is logged but a site's name and how it answered.
 */

const KEY = "lines.lists";
/** How long after a note's status, rating or progress changes its list is asked. */
const SOON = 5_000;

/** What went wrong at the last pass: the token wasn't taken (sign in again), the site said to wait (until, ms), it answered something else, or couldn't be reached. */
export interface Problem {
  reason: ListError["reason"];
  until?: number;
}

/** What was last exchanged for an entry, and with which note (`id`): one locked shut or in the Trash is still its note. */
type Last = Exchanged & { id?: string };

/**
 * A signed-in site as kept: its account, what was last exchanged for each entry (by its id there),
 * the entries taken off the list there (what their notes said then, which they're not put back on it
 * for), and since when what's put on the list becomes a note.
 */
interface Kept {
  account: ListAccount;
  records: Record<string, Last>;
  removed?: Record<string, Said>;
  since: number;
  synced?: number;
  problem?: Problem;
}

/** How a site's list is doing, as Settings shows it: who's signed in, and when it was last in step or what went wrong. */
export interface ListState {
  name: string;
  busy: boolean;
  synced?: number;
  problem?: Problem;
}

/** A note's status, rating and progress, as written. */
function saidOf({ meta }: Entry): Said {
  const value = (key: string) => propertyOf(meta.properties, key)?.value.trim() || undefined;
  return { status: value("status"), rating: value(OVERALL), progress: value("progress") };
}

const heldOf = ({ status, score, progress }: Held): Held => ({ status, score, progress });

/** What of `wanted` differs from what the site has: all that's sent, so what isn't changed stays as it is there. */
const changeOf = (has: Held, wanted: Held): Partial<Held> => Object.fromEntries(Object.entries(wanted).filter(([key, value]) => has[key as keyof Held] !== value));

/** Whether a note still says what it said when its entry was taken off the list. */
const alike = (a: Said, b: Said) => a.status === b.status && a.rating === b.rating && a.progress === b.progress;

/** An entry's ids, as its kind's notes keep them: `anilist:154587`, and another site's it knows. */
const idsOf = (site: ListSite, entry: ListEntry) => [`${site.key}:${entry.id}`, ...Object.entries(entry.ids ?? {}).map(([key, id]) => `${key}:${id}`)];

/**
 * The notes of a site's kind there are to keep in step (not trashed, nor locked shut), by their id
 * there; and the ids the kind's notes in the Trash have (`mal:52991`), which an entry isn't made a note
 * of again, nor kept in step with.
 */
function notesOf(site: ListSite) {
  const byId = new Map<number, Entry>();
  const trashed = new Set<string>();
  const keys = plugins.libraryKind(site.kind)?.ids ?? [site.key];
  for (const entry of notes.entries) {
    if (entry.meta.type !== site.kind || isClosed(entry.note)) continue;
    if (entry.note.trashed) {
      for (const key of keys) {
        const value = propertyOf(entry.meta.properties, key)?.value.trim();
        if (value) trashed.add(`${key}:${value}`);
      }
      continue;
    }
    const id = Number(propertyOf(entry.meta.properties, site.key)?.value);
    if (id > 0 && !byId.has(id)) byId.set(id, entry);
  }
  return { byId, trashed };
}

/** The note (same.ts) of an entry, that hasn't its id there yet: by another site's id it knows (AniList knows MyAnimeList's), or by its link. */
function findNote(site: ListSite, entry: ListEntry): Entry | undefined {
  const ids = Object.entries(entry.ids ?? {}).map(([key, id]): [string, string] => [key, String(id)]);
  const found = libraryNoteOf({ type: site.kind, link: entry.item.link, properties: [...ids, ...entry.item.properties] });
  if (!found || found.meta.type !== site.kind || isClosed(found.note)) return undefined;
  return Number(propertyOf(found.meta.properties, site.key)?.value) > 0 ? undefined : found;
}

/** The note an entry becomes: what it is, its id, and its status, rating and progress, as the list has them. */
function newNoteOf(site: ListSite, entry: ListEntry): NewLibraryNote {
  const rating = fromSite(entry.score, ratings.scaleOf(site.kind), site.scale);
  const known = new Set(entry.item.properties.map(([key]) => key));
  const properties: [string, string][] = [
    ...entry.item.properties,
    ...(known.has(site.key) ? [] : [[site.key, String(entry.id)] as [string, string]]),
    ...(rating ? [[OVERALL, rating] as [string, string]] : []),
    ...(entry.progress ? [["progress", String(entry.progress)] as [string, string]] : []),
  ];
  return { item: { ...entry.item, properties }, status: entry.status, updated: entry.updated || undefined };
}

class Lists {
  /** Each signed-in site's, by its id; shared with the Settings window (windows/settings.svelte.ts). */
  state = $state<Record<string, ListState>>({});
  #kept: Record<string, Kept> = {};
  #running = new Map<string, Promise<void>>();
  /** The pass to run after the one running, by site, and the sites someone asked of meanwhile (Sync Now). */
  #next = new Map<string, Promise<void>>();
  #asked = new Set<string>();
  /** Each kept note's status, rating and progress as last seen, and when they last changed here: what's settled, and which side's later. */
  #seen = new Map<string, string>();
  #touched = new Map<string, number>();
  #soon: ReturnType<typeof setTimeout> | undefined;

  /** The site of `id`, while its plugin's on. */
  site(id: string): ListSite | undefined {
    return plugins.lists.find((site) => site.id === id);
  }

  async load() {
    this.#kept = (await readSecret<Record<string, Kept>>(KEY)) ?? {};
    this.#show();
  }

  /** Kept again, encrypted or not as the app lock now says (lock.svelte.ts). */
  async rewrite() {
    await writeSecret(KEY, this.#kept);
  }

  async #save() {
    await writeSecret(KEY, this.#kept);
    this.#show();
  }

  #show() {
    this.state = Object.fromEntries(
      Object.entries(this.#kept).map(([id, kept]) => [id, { name: kept.account.name, busy: this.#running.has(id), synced: kept.synced, problem: kept.problem }]),
    );
  }

  /** Signed in (Settings asks it of the main window): keeps the account, and starts keeping its list in step. */
  async signIn(id: string, account: ListAccount) {
    const was = this.#kept[id];
    // Signed in again as the same person (the token ran out), what was exchanged still holds.
    const same = was && was.account.name === account.name;
    this.#kept[id] = { account, records: same ? was.records : {}, since: same ? was.since : Date.now() };
    await this.#save();
    void this.sync(id);
  }

  /** Forgets the account, and what was exchanged with it. The notes stay as they are. */
  async signOut(id: string) {
    delete this.#kept[id];
    await this.#save();
  }

  /** Everything on a site's list, asked with the account kept (Settings, to say what importing it would do). */
  async entries(id: string): Promise<ListEntry[]> {
    const site = this.site(id);
    const kept = this.#kept[id];
    if (!site || !kept) return [];
    try {
      return await site.entries(kept.account, new AbortController().signal);
    } finally {
      // A token the site refreshed as it was asked.
      await this.#save();
    }
  }

  /** Keeps every signed-in list in step now (Settings' Sync Now), even one whose site said to wait. */
  async syncNow() {
    await this.#syncAll(true);
  }

  #syncAll(asked: boolean) {
    return Promise.all(Object.keys(this.#kept).map((id) => this.sync(id, asked)));
  }

  /**
   * In the main window, once notes are loaded: each list in step once sync's first pass is done
   * (`synced`, which brings in what other devices made of the lists), as often as feeds are fetched,
   * and soon after a change here.
   */
  async start(synced: Promise<void>) {
    await this.load();
    this.#notice();
    notes.onLocalChange(() => this.#notice());
    $effect.root(() => {
      $effect(() => {
        const minutes = prefs.feedRefresh;
        if (!minutes) return;
        const timer = setInterval(() => void this.#syncAll(false), minutes * 60_000);
        return () => clearInterval(timer);
      });
    });
    await synced;
    await this.#syncAll(false);
  }

  /** Notes kept in step whose status, rating or progress changed here: their lists are asked in a moment. */
  #notice() {
    const now = Date.now();
    let changed = false;
    for (const id of Object.keys(this.#kept)) {
      const site = this.site(id);
      if (!site) continue;
      for (const entry of notesOf(site).byId.values()) {
        const said = JSON.stringify(saidOf(entry));
        const was = this.#seen.get(entry.note.id);
        this.#seen.set(entry.note.id, said);
        if (was === undefined || was === said) continue;
        this.#touched.set(entry.note.id, now);
        changed = true;
      }
    }
    if (!changed) return;
    clearTimeout(this.#soon);
    this.#soon = setTimeout(() => void this.#syncAll(false), SOON);
  }

  /**
   * Keeps one list in step, one pass at a time: asked while one's running, the next, which starts
   * after it, and is shared by whatever asks meanwhile. `asked`: now, even if the site said to wait.
   */
  sync(id: string, asked = false): Promise<void> {
    const running = this.#running.get(id);
    if (running) {
      if (asked) this.#asked.add(id);
      let next = this.#next.get(id);
      if (!next) {
        next = running.then(() => {
          this.#next.delete(id);
          return this.sync(id, this.#asked.delete(id));
        });
        this.#next.set(id, next);
      }
      return next;
    }
    const pass = this.#pass(id, asked).finally(() => {
      this.#running.delete(id);
      this.#show();
    });
    this.#running.set(id, pass);
    this.#show();
    return pass;
  }

  async #pass(id: string, asked: boolean) {
    const site = this.site(id);
    const kept = this.#kept[id];
    if (!site || !kept || site.unavailable || kept.problem?.reason === "token") return;
    if (!asked && kept.problem?.until && kept.problem.until > Date.now()) return;
    const signal = new AbortController().signal;
    const scales = { scale: ratings.scaleOf(site.kind), site: site.scale };
    try {
      const entries = await site.entries(kept.account, signal);
      const { byId, trashed } = notesOf(site);
      const onList = new Set<number>();
      const made: ListEntry[] = [];
      // Not before lines' own sync has brought in this session what other devices made, nor while the
      // list's import is making notes of it: either way a note would be made twice.
      const making = (!sync.config || sync.lastSynced !== null) && !(imports.state?.id === id && imports.state.kind === "importing");
      for (const entry of entries) {
        onList.add(entry.id);
        if (kept.removed) delete kept.removed[entry.id];
        const note = this.#noteOf(site, kept, entry, byId, trashed);
        if (note === "kept") continue;
        if (note) await this.#settle(site, kept, note, entry, scales, signal);
        else if (making && entry.updated > kept.since) made.push(entry);
      }
      // What the Library has of its kind that isn't on the list: put on it, unless it was and was taken
      // off there, which the note outlives, until its status, rating or progress changes here.
      for (const [entryId, note] of byId) {
        if (onList.has(entryId)) continue;
        const said = saidOf(note);
        if (kept.records[entryId]) {
          delete kept.records[entryId];
          (kept.removed ??= {})[entryId] = said;
          continue;
        }
        const removed = kept.removed?.[entryId];
        if (removed && alike(removed, said)) continue;
        if (kept.removed) delete kept.removed[entryId];
        const saved = await site.save(kept.account, { id: entryId, status: said.status ?? null, score: toSite(said.rating, scales.scale, scales.site), progress: Number(said.progress) || 0 }, signal);
        kept.records[entryId] = { note: said, site: heldOf(saved), id: note.note.id };
      }
      for (const entry of made) await this.#make(site, kept, entry, signal);
      kept.synced = Date.now();
      delete kept.problem;
    } catch (error) {
      if (error instanceof ListError) {
        console.warn(`lines: ${site.name} answered`, error.message);
        kept.problem = { reason: error.reason, ...(error.until && { until: error.until }) };
      } else {
        console.warn(`lines: couldn't reach ${site.name}`, error instanceof Error ? error.name : "");
        kept.problem = { reason: "offline" };
      }
    } finally {
      // What was exchanged is kept however far it got, and a token the site refreshed with it.
      await this.#save();
    }
  }

  /**
   * The note of an entry: by its id there; or the note it was last exchanged with, which is left as it
   * is (`kept`) while it's locked shut or in the Trash, as one in the Trash with its ids is; or one of
   * the same thing (same.ts), which takes its id there. None, if the Library hasn't one in any state.
   */
  #noteOf(site: ListSite, kept: Kept, entry: ListEntry, byId: Map<number, Entry>, trashed: Set<string>): Entry | "kept" | undefined {
    const found = byId.get(entry.id);
    if (found) return found;
    const recorded = kept.records[entry.id]?.id;
    const was = recorded ? notes.get(recorded) : undefined;
    if (was && (was.note.trashed || isClosed(was.note))) return "kept";
    if (idsOf(site, entry).some((each) => trashed.has(each))) return "kept";
    const same = was?.meta.type === site.kind ? was : findNote(site, entry);
    if (same) this.#write(same, { [site.key]: String(entry.id) });
    return same;
  }

  /** Makes an entry and its note alike, whichever way each of its status, rating and progress goes, and keeps what they are now. */
  async #settle(site: ListSite, kept: Kept, note: Entry, entry: ListEntry, scales: Parameters<typeof settle>[3], signal: AbortSignal) {
    const said = saidOf(note);
    const times = { note: Math.max(note.note.updatedAt, this.#touched.get(note.note.id) ?? 0), site: entry.updated };
    const settled = settle({ note: said, site: heldOf(entry) }, kept.records[entry.id], times, scales);
    const change = settled.site && changeOf(heldOf(entry), settled.site);
    const held = change ? heldOf(await site.save(kept.account, { id: entry.id, ...change }, signal)) : heldOf(entry);
    const changes = Object.entries(settled.note);
    if (changes.length) {
      this.#write(note, Object.fromEntries(changes.map(([key, value]) => [key === "rating" ? OVERALL : key, value])));
    }
    const now: Said = { ...said };
    for (const [key, value] of changes) now[key as keyof Said] = value ?? undefined;
    kept.records[entry.id] = { note: now, site: held, id: note.note.id };
    this.#seen.set(note.note.id, JSON.stringify(now));
  }

  /** Writes properties into a note kept in step, as the list says them: done by lines, not by hand, so it keeps its date and ⌘Z stays with what you did. */
  #write(note: Entry, changes: Record<string, string | null>) {
    notes.setText(note.note.id, (body) => setProperties(body, changes), { keepDate: true });
  }

  /** A note of something put on the list since you signed in. */
  async #make(site: ListSite, kept: Kept, entry: ListEntry, signal: AbortSignal) {
    const { note, keep } = await newLibraryNote(newNoteOf(site, entry), entry.updated || Date.now(), signal);
    await notes.insert(note);
    await keep();
    const made = notes.get(note.id);
    if (made) kept.records[entry.id] = { note: saidOf(made), site: heldOf(entry), id: note.id };
  }

  /**
   * What importing a site's list writes (its plugin's import, through imports/imports.svelte.ts): a note of each
   * entry the Library hasn't got, by its id there, another site's it knows, or its link. What's
   * there already is kept in step at the next pass.
   */
  work(id: string, entries: ListEntry[]): ImportWork {
    const site = this.site(id);
    const kept = this.#kept[id];
    if (!site || !kept) return { add: [], append: [] };
    const add = entries.filter((entry) => !this.#there(site, kept, entry, notesOf(site))).map((entry) => newNoteOf(site, entry));
    return { add, append: [] };
  }

  /** How many of `entries` the Library has a note of already (Settings says, before importing). */
  there(id: string, entries: ListEntry[]): number {
    const site = this.site(id);
    const kept = this.#kept[id];
    if (!site || !kept) return 0;
    const found = notesOf(site);
    return entries.filter((entry) => this.#there(site, kept, entry, found)).length;
  }

  /** Whether the Library has a note of an entry, in any state: in the Trash or locked shut too. */
  #there(site: ListSite, kept: Kept, entry: ListEntry, { byId, trashed }: ReturnType<typeof notesOf>) {
    const recorded = kept.records[entry.id]?.id;
    return byId.has(entry.id) || (!!recorded && !!notes.get(recorded)) || idsOf(site, entry).some((each) => trashed.has(each)) || !!findNote(site, entry);
  }
}

export const lists = new Lists();
