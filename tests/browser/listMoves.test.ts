import { afterEach, beforeEach, expect, test } from "bun:test";
import { type App, mod, noErrors, openApp, toggle } from "./app";

/*
 * Moving list items (editor/listMoves.ts): ⌥↑ and ⌥↓, a grip, cutting and pasting, deleting. A
 * numbered list is numbered again in its new order, from the number it started at, in its own `.`
 * or `)`, the item's sub-items going with it; Settings → Editor → Renumber lists when items move
 * off leaves the numbers as they were.
 */

let app: App;
beforeEach(async () => {
  app = await openApp();
});
afterEach(async () => {
  noErrors(app);
  await app.close();
});

/** Opens a note reading `note`, the cursor where its ‸ is. */
async function openAt(note: string) {
  await app.open(note.replace("‸", ""));
  await app.page.evaluate((pos) => window.testing.place(pos), note.indexOf("‸"));
}

/** The open note, the cursor shown as ‸. */
async function withCursor() {
  const [text, head] = await app.page.evaluate(() => {
    const { state } = window.testing.editor()!;
    return [state.doc.toString(), state.selection.main.head] as const;
  });
  return text.slice(0, head) + "‸" + text.slice(head);
}

/** Selects the open note's text from `from` to `to`, with the keyboard in it. */
const select = (from: number, to: number) =>
  app.page.evaluate(([anchor, head]) => {
    const view = window.testing.editor()!;
    view.focus();
    view.dispatch({ selection: { anchor, head } });
  }, [from, to] as const);

/** Drags the line reading `from` by its grip to the gap above the line reading `to`, and waits for it to have moved and come to rest. */
async function drag(from: string, to: string) {
  const { page } = app;
  const before = await app.text();
  const lines = page.locator(".editor-pane .cm-line");
  await lines.filter({ hasText: from }).hover();
  // The grip by that line, not on its way there from another.
  await page.waitForFunction((text) => {
    const line = [...document.querySelectorAll(".editor-pane .cm-line")].find((each) => each.textContent?.includes(text));
    const grip = document.querySelector(".editor-pane .cm-drag-handle")?.getBoundingClientRect();
    const at = line?.getBoundingClientRect();
    return at && grip?.height && Math.abs(at.top + at.height / 2 - (grip.top + grip.height / 2)) < 6;
  }, from);
  const grip = (await page.locator(".editor-pane .cm-drag-handle").boundingBox())!;
  const target = (await lines.filter({ hasText: to }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, target.y + 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction((before) => window.testing.text() !== before, before);
  await page.waitForFunction(() => ![...document.querySelectorAll(".editor-pane .cm-line")].some((line) => line.getAnimations().length));
}

test("⌥↑ and ⌥↓ move a numbered item past the one above or below, with its sub-items, and number the list again in its new order", async () => {
  const cases = [
    ["1. A\n2. B\n3. C\n4. D‸", "Alt+ArrowUp", "1. A\n2. B\n3. D‸\n4. C"],
    ["1. A‸\n2. B\n3. C", "Alt+ArrowDown", "1. B\n2. A‸\n3. C"],
    // Its sub-items go with it, past the other's.
    ["1. A\n2. B\n   - b1\n   - b2\n3. C‸\n   1. c1", "Alt+ArrowUp", "1. A\n2. C‸\n   1. c1\n3. B\n   - b1\n   - b2"],
    ["- A‸\n  - a1\n- B\n  - b1", "Alt+ArrowDown", "- B\n  - b1\n- A‸\n  - a1"],
    // From the number the list starts at, in its `)`.
    ["5. A\n6. B‸\n7. C", "Alt+ArrowUp", "5. B‸\n6. A\n7. C"],
    ["1) A\n2) B\n3) C‸", "Alt+ArrowUp", "1) A\n2) C‸\n3) B"],
    // A list inside an item, which stays where it is.
    ["1. A\n   1. x\n   2. y‸\n2. B", "Alt+ArrowUp", "1. A\n   1. y‸\n   2. x\n2. B"],
    // Blank lines between items stay between them; in a quote too.
    ["1. A\n\n2. B‸", "Alt+ArrowUp", "1. B‸\n\n2. A"],
    ["> 1. A\n> 2. B‸", "Alt+ArrowUp", "> 1. B‸\n> 2. A"],
    // Numbered 1. throughout, it stays so.
    ["1. A\n1. B‸\n1. C", "Alt+ArrowUp", "1. B‸\n1. A\n1. C"],
    // 9. made 10., its sub-items move along to stay under it.
    ["8. H\n9. I\n   - sub\n10. J‸", "Alt+ArrowUp", "8. H\n9. J‸\n10. I\n    - sub"],
    // The first item, with nothing above it to go past, goes past the line there.
    ["Shopping\n\n1. A‸\n   - a1\n2. B", "Alt+ArrowUp", "Shopping\n1. A‸\n   - a1\n\n2. B"],
    // Not a list in code, nor in the properties: lines, moved as they are.
    ["```\n1. A\n2. B‸\n```", "Alt+ArrowUp", "```\n2. B‸\n1. A\n```"],
    ["---\nsteps:\n1. a\n2. b‸\n---\nText", "Alt+ArrowUp", "---\nsteps:\n2. b‸\n1. a\n---\nText"],
  ];
  for (const [note, key, after] of cases) {
    await openAt(note);
    await app.page.keyboard.press(key);
    expect([note, await withCursor()]).toEqual([note, after]);
  }

  // Items selected together move together.
  await app.open("1. A\n2. B\n3. C\n4. D");
  await select(10, 19);
  await app.page.keyboard.press("Alt+ArrowUp");
  expect(await app.text()).toBe("1. A\n2. C\n3. D\n4. B");
});

test("⌘Z takes back the move and the numbering together, in one step", async () => {
  const note = "1. A\n2. B\n3. C\n4. D";
  await openAt(`${note}‸`);
  await app.page.keyboard.press("Alt+ArrowUp");
  await app.page.keyboard.press("Alt+ArrowUp");
  expect(await app.text()).toBe("1. A\n2. D\n3. B\n4. C");
  await app.page.keyboard.press(`${mod()}+z`);
  expect(await app.text()).toBe("1. A\n2. B\n3. D\n4. C");
  await app.page.keyboard.press(`${mod()}+z`);
  expect(await app.text()).toBe(note);
});

test("a numbered item dragged by its grip is numbered where it lands, its sub-items along; the list it left counts on, and the one it joins", async () => {
  await app.open("1. Apples\n2. Bread\n3. Carrots\n4. Dates\n   - medjool\n\nThen\n\n1. Xylophone\n2. Yoyo");
  // Up a place in its list.
  await drag("Dates", "Carrots");
  expect(await app.text()).toBe("1. Apples\n2. Bread\n3. Dates\n   - medjool\n4. Carrots\n\nThen\n\n1. Xylophone\n2. Yoyo");
  // Into the other list.
  await drag("Bread", "Yoyo");
  expect(await app.text()).toBe("1. Apples\n2. Dates\n   - medjool\n3. Carrots\n\nThen\n\n1. Xylophone\n2. Bread\n3. Yoyo");
  // One ⌘Z (in the note: a grip leaves the keyboard where it was) takes it all back.
  await app.page.evaluate(() => window.testing.editor()!.focus());
  await app.page.keyboard.press(`${mod()}+z`);
  expect(await app.text()).toBe("1. Apples\n2. Bread\n3. Dates\n   - medjool\n4. Carrots\n\nThen\n\n1. Xylophone\n2. Yoyo");
});

test("items cut, pasted or deleted number their lists again", async () => {
  const note = "1. A\n2. B\n3. C\n4. D";
  await app.open(note);
  const data = await app.page.evaluate(() => {
    const view = window.testing.editor()!;
    view.focus();
    view.dispatch({ selection: { anchor: 5, head: 10 } });
    const data = new DataTransfer();
    view.contentDOM.dispatchEvent(new ClipboardEvent("cut", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  expect(data).toBe("2. B\n");
  expect(await app.text()).toBe("1. A\n2. C\n3. D");
  // Pasted at the start of the list, it's its first.
  await app.page.evaluate((text) => {
    window.testing.place(0);
    const data = new DataTransfer();
    data.setData("text/plain", text);
    window.testing.editor()!.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, data);
  expect(await app.text()).toBe("1. B\n2. A\n3. C\n4. D");
  // Selected and deleted.
  await select(5, 10);
  await app.page.keyboard.press("Backspace");
  expect(await app.text()).toBe("1. B\n2. C\n3. D");
});

test("Settings → Editor → Renumber lists when items move, off, leaves items their numbers", async () => {
  const settings = await app.settings("Editor");
  await toggle(settings, "Renumber lists when items move", false);
  await app.closeSettings();
  expect(await app.page.evaluate(() => window.testing.prefs.renumberLists)).toBe(false);

  await openAt("1. A\n2. B\n3. C\n4. D‸");
  await app.page.keyboard.press("Alt+ArrowUp");
  expect(await app.text()).toBe("1. A\n2. B\n4. D\n3. C");
  await select(5, 10);
  await app.page.keyboard.press("Backspace");
  expect(await app.text()).toBe("1. A\n4. D\n3. C");

  await app.open("1. Apples\n2. Bread\n3. Carrots");
  await drag("Carrots", "Apples");
  expect(await app.text()).toBe("3. Carrots\n1. Apples\n2. Bread");
});
