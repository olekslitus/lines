import { afterEach, beforeEach, expect, test } from "bun:test";
import { type App, mod, noErrors, openApp, toggle } from "./app";

/*
 * Pasting with formatting (editor/richPaste.ts): the HTML copied with the text (Slack's, Google
 * Docs', a web page's) goes in as Markdown, its links, lists and emphasis kept; "•" lines of plain
 * text as a list. Undo right after leaves the paste plain, and so does the setting, off; code, and
 * what a code editor copies, stay plain.
 */

let app: App;
beforeEach(async () => {
  app = await openApp();
});
afterEach(async () => {
  noErrors(app);
  await app.close();
});

/** Pastes `plain` and `html` (if any) into a note reading `note` at its ‸; the note after. */
async function paste(note: string, plain: string, html?: string) {
  await app.open(note.replace("‸", ""));
  await app.page.evaluate((pos) => window.testing.place(pos), note.indexOf("‸"));
  await app.page.evaluate(
    ([plain, html]) => {
      const data = new DataTransfer();
      data.setData("text/plain", plain);
      if (html) data.setData("text/html", html);
      window.testing.editor()!.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [plain, html ?? ""] as const,
  );
  return app.text();
}

/** A Slack message as Slack copies it: paragraphs parted by breaks of its own, an emoji's picture, and a list of links whose second level is a list of its own after the first. */
const SLACK_HTML =
  `<meta charset='utf-8'><div class="p-rich_text_section">Hi Oleks <img class="c-emoji c-emoji__small" src="https://a.slack-edge.com/production-standard-emoji-assets/15.0/apple-medium/1f44b.png" alt=":wave:" data-stringify-text=":wave:" data-stringify-emoji=":wave:"> We have 402 open PRs.<span aria-label="" class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>Could you look at each one?</div>` +
  `<ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet" data-indent="0" data-border="0">` +
  `<li data-stringify-indent="0" data-stringify-border="0"><a target="_blank" class="c-link" data-stringify-link="https://github.com/acme/repo/pull/10458" href="https://github.com/acme/repo/pull/10458" rel="noopener noreferrer">#10458</a> (Monorepo/GH-10433) Refactor: Add AuthService <i data-stringify-type="italic">(draft, into develop)</i>.</li>` +
  `<li data-stringify-indent="0" data-stringify-border="0"><a class="c-link" href="https://github.com/acme/repo/pull/10567">#10567</a> Remove the dead <b data-stringify-type="bold">DeviceService</b> surface</li></ul>` +
  `<ul data-stringify-type="unordered-list" class="p-rich_text_list p-rich_text_list__bullet" data-indent="1" data-border="0"><li data-stringify-indent="1" data-stringify-border="0">Still accurate: merge it</li></ul>` +
  `<ul data-stringify-type="unordered-list" class="p-rich_text_list p-rich_text_list__bullet" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0"><a class="c-link" href="https://github.com/acme/repo/pull/10677">#10677</a> Split the EB layer</li></ul>`;
const SLACK_PLAIN = "Hi Oleks :wave: We have 402 open PRs.\n\nCould you look at each one?\n• #10458 (Monorepo/GH-10433) Refactor: Add AuthService (draft, into develop).\n• #10567 Remove the dead DeviceService surface\n    ◦ Still accurate: merge it\n• #10677 Split the EB layer";
const SLACK_MARKDOWN = [
  "Hi Oleks 👋 We have 402 open PRs.",
  "",
  "Could you look at each one?",
  "",
  "- [\\#10458](https://github.com/acme/repo/pull/10458) (Monorepo/GH-10433) Refactor: Add AuthService *(draft, into develop)*.",
  "- [\\#10567](https://github.com/acme/repo/pull/10567) Remove the dead **DeviceService** surface",
  "  - Still accurate: merge it",
  "- [\\#10677](https://github.com/acme/repo/pull/10677) Split the EB layer",
].join("\n");

test("a Slack message pastes as Markdown: its links, its list and the list in it, emphasis, emoji and paragraphs", async () => {
  expect(await paste("‸", SLACK_PLAIN, SLACK_HTML)).toBe(SLACK_MARKDOWN);
});

test("undo right after a formatted paste leaves it as plain text, and undo again takes it out", async () => {
  await paste("Before ‸", SLACK_PLAIN, SLACK_HTML);
  await app.page.keyboard.press(`${mod()}+z`);
  expect(await app.text()).toBe(`Before ${SLACK_PLAIN}`);
  await app.page.keyboard.press(`${mod()}+z`);
  expect(await app.text()).toBe("Before ");
});

test("Google Docs' text pastes with its own bold and italics, not as all bold, its headings at their level", async () => {
  const html =
    `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><h1 dir="ltr"><span style="font-size:20pt;font-weight:400;">Plan</span></h1>` +
    `<p dir="ltr"><span style="font-weight:400;">Ship the </span><span style="font-weight:700;">release</span><span style="font-weight:400;"> on </span><span style="font-style:italic;font-weight:400;">Friday</span></p>` +
    `<ul><li dir="ltr"><p dir="ltr"><span style="font-weight:400;">Notes</span></p></li><li dir="ltr"><p dir="ltr"><span style="text-decoration:line-through;">Old</span></p></li></ul></b>`;
  expect(await paste("‸", "Plan\nShip the release on Friday\nNotes\nOld", html)).toBe("# Plan\n\nShip the **release** on *Friday*\n\n- Notes\n- ~~Old~~");
});

test("a link from a page pastes as a Markdown link in the line it's pasted into", async () => {
  const html = `<span>See </span><a href="https://example.com/docs">the docs</a><span> first</span>`;
  expect(await paste("Read this: ‸ today", "See the docs first", html)).toBe("Read this: See [the docs](https://example.com/docs) first today");
});

test("a list pasted after text on a line goes on lines of its own; on an empty item, in its place at its level", async () => {
  const html = `<ul><li><a href="https://a.example/one">One</a></li><li>Two</li></ul>`;
  expect(await paste("Tasks:‸", "One\nTwo", html)).toBe("Tasks:\n- [One](https://a.example/one)\n- Two");
  expect(await paste("- first\n  - ‸", "One\nTwo", html)).toBe("- first\n  - [One](https://a.example/one)\n  - Two");
});

test("plain text's • lines paste as a list, nested where they were indented", async () => {
  expect(await paste("‸", "Groceries\n• milk\n• eggs\n    ◦ brown\n• bread")).toBe("Groceries\n- milk\n- eggs\n    - brown\n- bread");
});

test("stays plain: what a code editor copies, a link alone, code, and HTML with nothing more than its text", async () => {
  const vscode = `<meta charset='utf-8'><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Menlo;white-space: pre;"><div><span style="color: #c586c0;">import</span><span style="color: #d4d4d4;"> * </span><span style="color: #c586c0;">as</span> fs</div></div>`;
  expect(await paste("‸", "import * as fs", vscode)).toBe("import * as fs");
  expect(await paste("‸", "https://example.com/a_b", `<a href="https://example.com/a_b">https://example.com/a_b</a>`)).toBe("https://example.com/a_b");
  expect(await paste("```\n‸\n```", "One\nTwo", `<ul><li><a href="https://a.example/one">One</a></li><li>Two</li></ul>`)).toBe("```\nOne\nTwo\n```");
  expect(await paste("‸", "First\n\nSecond", "<p>First</p><p>Second</p>")).toBe("First\n\nSecond");
});

test("Settings → Editor → Keep formatting when pasting, off, pastes plain text", async () => {
  const settings = await app.settings("Editor");
  await toggle(settings, "Keep formatting when pasting", false);
  await app.closeSettings();
  expect(await app.page.evaluate(() => window.testing.prefs.pasteFormatting)).toBe(false);
  expect(await paste("‸", SLACK_PLAIN, SLACK_HTML)).toBe(SLACK_PLAIN);
});
