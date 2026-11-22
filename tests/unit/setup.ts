import { plugin } from "bun";
import { compileModule } from "svelte/compiler";

/*
 * What unit tests need to import lines' modules outside a browser: `.svelte.ts` modules (with
 * runes, `$state`) compiled as Vite's Svelte plugin compiles them, `?raw` imports read as text, `?url` ones as the file's URL, and
 * stylesheets (fonts a plugin imports) as nothing. Loaded before every unit test (package.json).
 */

const typescript = new Bun.Transpiler({ loader: "ts" });

plugin({
  name: "lines-unit",
  setup(build) {
    build.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
      const js = typescript.transformSync(await Bun.file(path).text());
      return { contents: compileModule(js, { filename: path, generate: "client" }).js.code, loader: "js" };
    });
    build.onResolve({ filter: /\?raw$/ }, ({ path, importer }) => ({ path: Bun.resolveSync(path.slice(0, -4), importer.replace(/[^/]+$/, "")), namespace: "raw" }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, async ({ path }) => ({ contents: `export default ${JSON.stringify(await Bun.file(path).text())};`, loader: "js" }));
    // A file's URL, as Vite gives it (`?url`): IronCalc's WebAssembly, fetched from disk.
    build.onResolve({ filter: /\?url$/ }, ({ path, importer }) => ({ path: Bun.resolveSync(path.slice(0, -4), importer.replace(/[^/]+$/, "")), namespace: "url" }));
    build.onLoad({ filter: /.*/, namespace: "url" }, ({ path }) => ({ contents: `export default ${JSON.stringify(Bun.pathToFileURL(path).href)};`, loader: "js" }));
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
});

/** Browsers' storage, kept in memory for the run; its keys listed as a browser's are (`Object.keys(localStorage)`). */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  const methods = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
  return new Proxy(methods, {
    ownKeys: () => [...items.keys()],
    getOwnPropertyDescriptor: (_, key) => (typeof key === "string" && items.has(key) ? { value: items.get(key), enumerable: true, configurable: true } : undefined),
  }) as unknown as Storage;
}
globalThis.localStorage ??= memoryStorage();

/** The version Vite builds in (vite.config.ts), which the apps' requests say. */
(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = "0.0.0";
