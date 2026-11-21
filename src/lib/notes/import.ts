import { t } from "../i18n/index.svelte";
import { type Exported, exportedFrom, modifiedOf, TooBig } from "../imports/exported";
import { DEFAULT_LANGUAGE, plugins } from "../plugins/registry.svelte";
import { deserialize } from "../sync/format";
import { ATTACHMENT_PATH, saveAttachment } from "./attachments";
import type { Note } from "./types";

/*
 * Files made into notes (Settings → Export and Import → Import), each by the language its extension belongs
 * to: a Markdown file as a Markdown note, a CSV file or each sheet of an Excel workbook as a
 * spreadsheet note. A language reads a file its own way, or takes its text as it is. A note's own
 * file from a synced folder or bucket comes back as the note it is, by lines' header in it. A ZIP
 * of notes, as Export makes one (export.ts), brings them back with their pictures and files.
 */

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const languageFor = (extension: string) =>
  plugins.languages.find((language) => language.extensions.includes(extension) || language.opens?.includes(extension));

/** The extensions lines can make notes from, with the plugins on. */
export const importable = () => plugins.languages.flatMap((language) => [...language.extensions, ...(language.opens ?? [])]);

/** Where an export keeps the pictures and files its notes show, beside them. */
const ATTACHMENTS = "attachments/";
const isAttachment = (path: string) => path.startsWith(ATTACHMENTS) && !path.slice(ATTACHMENTS.length).includes("/");

/** An export's pictures and files as its notes link to them: from where (`folder`, as a note in it links), and those kept under another name. */
interface Linked {
  folder: string;
  renamed: Map<string, string>;
}

/**
 * The notes a file makes, by the language its extension belongs to; null if none reads it. From an
 * export, a note's links to its pictures and files are made the note's own again (`fromFile`).
 */
async function notesOf(name: string, data: Uint8Array<ArrayBuffer>, time: number, linked?: Linked): Promise<Note[] | null> {
  const language = languageFor(extensionOf(name));
  if (!language) return null;
  // With Windows line endings too, so a file's properties are read.
  const bodies = language.read ? await language.read({ name, data }) : [new TextDecoder().decode(data).replace(/\r\n?/g, "\n")];
  return bodies.map((text) => {
    let body = linked && !language.read ? (language.fromFile?.(text, linked.folder) ?? text) : text;
    for (const [was, kept] of linked?.renamed ?? []) body = body.replaceAll(ATTACHMENT_PATH + was, ATTACHMENT_PATH + kept);
    const note: Note = { id: crypto.randomUUID(), body, createdAt: time, updatedAt: time, pinned: false, trashed: false };
    const synced = !language.read && deserialize(body, note.id);
    if (synced && synced.id !== note.id) return synced;
    return language.id === DEFAULT_LANGUAGE ? note : { ...note, format: language.id };
  });
}

/**
 * The notes in an export: its pictures and files kept, from its `attachments` folder, and its notes'
 * links pointing at them again, as each note links to them from its folder; those in its Trash
 * folder in the Trash. Files no language reads, hidden ones aside, are `skipped`.
 */
async function notesOfExport({ files }: Exported, skipped: string[]): Promise<Note[]> {
  const renamed = new Map<string, string>();
  for (const file of files.filter((each) => isAttachment(each.path))) {
    const name = file.path.slice(ATTACHMENTS.length);
    const kept = await saveAttachment(await file.file());
    if (kept !== name) renamed.set(name, kept);
  }
  const trash = `${t("list.trashFolder")}/`;
  const notes: Note[] = [];
  for (const file of files.filter((each) => !isAttachment(each.path) && !nameOf(each.path).startsWith("."))) {
    const folder = `${"../".repeat(file.path.split("/").length - 1)}${ATTACHMENTS}`;
    const data = new Uint8Array(await (await file.file()).arrayBuffer());
    const made = await notesOf(nameOf(file.path), data, file.modified ?? Date.now(), { folder, renamed });
    if (!made) skipped.push(file.path);
    else notes.push(...(file.path.startsWith(trash) ? made.map((note) => ({ ...note, trashed: true })) : made));
  }
  return notes;
}

/**
 * Notes made from files, keeping the files' times; files no language reads are `skipped`. A ZIP is
 * an export's (above); one that can't be read is skipped, one too big to read here is `TooBig`, and
 * a file in it that would unpack to too much is `leftOut`.
 */
export async function notesFromFiles(files: File[]): Promise<{ notes: Note[]; skipped: string[]; leftOut: string[] }> {
  const notes: Note[] = [];
  const skipped: string[] = [];
  const leftOut: string[] = [];
  for (const file of files) {
    if (extensionOf(file.name) === "zip") {
      let exported: Exported;
      try {
        exported = await exportedFrom([file]);
      } catch (error) {
        if (error instanceof TooBig) throw error;
        skipped.push(file.name);
        continue;
      }
      notes.push(...(await notesOfExport(exported, skipped)));
      leftOut.push(...(exported.skipped ?? []));
      continue;
    }
    const made = await notesOf(file.name, new Uint8Array(await file.arrayBuffer()), modifiedOf(file) ?? Date.now());
    if (made) notes.push(...made);
    else skipped.push(file.name);
  }
  return { notes, skipped, leftOut };
}
