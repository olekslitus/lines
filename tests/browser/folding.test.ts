import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type App, mod, noErrors, openApp, toggle } from "./app";

/*
 * Folding a note's sections by their headings (editor/folding.ts): the chevron beside a heading, the
 * keys, what opens a fold, folds kept on this device, and Settings → Editor → Fold sections.
 */

let app: App;
beforeEach(async () => {
  app = await openApp();
});
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const NOTE = "# Alpha\n\nalpha text\n\n## Inner\n\ninner text\n\n# Beta\n\nbeta text";

/** The note's lines as drawn. */
const drawn = () => app.page.evaluate(() => [...document.querySelectorAll(".editor-pane .cm-line")].map((line) => line.textContent));
const shows = async (text: string) => (await drawn()).some((line) => line?.includes(text));
/** The chevron by the heading named `title`. */
const chevron = (title: string) => app.page.locator(`.editor-pane .cm-fold-chevron[aria-label$="“${title}”"]`);
/** How many folds show (not those inside another). */
const folds = () => app.page.locator(".editor-pane .cm-fold-placeholder").count();
/** The keys that fold (`[`) or unfold (`]`) at the cursor, or every section with `all`, as CodeMirror reads them where the page runs. */
async function foldKey(which: "[" | "]", all = false) {
  const mac = await app.page.evaluate(() => /Mac/.test(navigator.platform));
  const key = which === "[" ? "BracketLeft" : "BracketRight";
  await app.page.keyboard.press(all ? `Control+Alt+${key}` : mac ? `Meta+Alt+${key}` : `Control+Shift+${key}`);
}
const placeAt = (text: string) => app.page.evaluate((text) => window.testing.place(window.testing.text()!.indexOf(text)), text);

test("a heading's chevron folds its section, children included, and unfolds it; the text stays as it is", async () => {
  await app.open(NOTE);
  await app.page.locator(".editor-pane").getByRole("heading", { name: "Alpha" }).hover();
  const alpha = chevron("Alpha");
  // Shown as the pointer is over its heading.
  await app.page.waitForFunction(() => getComputedStyle(document.querySelector(".editor-pane .cm-fold-chevron")!).opacity === "1");
  expect(await alpha.getAttribute("aria-expanded")).toBe("true");
  await alpha.click();
  await app.page.locator(".editor-pane .cm-fold-placeholder").waitFor();
  expect([await shows("alpha text"), await shows("inner text"), await shows("Inner"), await shows("beta text")]).toEqual([false, false, false, true]);
  // Its button says so, as it's drawn again.
  await app.page.locator('.editor-pane .cm-fold-chevron[aria-expanded="false"]').waitFor();
  expect(await alpha.getAttribute("aria-label")).toBe("Unfold “Alpha”");
  expect(await app.text()).toBe(NOTE);
  // Folded, it shows without the pointer by it.
  await app.page.mouse.move(5, 5);
  await app.page.waitForFunction(() => getComputedStyle(document.querySelector(".editor-pane .cm-fold-chevron")!).opacity === "1");
  expect(await chevron("Beta").evaluate((button) => getComputedStyle(button).opacity)).toBe("0");
  await alpha.click();
  await app.page.waitForFunction(() => !document.querySelector(".editor-pane .cm-fold-placeholder"));
  expect(await shows("inner text")).toBe(true);
});

test("⌘⌥[ folds the innermost section the cursor's in, then the one around it; ⌘⌥] unfolds one, leaving the one inside it folded", async () => {
  await app.open(NOTE);
  await placeAt("inner text");
  await foldKey("[");
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 1);
  expect([await shows("alpha text"), await shows("inner text")]).toEqual([true, false]);
  // The cursor went out of what's folded, to its heading.
  expect(await app.page.evaluate(() => window.testing.editor()!.state.selection.main.head)).toBe(NOTE.indexOf("## Inner") + "## Inner".length);
  await foldKey("[");
  await app.page.waitForFunction(() => !document.querySelector(".editor-pane .cm-line")?.parentElement?.textContent?.includes("alpha text"));
  expect(await shows("Inner")).toBe(false);
  await foldKey("]");
  await app.page.waitForFunction(() => document.querySelector(".editor-pane .cm-content")?.textContent?.includes("alpha text"));
  // The section inside is still folded.
  expect([await shows("Inner"), await shows("inner text")]).toEqual([true, false]);
  expect(await folds()).toBe(1);
});

test("⌃⌥[ folds every section, at every level, and ⌃⌥] unfolds them all", async () => {
  await app.open(NOTE);
  await placeAt("beta text");
  await foldKey("[", true);
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 2);
  expect([await shows("alpha text"), await shows("beta text")]).toEqual([false, false]);
  // Alpha opened, Inner is folded inside it.
  await chevron("Alpha").click();
  await app.page.waitForFunction(() => document.querySelector(".editor-pane .cm-content")?.textContent?.includes("alpha text"));
  expect(await shows("inner text")).toBe(false);
  await foldKey("]", true);
  await app.page.waitForFunction(() => !document.querySelector(".editor-pane .cm-fold-placeholder"));
  expect([await shows("inner text"), await shows("beta text")]).toEqual([true, true]);
});

test("find opens the fold its match is in; so do the outline going to a heading in one, and a line break typed at a folded heading's end", async () => {
  await app.page.evaluate(() => Object.assign(window.testing.prefs, { outline: true, outlineSide: "right" }));
  await app.open(NOTE);
  await placeAt("alpha text");
  await foldKey("[", true);
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 2);

  // Find: the match ends where the fold does.
  await app.page.keyboard.press(`${mod()}+F`);
  await app.page.keyboard.type("beta text");
  await app.page.keyboard.press("Enter");
  const match = app.page.locator(".editor-pane .cm-searchMatch-selected");
  await match.waitFor();
  expect(await match.innerText()).toBe("beta text");
  await app.page.keyboard.press("Escape");

  // The outline, to a heading inside a folded section.
  await app.page.getByRole("button", { name: "Headings" }).click();
  await app.page.getByRole("navigation", { name: "Outline" }).getByRole("button", { name: "Inner" }).click();
  await app.page.waitForFunction(() => document.querySelector(".editor-pane .cm-content")?.textContent?.includes("alpha text"));

  // Enter at the end of the folded Inner.
  await app.page.evaluate((at) => window.testing.place(at), NOTE.indexOf("## Inner") + "## Inner".length);
  expect(await shows("inner text")).toBe(false);
  await app.page.keyboard.press("Enter");
  await app.page.waitForFunction(() => document.querySelector(".editor-pane .cm-content")?.textContent?.includes("inner text"));
  expect(await folds()).toBe(0);
});

test("the arrows step over a fold, and back into its end open it; Shift and the arrows select it whole, and it copies whole", async () => {
  await app.open(NOTE);
  await placeAt("inner text");
  await foldKey("[");
  await app.page.locator(".editor-pane .cm-fold-placeholder").waitFor();
  // From Inner's heading down to Beta's, the fold staying.
  await app.page.keyboard.press("ArrowDown");
  await app.page.keyboard.press("ArrowDown");
  const line = () => app.page.evaluate(() => window.testing.editor()!.state.doc.lineAt(window.testing.editor()!.state.selection.main.head).text);
  expect(await line()).toBe("# Beta");
  expect(await folds()).toBe(1);

  // A selection from Inner's heading over its fold copies all of it, folded.
  await app.page.evaluate((at) => window.testing.place(at), NOTE.indexOf("## Inner"));
  await app.page.keyboard.press("Shift+ArrowDown");
  // As ⌘C copies, which Playwright's WebKit can't be let do.
  const copied = await app.page.evaluate(() => {
    const data = new DataTransfer();
    window.testing.editor()!.contentDOM.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  expect(copied).toStartWith("## Inner\n\ninner text");
  expect(await folds()).toBe(1);

  // Left from the line after it goes into its end, which opens it.
  await app.page.evaluate((at) => window.testing.place(at), NOTE.indexOf("# Beta"));
  await app.page.keyboard.press("ArrowLeft");
  await app.page.keyboard.press("ArrowLeft");
  await app.page.waitForFunction(() => !document.querySelector(".editor-pane .cm-fold-placeholder"));
  expect(await line()).toBe("inner text");
});

test("folds are kept for the note on this device, and back as it's opened again after a reload", async () => {
  const id = await app.open(NOTE);
  await placeAt("beta text");
  await foldKey("[");
  await app.page.locator(".editor-pane .cm-fold-placeholder").waitFor();
  await app.page.reload();
  await app.page.waitForFunction(() => window.testing?.notes.ready);
  await app.page.evaluate((id) => window.testing.notes.select(id), id);
  await app.page.waitForFunction((note) => window.testing.text() === note, NOTE);
  await app.page.locator(".editor-pane .cm-fold-placeholder").waitFor();
  expect([await shows("alpha text"), await shows("beta text")]).toEqual([true, false]);
  expect(await app.text()).toBe(NOTE);
});

test("a folded note prints whole", async () => {
  await app.open(NOTE);
  await placeAt("beta text");
  await foldKey("[", true);
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 2);
  await app.page.keyboard.press(`${mod()}+P`);
  // Each page shows its part of the document: all of it, between them.
  const pages = app.page.getByRole("dialog").getByRole("group", { name: /^Page 1 of/ });
  await pages.waitFor();
  const printed = await pages.textContent();
  expect([printed?.includes("alpha text"), printed?.includes("inner text"), printed?.includes("beta text")]).toEqual([true, true, true]);
});

test("a LaTeX note's \\section folds to its \\subsection's end and the next \\section, not past \\end{document}", async () => {
  const note = "\\begin{document}\n\\section{One}\nfirst\n\\subsection{Sub}\nsecond\n\\section{Two}\nthird\n\\end{document}";
  await app.open(note, "latex");
  await app.page.evaluate((at) => window.testing.place(at), note.indexOf("first"));
  await foldKey("[");
  await app.page.locator(".editor-pane .cm-fold-placeholder").waitFor();
  expect([await shows("first"), await shows("second"), await shows("third")]).toEqual([false, false, true]);
  await app.page.evaluate((at) => window.testing.place(at), note.indexOf("third"));
  await foldKey("[");
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 2);
  // \end{document} isn't in either fold.
  expect(await app.page.evaluate(() => {
    const view = window.testing.editor()!;
    const { doc } = view.state;
    return view.lineBlockAt(doc.length).from === doc.line(doc.lines).from;
  })).toBe(true);
});

describe("Fold sections, off", () => {
  test("shows no chevrons, and the keys fold nothing", async () => {
    await app.open(NOTE);
    await app.page.locator(".editor-pane").getByRole("heading", { name: "Alpha" }).hover();
    await chevron("Alpha").waitFor({ state: "visible" });
    const settings = await app.settings("Editor");
    await toggle(settings, "Fold sections", false);
    await app.closeSettings();
    expect(await app.page.locator(".editor-pane .cm-fold-chevron").count()).toBe(0);
    await placeAt("alpha text");
    await foldKey("[");
    await foldKey("[", true);
    expect(await folds()).toBe(0);
    expect(await shows("alpha text")).toBe(true);
    expect(await app.text()).toBe(NOTE);
  });
});

test("tags on lines of their own at the note's end tag the note, so folding its last section leaves them showing; a tag in the text folds with it", async () => {
  await app.open("# Training\n\n## equipment\n\n- squat stand\n- pull-up bar #home\n\n#org #gym\n#fitness");
  await placeAt("squat stand");
  await foldKey("[");
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 1);
  expect([await shows("squat stand"), await shows("#home"), await shows("org"), await shows("fitness")]).toEqual([false, false, true, true]);
  // The heading above it folds them in, being a section they're in the middle of no more.
  await foldKey("]");
  await placeAt("# Training");
  await foldKey("[");
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 1);
  expect([await shows("equipment"), await shows("org")]).toEqual([false, true]);
});
