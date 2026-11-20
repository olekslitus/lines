# Releasing

Lines is released from GitHub: a bot keeps the next release's pull request ready, and merging it tags the version, builds the desktop and Android apps and publishes them. Nobody bumps a version or writes release notes by hand; both come from the pull requests' titles ([CONTRIBUTING.md](../CONTRIBUTING.md#commits-and-pull-requests)).

## Versions

Versions are [semantic](https://semver.org) (`0.2.0`), tagged `v0.2.0`. While Lines is in alpha (0.x), a new feature or a breaking change makes a minor release (0.2.0 → 0.3.0), and fixes and speed-ups a patch (0.2.0 → 0.2.1). From 1.0 on, a breaking change makes a major one. Only `feat`, `fix` and `perf` pull requests (and breaking changes) call for a release: documentation, refactoring, tests, CI and dependency updates alone don't.

The version is in `package.json` (the app's About shows it), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`. `scripts/release.mjs` changes all four together.

## How a release happens

1. **Pull requests are merged into main.** Each push to main deploys the website (`website.yml`: the home page, the docs, and the web app at `app/`) and runs the checks (`checks.yml`).
2. **The release pull request follows.** After each merge, `release-pr.yml` works out the next version from the titles merged since the last release (`bun scripts/release.mjs prepare`). It opens, or updates, a pull request titled `chore(release): v0.3.0` from the branch `release/next`, with the four files bumped and the release's notes added to the top of `CHANGELOG.md`, grouped into breaking changes, features, fixes and performance, each linking its pull request. GitHub holds the checks of a pull request a workflow opens until someone approves them, so the workflow approves its own; if it can't, its run shows a warning, and a maintainer approves them from the pull request's Checks tab. When nothing merged calls for a release, it closes the pull request.
3. **A maintainer merges it** when it's time for a release (squash, as every pull request). Up to then it keeps up with what's merged; changes made to its `CHANGELOG.md` by hand last until the next merge redoes it, so make them just before merging.
4. **`release.yml` releases it.** On the merged `chore(release): v…` commit it:
   - tags `v0.3.0` and drafts a GitHub release named "Lines 0.3.0", with the notes from `CHANGELOG.md` under a line on the alpha, on opening unsigned apps and on installing the Android app;
   - builds the desktop apps from the tag, with TeX included and Unsplash's and GIPHY's keys from the repository's secrets: a universal Mac app (`.dmg`, Apple silicon and Intel), Windows (`.msi` and a `-setup.exe`), and Linux (`.AppImage`, `.deb`, `.rpm`, built on Ubuntu 22.04 so they run on it and later), with the signed packages the apps update themselves from ([Updates](#updates)), each named by the system it's for: `lines_0.3.3_macos_universal.dmg`, `lines_0.3.3_windows_x64-setup.exe`, `lines_0.3.3_linux_amd64.deb` (`bun scripts/release.mjs name-downloads`);
   - builds the Android app from the tag, signed with Lines' Android key ([Android](#android)), checks the signature, and attaches it: `lines_0.3.3_android_universal.apk`, to install from the release or the website, and `lines_0.3.3_android_universal.aab`, the same app for Google Play;
   - attaches them to the release, adds `latest.json`, the update manifest the apps read (`bun scripts/release.mjs manifest`), and publishes the release once every build has;
   - deploys the website again, so its home page offers the new release's downloads.

If a build fails, the release stays a draft with whatever was attached: fix the cause in a pull request, then re-run the failed job from the workflow run (it builds the tagged commit), or, if the fix has to be in the release, delete the draft and the tag and merge the next release pull request.

`bun scripts/release.mjs next` shows, locally, what the next release would be and its notes.

## Updates

The desktop apps update themselves from these releases (`src-tauri/src/updates.rs`; Settings → About → Updates). Versions up to 0.2.0 came before this, so people on them download the next one by hand, once.

- **Which version.** Soon after starting and every six hours, the app lists Lines' releases through GitHub's API and picks the newest one newer than itself that has been out for the wait chosen in Settings: a week unless changed, or none, a day, three days, two weeks or a month. Drafts and pre-releases are skipped. The wait gives time for a problem in a release to be found, and a fix released, before most people get it. A newer version still within its wait shows in Settings, with a button to install it now.
- **Downloading.** Each release has `latest.json`, naming a package for each kind of install (`darwin-aarch64-app`, `windows-x86_64-nsis`, `linux-x86_64-appimage`…) with its signature. The app downloads its own in the background, into its cache folder, and checks the signature, and the version signed with it, against the public key in `tauri.conf.json` (`plugins.updater.pubkey`).
- **Installing.** The package is installed as Lines quits, however it's quit, or straight away with Restart to update (in Settings, and beside the version in the sidebar). On a Mac the app is swapped for the new one (macOS asks for a password only if the app is somewhere its user can't change); on Windows the installer runs on its own, the MSI asking for permission since it installs for every user; on Linux the AppImage is replaced, and a `.deb` or `.rpm` install asks for a password.
- **Only installed apps.** Development builds (`bun run tauri dev`, debug builds) don't look for updates. An app built locally with `bun run tauri build` does, and updates to the next release once it has waited long enough.
- **Privacy.** A check asks GitHub for the list of releases; nothing about notes or settings is sent. With Update automatically off there are no checks; Lines looks only when asked. Turning it off also drops a version already downloaded, which is then offered with Install and restart rather than installed at quit.

### The identifier and the name

Lines' identifier is `com.olekslitus.lines` (`tauri.conf.json`). It names the app's data folders ([storage.md](storage.md#in-the-desktop-apps)), so changing it starts Lines over with no notes. It changed once, in 0.7, which copied the notes over from the old one's folders; later versions don't, so an install from before 0.7 should update to 0.7 first, or its notes stay behind.

Its name, `productName`, is "Lines": what the Mac's menus (About Lines, Quit Lines), the windows, the Start menu, Linux's app menus and the installers show. It was "lines" until the release after 0.7. No data is kept by the name, and the main program keeps the Cargo package's name, `lines`. The iPhone and iPad app's `PRODUCT_NAME` (`src-tauri/gen/apple`) and Android's `app_name` match it. Updates replace the app in place, whichever name it was installed under:

- **macOS**: the updater replaces the app where it is, putting what's in the update's `Lines.app` into the app that's running, so one installed as `lines.app` keeps that name in Applications, with Lines in its menus. Downloaded again, it's `Lines.app`, which replaces `lines.app` on the Mac's usual disks, as they don't tell names apart by case.
- **Windows**: the MSI upgrades the one installed because its upgrade code is the one Tauri derived from the old name, `lines`, pinned in `bundle.windows.wix.upgradeCode` so that the name can't change it. The NSIS installer finds the one installed by its uninstall key, `…\Uninstall\Lines`, and the folder it's in under `Software\<publisher>\Lines`: Windows doesn't tell registry keys or folders apart by case, so these are the `lines` ones an older install wrote, and the template looks for an MSI install by its name with `StrCmp`, which ignores case too. The publisher is the identifier's second part, `olekslitus`, since the release after 0.7; an install from before that was under another name, so an update of it goes to the default folder rather than one chosen when installing, and if a setup run over it stops on "unable to uninstall", uninstall the old Lines first.
- **Linux**: the `.deb` and `.rpm` packages are named for the product name in kebab case, which is still `lines`, so they upgrade the one installed; the AppImage is replaced where it is. None of them goes by the identifier.

Tauri names the files it builds after the product name (`Lines_0.3.3_universal.dmg`, `Lines.app.tar.gz`); `bun scripts/release.mjs name-downloads` gives the downloads their lowercase names, `lines_0.3.3_macos_universal.dmg`, as before.

### The signing key

`release.yml` has Tauri make and sign the update packages (`createUpdaterArtifacts`) with a private key kept in the repository's secrets, `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; its public half is in `tauri.conf.json`. Local builds make no update packages and need neither.

Installed apps accept only packages signed with that key, so keep a copy of it and its password somewhere safe besides the secrets. Lost, apps already installed can't update anymore and have to be downloaded again; a new pair (`bun tauri signer generate`) then goes in the secrets and its public key in `tauri.conf.json`.

## Android

`release.yml`'s `android` job builds the app with `bun run tauri android build --apk --aab` on Ubuntu, with the runner's Java 17, Android SDK and NDK, and Rust for each kind of Android processor.

- **Universal.** One APK for every Android device: phones and tablets (ARM, 64- and 32-bit) and Chromebooks and emulators (x86, 64- and 32-bit). The `.aab` holds the same four, and Google Play would hand each device only its own.
- **No TeX.** Tauri builds the app's pages into its native library, once for each kind of processor, so TeX's 120 MB would be in the APK four times. LaTeX notes work, and their PDF says TeX isn't included. OpenSCAD, about 3 MB compressed, is in.
- **Version code.** Android installs an APK over another only if its version code is higher. Tauri works it out from the version, major × 1,000,000 + minor × 1,000 + patch (0.7.0 is 7000, 1.2.3 is 1002003), so each release's is higher than the last's while minor and patch stay under 1,000.
- **The signature.** Before attaching them, `bun scripts/release.mjs check-android-signatures` checks that the APK (`apksigner`) and the `.aab` (`jarsigner`, `keytool`) are signed by Lines' key and no other, and the job fails if not.
- **No updates.** The app doesn't update itself; people install a newer APK over it, which keeps their notes ([limitations.md](limitations.md#the-iphone-ipad-and-android-apps)).

### The Android key

Android installs an update only if it's signed with the same key as the app already there. The key is a PKCS #12 keystore, alias `lines`, whose certificate's SHA-256 is `32:18:95:64:7F:13:07:2C:79:6C:C1:3B:A7:3B:21:C2:B4:19:75:82:15:BE:10:EE:BB:8D:EC:45:21:E4:81:12`.

- **Where it is.** On the maintainer's Mac, `~/.tauri/lines-android.jks`, with its password in the login Keychain (`security find-generic-password -a lines -s "lines Android signing key password" -w`); the store and the key share it. In the repository's secrets, `ANDROID_KEY_BASE64` (the keystore, base64) and `ANDROID_KEY_PASSWORD`. The job writes the keystore into the runner's temporary folder, and where it is, its alias and its password into `src-tauri/gen/android/keystore.properties`, which `app/build.gradle.kts` reads; that file and any `.jks` are kept out of git. The alias isn't read from a secret (`ANDROID_KEY_ALIAS` is there but unused): GitHub hides a secret's value wherever it's in a job's log, and `lines` is all through it.
- **Never lose it.** Keep a copy of the keystore and its password somewhere safe besides the Mac and the secrets. Lost, no later version can install over the Lines people have: each would have to uninstall it, losing the notes on that phone that aren't synced, and install one signed with a new key. Leaked, someone else could make an update phones would accept.
- **On Google Play later.** Upload this key as the app's signing key in Play App Signing, choosing to use an existing key (exported with Google's PEPK tool) rather than letting Google make one. Play then signs what it delivers with the same key as the APK on the website, so either installs over the other. Play's upload key can be another, made then.
- **Developer verification.** Google is to require apps installed on certified Android devices to be registered by a verified developer: in Brazil, Indonesia, Singapore and Thailand from 30 September 2026, worldwide in 2027 ([Google's announcement](https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html)). Registering Lines means verifying the developer account (in the Android Developer Console, or the Play Console once Lines is on Play) and registering the app's package name, `com.olekslitus.lines`, with this key. Until then, people where it's enforced need Android's advanced flow or `adb` to install it ([limitations.md](limitations.md#the-iphone-ipad-and-android-apps)).

## The first release

There's been no release yet. The first release pull request is for 0.1.0, the version `package.json` has, and its notes list every change so far (the commits from before the convention under "Changes").

## Not done yet

- **Signing.** The desktop apps aren't signed: macOS and Windows warn before opening a downloaded copy (the release notes say how to open it). Signing and notarizing the Mac app needs an Apple Developer ID; Windows needs a code-signing certificate. Both would be secrets the build job uses.
- **iPhone and iPad** builds, and the App Store; **Google Play** and Google's developer verification for the Android app ([The Android key](#the-android-key)).
- **Linux on ARM.**

## Settings this relies on

Set once in the repository on GitHub:

- **Branch protection on main**: pull requests only, for administrators too; the checks required (`conventions`, `cla`, `web`, and `rust` on each system); squash merging only, the pull request's title and description becoming the commit.
- **The `cla-signatures` branch**, where `cla.yml` records who agreed to the contributor agreement (`signatures/cla.json`); protected from force pushes and deletion.
- **Actions → General → Workflow permissions**: "Allow GitHub Actions to create and approve pull requests", for the release pull request.
- **Pages**: Source set to GitHub Actions, for the website.
- **Secrets**: `UNSPLASH_ACCESS_KEY` and `GIPHY_API_KEY`, for the website and the apps; `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, the key update packages are signed with ([The signing key](#the-signing-key)); `ANDROID_KEY_BASE64` and `ANDROID_KEY_PASSWORD`, the Android app's ([The Android key](#the-android-key)). A release fails to build without them.
