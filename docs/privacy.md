# Privacy policy

Effective 21 November 2026.

Lines is a notes app that keeps your notes on your device. It collects nothing about you. It talks to other sites only when you use a feature that needs one, and then sends that site only what the feature needs. This page says what that is, feature by feature.

It covers the Lines apps for Mac, Windows, Linux, iPhone, iPad and Android, the web app at [olekslitus.com/lines/app](https://olekslitus.com/lines/app/), and this website.

## Who makes Lines

Lines is made by Oleksandr Litus, an independent developer. For questions about this policy, or about privacy in Lines, [open an issue on GitHub](https://github.com/olekslitus/lines/issues). Issues are public, so please don't put anything private in one.

Lines is free and open source: anyone can read its code and check what this page says.

## What Lines collects

Nothing. There's no Lines account and no Lines server. Lines has no analytics, no ads, no tracking and no crash reports. Nothing you write, and nothing about how you use Lines, is sent to its developer.

Your notes, their pictures and files, your settings and everything else Lines keeps stay on your device ([Storage](storage.md) lists where). They leave it only in the ways below.

## What leaves your device, and when

Each of these happens only when you use the feature. Whatever site Lines talks to sees your IP address, as with any visit to a website, and that site's own privacy policy applies to what it receives.

### Sync

Sync is off until you set it up. Then Lines copies your notes, their pictures and files, and a few small files that sync with them (such as your tags' icons, and which feed posts you've read) to the storage you chose, and nowhere else:

- **A folder or a cloud drive**: Save to a folder on the web, or in the desktop apps a drive such as iCloud Drive, Google Drive, Dropbox or OneDrive. Lines writes files into the folder, and the drive's own app uploads them.
- **An S3-compatible bucket**, such as Cloudflare R2, Backblaze B2 or Amazon S3. Lines sends the files to the bucket itself, signed with the keys you gave it, which are kept on your device.

With [end-to-end encryption](sync.md#end-to-end-encryption) on (Settings → Sync), everything is encrypted on your device before it leaves, so the drive or bucket only holds files it can't read. Without it, notes are stored there as plain Markdown, protected by your provider's access controls. See [Sync](sync.md).

### Looking things up for the Library

When you paste a link into a new note, Lines fills the note in by asking about that link. When you search in Add to Library, the words you type go to the catalog for what you're looking for. Only the link, an id read from it, or your search words are sent. Nothing from your notes. In the apps, Lines tells these services it's `lines/<version>` with a link to its code; nothing about you.

| Asked | What it's sent |
|---|---|
| The link's own site | The link, to read what its page says about itself |
| Open Library | A book's id or ISBN, or what you search for; covers come from covers.openlibrary.org |
| Wikidata, Wikipedia and Wikimedia Commons | A film's, show's, comic's or book's id, or a page's title, or what you search for |
| AniList | An anime's or manga's id, or what you search for |
| MangaDex (in the apps) | The id in a MangaDex link |
| Jikan (api.jikan.moe), which reads MyAnimeList | The id in a MyAnimeList anime link |
| MusicBrainz and the Cover Art Archive | A song's or album's id or link, or what you search for |
| Apple Podcasts (Apple's iTunes Search) | A podcast's or episode's id, or what you search for |
| SoundCloud | The link; in the apps, the track's page and its maker's feed |
| YouTube | The video's link; in the apps, the video's or channel's page |
| arXiv | A paper's id, or what you search for (in the apps) |

A cover is downloaded once and kept with its note. Settings → Library → Look up links turns this off, and then nothing is asked. Each source is a plugin you can also turn off in Settings → Plugins. [Where Lines looks](library.md#where-lines-looks) has the details.

Importing a YouTube playlist by its link (in the apps) reads the playlist from YouTube. Importing a Google Takeout file asks YouTube about each video by its id.

### Feeds and podcasts

When you subscribe to a feed, Lines fetches it from its site, and then again to see what's new: when Lines starts, and every 30 minutes while it's open (Settings → Library → Refresh feeds changes how often), asking only whether it changed. It also fetches the feed's picture, or its site's icon. When you open a post or play an episode, its pictures, transcript and sound come from wherever the feed says they are. A post that says nothing itself may have its page read, as for a link (Look up links turns that off too).

A Hacker News post's comments come from Hacker News' public APIs (hn.algolia.com, run by Algolia, and hacker-news.firebaseio.com), which are sent only the story's number. In the apps, feeds are asked for as `lines/<version>`. See [Feeds](library.md#feeds).

### AniList and MyAnimeList

If you sign in to AniList or MyAnimeList in Settings → Library, Lines keeps your anime list there and the Library in step. It sends the site your token and, for each anime, its id, status, score and how many episodes you've watched. Nothing else from your notes.

The token stays on your device, encrypted while the app lock is on, and goes only to its site. It isn't synced. MyAnimeList's sign-in comes back to Lines on your own device (`127.0.0.1`), not through any server. Sign Out forgets the token. See [AniList and MyAnimeList](library.md#anilist-and-myanimelist).

### Readwise

If you import from Readwise (Settings → Library → Readwise), the access token you paste is sent to readwise.io and nowhere else, used for that import, and not kept.

### Photos, GIFs, wallpapers and papers

- **`/unsplash`** sends what you type, and your language, to Unsplash, and tells Unsplash which photo you picked, as its terms ask.
- **`/giphy`** sends what you type, and your language, to GIPHY.
- **`/wallhaven`** (in the apps) sends what you type to Wallhaven, and downloads the wallpaper you pick.
- **`/paper`** (in the apps) sends what you type to arXiv.

### Things from the web in your notes

A note can show things that are on other sites, and showing them means asking those sites for them:

- **Pictures on the web**: an Unsplash photo or a GIF from GIPHY (they're kept as links, and load each time they're shown), or any picture whose address is on the web, in a note or a feed's post.
- **YouTube links** on a line of their own show the video's picture, from YouTube's image server (i.ytimg.com), as soon as the note shows them. YouTube's player (youtube-nocookie.com) loads only when you press play.
- **Spotify and SoundCloud links** on a line of their own load the site's player only when you press play. Nothing reaches the site before.
- **Recordings on asciinema.org** load from asciinema.org when the note shows them.

The feature tour's note on pictures and files shows an Unsplash photo, so opening it asks Unsplash for the photo.

### Requests you write

API requests in a note go where they say, with what they say, when you send them. A secret you use in one is sent to that address.

### Opening and sharing

A link you open goes to its site: in your browser, or on iPhone and iPad in Safari's view over Lines, and on Android in a Custom Tab, unless you choose your browser in Settings → General. Sharing a note hands it to the app you pick in your system's share sheet.

### Updates, in the desktop apps

The Mac, Windows and Linux apps check for a new version soon after they start and every six hours, by asking GitHub's API for the list of Lines' releases (api.github.com). When a new one has been out long enough, it's downloaded from GitHub. These requests carry nothing about you or your notes. Turn off Update automatically in Settings → About and Lines stops checking by itself; Check now still asks.

The phone apps are updated by their app stores. The web app is a web page, always the newest.

## Permissions on phones

- **Internet** (Android's `INTERNET`), for the features above. Android doesn't ask about it.
- **Vibration** (Android's `VIBRATE`), for the small tap you feel when you pull far enough to refresh, or hold something to open its menu. On iPhone and iPad these taps need no permission.

That's all. Lines asks for no camera, microphone, location, contacts, calendar or photo library permission. Pictures and files you add come from your system's own picker, or from what you paste or drop, so Lines gets only what you choose.

On Android, Lines leaves itself out of the phone's backup to Google and out of moving to a new phone. Your notes come back through sync instead. On iPhone and iPad, your device's own backup (to iCloud or a computer) may include Lines' data, as it does other apps'.

## Your data, and deleting it

Everything Lines keeps is on your device, so it's yours to keep, export or delete:

- **Notes**: delete them in Lines, or export them all at any time (Settings → Export and Import → Export).
- **On a phone**, deleting the app deletes everything Lines kept there.
- **On a computer**, removing the app may leave its data folder behind; [Storage](storage.md#in-the-desktop-apps) says where it is, to delete it too.
- **In a browser**, clearing the site's data for olekslitus.com deletes the web app's notes.
- **Synced copies** are in your own drive or bucket. Delete them there.
- **Accounts you signed in to** (AniList, MyAnimeList): Sign Out in Settings → Library forgets the token on this device.

Lines' developer never receives your data, so there's nothing to ask him to show, change or delete, and nothing he could recover if you lose it.

## The web app and this website

The web app and this website are hosted on GitHub Pages. They set no cookies, run no analytics, and load nothing from other sites (but for the things from the web a note shows, above). GitHub sees ordinary request logs, as for any site: your IP address, your browser, and which files were loaded. It never sees what's in your notes. [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) applies.

The web app keeps your notes in your browser, on your computer. A browser keeps a site's storage by its domain, so the web app's storage is shared with other pages on olekslitus.com; [Storage](storage.md#shared-with-other-sites-on-the-same-domain) says more.

## Where you got Lines

The apps are downloaded from GitHub, Google Play or the App Store, whose own privacy policies apply. GitHub counts how many times each download is fetched. Google Play and the App Store show developers numbers such as how many people installed an app, and crash reports from people who chose, in their phone's settings, to share them with developers. Lines itself sends none.

## Children

Lines isn't directed at children under 13. It collects no personal information from anyone, children included.

## Changes to this policy

When this policy changes, the new one is posted on this page, with the date it takes effect at the top. Its history is in [Lines' repository](https://github.com/olekslitus/lines/commits/main/docs/privacy.md).
