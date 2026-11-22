# Sync with your own storage

Lines syncs through storage you already have. There's no Lines server and no account.

## Cloud drive (desktop apps)

In the Mac (and Windows/Linux) app, Settings → Sync → Cloud drive lists the drives on your computer: iCloud Drive, Google Drive, Proton Drive, Dropbox, OneDrive and Box. Pick one, or any folder. Lines keeps your notes in a `lines` folder there, one Markdown file per note (`lines/notes/<note-id>.md`, the same format as a bucket), and the drive's own app carries them to your other computers. Connect Lines on each of them to the same drive.

- Lines only ever touches its own files in that one folder: `.md` notes and their attachments (or, with end-to-end encryption, `.enc` files and `encryption.json`).
- macOS asks once for permission to use the drive's folder.
- If iCloud hasn't downloaded a note to this Mac yet, Lines asks it to and picks the note up on the next pass.
- A note's file another app saved with a byte order mark or Windows line endings, or as UTF-16, reads as usual. Bytes that aren't UTF-8 (a file saved as Latin-1, say) read as �, as they do from a bucket, rather than stop sync.
- The drive's app does the uploading, so Lines doesn't need to be online, and conflicts are handled just like with a bucket.
- When the drive itself finds two versions of a note's file it can't merge, it keeps one under the note's name and the other beside it: `<note-id> (MacBook's conflicted copy 2026-11-09).md` (Dropbox), `<note-id> 2.md` (iCloud), `<note-id> (1).md` (Google Drive), `<note-id>-MacBook.md` (OneDrive). Lines brings that one in as a “… (conflicted copy)” note, as for a conflict of its own (or nothing, if it says what the note does), and then deletes the drive's file: the copy syncs as a note of its own. Two devices bringing in the same file at once each make a copy.

On the web and on phones, use a bucket for now; signing in to iCloud, Google Drive and Proton Drive there is on the roadmap.

## S3-compatible bucket

Lines can also sync through any S3-compatible object storage you control.

Tested API surface: `ListObjectsV2`, `GetObject`, `PutObject` (with `If-Match` and `If-None-Match` where the provider supports them), `DeleteObject`. Any provider that implements these with AWS Signature V4 should work:

- Cloudflare R2
- Backblaze B2
- Amazon S3
- MinIO, Wasabi, Tigris, DigitalOcean Spaces, Hetzner Object Storage, Garage, …

## How it works

Your notes are always stored on the device first. Lines stays instant and works offline, and syncs in the background: about 2 seconds after you stop typing, every minute, when the app regains focus, and when you come back online.

Each note is a Markdown file in the bucket:

```
<bucket>/<folder>/notes/<note-id>.md
```

```markdown
---
id: 6f1c2a9e-…
created: 2026-10-28T14:43:00.000Z
updated: 2026-10-28T15:02:11.000Z
pinned: false
trashed: false
---
# My note

Plain Markdown, readable by any editor.
```

A note in the Inbox has an `inbox: true` line, and loses it once filed. A note with an icon has an `icon` line, and one with a color a `color` line. A note in another format has a `format` line, followed by its text: `format: latex` and its LaTeX ([latex.md](latex.md)), or `format: spreadsheet` and its title and CSV ([spreadsheets.md](spreadsheets.md#its-text)). A note imported from another app has a `source` line saying where it came from, as JSON ([importing.md](importing.md#importing-again)). A line Lines doesn't know, a newer version's, is kept as it is and written back when the note changes. A note changed on two devices at once keeps such lines of both, a line at a time, each as the side that changed it since has it (this device's, if both did), and they aren't part of its text, so one of them changed elsewhere is never an edit to keep a conflicted copy of. A version that retires such a line keeps its name known (read, and left out), so older versions that still have it don't bring it back.

Importing such a file (Settings → Export and Import → Import Files…) brings the note back as it was, with its id, unless a note on the device has that id; then it comes in as a note of its own, so an import never replaces one.

A note's own [properties](linedown.md#properties) are part of its text, so they come after this block, in a second one:

```markdown
---
id: 6f1c…
…
---
---
type: person
fullname: Oleksandr Litus
---
# Oleks
```

On each sync, Lines compares every note with what it last exchanged with the bucket (the object's ETag and a hash of its content):

| Situation | What happens |
| --- | --- |
| Changed on this device | Uploaded |
| Changed on another device | Downloaded, including into an open editor. Into a floating note being typed in, it's an edit on both devices (below) |
| Edited on both | The newer edit wins, and the other is saved as a separate note titled “… (conflicted copy)”, its properties and type kept (but a feed's subscription's `feed:`, when the note keeps the same feed, so the copy doesn't subscribe to it twice: a feed's address changed on one device stays in the copy, a second subscription to keep or put in the Trash, and a `feed:` that isn't a link is the note's own and stays; a spreadsheet's mark goes on its title line, not in its cells, a LaTeX document's in its `\title`, and a code note's in the comment its title comes from, or in a comment of its own above the line of code it's read from, never in its code; a note in another format whose title can't be marked that way, or a code note whose comment would read as a tag, as a C note's `#include` would, keeps its text as it is). Nothing is lost. |
| Edited on one, pinned, moved to the trash, filed or put in the Inbox, given an icon or locked on the other | Both kept, in one note: pinning and the rest don't count as edits. A note locked on either device stays locked, the edit inside it (or, on a device that doesn't have the password, the edit as a conflicted copy) |
| Deleted on one device | Deleted on the others, unless another device edited it in the meantime, in which case the edit wins |

If every note that synced is gone from the bucket or folder at once, that's as likely a drive that's signed out or the wrong folder as every note deleted elsewhere, so Lines changes nothing and sync stops until you say which, in Settings → Sync: **Delete them here too…** (asks first; notes edited here since they last synced are kept and uploaded), or **Upload them again**.

Images and files in notes sit next to them, named after their content and keeping their extension:

```
<bucket>/<folder>/attachments/<hash>.png
<bucket>/<folder>/attachments/<hash>.pdf
```

A note shows an image as `![](../attachments/<hash>.png)` and links a file as `[Report.pdf](../attachments/<hash>.pdf)`, so the folder reads correctly in other Markdown apps too. Since a name always means the same bytes, there's nothing to merge: each sync uploads the attachments your notes use that the bucket lacks, and downloads the ones this device lacks. Every device keeps a copy of every attachment, so large files take room everywhere. One no note uses any more is removed from the device at the next launch (one where Lines isn't open in another tab, which could still bring it back with undo), but stays in the bucket for now.

The icons and colors chosen for tags and types are one small file beside the notes, `<bucket>/<folder>/library.json` (encrypted like a note when encryption is on). Each choice keeps when it was made, so devices merge them one by one, the later winning: an icon chosen for a tag on the phone and a color for a type on the Mac both stay. A choice undone is kept as undone, so that syncs too. Icons chosen before they synced are the device's until another device chooses for the same tag or type.

What the Library's kinds are rated on ([library.md](library.md#ratings)) is a file of its own beside it, `<bucket>/<folder>/ratings.json` (encrypted likewise): each kind's scale and its named ratings, two choices of their own, and each scale of yours, merged the same way. A scale removed is kept as removed, so that syncs too, unless a kind is still rated on it on either device, which keeps it. A file of its own, so that a Lines from before ratings, which writes `library.json` back as it knows it, leaves them alone. The ratings themselves are properties of the notes, and sync with them.

What's been done with feeds' posts is a folder of small files beside them, `<bucket>/<folder>/feeds/`, one for each feed, named by a fingerprint of its address (encrypted like notes when encryption is on, under names that hide even that). Each says, for each post, when it was read, marked unread, dismissed (done with, or not interesting) and put back, under a fingerprint of the post's id (its guid, or its link and title), which every device that fetches the feed reads alike; a Dismiss All as one cut-off, everything published before it dismissed, rather than a mark for each post (undoing it puts back the one before, for every device); and the feed's horizon (below). Devices merge them mark by mark, the later winning (a mark made after another device's is later than it, whatever this device's clock says), and each applies them to the posts it has fetched, or fetches later ([library.md](library.md#feeds)).

- **What's sent:** each pass lists the folder (unless there are no feeds and nothing's been done with posts, when it isn't listed, nor made); a file is read only when its tag says it changed since this device last read it, and written only when this device knows more than it says (marks newer than its, or a horizon moved on), at most every 15 seconds while posts are being read and dismissed (and with any pass sooner). Files are written the same whenever what they say is, so two devices with the same marks never write them back and forth. A file the drive hasn't downloaded yet (iCloud's placeholder) is read on a later pass, and not written over meanwhile. A feed's file is about 130 bytes with one post marked, 1.8 KB with 30 read and dismissed, 16 KB with 200 read, dismissed and still in the feed, and after Dismiss All about 0.5 KB; a busy feed read 30 posts a day, each dismissed one by one, holds 90 days of them, about 150 KB (a third more encrypted).
- **How long marks stay:** a mark is kept while its post is in its feed, however old, so a new device (or one whose storage was cleared, or a browser that dropped the site's storage) shows a post dismissed years ago as dismissed: a device that fetches the feed says which marked posts are still in it, once a day. Once a post has been gone from its feed for 90 days, its mark is let go: the device that fetched moves the feed's horizon on, in the file, and every device that reads the file lets go of its marks from before it too, whether or not it fetches the feed, so none writes them back. A device away for less than 90 days finds every mark made meanwhile; every device that has the post keeps it as it was left. A post put back after Dismiss All keeps its mark while the cut-off stands, however old. Posts read before Lines synced this stay each device's own.
- **One tab syncs them.** With Lines open in several tabs of a browser, one of them syncs the feeds' marks; the others send it theirs as they're made, and each tab takes in every other's, so none writes over another's. When it closes, another takes over.
- **Feed filters:** beside them, `feeds/muted.json` has the words and phrases hidden in every feed (Settings → Library → Feed filters), the later setting winning. A feed's own filters are on its note.
- A drive's own conflicted copy of one of these files (`a1b2c3 2.json`) is merged in and removed, as a note's is.
- **What it shows:** a post's fingerprint hides nothing. A post's id is usually its public link or guid, so with encryption off, anyone who can read the folder can tell which posts of which feeds were read and dismissed, and when. End-to-end encryption hides it all, the files' names too.

Only one sync pass runs at a time, even with Lines open in several browser tabs, so a conflict makes one copy, not one per tab. Before a pass writes a note, here or there, it looks at the note as it's stored on the device, so a tab that hasn't yet heard of another tab's edit or deletion takes it up rather than write over it with its older copy.

A note is only written over the version Lines saw there a moment before, so an edit another device saves while this one syncs isn't overwritten: the next pass brings it in and compares, as above. In a bucket that's a conditional write (`If-Match`, or `If-None-Match` for a new note); a service that ignores those, or doesn't do them (it refuses a write over the very version it holds), is written to as before. In a cloud drive's folder, Lines looks at the file again just before writing it.

Several devices can share one bucket and folder. To keep separate libraries in one bucket, use different folders.

## End-to-end encryption

Settings → Sync → **Set up encryption…** encrypts notes and attachments on the device before they're uploaded, so the bucket or drive (and whoever runs it) only ever holds files it can't read:

```
<bucket>/<folder>/encryption.json             the library key, locked with your passphrase
<bucket>/<folder>/notes/<note-id>.enc         a note, encrypted
<bucket>/<folder>/attachments/<name>.enc      an attachment, encrypted, under a keyed hash of its name
```

- Notes and attachments are encrypted with AES-256-GCM under a random library key. Your passphrase only locks that key (PBKDF2-SHA-256, 600,000 iterations), so changing the passphrase doesn't re-upload anything, and devices that already have the key keep syncing.
- Each file is bound to its name, so one note can't be swapped for another.
- Attachment names are hidden too: a content hash would show whether a known file is in your library.
- Still visible: how many notes and attachments there are, their sizes, when they change, and note ids (random).

Turning it on syncs once, uploads everything again encrypted, and removes the plain copies. Every other device stops syncing until you enter the passphrase there (Settings → Sync). Turning it off does the reverse; other devices stop until it's turned off there too. Lines never goes back to plain files on its own, since anyone who can change the bucket could make that happen.

If you forget the passphrase, any device that still syncs can set a new one (Change passphrase…), since it already has the key. With no such device left, the encrypted notes can't be recovered; the copies on each device are unaffected.

With encryption on, the bucket no longer holds Markdown other apps can open; Settings → Export and Import → Export still makes a .zip of plain files, each in its note's format.

## Locked notes

A locked note (Lock Note, in its toolbar or menu) is encrypted on its own, whether end-to-end encryption is on or not. Its file keeps the usual front matter, plus a `locked` line, and its Markdown is encrypted:

```markdown
---
id: 6f1c2a9e-…
created: 2026-10-28T14:43:00.000Z
updated: 2026-10-28T15:02:11.000Z
pinned: false
trashed: false
locked: {"title":"Bank","files":[],"key":{"id":"…","changed":…,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"…","key":"…","check":"…"}}
---
AWeRtq…
```

- The Markdown is encrypted with AES-256-GCM under a random key that notes locked with the same password share. Each note carries that key, locked with the password (PBKDF2-SHA-256, 600,000 iterations), so it opens on any device where you type the password. A device that has no password of its own yet takes this one once it's typed.
- Changing the password locks the same key again, in every note that has it; they sync, and the new password opens them everywhere. "Forgot password" sets a new one for notes you lock from then on; notes already locked still need the old one.
- Each copy of the key carries a check made with the key itself (`check`: HMAC-SHA-256, under a key derived from it), so a device that has the key can tell a copy made by one of your devices from one someone put in its place. Anyone who can write to the bucket or folder could put a copy there that says it's newer: Lines never takes one on trust. A device keeps its own copy until a newer one holds the same key (the key vouches for it, or the password opens it and it holds the key the device's own copy is for); every copy is tried when you type the password, so a bad one can't hide a good one; and a copy that doesn't hold the key it names is refused and forgotten.
- Readable: the title, dates, pin and icon, and the names of the images and files it shows. Those images and files themselves aren't encrypted by the lock (end-to-end encryption does encrypt them). A note imported from another app says which, and what it was imported with (a vault's name), but of the note's id there (its path, which would say what folders it was in) only a hash, which importing again knows it by, and not its name there; unlocked again, it stays so.

## Setting up a bucket

1. Create a bucket (private, no public access needed).
2. Create an access key that can only read and write that bucket.
3. In Lines, open the sync button at the bottom of the sidebar, choose your provider, and enter the endpoint, bucket and keys.
4. **Only for the web app:** add a CORS rule (below). The desktop and mobile apps send requests from native code and don't need CORS.

### Cloudflare R2

- **Endpoint:** `https://<account-id>.r2.cloudflarestorage.com` (shown in the bucket's settings)
- **Keys:** R2 → *Manage API tokens* → *Create API token* → *Object Read & Write*, scoped to your bucket
- **Region:** `auto` (filled in for you)

### Backblaze B2

- **Endpoint:** shown on the bucket page, e.g. `https://s3.us-west-004.backblazeb2.com`
- **Keys:** *Application Keys* → *Add a New Application Key* with *Read and Write* access to your bucket
- **Region:** taken from the endpoint automatically

### Amazon S3

- **Endpoint:** `https://s3.<region>.amazonaws.com`
- **Keys:** an IAM user with a policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::my-notes" },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::my-notes/*"
    }
  ]
}
```

## CORS (web app only)

Browsers only let a web page call your bucket if the bucket allows the page's origin. Replace the origin with wherever you host Lines, e.g. `https://notes.example.com`.

**Amazon S3, Cloudflare R2, MinIO, and most others** (bucket → CORS settings):

```json
[
  {
    "AllowedOrigins": ["https://notes.example.com"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Backblaze B2** uses its own rule format. Its web UI only offers download-only rules, so set the rule with the [B2 CLI](https://www.backblaze.com/docs/cloud-storage-command-line-tools):

```json
[
  {
    "corsRuleName": "lines",
    "allowedOrigins": ["https://notes.example.com"],
    "allowedOperations": ["s3_get", "s3_head", "s3_put", "s3_delete"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ETag` is recommended. Without it sync still works, but it downloads a little more than necessary. A rule that lists the headers it allows, rather than `*`, needs `If-Match` and `If-None-Match` among them.

## Security notes

- Credentials are stored on the device. The bucket's secret key and the end-to-end encryption key are in the system's keychain in the Mac, iPhone, iPad and Windows apps (the login keychain, the Keychain, Credential Manager), and the rest of the connection in the app's data folder. The web app keeps them in the browser's local storage, and the Linux and Android apps in their data folder, for now. Use a key limited to a single bucket, and revoke it if a device is lost.
- Without end-to-end encryption (above), notes are stored in your bucket unencrypted, protected by your provider's access controls.
- The app lock (Settings → Privacy) encrypts what's on the device too: notes, attachments, and these credentials (but for the keys in a keychain, which the system protects).
- Locking a note replaces its plain copy in the bucket with the encrypted one. A bucket that keeps old versions (S3 versioning, a drive's file history) may still hold the plain one from before.
