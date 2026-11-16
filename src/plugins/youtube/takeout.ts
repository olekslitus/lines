import { parseCsv } from "../../lib/sheets/csv";
import { VIDEO_ID } from "./data";

/*
 * A YouTube playlist as Google Takeout gives it (YouTube and YouTube Music → playlists →
 * `Watch later-videos.csv`, `<name>-videos.csv`): Watch Later's only way out, which YouTube's pages
 * and API keep to its owner. Its videos by their ids and when each was added, in either of the two
 * shapes Takeout has written: a header of its own (`Video ID,Playlist Video Creation Timestamp`),
 * or the playlist's details first and then its videos (`Video Id,Time Added`).
 */

/** A playlist from Takeout: its name where the file says it, and its videos, the latest added first. */
export interface TakeoutPlaylist {
  title?: string;
  videos: { id: string; added?: number }[];
}

const key = (cell: string) => cell.trim().toLowerCase().replace(/\s+/g, " ");
const isVideoHeader = (row: string[]) => row.some((cell) => key(cell) === "video id");

/** Whether a file's start is a Takeout playlist's: a header naming its videos' ids, among its first lines. */
export function isTakeoutPlaylist(start: string): boolean {
  return parseCsv(start.split(/\r?\n/).slice(0, 12).join("\n")).some(isVideoHeader);
}

/** When a video was added, as Takeout writes it: `2024-01-15T10:20:30+00:00`, or `2023-01-15 10:20:30 UTC`. */
function addedAt(cell: string | undefined): number | undefined {
  const written = cell?.trim().replace(/^(\d{4}-\d\d-\d\d) (\d)/, "$1T$2").replace(/\s*UTC$/, "Z");
  const time = written ? Date.parse(written) : NaN;
  return Number.isFinite(time) ? time : undefined;
}

/** A Takeout playlist file's videos, and its name: the file's details' title, or else its file name's (`Watch later-videos.csv`). */
export function readTakeout(text: string, fileName = ""): TakeoutPlaylist {
  const rows = parseCsv(text);
  const header = rows.findIndex(isVideoHeader);
  if (header < 0) throw new Error("not a playlist from Google Takeout");
  const columns = rows[header].map(key);
  const idAt = columns.indexOf("video id");
  const addedAtColumn = columns.findIndex((column) => /time added|creation timestamp|added/.test(column));
  // The older shape's details, above its videos: a row of keys, and the playlist's under it.
  const isTitle = (column: string) => column === "title" || column.startsWith("playlist title");
  const details = rows.slice(0, header).findIndex((row) => row.map(key).some(isTitle));
  const titleAt = details >= 0 ? rows[details].map(key).findIndex(isTitle) : -1;
  const title = (titleAt >= 0 ? rows[details + 1]?.[titleAt]?.trim() : undefined) || /^(.+?)-videos\.csv$/i.exec(fileName)?.[1]?.trim() || undefined;
  const seen = new Set<string>();
  const videos = rows
    .slice(header + 1)
    .map((row) => ({ id: row[idAt]?.trim() ?? "", added: addedAt(row[addedAtColumn]) }))
    // Each once, however often a file lists it.
    .filter(({ id }) => VIDEO_ID.test(id) && !seen.has(id) && !!seen.add(id));
  return { title, videos: videos.sort((a, b) => (b.added ?? 0) - (a.added ?? 0)) };
}
