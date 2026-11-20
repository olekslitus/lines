// Versions and releases (docs/releasing.md). Run with Bun (`bun scripts/release.mjs …`):
//
//   check-title "<title>"   whether a pull request's title (or a commit's subject) follows the
//                           commit convention (CONTRIBUTING.md); exits 1, saying why, if not
//   next                    the next version, worked out from the commits since the last release
//   prepare                 writes that version into the files that carry it and adds its notes to
//                           CHANGELOG.md; prints `version=…` (for GitHub Actions), or nothing
//                           when nothing since the last release calls for one
//   notes <version>         that version's notes from CHANGELOG.md, for its GitHub release
//   manifest <version> <dir>
//                           the update manifest (latest.json) the apps check for that version,
//                           from its packages' signatures (the .sig files) in <dir>
//   name-downloads <version> <target>
//                           names the installers and update packages Tauri built in <target> (its
//                           bundle folders, or Android's outputs) by the system they're for:
//                           lines_0.3.3_macos_universal.dmg, lines_0.3.3_android_universal.apk
//   check-android-signatures <dir>
//                           whether every APK and .aab in <dir> is signed by Lines' Android key
//                           alone; exits 1, saying which isn't, if not
//   check-mac-signature <target> [notarized]
//                           whether the Mac app Tauri built in <target> (the .app, the app in its
//                           update package, and the .dmg) is signed with Lines' Developer ID, ready
//                           to notarize, and with `notarized`, notarized and stapled; exits 1,
//                           saying what isn't, if not
//
// The version is in package.json (the app's About shows it), src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml and src-tauri/Cargo.lock; releases are tagged `v0.2.0`.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/olekslitus/lines";
const CHANGELOG = join(root, "CHANGELOG.md");

const TYPES = ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "revert", "style"];
/** `type(scope)!: subject`, the scope and `!` optional. */
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9 ,/-]*)\))?(?<breaking>!)?: (?<subject>\S.*)$/;
const MAX_TITLE = 100;
/** A release's own commit, which the release workflow tags (` (#45)` is GitHub's, on a squash merge). */
const RELEASE_TITLE = /^chore\(release\): v(?<version>\d+\.\d+\.\d+)(?: \(#\d+\))?$/;
/** What GitHub adds to a squash-merged pull request's title. */
const PR_NUMBER = /\s*\(#(\d+)\)$/;

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const read = (path) => readFileSync(join(root, path), "utf8");
const write = (path, text) => writeFileSync(join(root, path), text);
/** Runs a program, returning whether it succeeded and everything it printed. */
const run = (program, args) => {
  const { status, stdout, stderr, error } = spawnSync(program, args, { encoding: "utf8" });
  return { ok: status === 0, output: `${stdout ?? ""}${stderr ?? ""}${error?.message ?? ""}` };
};

/** Why `title` doesn't follow the convention, or null if it does. */
function titleProblem(title) {
  const match = CONVENTIONAL.exec(title);
  if (!match) return `"${title}" isn't "type(scope): what changed", e.g. "fix(sync): keep edits made while a pass runs".`;
  if (!TYPES.includes(match.groups.type)) return `"${match.groups.type}" isn't one of the types: ${TYPES.join(", ")}.`;
  if (title.replace(PR_NUMBER, "").length > MAX_TITLE) return `It's ${title.length} characters; keep it to ${MAX_TITLE}, and put the rest in the description.`;
  if (title.endsWith(".")) return "Leave out the full stop at the end.";
  return null;
}

/** The last release's tag (`v0.2.0`), if there's been one. */
function lastTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
  } catch {
    return null;
  }
}

/** The commits since `tag` (every one, before the first release), newest first. */
function commitsSince(tag) {
  const log = git("log", "--format=%s%x1f%b%x1e", ...(tag ? [`${tag}..HEAD`] : []));
  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ""] = entry.split("\x1f");
      // Only the convention's own types: "lines: …", from before it, is a plain subject.
      const match = CONVENTIONAL.exec(subject);
      if (match && !TYPES.includes(match.groups.type)) return { subject, body, breaking: false };
      const breaking = !!match?.groups.breaking || /^BREAKING[ -]CHANGE: /m.test(body);
      return { subject, body, ...match?.groups, breaking };
    })
    .filter((commit) => !RELEASE_TITLE.test(commit.subject));
}

const parse = (version) => version.split(".").map(Number);

/**
 * The version after `current` that `commits` call for, or null for none. Before 1.0, a breaking
 * change or a feature makes a minor release (0.2.0 → 0.3.0) and a fix a patch; from 1.0 on, a
 * breaking change makes a major one.
 */
function bump(current, commits) {
  const [major, minor, patch] = parse(current);
  if (commits.some((c) => c.breaking)) return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  if (commits.some((c) => c.type === "feat")) return `${major}.${minor + 1}.0`;
  if (commits.some((c) => c.type === "fix" || c.type === "perf")) return `${major}.${minor}.${patch + 1}`;
  return null;
}

/** A commit as a line of release notes, its pull request linked. */
function noteLine({ scope, subject }) {
  const text = subject.replace(PR_NUMBER, (_, n) => ` ([#${n}](${REPO}/pull/${n}))`);
  return `- ${scope ? `**${scope}:** ` : ""}${text}`;
}

/** The notes for a release: its breaking changes, features, fixes and speed-ups. */
function notes(commits, first) {
  const sections = [
    ["Breaking changes", commits.filter((c) => c.breaking)],
    ["Features", commits.filter((c) => c.type === "feat" && !c.breaking)],
    ["Fixes", commits.filter((c) => c.type === "fix" && !c.breaking)],
    ["Performance", commits.filter((c) => c.type === "perf" && !c.breaking)],
    // Before the convention, commits said what changed in their own words.
    ["Changes", first ? commits.filter((c) => !c.type) : []],
  ];
  return sections
    .filter(([, list]) => list.length)
    .map(([title, list]) => `### ${title}\n\n${list.map(noteLine).join("\n")}`)
    .join("\n\n");
}

/** The next release: its version and notes, or null when nothing calls for one. */
function next() {
  const tag = lastTag();
  const current = JSON.parse(read("package.json")).version;
  const commits = commitsSince(tag);
  // The first release is the version package.json has.
  const version = tag ? bump(tag.slice(1), commits) : current;
  if (!version) return null;
  return { version, previous: tag, notes: notes(commits, !tag) };
}

/** Writes `version` into every file that carries it. */
function setVersion(version) {
  const replace = (path, pattern, label) => {
    const text = read(path);
    if (!pattern.test(text)) throw new Error(`No ${label} in ${path}`);
    write(path, text.replace(pattern, `$1${version}$2`));
  };
  replace("package.json", /("version": ")[^"]+(")/, "version");
  replace("src-tauri/tauri.conf.json", /("version": ")[^"]+(")/, "version");
  replace("src-tauri/Cargo.toml", /(\[package\][^[]*?\nversion = ")[^"]+(")/, "[package] version");
  replace("src-tauri/Cargo.lock", /(\nname = "lines"\nversion = ")[^"]+(")/, "lines package");
}

const HEADER = "# Changelog\n\nWhat changed in each release of Lines. Written by `bun scripts/release.mjs prepare` from the commits since the release before (docs/releasing.md).\n";

/** Adds a release's notes at the top of CHANGELOG.md. */
function addToChangelog({ version, previous, notes: body }) {
  const date = new Date().toISOString().slice(0, 10);
  const link = previous ? `${REPO}/compare/${previous}...v${version}` : `${REPO}/releases/tag/v${version}`;
  const section = `## [${version}](${link}) (${date})\n\n${body || "Maintenance."}\n`;
  const text = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : HEADER;
  const at = text.indexOf("\n## ");
  writeFileSync(CHANGELOG, at < 0 ? `${text.trimEnd()}\n\n${section}` : `${text.slice(0, at + 1)}${section}\n${text.slice(at + 1)}`);
}

/** A version's notes, as CHANGELOG.md has them. */
function notesOf(version) {
  const text = readFileSync(CHANGELOG, "utf8");
  const start = text.indexOf(`\n## [${version}]`);
  if (start < 0) throw new Error(`CHANGELOG.md has no ${version}`);
  const body = text.slice(text.indexOf("\n", start + 1) + 1);
  const end = body.indexOf("\n## ");
  return (end < 0 ? body : body.slice(0, end)).trim();
}

/**
 * The installs each update package is for, by how its name ends: the apps look for
 * `{os}-{arch}-{installer}` in the manifest (src-tauri/src/updates.rs). One Mac app is for both.
 */
const PACKAGES = [
  [".app.tar.gz", () => ["darwin-aarch64-app", "darwin-x86_64-app"]],
  ["-setup.exe", (arch) => [`windows-${arch}-nsis`]],
  [".msi", (arch) => [`windows-${arch}-msi`]],
  [".AppImage", (arch) => [`linux-${arch}-appimage`]],
  [".deb", (arch) => [`linux-${arch}-deb`]],
  [".rpm", (arch) => [`linux-${arch}-rpm`]],
];

/** The update manifest for `version`: each package signed in `dir`, where to download it, and its signature. */
function manifest(version, dir) {
  const platforms = {};
  for (const name of readdirSync(dir).filter((name) => name.endsWith(".sig"))) {
    const file = name.slice(0, -".sig".length);
    const targets = PACKAGES.find(([end]) => file.endsWith(end))?.[1];
    if (!targets) continue;
    const arch = /aarch64|arm64/.test(file) ? "aarch64" : "x86_64";
    const url = `${REPO}/releases/download/v${version}/${encodeURIComponent(file)}`;
    for (const target of targets(arch)) platforms[target] = { url, signature: readFileSync(join(dir, name), "utf8").trim() };
  }
  if (!Object.keys(platforms).length) throw new Error(`No signed update packages in ${dir}`);
  return { version, pub_date: new Date().toISOString(), platforms };
}

/** The system each download is for, by how its name ends. */
const SYSTEMS = [
  [".dmg", "macos"],
  [".app.tar.gz", "macos"],
  ["-setup.exe", "windows"],
  [".msi", "windows"],
  [".AppImage", "linux"],
  [".deb", "linux"],
  [".rpm", "linux"],
  [".apk", "android"],
  [".aab", "android"],
];

/**
 * A download's name with the system it's for after the version, as Tauri names it otherwise, and
 * in lower case, as Tauri names it after the app (`Lines_0.3.3_universal.dmg`):
 * `lines_0.3.3_macos_universal.dmg`, `lines_0.3.3_windows_x64.msi`, `lines_0.3.3_linux_amd64.deb`,
 * and `lines_0.3.3_linux_x86_64.rpm` (`Lines-0.3.3-1.x86_64.rpm`). The Mac's update package,
 * `Lines.app.tar.gz`, gets the version and `universal` too: the Mac app is one for both kinds of Mac.
 * Android's, `app-universal-release.apk` and `.aab`, become `lines_0.3.3_android_universal.apk`; an
 * unsigned one (`app-universal-release-unsigned.apk`) isn't renamed. Signatures (`.sig`) follow their
 * file. Other files keep their names.
 */
export function downloadName(file, version) {
  const system = SYSTEMS.find(([end]) => file.replace(/\.sig$/, "").endsWith(end))?.[1];
  if (!system) return file;
  const lower = file.replace(/^Lines(?=[_.-])/, "lines");
  const named = lower.startsWith("lines.app.tar.gz")
    ? `lines_${version}_universal${lower.slice("lines".length)}`
    : lower.replace(/^app-(\w+)-release\./, `lines_${version}_$1.`);
  const versioned = new RegExp(`^lines[_-]${version.replaceAll(".", "\\.")}(?:-1)?[_.](?!${system}_)`);
  return named.replace(versioned, `lines_${version}_${system}_`).replace("_en-US", "");
}

/** The folders in `dir`, if it's there. */
const folders = (dir) => (existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)).filter((path) => statSync(path).isDirectory()) : []);

/** Where Tauri puts the desktop apps it built in `target`: `release/bundle/`, and `<target triple>/release/bundle/`. */
const bundleFolders = (target) => [join(target, "release", "bundle"), ...folders(target).map((dir) => join(dir, "release", "bundle"))];

/**
 * Renames what Tauri built in `target` as downloadName says: the desktop apps in `src-tauri/target`
 * (`…/release/bundle/<kind>/`, for any target triple), or Android's in `src-tauri/gen/android`
 * (`app/build/outputs/apk/<abi>/release/` and `app/build/outputs/bundle/<abi>Release/`).
 */
function nameDownloads(version, target) {
  const android = join(target, "app", "build", "outputs");
  const apks = folders(join(android, "apk")).map((dir) => join(dir, "release"));
  const appBundles = folders(join(android, "bundle")).filter((dir) => dir.endsWith("Release"));
  for (const folder of [...bundleFolders(target).flatMap(folders), ...apks, ...appBundles].filter((dir) => existsSync(dir))) {
    for (const file of readdirSync(folder)) {
      const name = downloadName(file, version);
      if (name !== file && statSync(join(folder, file)).isFile()) {
        renameSync(join(folder, file), join(folder, name));
        console.log(`${file} → ${name}`);
      }
    }
  }
}

/** The SHA-256 fingerprint of the certificate in lines' Android key (docs/releasing.md). */
const ANDROID_CERTIFICATE = "32:18:95:64:7F:13:07:2C:79:6C:C1:3B:A7:3B:21:C2:B4:19:75:82:15:BE:10:EE:BB:8D:EC:45:21:E4:81:12";

/**
 * Checks that every APK and app bundle in `dir` is signed by lines' Android key and nothing else:
 * apksigner for an APK, from the SDK at $ANDROID_HOME, and the JDK's jarsigner and keytool for an
 * .aab. Exits 1, saying which, if any isn't, or if there are none.
 */
function checkAndroidSignatures(dir) {
  const hex = (fingerprint) => fingerprint.replaceAll(":", "").toLowerCase();
  const buildTools = join(process.env.ANDROID_HOME ?? "", "build-tools");
  const newest = existsSync(buildTools) ? readdirSync(buildTools).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1) : undefined;
  if (!newest) throw new Error(`No Android build tools in ${buildTools}: set ANDROID_HOME to the Android SDK`);
  const apksigner = join(buildTools, newest, "apksigner");
  const jdk = (program) => (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", program) : program);
  /** apksigner's report on an APK; for an app bundle, jarsigner's check and then keytool's list of its certificates. */
  const verify = (path) => {
    if (path.endsWith(".apk")) return run(apksigner, ["verify", "--print-certs", path]);
    const jar = run(jdk("jarsigner"), ["-verify", path]);
    return jar.ok && jar.output.includes("jar verified.") ? run(jdk("keytool"), ["-printcert", "-jarfile", path]) : { ok: false, output: jar.output };
  };

  const files = readdirSync(dir, { recursive: true }).filter((file) => /\.(apk|aab)$/.test(file));
  if (!files.length) throw new Error(`No APK or app bundle in ${dir}`);
  let wrong = 0;
  for (const file of files) {
    const { ok, output } = verify(join(dir, file));
    const signers = [...output.matchAll(/(?:certificate SHA-256 digest: |SHA256: )([0-9A-Fa-f:]+)/g)].map((match) => hex(match[1]));
    if (ok && signers.length && signers.every((signer) => signer === hex(ANDROID_CERTIFICATE))) {
      console.log(`${file}: signed by Lines' key`);
    } else {
      wrong++;
      console.error(`${file}: not signed by Lines' key alone${signers.length ? ` (signed by ${signers.join(", ")})` : ""}\n${output.trim()}`);
    }
  }
  if (wrong) process.exit(1);
}

/** The certificate the Mac app is signed with, and its team (docs/releasing.md#the-mac-apps-signature). */
const MAC_IDENTITY = "Developer ID Application: OLEKSANDR LITUS (YT4AC6762J)";
const MAC_TEAM = "YT4AC6762J";

/**
 * Checks the Mac app Tauri built in `target`: that the .app, the app in the update package
 * (`.app.tar.gz`) and the .dmg are signed with Lines' Developer ID and a secure timestamp, the apps
 * with the hardened runtime, as notarization needs. With `notarized`, also that Gatekeeper accepts
 * them as notarized and that their tickets are stapled to them, so they open offline too. Exits 1,
 * saying what's wrong, if anything is, or if any of the three is missing.
 */
function checkMacSignature(target, notarized) {
  const bundled = (kind, end) =>
    bundleFolders(target)
      .map((dir) => join(dir, kind))
      .filter((dir) => existsSync(dir))
      .flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith(end)).map((name) => join(dir, name)));
  /** Each check of `path`, [what it is, whether it passed, what the tool said]. */
  const checks = (path) => {
    const app = path.endsWith(".app");
    const verified = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", path]);
    const { output } = run("codesign", ["--display", "--verbose=2", path]);
    const signed = [
      ["valid", verified.ok, verified.output],
      [`signed by ${MAC_IDENTITY}`, output.includes(`Authority=${MAC_IDENTITY}\n`) && output.includes(`TeamIdentifier=${MAC_TEAM}\n`), output],
      ["timestamped", /^Timestamp=/m.test(output), output],
      ...(app ? [["hardened", /^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*runtime/m.test(output), output]] : []),
    ];
    if (!notarized) return signed;
    const context = app ? ["--type", "execute"] : ["--type", "open", "--context", "context:primary-signature"];
    const assessed = run("spctl", ["--assess", "--verbose=2", ...context, path]);
    const stapled = run("xcrun", ["stapler", "validate", path]);
    return [...signed, ["notarized", assessed.ok && assessed.output.includes("source=Notarized Developer ID"), assessed.output], ["stapled", stapled.ok, stapled.output]];
  };

  const packages = bundled("macos", ".app.tar.gz");
  const unpacked = mkdtempSync(join(tmpdir(), "lines-update-"));
  let wrong = 0;
  try {
    const updates = packages.flatMap((file) => {
      const into = mkdtempSync(join(unpacked, "package-"));
      execFileSync("tar", ["-xzf", file, "-C", into]);
      return readdirSync(into).filter((name) => name.endsWith(".app")).map((name) => join(into, name));
    });
    const paths = [...bundled("macos", ".app"), ...updates, ...bundled("dmg", ".dmg")];
    if (!packages.length || updates.length !== packages.length || !paths.some((path) => path.endsWith(".dmg"))) {
      throw new Error(`No .app, update package with its app, and .dmg in ${target}'s bundle folders`);
    }
    for (const path of paths) {
      const all = checks(path);
      const failed = all.filter(([, ok]) => !ok);
      if (failed.length) {
        wrong++;
        const said = [...new Set(failed.map(([, , output]) => output.trim()))].join("\n");
        console.error(`${path} isn't ${failed.map(([what]) => what).join(", ")}\n${said}`);
      } else {
        console.log(`${path}: ${all.map(([what]) => what).join(", ")}`);
      }
    }
  } finally {
    rmSync(unpacked, { recursive: true, force: true });
  }
  if (!notarized) console.log("Notarization wasn't checked: the build had no App Store Connect key to notarize with.");
  if (wrong) process.exit(1);
}

const [command, arg, arg2] = process.argv.slice(2);
if (!import.meta.main) {
  // Imported, by its tests.
} else if (command === "check-title") {
  const problem = titleProblem(arg ?? "");
  if (problem) {
    console.error(`${problem}\nSee "Commits and pull requests" in CONTRIBUTING.md.`);
    process.exit(1);
  }
  console.log(`"${arg}" follows the convention.`);
} else if (command === "next" || !command) {
  const release = next();
  console.log(release ? `${release.version}\n\n${release.notes}` : "Nothing since the last release calls for a new one.");
} else if (command === "prepare") {
  const release = next();
  if (release) {
    setVersion(release.version);
    addToChangelog(release);
    console.log(`version=${release.version}`);
  }
} else if (command === "notes") {
  console.log(notesOf(arg));
} else if (command === "manifest") {
  console.log(JSON.stringify(manifest(arg, arg2), null, 2));
} else if (command === "name-downloads") {
  nameDownloads(arg, arg2);
} else if (command === "check-android-signatures") {
  checkAndroidSignatures(arg);
} else if (command === "check-mac-signature") {
  checkMacSignature(arg, arg2 === "notarized");
} else {
  console.error(`Unknown command "${command}". See the top of scripts/release.mjs.`);
  process.exit(1);
}
