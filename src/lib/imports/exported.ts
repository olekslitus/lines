import { attachmentType } from "../notes/attachments";
import { UNPACKED, Unpacking, zipEntries } from "../zip";

/*
 * What another app exported, as chosen to import: a folder (an Obsidian vault), or a ZIP of one.
 * Its files are read only when asked for, so a vault of thousands of pictures is quick to look
 * through, and its text is only ever read as text.
 */

/** A file of an export: where it is in it, and what it holds, read when asked. */
export interface ExportedFile {
  /** Its path from the export's top, with `/`: `Projects/Plan.md`. */
  path: string;
  size: number;
  /** When it was last changed (ms), where the export says. */
  modified?: number;
  /** Its text, as UTF-8, with Unix line endings. */
  text(): Promise<string>;
  /** Itself, named and typed by its extension, to keep as an attachment. */
  file(): Promise<File>;
}

export interface Exported {
  /** What the export is called: the folder's name, or the ZIP's. */
  name: string;
  files: ExportedFile[];
  /** What's left out of it, by path: a ZIP that couldn't be read, or a file in one that would unpack to too much. */
  skipped?: string[];
}

/** A ZIP chosen that's too big to read here (`UNPACKED`): unpacked, its folder can be chosen. */
export class TooBig extends Error {}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A file's text as a note's is kept: without a byte order mark, and with Unix line endings. */
export const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

const typed = (blob: Blob, path: string) => new File([blob], nameOf(path), { type: attachmentType(path) });

/** ZIPs, by the names apps give theirs too: Bear's backups (.bear2bk), TextPacks (a TextBundle, zipped). */
const ZIP = /\.(?:zip|bear2bk|textpack)$/i;

/** A TextPack's files in the TextBundle it is, if they aren't in one already, so several don't run together. */
function bundled(name: string, files: ExportedFile[]) {
  if (!/\.textpack$/i.test(name) || files.every((file) => /^[^/]+\.textbundle\//i.test(file.path))) return files;
  const bundle = name.replace(/\.textpack$/i, ".textbundle");
  return files.map((file) => ({ ...file, path: `${bundle}/${file.path}` }));
}

/** A file as it was chosen, at `path` in the export. */
const chosenFile = (file: File, path: string): ExportedFile => ({
  path,
  size: file.size,
  modified: file.lastModified || undefined,
  text: async () => textOf(new Uint8Array(await file.arrayBuffer())),
  file: async () => typed(file, path),
});

/**
 * The files of the ZIP `name`, by their paths in it, but those that would unpack to too much
 * (`skipped`, with the ZIP if it can't be read at all). A ZIP of nothing but ZIPs (Notion splits a
 * large export so) is the files of those, unpacked in turn.
 */
async function unzipped(name: string, data: () => Promise<Uint8Array<ArrayBuffer>>, unpacking: Unpacking, skipped: string[]): Promise<ExportedFile[]> {
  let entries;
  try {
    entries = [...zipEntries(await data())].filter(([path]) => !path.startsWith("__MACOSX/"));
  } catch (error) {
    console.warn(`lines: couldn't read ${name}`, error);
    skipped.push(name);
    return [];
  }
  if (entries.length && entries.every(([path]) => ZIP.test(path))) {
    const parts: ExportedFile[] = [];
    for (const [path, entry] of entries) parts.push(...(await unzipped(path, () => entry.read(), unpacking, skipped)));
    return parts;
  }
  return entries.flatMap(([path, entry]): ExportedFile[] => {
    if (unpacking.allows(entry)) {
      return [{ path, size: entry.size, modified: entry.modified, text: async () => textOf(await entry.read()), file: async () => typed(new Blob([await entry.read()]), path) }];
    }
    skipped.push(path);
    return [];
  });
}

/** Files with the folder they all share, if they do, as their name and taken off their paths; or `name`. */
function rooted(name: string, files: ExportedFile[]): Exported {
  const top = files[0]?.path.split("/")[0];
  const shared = !!top && files.every((file) => file.path.startsWith(`${top}/`));
  return shared ? { name: top, files: files.map((file) => ({ ...file, path: file.path.slice(top.length + 1) })) } : { name, files };
}

/**
 * The export in the files chosen: a folder's (from a picker of folders, each file knowing its path
 * in it), whatever is in it, ZIPs too; or files chosen as they are, a ZIP unpacked. A folder of
 * nothing but ZIPs (Notion's large export, unpacked once) is an export's parts, which are unpacked
 * too. A folder they all share is its name. A ZIP that can't be read is left out and said so
 * (`skipped`), unless there's nothing else; one too big to read here is `TooBig`.
 */
export async function exportedFrom(chosen: File[]): Promise<Exported> {
  const folder = chosen.find((file) => file.webkitRelativePath)?.webkitRelativePath.split("/")[0];
  // Hidden files, as a Mac leaves in a folder (.DS_Store), aren't what it holds.
  const shown = chosen.filter((file) => !file.name.startsWith("."));
  if (folder !== undefined && !(shown.length && shown.every((file) => ZIP.test(file.name)))) {
    return rooted(folder, chosen.map((file) => chosenFile(file, file.webkitRelativePath)));
  }
  const unpacking = new Unpacking();
  const skipped: string[] = [];
  const files: ExportedFile[] = [];
  for (const file of folder === undefined ? chosen : shown) {
    if (!ZIP.test(file.name)) files.push(chosenFile(file, file.name));
    else if (file.size > UNPACKED) throw new TooBig(file.name);
    else files.push(...bundled(file.name, await unzipped(file.name, async () => new Uint8Array(await file.arrayBuffer()), unpacking, skipped)));
  }
  if (!files.length && skipped.length) throw new Error(`Nothing in ${skipped.join(", ")} could be read`);
  const zip = chosen.length === 1 && ZIP.test(chosen[0].name) ? chosen[0].name.replace(ZIP, "") : "";
  return { ...rooted(folder ?? (zip || (chosen[0]?.name ?? "")), files), ...(skipped.length && { skipped }) };
}
