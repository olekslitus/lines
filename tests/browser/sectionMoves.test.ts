import { afterEach, beforeEach, expect, test } from "bun:test";
import { type App, mod, noErrors, openApp, toggle } from "./app";

/*
 * Moving a heading moves its section (editor/sectionMoves.ts, and dragBlocks.ts for its grip):
 * past the whole section of its size, with what's in it, folded or not; one ⌘Z takes it back; and
 * Settings → Editor → Move a heading with its section, off.
 */

let app: App;
beforeEach(async () => {
  app = await openApp();
});
afterEach(async () => {
  noErrors(app);
  await app.close();
});

const NOTE = "# Plan\n\nIntro\n\n## A\n\na text\n\n### A1\n\na1 text\n\n## B\n\nb text\n\n```\n# not a heading\n```\n\n## C\n\nc text";
const SWAPPED = "# Plan\n\nIntro\n\n## B\n\nb text\n\n```\n# not a heading\n```\n\n## A\n\na text\n\n### A1\n\na1 text\n\n## C\n\nc text";

const placeAt = (text: string, offset = 0) => app.page.evaluate(([text, offset]) => window.testing.place(window.testing.text()!.indexOf(text as string) + (offset as number)), [text, offset] as const);
const line = () => app.page.evaluate(() => {
  const { state } = window.testing.editor()!;
  return state.doc.lineAt(state.selection.main.head).text;
});
const textIs = (text: string) => app.page.waitForFunction((text) => window.testing.text() === text, text);

test("⌥↓ on a heading moves its section, the one inside it too, past the next of its size; ⌥↑ back; the cursor goes with it", async () => {
  await app.open(NOTE);
  await placeAt("## A", 4);
  await app.page.keyboard.press("Alt+ArrowDown");
  await textIs(SWAPPED);
  expect(await line()).toBe("## A");
  await app.page.keyboard.press("Alt+ArrowUp");
  await textIs(NOTE);
  // A section inside one moves among its own: A1 is the only one in A, so it stays.
  await placeAt("### A1");
  await app.page.keyboard.press("Alt+ArrowUp");
  await app.page.keyboard.press("Alt+ArrowDown");
  expect(await app.text()).toBe(NOTE);
});

test("on a device too busy to read the note as it changes, ⌥↓ and ⌥↑ at once still move a heading's section, not its line", async () => {
  await app.open(NOTE);
  await placeAt("## A", 4);
  // Both at once, with the clock running fast, as a device too busy to give the parser its time sees
  // them: its slice runs out before it reaches the heading just moved.
  const texts = await app.page.evaluate(() => {
    const now = Date.now;
    let ahead = 0;
    Date.now = () => now() + (ahead += 100);
    try {
      return ["ArrowDown", "ArrowUp"].map((key) => {
        window.testing.editor()!.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));
        return window.testing.text();
      });
    } finally {
      Date.now = now;
    }
  });
  expect(texts).toEqual([SWAPPED, NOTE]);
});

test("the first section of its size doesn't move up, nor the last down; nor the only one under its heading", async () => {
  await app.open(NOTE);
  await placeAt("## A");
  await app.page.keyboard.press("Alt+ArrowUp");
  await placeAt("## C");
  await app.page.keyboard.press("Alt+ArrowDown");
  await placeAt("# Plan");
  await app.page.keyboard.press("Alt+ArrowDown");
  expect(await app.text()).toBe(NOTE);
});

test("one ⌘Z takes a section's move back", async () => {
  await app.open(NOTE);
  await placeAt("## B");
  await app.page.keyboard.press("Alt+ArrowUp");
  await textIs(SWAPPED);
  await app.page.keyboard.press(`${mod()}+Z`);
  await textIs(NOTE);
});

test("a line under a heading moves as a line, and a # in a code block is no heading: its section ends at the next", async () => {
  await app.open(NOTE);
  await placeAt("b text");
  await app.page.keyboard.press("Alt+ArrowUp");
  await textIs(NOTE.replace("## B\n\nb text", "## B\nb text\n"));
  // B's section runs past the code's `# not a heading` to C, and moves past A whole.
  await placeAt("## B");
  await app.page.keyboard.press("Alt+ArrowUp");
  await textIs(SWAPPED.replace("## B\n\nb text", "## B\nb text\n"));
});

test("a folded section moves folded, ⌘Z puts it back folded, and ⇧⌘Z moves it again folded", async () => {
  await app.open(NOTE);
  await placeAt("a text");
  const mac = await app.page.evaluate(() => /Mac/.test(navigator.platform));
  // Fold A, A1 in it.
  await app.page.keyboard.press(mac ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft");
  await app.page.locator(".editor-pane .cm-fold-placeholder").waitFor();
  await app.page.keyboard.press("Alt+ArrowDown");
  await textIs(SWAPPED);
  const folded = () => app.page.evaluate(() => [...document.querySelectorAll(".editor-pane .cm-fold-placeholder")].map((placeholder) => placeholder.closest(".cm-line")?.textContent?.replace("…", "").replace(/^#+ /, "")));
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 1);
  expect(await folded()).toEqual(["A"]);
  expect(await app.page.locator(".editor-pane .cm-line", { hasText: "a text" }).count()).toBe(0);
  await app.page.keyboard.press(`${mod()}+Z`);
  await textIs(NOTE);
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 1);
  expect(await folded()).toEqual(["A"]);
  expect(await app.page.locator(".editor-pane .cm-line", { hasText: "a text" }).count()).toBe(0);
  // And redone, folded where it went again.
  await app.page.keyboard.press(mac ? "Meta+Shift+Z" : "Control+Y");
  await textIs(SWAPPED);
  await app.page.waitForFunction(() => document.querySelectorAll(".editor-pane .cm-fold-placeholder").length === 1);
  expect(await folded()).toEqual(["A"]);
});

test("a heading dragged by its grip takes its section, before a section of its size", async () => {
  await app.open(NOTE);
  const page = app.page;
  const heading = page.locator(".editor-pane").getByRole("heading", { name: "B", exact: true });
  await heading.hover();
  const handle = page.locator(".editor-pane .cm-drag-handle");
  await handle.waitFor({ state: "visible" });
  const grip = (await handle.boundingBox())!;
  const target = (await page.locator(".editor-pane").getByRole("heading", { name: "A", exact: true }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, target.y + 2, { steps: 12 });
  await page.mouse.up();
  await textIs(SWAPPED);
});

test("a LaTeX \\section moves with its \\subsection past the next \\section", async () => {
  const note = "\\begin{document}\n\\section{One}\nfirst\n\\subsection{Sub}\nsecond\n\\section{Two}\nthird\n\\end{document}";
  await app.open(note, "latex");
  await placeAt("\\section{One}");
  await app.page.keyboard.press("Alt+ArrowDown");
  await textIs("\\begin{document}\n\\section{Two}\nthird\n\\section{One}\nfirst\n\\subsection{Sub}\nsecond\n\\end{document}");
});

test("Move a heading with its section, off: ⌥↓ moves the heading's line alone, and so does its grip", async () => {
  await app.open(NOTE);
  const settings = await app.settings("Editor");
  await toggle(settings, "Move a heading with its section", false);
  await app.closeSettings();
  await placeAt("## A");
  await app.page.keyboard.press("Alt+ArrowDown");
  await textIs(NOTE.replace("## A\n\na text", "\n## A\na text"));
});

test("the note's last section moves without its closing tags, which stay at the note's end", async () => {
  await app.open("## A\n\na text\n\n## B\n\nb text\n\n#org #gym");
  await placeAt("## B");
  await app.page.keyboard.press("Alt+ArrowUp");
  await textIs("## B\n\nb text\n\n## A\n\na text\n\n#org #gym");
});
