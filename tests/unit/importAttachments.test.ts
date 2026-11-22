import { describe, expect, test } from "bun:test";
import type { ExportedFile } from "../../src/lib/imports/exported";
import { devices } from "./sync";
// After ./sync, which keeps attachments in memory in place of IndexedDB.
const { keepAttachments, Tally } = await import("../../src/lib/imports/notes");
const { getAttachment } = await import("../../src/lib/notes/attachments");

/** A file in an export, read as `read` gives it. */
const exported = (path: string, read: () => Promise<File>): ExportedFile => ({ path, size: 0, text: async () => (await read()).text(), file: read });

describe("an import's pictures and files", () => {
  test("are kept, but one that can't be read, which is left out while the rest are kept", async () => {
    await devices(1);
    const photo = new File(["a picture"], "photo.png", { type: "image/png" });
    const attachments = [
      exported("broken.png", async () => {
        throw new Error("The file couldn't be read");
      }),
      exported("photo.png", async () => photo),
    ];
    const source = { name: "Vault", notes: [], attachments, report: new Tally() };
    const progress: number[] = [];
    const names = await keepAttachments(source, { add: [], there: [], folders: 0, attachments: [0, 1] }, new AbortController().signal, (done) => progress.push(done));
    expect([...names.keys()]).toEqual([1]);
    expect(await (await getAttachment(names.get(1)!))?.text()).toBe("a picture");
    expect(progress).toEqual([0, 1]);
  });

  test("stop being kept once the import is stopped", async () => {
    await devices(1);
    const stop = new AbortController();
    const attachments = ["a.png", "b.png"].map((path) =>
      exported(path, async () => {
        stop.abort();
        return new File([path], path, { type: "image/png" });
      }),
    );
    const source = { name: "Vault", notes: [], attachments, report: new Tally() };
    const kept = await keepAttachments(source, { add: [], there: [], folders: 0, attachments: [0, 1] }, stop.signal, () => {}).then(
      () => "finished",
      (error: Error) => error.name,
    );
    expect(kept).toBe("AbortError");
  });
});
