import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type App, mod, noErrors, openApp } from "./app";

/*
 * Settings → Editor → Show Markdown → Hidden, as in Bear and Notion: no Markdown in sight, wherever
 * the cursor is, while the note's text keeps all of it.
 */

let app: App;
beforeEach(async () => {
  app = await openApp({ prefs: { markdownMode: "hidden" } });
});
afterEach(async () => {
  noErrors(app);
  await app.close();
});

/**
 * The note as it's seen, a line of text for each of the editor's: its characters drawn on the page,
 * not those only screen readers hear, nor those drawn in no color.
 */
const seen = () =>
  app.page.evaluate(() =>
    [...document.querySelectorAll(".editor-pane .cm-content > *")]
      .map((line) => {
        let text = "";
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement!;
          if (el.closest(".sr-only") || !el.checkVisibility({ visibilityProperty: true }) || getComputedStyle(el).color === "rgba(0, 0, 0, 0)") continue;
          text += node.textContent;
        }
        return text.replace(/​/g, "");
      })
      .join("\n"),
  );

/** Puts the cursor at `anchor`, or selects to `head`, with the keyboard in the note. */
const select = (anchor: number, head = anchor) =>
  app.page.evaluate(([anchor, head]) => {
    const view = window.testing.editor()!;
    view.focus();
    view.dispatch({ selection: { anchor, head } });
  }, [anchor, head]);

const head = () => app.page.evaluate(() => window.testing.editor()!.state.selection.main.head);

/** Where the cursor goes, from `from`, with each press of `key` until it stops moving. */
async function steps(from: number, key: string) {
  await select(from);
  const heads = [from];
  for (;;) {
    await app.page.keyboard.press(key);
    const now = await head();
    if (now === heads.at(-1)) return heads;
    heads.push(now);
  }
}

/**
 * What's seen of `markdown` (between two lines of text) with the cursor away from it, at the end
 * of its line, at `inside` in it, and with all of it selected: each as `expected`, the note's text
 * as written.
 */
async function hiddenEverywhere(markdown: string, inside: number, expected: string | { none: string[] }) {
  const body = `Intro\n\n${markdown}\n\nEnd`;
  await app.open(body);
  const start = body.indexOf(markdown);
  const states: [where: string, anchor: number, head?: number][] = [
    ["away", 1],
    ["line", start + markdown.split("\n")[0].length],
    ["inside", start + inside],
    ["selecting", start, start + markdown.length],
  ];
  for (const [where, anchor, to] of states) {
    await select(anchor, to);
    const now = await seen();
    if (typeof expected === "string") expect(`${where}: ${now}`).toBe(`${where}: Intro\n\n${expected}\n\nEnd`);
    // Where what's drawn has text of its own (math), none of the marks.
    else for (const mark of expected.none) expect(now.includes(mark) ? `${where}, ${mark}: ${now}` : "").toBe("");
  }
  expect(await app.text()).toBe(body);
}

describe("links", () => {
  const ROGUE = "SML-3 Rogue 108\" Monster Lite Squat Stand";
  const ITEM = `- [${ROGUE}](https://www.roguefitness.com/sml-3-rogue-108-monster-lite-squat-stand)`;

  test("a link shows only its text, the cursor away, at its end, in it, or selecting across it", async () => {
    await hiddenEverywhere(ITEM, 6, ROGUE);
    await hiddenEverywhere("See [Rogue](https://rogue.com/x \"A title\") here", 6, "See Rogue here");
    await hiddenEverywhere("A [**bold** link](https://example.com)", 5, "A bold link");
    // With no text of its own, its address.
    await hiddenEverywhere("Go [](https://example.com) now", 6, "Go https://example.com now");
  });

  test("an address in <> shows without them; a picture stays drawn, its Markdown never seen", async () => {
    await hiddenEverywhere("See <https://example.com> here", 8, "See https://example.com here");
    await hiddenEverywhere("Look ![A picture](https://example.com/a.png) here", 8, "Look This image couldn’t be shown here");
  });

  test("← and → step over a link's hidden marks a character a press, never stopping in them", async () => {
    const body = "See [Rogue](https://rogue.com/x) here";
    await app.open(body);
    const right = await steps(0, "ArrowRight");
    // A press a character seen: "See Rogue here".
    expect(right.length - 1).toBe("See Rogue here".length);
    expect(right.at(-1)).toBe(body.length);
    const hidden = (pos: number) => pos === 5 || (pos >= 10 && pos < 32);
    expect(right.filter(hidden)).toEqual([]);
    const left = await steps(body.length, "ArrowLeft");
    expect(left.length - 1).toBe("See Rogue here".length);
    expect(left.filter(hidden)).toEqual([]);

    // A list item's link, its `[` right after the bullet: from its text's start to its end.
    await app.open(ITEM);
    const item = await steps(2, "ArrowRight");
    expect(item.length - 1).toBe(ROGUE.length);
    expect(item.at(-1)).toBe(ITEM.length);
  });

  test("Backspace at a link's end takes its text's last letter, not its address; typing there goes after it; ⌘Z undoes", async () => {
    await app.open(ITEM);
    await select(ITEM.length);
    await app.page.keyboard.press("Backspace");
    expect(await app.text()).toBe(ITEM.replace("Stand]", "Stan]"));
    await app.page.keyboard.type("!");
    expect(await app.text()).toBe(`${ITEM.replace("Stand]", "Stan]")}!`);
    await app.page.keyboard.press(`${mod()}+z`);
    expect(await app.text()).toBe(ITEM.replace("Stand]", "Stan]"));
    await app.page.keyboard.press(`${mod()}+z`);
    expect(await app.text()).toBe(ITEM);
  });

  test("Delete at a list item's link takes its first letter, not its `[`; → there steps on, bold text too", async () => {
    await app.open(ITEM);
    await select(2);
    await app.page.keyboard.press("Delete");
    expect(await app.text()).toBe(ITEM.replace("[SML", "[ML"));
    await app.open("- **bold** text");
    expect((await steps(2, "ArrowRight")).length - 1).toBe("bold text".length);
  });

  test("Backspace on a link's last letter takes the link", async () => {
    await app.open("A [b](https://example.com) c");
    await select(26);
    await app.page.keyboard.press("Backspace");
    expect(await app.text()).toBe("A  c");
  });
});

describe("the link bar and box", () => {
  const BODY = "See [Rogue](https://rogue.com/x) here";
  const bar = () => app.page.getByRole("toolbar", { name: "Link" });
  const box = () => app.page.getByRole("dialog");

  test("the cursor in a link shows its address under it, with Open, Copy and Remove; at its ends or away, nothing", async () => {
    await app.open(BODY);
    await select(7);
    await bar().waitFor();
    expect(await bar().getByRole("button", { name: "Edit Link: https://rogue.com/x" }).textContent()).toBe("https://rogue.com/x");
    for (const pos of [4, 32, 1]) {
      await select(pos);
      await bar().waitFor({ state: "detached" });
    }
    await select(7);
    await bar().getByRole("button", { name: "Copy Link" }).click();
    expect(await app.page.evaluate(() => navigator.clipboard.readText())).toBe("https://rogue.com/x");
    await bar().getByRole("button", { name: "Remove Link" }).click();
    expect(await app.text()).toBe("See Rogue here");
    await bar().waitFor({ state: "detached" });
    await app.page.keyboard.press(`${mod()}+z`);
    expect(await app.text()).toBe(BODY);
  });

  test("clicking the address opens the box; its address and text change the link's, by keyboard alone", async () => {
    await app.open(BODY);
    await select(7);
    await bar().getByRole("button", { name: /^Edit Link/ }).click();
    await box().waitFor();
    await app.page.keyboard.press("Escape");
    await box().waitFor({ state: "detached" });
    expect(await app.text()).toBe(BODY);

    // ⌘K: focus in its address, all of it selected.
    await select(7);
    await app.page.keyboard.press(`${mod()}+k`);
    await app.page.waitForFunction(() => document.activeElement?.getAttribute("type") === "url");
    await app.page.keyboard.type("https://example.com/new");
    await app.page.keyboard.press("Shift+Tab");
    await app.page.keyboard.press(`${mod()}+a`);
    await app.page.keyboard.type("Rogue Fitness");
    await app.page.keyboard.press("Enter");
    await box().waitFor({ state: "detached" });
    expect(await app.text()).toBe("See [Rogue Fitness](https://example.com/new) here");
    // Back in the note, after the link.
    await app.page.keyboard.type("!");
    expect(await app.text()).toBe("See [Rogue Fitness](https://example.com/new)! here");
    expect(await seen()).toBe("See Rogue Fitness! here");
  });

  test("Remove in the box, by keyboard, leaves the text; ⌘Z brings the link back", async () => {
    await app.open(BODY);
    await select(7);
    await app.page.keyboard.press(`${mod()}+k`);
    await box().getByRole("button", { name: "Remove Link" }).focus();
    await app.page.keyboard.press("Enter");
    await box().waitFor({ state: "detached" });
    expect(await app.text()).toBe("See Rogue here");
    await app.page.keyboard.press(`${mod()}+z`);
    expect(await app.text()).toBe(BODY);
  });

  test("⌘K over text that isn't a link makes it one, an address with spaces written so it stays one", async () => {
    await app.open("Read the plan here");
    await select(9, 13);
    await app.page.keyboard.press(`${mod()}+k`);
    await app.page.getByRole("dialog", { name: "Add Link" }).waitFor();
    await app.page.waitForFunction(() => document.activeElement?.getAttribute("type") === "url");
    await app.page.keyboard.type("file:///Users/me/My Plan.pdf");
    await app.page.keyboard.press("Enter");
    await box().waitFor({ state: "detached" });
    expect(await app.text()).toBe("Read the [plan](file:///Users/me/My%20Plan.pdf) here");
    expect(await seen()).toBe("Read the plan here");
  });

  test("Live shows a link's Markdown where the cursor is, as before, with no bar", async () => {
    await app.close();
    app = await openApp({ prefs: { markdownMode: "live" } });
    await app.open(BODY);
    await select(7);
    expect(await seen()).toBe(BODY);
    expect(await bar().count()).toBe(0);
    await select(0);
    expect(await seen()).toBe("See Rogue here");
  });
});

describe("everything else Lines draws", () => {
  const line = () =>
    app.page.evaluate(() => {
      const { state } = window.testing.editor()!;
      return state.doc.lineAt(state.selection.main.head).number;
    });

  test("a code block shows its language as a label and no fences; ```math, a math block and math in text no `$` or fences", async () => {
    await hiddenEverywhere("```ts\nconst a = 1;\n```", 3, { none: ["`"] });
    await hiddenEverywhere("```math\nx^2\n```", 9, { none: ["`"] });
    await hiddenEverywhere("$$\nx^2\n$$", 4, { none: ["$"] });
    await hiddenEverywhere("So $x^2$ is", 5, { none: ["$"] });
    // Math's source with the cursor in it, and the language, are what's written there.
    await select(7 + 5);
    expect(await seen()).toBe("Intro\n\nSo x^2 is\n\nEnd");
    await app.open("```ts\nconst a = 1;\n```");
    await select(5);
    expect((await seen()).split("\n")[0]).toBe("ts");
  });

  test("a card's and a callout's `:::`, a page break's comment, a line mark's, a `\\` line break's and an escape's backslash never show", async () => {
    await hiddenEverywhere(":::i\nInside\n:::", 2, { none: [":"] });
    await hiddenEverywhere("::: card\n:::!\nNested\n:::\n:::", 15, { none: [":", "card"] });
    await hiddenEverywhere("<!-- pagebreak -->", 3, { none: ["<", "pagebreak"] });
    await hiddenEverywhere("Marked line <!-- mark green: ready -->", 3, "Marked line");
    await hiddenEverywhere("One\\\nTwo", 2, "One\nTwo");
    await hiddenEverywhere("Not \\*em\\* here", 6, "Not *em* here");
  });

  test("a mention stays its note's chip, the cursor on it or in it; a picture on a line of its own stays drawn", async () => {
    await app.open("# Ada Lovelace\n\nShe wrote the first program.");
    await hiddenEverywhere("Ask @[Ada Lovelace] now", 7, "Ask Ada Lovelace now");
    await hiddenEverywhere("Ask [[Ada Lovelace|Ada]] now", 7, "Ask Ada now");
    await hiddenEverywhere("![A picture](https://example.com/a.png)", 4, "This image couldn’t be shown");
    // One Backspace takes a mention.
    await app.open("Ask @[Ada Lovelace]");
    await select(19);
    await app.page.keyboard.press("Backspace");
    expect(await app.text()).toBe("Ask ");
  });

  test("↓ and ↑ go past a code block's closing fence and a card's fences, never onto them", async () => {
    await app.open("Intro\n\n```ts\ncode\n```\n\nEnd");
    await select(13);
    await app.page.keyboard.press("ArrowDown");
    expect(await line()).toBe(6);
    await app.page.keyboard.press("ArrowUp");
    expect(await line()).toBe(4);

    await app.open("Intro\n:::i\nInside\n:::\nEnd");
    await select(5);
    const lines: number[] = [];
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp"]) {
      await app.page.keyboard.press(key);
      lines.push(await line());
    }
    expect(lines).toEqual([3, 5, 3]);
  });

  test("Backspace beside a fence never joins a line to it: an empty line goes, a line with text stays", async () => {
    await app.open("```ts\ncode\n```\n\nEnd");
    await select(15);
    await app.page.keyboard.press("Backspace");
    expect(await app.text()).toBe("```ts\ncode\n```\nEnd");
    expect(await head()).toBe(10);
    await select(15);
    await app.page.keyboard.press("Backspace");
    expect(await app.text()).toBe("```ts\ncode\n```\nEnd");
  });

  test("math's `$` are stepped over: → from before it goes past its first character, its source shown", async () => {
    await app.open("So $x^2$ is");
    await select(3);
    await app.page.keyboard.press("ArrowRight");
    expect(await head()).toBe(5);
    expect(await seen()).toBe("So x^2 is");
  });

  test("typing at a marked line's end goes before its mark; Return starts the next line after it; → goes on to the next line", async () => {
    const marked = "Marked line <!-- mark green: ready -->";
    await app.open(`${marked}\nNext`);
    await select(marked.length);
    await app.page.keyboard.type("!");
    expect(await app.text()).toBe("Marked line! <!-- mark green: ready -->\nNext");
    await app.page.keyboard.press("Enter");
    expect(await app.text()).toBe("Marked line! <!-- mark green: ready -->\n\nNext");
    expect(await line()).toBe(2);
    await select(12);
    await app.page.keyboard.press("ArrowRight");
    expect(await line()).toBe(2);
    // Delete there brings the next line up before the mark.
    await app.page.keyboard.press("Backspace");
    await select(12);
    await app.page.keyboard.press("Delete");
    expect(await app.text()).toBe("Marked line!Next <!-- mark green: ready -->");
  });

  test("↓ onto a page break chooses it whole, drawn; Backspace takes it", async () => {
    await app.open("Before\n<!-- pagebreak -->\nAfter");
    await select(3);
    await app.page.keyboard.press("ArrowDown");
    expect(await app.page.evaluate(() => window.testing.editor()!.state.selection.main.toJSON())).toEqual({ anchor: 7, head: 25 });
    expect(await seen()).not.toContain("<!--");
    await app.page.keyboard.press("Backspace");
    expect(await app.text()).toBe("Before\n\nAfter");
  });
});
