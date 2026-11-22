/**
 * A minimal ZIP writer: files are stored uncompressed, which keeps this tiny and is fine for
 * text (and images, which are compressed already). Names are UTF-8, and each file keeps its own
 * modification time. Past 65,535 files or 4 GB, ZIP64 holds the numbers ZIP's own fields can't.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, in local time, as ZIP stores them. */
function dosTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** What 32 bits, or 16, hold at most: in a ZIP, a sign that ZIP64 keeps the real number elsewhere. */
const FULL32 = 0xffffffff;
const FULL16 = 0xffff;

/** The version of ZIP a file needs to be read: 4.5 with ZIP64's numbers, 2.0 without. */
const versionFor = (zip64: boolean) => (zip64 ? 45 : 20);

/** ZIP64's extra field (0x0001): the numbers 32 bits can't hold, in the order ZIP gives them; nothing without any. */
function zip64Field(numbers: number[]) {
  if (!numbers.length) return new Uint8Array();
  const field = new DataView(new ArrayBuffer(4 + 8 * numbers.length));
  field.setUint16(0, 1, true);
  field.setUint16(2, 8 * numbers.length, true);
  numbers.forEach((number, i) => field.setBigUint64(4 + 8 * i, BigInt(number), true));
  return new Uint8Array(field.buffer);
}

export interface ZipEntry {
  name: string;
  /** Text (saved as UTF-8) or a file's bytes. */
  data: string | Uint8Array;
  modified: Date;
}

export function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(data);
    const { time, day } = dosTime(entry.modified);
    // A size or place 32 bits can't hold is in ZIP64's field; a local header gives both sizes there.
    const big = data.length >= FULL32;
    const far = offset >= FULL32;
    const size = big ? FULL32 : data.length;
    const localExtra = zip64Field(big ? [data.length, data.length] : []);
    const centralExtra = zip64Field([...(big ? [data.length, data.length] : []), ...(far ? [offset] : [])]);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); // local file header
    header.setUint16(4, versionFor(big), true); // version needed
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, time, true);
    header.setUint16(12, day, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, size, true);
    header.setUint32(22, size, true);
    header.setUint16(26, name.length, true);
    header.setUint16(28, localExtra.length, true);
    local.push(new Uint8Array(header.buffer), name, localExtra, data);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true); // central directory header
    record.setUint16(4, versionFor(big || far), true); // version made by
    record.setUint16(6, versionFor(big || far), true); // version needed
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, size, true);
    record.setUint32(24, size, true);
    record.setUint16(28, name.length, true);
    record.setUint16(30, centralExtra.length, true);
    record.setUint32(42, far ? FULL32 : offset, true);
    central.push(new Uint8Array(record.buffer), name, centralExtra);

    offset += 30 + name.length + localExtra.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  // Past what the end record's numbers hold, ZIP64's own end record has them, found by a locator just before it.
  const zip64 = entries.length >= FULL16 || centralSize >= FULL32 || offset >= FULL32;
  const zip64End = new DataView(new ArrayBuffer(zip64 ? 56 + 20 : 0));
  if (zip64) {
    zip64End.setUint32(0, 0x06064b50, true); // ZIP64 end of central directory
    zip64End.setBigUint64(4, 44n, true); // its size, after this
    zip64End.setUint16(12, versionFor(true), true); // version made by
    zip64End.setUint16(14, versionFor(true), true); // version needed
    zip64End.setBigUint64(24, BigInt(entries.length), true);
    zip64End.setBigUint64(32, BigInt(entries.length), true);
    zip64End.setBigUint64(40, BigInt(centralSize), true);
    zip64End.setBigUint64(48, BigInt(offset), true);
    zip64End.setUint32(56, 0x07064b50, true); // ZIP64 end of central directory locator
    zip64End.setBigUint64(64, BigInt(offset + centralSize), true);
    zip64End.setUint32(72, 1, true); // disks
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, Math.min(entries.length, FULL16), true);
  end.setUint16(10, Math.min(entries.length, FULL16), true);
  end.setUint32(12, Math.min(centralSize, FULL32), true);
  end.setUint32(16, Math.min(offset, FULL32), true);

  const parts = [...local, ...central, new Uint8Array(zip64End.buffer), new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A file in a ZIP: how big it is unpacked, and its bytes, inflated when asked for. */
export interface ZippedFile {
  /** Its size unpacked, as the ZIP says. */
  size: number;
  /** Its size as it's kept in the ZIP, packed. */
  packed: number;
  /** When it was last changed, as the ZIP says (ms; to two seconds, in local time, as ZIP keeps it). */
  modified: number;
  /** Its bytes; rejects for one bigger than the ZIP says it is, or than the limit. */
  read(): Promise<Uint8Array<ArrayBuffer>>;
}

/** The most a file in a ZIP is unpacked to, by default: many times any picture or chapter in a book. */
const LIMIT = 256 * 1024 * 1024;

/** A file in a ZIP that unpacks to more than it should: a damaged ZIP, or one made to fill memory. */
const tooBig = () => new Error("A file in the ZIP is bigger than it says");

/** Inflates `stored`, stopping as soon as it comes to more than `size` bytes. */
async function inflate(stored: Uint8Array<ArrayBuffer>, size: number): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  const reader = new Blob([stored]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    length += chunk.value.length;
    if (length > size) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(chunk.value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

/**
 * Where a ZIP's central directory (its list of files) starts, and how many files it says it has:
 * from its end record, which a comment of up to 64 KB can follow; or, past 65,535 files or 4 GB,
 * from ZIP64's record, which a locator just before the end record points to.
 */
function directoryOf(view: DataView) {
  let end = -1;
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP file");
  const locator = end - 20;
  if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
    const record = Number(view.getBigUint64(locator + 8, true));
    if (record + 56 <= view.byteLength && view.getUint32(record, true) === 0x06064b50) {
      const big = (at: number) => Number(view.getBigUint64(record + at, true));
      return { count: big(32), start: big(48), zip64: true };
    }
  }
  return { count: view.getUint16(end + 10, true), start: view.getUint32(end + 16, true), zip64: false };
}

/**
 * The files in a ZIP by name (folders left out), stored or deflated, as nearly every ZIP has them;
 * each inflated by the browser's own DecompressionStream only when it's read, to no more than the
 * size the ZIP gives it, nor `limit`. ZIP64 too, for more than 65,535 files; not encrypted files.
 * Every file in its central directory is listed, up to the record that ends it, however many it
 * says it has; or it's said to be damaged: some apps write a count past 65,535 without ZIP64, as
 * what's left over in 16 bits.
 */
export function zipEntries(data: Uint8Array<ArrayBuffer>, limit = LIMIT): Map<string, ZippedFile> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const directory = directoryOf(view);
  const names = new TextDecoder();
  const files = new Map<string, ZippedFile>();
  let listed = 0;
  let at = directory.start;
  for (; at + 46 <= data.length && view.getUint32(at, true) === 0x02014b50; listed++) {
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const day = view.getUint16(at + 14, true);
    let packed = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    let local = view.getUint32(at + 42, true);
    const name = names.decode(data.subarray(at + 46, at + 46 + nameLength));
    // ZIP64 keeps what doesn't fit 32 bits in an extra field of its own (0x0001), in this order.
    for (let field = at + 46 + nameLength, fields = field + extraLength; field + 4 <= fields; field += 4 + view.getUint16(field + 2, true)) {
      if (view.getUint16(field, true) !== 1) continue;
      let next = field + 4;
      const big = () => {
        const value = Number(view.getBigUint64(next, true));
        next += 8;
        return value;
      };
      if (size === FULL32) size = big();
      if (packed === FULL32) packed = big();
      if (local === FULL32) local = big();
      break;
    }
    at += 46 + nameLength + extraLength + view.getUint16(at + 32, true);
    if (name.endsWith("/") || (method !== 0 && method !== 8)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const stored = data.subarray(start, start + packed);
    files.set(name, {
      size,
      packed,
      modified: new Date((day >> 9) + 1980, ((day >> 5) & 15) - 1, day & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime(),
      async read() {
        if (size > limit || stored.length < packed || (method === 0 && packed !== size)) throw tooBig();
        return method === 0 ? stored : inflate(stored, size);
      },
    });
  }
  if (listed !== directory.count && (directory.zip64 || listed % (FULL16 + 1) !== directory.count)) throw new Error("A damaged ZIP file");
  return files;
}

/** The most the ZIPs of one thing chosen to import unpack to, all told, by default: about what a browser can hold at once. */
export const UNPACKED = 2 * 1024 ** 3;
/** How many times over a file bigger than `SMALL` can be packed: more is one made to fill memory, not a real file's. */
const RATIO = 100;
const SMALL = 1024 ** 2;

/**
 * What files from ZIPs chosen elsewhere may unpack to, so one made to fill memory (a little that
 * unpacks to gigabytes) is stopped by what it says of itself, before anything is unpacked: each
 * file is unpacked to no more than it says (`zipEntries`), so what they say is what they take.
 */
export class Unpacking {
  #left: number;

  constructor(total = UNPACKED) {
    this.#left = total;
  }

  /**
   * Whether `file` may be unpacked: no bigger than one can be, nor packed so tightly no real file is,
   * nor past what's left; counted if so. Any file packed some way (an .enex's base64) is asked of too.
   */
  allows(file: Pick<ZippedFile, "size" | "packed">) {
    if (file.size > LIMIT || (file.size > SMALL && file.size > file.packed * RATIO) || file.size > this.#left) return false;
    this.#left -= file.size;
    return true;
  }
}

/** Every file in a ZIP by name, inflated (zipEntries). */
export async function unzip(data: Uint8Array<ArrayBuffer>): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, file] of zipEntries(data)) files.set(name, await file.read());
  return files;
}
