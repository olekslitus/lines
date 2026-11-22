import { expect, test } from "bun:test";

/*
 * While a test awaits `expect(promise).resolves` (or `.rejects`), bun:test turns the event loop
 * itself, running setImmediate callbacks queued after ones still waiting. Playwright hands its
 * messages from the browser to the test with setImmediate, so one could arrive before the object
 * it names: "Object with guid response@… was not bound in the connection" (#397). The browser
 * tests await the value, then expect it.
 */
test("the browser tests don't expect a promise's value with .resolves or .rejects", async () => {
  const found: string[] = [];
  for await (const file of new Bun.Glob("tests/browser/**/*.ts").scan()) {
    const lines = (await Bun.file(file).text()).split("\n");
    lines.forEach((line, i) => /\.(?:resolves|rejects)\b/.test(line) && found.push(`${file}:${i + 1}`));
  }
  expect(found).toEqual([]);
});
