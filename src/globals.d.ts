/** The version in package.json, set at build time (vite.config.ts). */
declare const __APP_VERSION__: string;

interface Window {
  /** Where Excalidraw loads its fonts from (DrawingEditor.svelte). */
  EXCALIDRAW_ASSET_PATH?: string | string[];
  /** Picks a color from anywhere on the screen: Chromium's, which TypeScript's DOM types don't have yet. */
  EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
  /** Goes back a step, for the system's Back: whether there was one to go (App.svelte). */
  linesBack?: () => boolean;
  /** The Android app's status and navigation bars: the color of the pane on screen behind them, their icons light on a dark one (MainActivity.kt). */
  linesSystemBars?: { setColors(background: string, dark: boolean): void };
  /** The Android app's Custom Tabs: a web page over lines, its toolbar `toolbar`'s color; whether it could (MainActivity.kt). */
  linesBrowser?: { open(url: string, toolbar: string, dark: boolean): boolean };
}

/** The messages each of Settings' sections shows, by its id, for its search, each with the part it's in (vite.config.ts). */
declare module "virtual:settings-search" {
  const index: Record<string, Record<string, string>>;
  export default index;
}
