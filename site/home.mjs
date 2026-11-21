import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, ROOT } from "./content.mjs";
import { layout, script } from "./pages.mjs";

/*
 * The home page: what Lines is for, in a few words and many pictures (site/images/, which
 * screenshots.mjs takes), what notes can become, the looks, the plugins, and the downloads.
 */

/** The apps of the latest release, by system, with the files there are for each. */
const SYSTEMS = [
  { id: "mac", name: "Mac", about: "Apple silicon and Intel", files: [".dmg"] },
  { id: "windows", name: "Windows", about: "64-bit, Windows 10 and later", files: ["-setup.exe", ".msi"] },
  { id: "linux", name: "Linux", about: "64-bit, Ubuntu 22.04 and later", files: [".AppImage", ".deb", ".rpm"] },
  { id: "android", name: "Android", about: "Phones and tablets, Android 7 and later", files: [".apk"] },
];

/** A system's files in the release, the one to offer first. */
const filesFor = (system, release) =>
  release ? system.files.map((suffix) => release.assets.find((asset) => asset.name.endsWith(suffix))).filter(Boolean) : [];

/** The systems the release has an app for. */
const available = (release) => SYSTEMS.filter((system) => filesFor(system, release).length);

const hasAndroid = (release) => available(release).some((system) => system.id === "android");

/** "Mac, Windows and Linux", as people write a list. */
const list = (words) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words.join(""));

/** What Lines is for, each in a sentence or two: the README's "What you can do with it". */
function usesFor(release) {
  const android = hasAndroid(release);
  return [
    {
      icon: "pen-line",
      title: "Write and think",
      text: "A quiet page that tidies itself up as you type. Plain Markdown underneath, tags instead of folders, and search that finds anything.",
    },
    {
      icon: "library",
      title: "Keep what you read, watch and listen to",
      text: "Paste a link to a book, a film or a podcast, and it fills itself in. Read your own books, follow the sites you love, and listen as you write.",
      link: ["docs/library.html", "The Library"],
    },
    {
      icon: "calendar-days",
      title: "Plan your days",
      text: "A calendar of your notes, events that repeat, and one list of every open todo. Choose a day to start a note for it.",
    },
    {
      icon: "shield-check",
      title: "Yours, private and offline",
      text: "Your notes live on your device. No account, no ads, no tracking. Sync where you choose, encrypted end to end if you like.",
      link: ["docs/sync.html", "Sync"],
    },
    {
      icon: "folder-input",
      title: "Bring your notes with you",
      text: "Move from Obsidian, Bear, Logseq, Notion or Evernote with your tags, links and pictures. Take everything out as plain files whenever you like.",
      link: ["docs/importing.html", "Importing"],
    },
    {
      icon: "monitor-smartphone",
      title: "On every device",
      text: android
        ? "Apps for Mac, Windows, Linux and Android, and the web app in any browser. The iPhone app is on its way."
        : "Apps for Mac, Windows and Linux, and the web app in any browser. Apps for Android and iPhone are on their way.",
      link: ["#download", "Get Lines"],
    },
  ];
}

const KINDS = [
  {
    picture: "latex",
    icon: "graduation-cap",
    label: "Papers",
    title: "Write it the way it will print",
    text: "Theorems, proofs and equations in LaTeX, drawn as you type. Make the PDF right in the app, or take a .tex file that works anywhere.",
    link: ["docs/latex.html", "LaTeX notes"],
  },
  {
    picture: "spreadsheet",
    icon: "sheet",
    label: "Spreadsheets",
    title: "Numbers that add up",
    text: "Formulas with the keys and functions you know from Excel, and money and dates shown your way. Open and save CSV and Excel files.",
    link: ["docs/spreadsheets.html", "Spreadsheets"],
  },
  {
    picture: "diagrams",
    icon: "box",
    label: "Diagrams and models",
    title: "Plans you can see",
    text: "A few lines of text become a flowchart or a timing diagram. Sketch by hand, or make a 3D model to turn around and print.",
    link: ["docs/linedown.html#3d-models", "Diagrams and models"],
  },
];

const MORE = [
  ["sigma", "Math"],
  ["pen-tool", "Drawings"],
  ["code-xml", "Code"],
  ["send", "API requests"],
  ["play", "Audio and video"],
  ["headphones", "Spotify and SoundCloud"],
  ["keyboard", "Typing practice"],
  ["square-terminal", "Terminal recordings"],
  ["printer", "PDF and print"],
  ["lock", "Locked notes"],
  ["key-round", "Secrets"],
];

const THEMES = ["Sepia", "Nord", "Catppuccin", "Ember"];

/** One of the icons the app draws (Lucide's), as SVG. */
function icon(name, className = "size-5") {
  const source = readFileSync(join(ROOT, `node_modules/@lucide/svelte/dist/icons/${name}.svelte`), "utf8");
  const data = source.match(/__iconData = (\{.*\});/);
  if (!data) throw new Error(`The ${name} icon isn't where @lucide/svelte used to keep it`);
  const { node } = JSON.parse(data[1]);
  const shapes = node.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(" ")}/>`).join("");
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}

/** A WebP picture's size, from its header, so the page saves its room before it loads. */
function size(file) {
  const bytes = readFileSync(join(ROOT, "site/images", file));
  switch (bytes.toString("ascii", 12, 16)) {
    case "VP8X":
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    case "VP8L": {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    default:
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
}

/** A picture of the app, light or dark as the visitor's system is. */
function picture(name, alt, { lazy = true } = {}) {
  const light = `${name}-light.webp`;
  const { width, height } = size(light);
  return `<picture>
          <source media="(prefers-color-scheme: dark)" srcset="images/${name}-dark.webp" />
          <img src="images/${light}" width="${width}" height="${height}" alt="${alt}" class="shot"${lazy ? ' loading="lazy" decoding="async"' : ""} />
        </picture>`;
}

const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

/** A place to get Lines: its name, what it runs on, and how to get it there. */
const card = (name, about, action = "") => `<li class="flex flex-col rounded-xl border border-card-line bg-card p-5 shadow-card">
            <h3 class="text-lg font-semibold">${name}</h3>
            <p class="mt-1 text-sm text-muted">${about}</p>
            ${action}
          </li>`;

function downloads(release) {
  const extension = (asset) => asset.name.slice(asset.name.lastIndexOf(".") + 1);
  const apps = release
    ? SYSTEMS.map((system) => {
        const [first, ...others] = filesFor(system, release);
        if (!first) return system.id === "android" ? card(system.name, "Coming soon, to download and install yourself.") : "";
        return card(
          system.name,
          system.about,
          `<a href="${first.url}" class="button button-primary mt-5 self-start" data-system="${system.id}" data-name="${system.name}">Download .${extension(first)} <span class="font-normal opacity-80">${megabytes(first.size)}</span></a>
            ${others.length ? `<p class="mt-3 text-sm text-muted">Or ${others.map((asset) => `<a href="${asset.url}">.${extension(asset)}</a>`).join(", ")}</p>` : ""}`,
        );
      })
    : [card("Mac, Windows and Linux", "The apps are on Lines' releases.", `<a href="${REPO}/releases" class="button mt-5 self-start">See the releases</a>`)];
  const cards = [
    ...apps,
    card("iPhone and iPad", "Coming soon, through TestFlight."),
    card("In your browser", "Nothing to install. Chrome, Edge, Safari or Firefox.", `<a href="app/" class="button mt-5 self-start">Open the web app</a>`),
  ].filter(Boolean);
  const android = hasAndroid(release);
  const date = release && new Date(release.date).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${release ? `<p class="mt-3 text-center text-muted">Lines ${release.version}, ${date}. <a href="docs/changelog.html">What's new</a></p>` : ""}
        <ul class="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          ${cards.join("\n          ")}
        </ul>
        <div class="mx-auto mt-8 max-w-3xl text-center text-sm text-muted">
          <p>Lines is still in alpha: it changes often and may have bugs, so export your notes now and then.</p>
          <p class="mt-2">The Mac app is signed and notarized by Apple, so it opens like any other app. The Windows app isn't signed yet: choose More info → Run anyway.${android ? " On Android, open the downloaded file, and allow your browser or Files app to install apps when it asks." : ""}${release ? ` <a href="${release.url}">All of this release's files</a>` : ""}</p>
        </div>`;
}

/** The download button offers the visitor's system's app, when there's one for it. */
function offerYourSystem() {
  const platform = (navigator.userAgentData?.platform || navigator.platform).toLowerCase();
  // iPads say they're Macs.
  const mac = platform.startsWith("mac") && navigator.maxTouchPoints < 2;
  const android = /android/i.test(navigator.userAgent);
  const linux = platform.includes("linux") && !android;
  const system = mac ? "mac" : platform.startsWith("win") ? "windows" : linux ? "linux" : android ? "android" : "";
  const app = system && document.querySelector(`[data-system="${system}"]`);
  const button = document.getElementById("download-button");
  if (!app || !button) return;
  button.href = app.href;
  button.textContent = `Download for ${app.dataset.name}`;
}

/** Lines installed from the web app, when it was where the home page is now, opens the app. */
function openInstalled() {
  if (matchMedia("(display-mode: standalone)").matches) location.replace("app/");
}

const more = ([href, label], spacing = "mt-4") => `<a href="${href}" class="more ${spacing}">${label}${icon("arrow-right", "size-4")}</a>`;

export function home({ release }) {
  const pitch = "Your notes and ideas, the books, films and podcasts you love, and the week ahead, together in one quiet place. It lives on your device, needs no account, and syncs only where you choose.";

  const uses = usesFor(release)
    .map(
      (use) => `<li class="flex flex-col">
            <span class="value-icon">${icon(use.icon)}</span>
            <h3 class="mt-4 text-lg font-semibold text-balance">${use.title}</h3>
            <p class="mt-1.5 text-muted">${use.text}</p>
            ${use.link ? more(use.link, "mt-auto pt-3") : ""}
          </li>`,
    )
    .join("\n          ");

  const kinds = KINDS.map(
    (kind, i) => `<div class="grid items-center gap-8 md:grid-cols-5 md:gap-14">
          <div class="md:col-span-2${i % 2 ? " md:order-last" : ""}">
            <p class="flex items-center gap-2 text-sm font-semibold text-accent">${icon(kind.icon, "size-4")}${kind.label}</p>
            <h3 class="mt-3 text-2xl font-bold tracking-tight">${kind.title}</h3>
            <p class="mt-3 text-lg text-muted">${kind.text}</p>
            ${more(kind.link)}
          </div>
          <div class="md:col-span-3">${picture(kind.picture, `A note in Lines: ${kind.title.toLowerCase()}`)}</div>
        </div>`,
  ).join("\n        ");

  const themes = THEMES.map((theme) => {
    const file = `theme-${theme.toLowerCase()}.webp`;
    const { width, height } = size(file);
    return `<li><img src="images/${file}" width="${width}" height="${height}" alt="Lines in ${theme}" class="shot" loading="lazy" decoding="async" /><p class="mt-2 text-center text-sm text-muted">${theme}</p></li>`;
  }).join("\n          ");

  return layout({
    page: "index.html",
    title: "Lines: a calm, private space for everything you keep",
    description: `${pitch} Free and open source.`,
    head: `\n    ${script(openInstalled)}`,
    body: `    <main id="main">
      <section class="mx-auto max-w-5xl px-4 pt-14 text-center sm:px-6 sm:pt-24">
        <h1 class="mx-auto max-w-3xl text-display font-bold text-balance">A calm, private space for everything you keep.</h1>
        <p class="mx-auto mt-6 max-w-2xl text-xl text-pretty text-muted">${pitch}</p>
        <div class="mt-9 flex flex-wrap justify-center gap-3">
          <a href="app/" class="button button-primary button-large">Open in your browser</a>
          <a href="#download" id="download-button" class="button button-large">Download</a>
        </div>
        <p class="mt-4 text-sm text-faint">Free and open source. ${list([...(release ? available(release).map((system) => system.name) : ["Mac", "Windows", "Linux"]), "the web"])}. No account needed.</p>
      </section>
      <div class="mx-auto mt-14 max-w-6xl px-4 sm:px-6">
        ${picture("app", "Lines: tags in the sidebar, the list of notes, and a note with a callout, todos and a table", { lazy: false })}
      </div>

      <section aria-labelledby="uses" class="mx-auto mt-28 max-w-5xl px-4 sm:px-6">
        <h2 id="uses" class="section-title text-center">What you can do with it</h2>
        <ul class="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          ${uses}
        </ul>
      </section>

      <section aria-labelledby="kinds" class="mx-auto mt-32 max-w-6xl px-4 sm:px-6">
        <div class="mx-auto max-w-2xl text-center">
          <h2 id="kinds" class="section-title">When a note needs to be more</h2>
          <p class="mt-4 text-lg text-muted">Some thoughts need more than words. Any note can become a paper, a spreadsheet or a plan you can see.</p>
        </div>
        <div class="mt-16 grid gap-24">
        ${kinds}
        </div>
        <ul class="mx-auto mt-20 flex max-w-3xl flex-wrap justify-center gap-2.5" aria-label="And">
          ${MORE.map(([name, label]) => `<li class="chip">${icon(name, "size-4")}${label}</li>`).join("\n          ")}
        </ul>
      </section>

      <section aria-labelledby="themes" class="mx-auto mt-32 max-w-6xl px-4 sm:px-6">
        <div class="mx-auto max-w-2xl text-center">
          <h2 id="themes" class="section-title">Make it feel like yours</h2>
          <p class="mt-4 text-lg text-muted">Twenty-six themes, each light and dark, including High Contrast and two for color blindness. Write on ruled or dotted paper, choose your fonts, or make a theme from a picture you love.</p>
        </div>
        <ul class="mt-12 grid grid-cols-2 gap-5 lg:grid-cols-4">
          ${themes}
        </ul>
      </section>

      <section aria-labelledby="plugins" class="mx-auto mt-32 max-w-6xl px-4 sm:px-6">
        <div class="grid items-center gap-8 md:grid-cols-5 md:gap-14">
          <div class="md:col-span-2">
            <p class="flex items-center gap-2 text-sm font-semibold text-accent">${icon("puzzle", "size-4")}Plugins</p>
            <h2 id="plugins" class="mt-3 section-title">Only what you need</h2>
            <p class="mt-3 text-lg text-muted">Lines is a small app with plugins around it, like a code editor. Turn off what you don't use, and nothing in your notes changes.</p>
            ${more(["docs/plugins.html", "How plugins work"])}
          </div>
          <div class="md:col-span-3">${picture("plugins", "Settings in Lines, listing its plugins, each with a switch")}</div>
        </div>
      </section>

      <section aria-labelledby="download" class="mx-auto mt-32 max-w-5xl scroll-mt-6 px-4 sm:px-6">
        <h2 id="download" class="section-title text-center">Get Lines</h2>
        ${downloads(release)}
      </section>
    </main>
    ${script(offerYourSystem)}`,
  });
}
