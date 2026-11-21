//! Sync through a folder that a cloud drive app keeps in sync: iCloud Drive, Google Drive,
//! Proton Drive, Dropbox, OneDrive… lines writes one Markdown file per note into the folder and
//! the drive's own app carries it to other devices.
//!
//! Images go in an `attachments` folder beside `notes`, as `<hash>.<ext>` files.
//!
//! File names are checked to be plain names of those kinds, or a drive's copy of one; the folder has
//! to be one the person chose for sync (`Folders`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Manager, State};

/// What the page is told when it asks for a folder that isn't one chosen for sync.
const CHOOSE_AGAIN: &str = "Choose a folder for sync again.";

/// The folders the page may sync through, so a page made to do something else can't write files
/// anywhere: one the person chose in the folder picker, or one in a cloud drive this computer has
/// (`sync_folder_use`). Once used, one is remembered in `file` (in the app's data folder), for the
/// next start.
pub struct Folders {
  file: Option<PathBuf>,
  kept: Mutex<Kept>,
}

#[derive(Default)]
struct Kept {
  /// Chosen in the folder picker since Lines started.
  picked: Vec<PathBuf>,
  /// Synced through: the page's folder commands work inside these.
  used: Vec<PathBuf>,
  /// Whether `file` was ever written. Until it is, a folder synced through before Lines kept this
  /// list is taken, as it already has notes in it.
  remembered: bool,
}

impl Folders {
  pub fn load(file: Option<PathBuf>) -> Self {
    let text = file.as_deref().and_then(|file| std::fs::read_to_string(file).ok());
    let used: Vec<String> = text.as_deref().and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default();
    let kept = Kept { picked: Vec::new(), used: used.into_iter().map(PathBuf::from).collect(), remembered: text.is_some() };
    Self { file, kept: Mutex::new(kept) }
  }

  fn kept(&self) -> std::sync::MutexGuard<'_, Kept> {
    self.kept.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
  }

  fn picked(&self, folder: PathBuf) {
    self.kept().picked.push(folder);
  }

  /// Lets the page sync through `root`, if it's one the person chose: picked, in one of `drives`,
  /// or used before.
  fn use_folder(&self, root: PathBuf, drives: &[Candidate]) -> Result<(), String> {
    let mut kept = self.kept();
    if kept.used.contains(&root) {
      return Ok(());
    }
    let chosen = kept.picked.contains(&root)
      || drives.iter().any(|drive| root.starts_with(&drive.path))
      || (!kept.remembered && root.join("notes").is_dir());
    if !chosen {
      return Err(CHOOSE_AGAIN.into());
    }
    kept.used.push(root);
    kept.remembered = true;
    if let Some(file) = &self.file {
      let used: Vec<_> = kept.used.iter().map(|folder| folder.to_string_lossy()).collect();
      let saved = file
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(file, serde_json::to_string(&used).unwrap_or_default()));
      // It's still used now; only the next start would ask for it again.
      if let Err(error) = saved {
        log::warn!("couldn't remember the sync folder: {error}");
      }
    }
    Ok(())
  }

  /// `dir`, if it's a folder sync uses or one inside it.
  fn inside(&self, dir: &str) -> Result<PathBuf, String> {
    let dir = folder(dir)?;
    if self.kept().used.iter().any(|root| dir.starts_with(root)) { Ok(dir) } else { Err(CHOOSE_AGAIN.into()) }
  }

  /// `name` in `dir`, which has to be inside a folder sync uses.
  fn file(&self, dir: &str, name: &str) -> Result<PathBuf, String> {
    let dir = self.inside(dir)?;
    file(&dir, name)
  }
}

/// A synced cloud folder found on this computer.
#[derive(Serialize)]
pub struct Candidate {
  /// "icloud", "google", "proton", "dropbox", "onedrive" or "box".
  provider: &'static str,
  name: String,
  path: String,
}

#[derive(Serialize)]
pub struct Entry {
  name: String,
  etag: String,
}

#[derive(Serialize)]
pub struct File {
  text: String,
  etag: String,
}

/// The cloud drive folders this computer has, best known first. Off the main thread, like the
/// other folder commands: looking into a drive's folder can wait on its app.
#[tauri::command]
pub async fn sync_folder_candidates(app: AppHandle) -> Vec<Candidate> {
  let Ok(home) = app.path().home_dir() else { return Vec::new() };
  tauri::async_runtime::spawn_blocking(move || candidates_in(&home)).await.unwrap_or_default()
}

fn candidates_in(home: &Path) -> Vec<Candidate> {
  let mut found = Vec::new();

  let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
  if icloud.is_dir() {
    found.push(candidate("icloud", "iCloud Drive".into(), icloud));
  }

  // Drives built on Apple's File Provider live here, one folder per account.
  if let Ok(entries) = std::fs::read_dir(home.join("Library/CloudStorage")) {
    let mut entries: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
      let dir = entry.file_name().to_string_lossy().into_owned();
      let account = |prefix: &str, suffix: &str| {
        dir.strip_prefix(prefix).map(|rest| rest.strip_suffix(suffix).unwrap_or(rest).to_string())
      };
      let path = entry.path();
      if let Some(account) = account("GoogleDrive-", "") {
        let my_drive = path.join("My Drive");
        let path = if my_drive.is_dir() { my_drive } else { path };
        found.push(candidate("google", format!("Google Drive ({account})"), path));
      } else if let Some(account) = account("ProtonDrive-", "-folder") {
        found.push(candidate("proton", format!("Proton Drive ({account})"), path));
      } else if dir.starts_with("Dropbox") {
        found.push(candidate("dropbox", "Dropbox".into(), path));
      } else if dir.starts_with("OneDrive") {
        let name = account("OneDrive-", "").filter(|a| !a.is_empty()).map_or("OneDrive".into(), |a| format!("OneDrive ({a})"));
        found.push(candidate("onedrive", name, path));
      } else if dir.starts_with("Box") {
        found.push(candidate("box", "Box".into(), path));
      }
    }
  }

  if cfg!(windows) {
    found.extend(windows_drives(home));
  }

  // Dropbox's older, non-File Provider location, and where its Windows and Linux apps keep it.
  let dropbox = home.join("Dropbox");
  if dropbox.is_dir() && !found.iter().any(|c| c.provider == "dropbox") {
    found.push(candidate("dropbox", "Dropbox".into(), dropbox));
  }
  found
}

/// Where the drives' Windows apps keep them: in the home folder, OneDrive's as "OneDrive" or
/// "OneDrive - <organization>"; Google Drive's as a drive of its own (G: unless changed) when it
/// streams files, or "My Drive" when it mirrors them.
fn windows_drives(home: &Path) -> Vec<Candidate> {
  let mut found = Vec::new();
  let mut entries: Vec<_> = std::fs::read_dir(home).into_iter().flatten().flatten().filter(|e| e.path().is_dir()).collect();
  entries.sort_by_key(|e| e.file_name());
  for entry in entries {
    let dir = entry.file_name().to_string_lossy().into_owned();
    let path = entry.path();
    match dir.as_str() {
      "OneDrive" => found.push(candidate("onedrive", "OneDrive".into(), path)),
      "iCloudDrive" => found.push(candidate("icloud", "iCloud Drive".into(), path)),
      "My Drive" => found.push(candidate("google", "Google Drive".into(), path)),
      "Box" => found.push(candidate("box", "Box".into(), path)),
      _ => {
        if let Some(organization) = dir.strip_prefix("OneDrive - ") {
          found.push(candidate("onedrive", format!("OneDrive ({organization})"), path));
        }
      }
    }
  }
  let streamed = Path::new(r"G:\My Drive");
  if !found.iter().any(|c| c.provider == "google") && streamed.is_dir() {
    found.push(candidate("google", "Google Drive".into(), streamed.to_path_buf()));
  }
  found
}

fn candidate(provider: &'static str, name: String, path: PathBuf) -> Candidate {
  Candidate { provider, name, path: path.to_string_lossy().into_owned() }
}

/// Lets the page sync through `path` from now on, if the person chose it: in the folder picker, or
/// in one of this computer's cloud drives. Asked before the other folder commands use it.
#[tauri::command]
pub async fn sync_folder_use(app: AppHandle, path: String) -> Result<(), String> {
  let root = folder(&path)?;
  let home = app.path().home_dir().map_err(|e| e.to_string())?;
  blocking(move || app.state::<Folders>().use_folder(root, &candidates_in(&home))).await
}

/// Every note or image file in `dir`: for `notes` and `attachments`, creating it if needed (which
/// also checks we may write there); for another (`feeds`), none if it isn't there, as it's made
/// only when a file is first written to it, so a sync folder with nothing for it has no such folder.
///
/// Only the sync folder and its `notes` and `attachments` folders are ever created by listing. If the folder they go in is gone
/// (a drive that's signed out, a folder that was moved), this fails rather than return an empty
/// list, which would look like every note had been deleted on another device.
#[tauri::command]
pub async fn sync_folder_list(folders: State<'_, Folders>, dir: String) -> Result<Vec<Entry>, String> {
  let dir = folders.inside(&dir)?;
  blocking(move || list(&dir)).await
}

fn list(dir: &Path) -> Result<Vec<Entry>, String> {
  let container = dir.parent().and_then(Path::parent).filter(|p| p.is_dir());
  if container.is_none() {
    return Err(format!("{} isn't available. Is the drive signed in?", dir.display()));
  }
  if matches!(dir.file_name().and_then(|name| name.to_str()), Some("notes" | "attachments")) {
    std::fs::create_dir_all(dir).map_err(|e| describe(dir, e))?;
  } else if !dir.is_dir() {
    return Ok(Vec::new());
  }
  let mut entries = Vec::new();
  for entry in std::fs::read_dir(dir).map_err(|e| describe(dir, e))?.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    if let Some(real) = icloud_placeholder(&name) {
      // Not downloaded to this Mac yet: ask for it, and list it so it doesn't look deleted.
      // Reading it finds nothing until it's here, so it's picked up on a later pass.
      request_download(&dir.join(real));
      entries.push(Entry { name: real.to_string(), etag: PLACEHOLDER.into() });
    } else if synced_name(&name)
      && let Ok(meta) = entry.metadata()
    {
      entries.push(Entry { name, etag: etag(&meta) });
    }
  }
  Ok(entries)
}

#[tauri::command]
pub async fn sync_folder_read(folders: State<'_, Folders>, dir: String, name: String) -> Result<Option<File>, String> {
  let path = folders.file(&dir, &name)?;
  blocking(move || read(&path)).await
}

fn read(path: &Path) -> Result<Option<File>, String> {
  let Some(bytes) = read_file(path)? else { return Ok(None) };
  let meta = std::fs::metadata(path).map_err(|e| describe(path, e))?;
  Ok(Some(File { text: decode(&bytes), etag: etag(&meta) }))
}

/// A note's text however another app saved it, read as a browser reads a bucket's: UTF-8 without
/// its byte order mark, anything that isn't UTF-8 replaced (�) rather than stop sync. Or UTF-16,
/// with its byte order mark.
fn decode(bytes: &[u8]) -> String {
  let utf16 = |rest: &[u8], unit: fn([u8; 2]) -> u16| {
    String::from_utf16_lossy(&rest.as_chunks::<2>().0.iter().map(|&pair| unit(pair)).collect::<Vec<_>>())
  };
  match bytes {
    [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
    [0xFF, 0xFE, rest @ ..] => utf16(rest, u16::from_le_bytes),
    [0xFE, 0xFF, rest @ ..] => utf16(rest, u16::from_be_bytes),
    _ => String::from_utf8_lossy(bytes).into_owned(),
  }
}

/// Writes a note and returns its new tag. Given the tag it's `expected` to have (empty for none),
/// only if it still has it: `None` if the drive brought in another device's version since.
#[tauri::command]
pub async fn sync_folder_write(
  folders: State<'_, Folders>,
  dir: String,
  name: String,
  text: String,
  expected: Option<String>,
) -> Result<Option<String>, String> {
  let path = folders.file(&dir, &name)?;
  blocking(move || write(&path, &text, expected)).await
}

fn write(path: &Path, text: &str, expected: Option<String>) -> Result<Option<String>, String> {
  if let Some(expected) = expected
    && etag_of(path)? != expected
  {
    return Ok(None);
  }
  let meta = write_atomic(path, text.as_bytes())?;
  Ok(Some(etag(&meta)))
}

/// The file's tag as listed, or an empty one if it isn't there.
fn etag_of(path: &Path) -> Result<String, String> {
  match std::fs::metadata(path) {
    Ok(meta) => Ok(etag(&meta)),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
    Err(e) => Err(describe(path, e)),
  }
}

/// Writes through a temporary file and a rename, so the drive never uploads half a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<std::fs::Metadata, String> {
  let parent = path.parent().ok_or("Invalid folder")?;
  let name = path.file_name().ok_or("Invalid file name")?.to_string_lossy();
  std::fs::create_dir_all(parent).map_err(|e| describe(parent, e))?;
  let temp = parent.join(format!(".{name}.saving"));
  std::fs::write(&temp, bytes).map_err(|e| describe(&temp, e))?;
  std::fs::rename(&temp, path).map_err(|e| describe(path, e))?;
  std::fs::metadata(path).map_err(|e| describe(path, e))
}

/// An attachment's bytes, as they are, or `null` if it isn't there (or the drive hasn't downloaded
/// it yet). An empty file is there, with no bytes.
#[tauri::command]
pub async fn sync_folder_read_file(folders: State<'_, Folders>, dir: String, name: String) -> Result<Response, String> {
  let path = folders.file(&dir, &name)?;
  blocking(move || {
    let bytes = read_file(&path)?;
    Ok(bytes.map_or_else(|| Response::new("null".to_string()), Response::new))
  })
  .await
}

fn read_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
  match std::fs::read(path) {
    Ok(bytes) => Ok(Some(bytes)),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(e) => Err(describe(path, e)),
  }
}

/// Writes an image: the raw request body, with the folder (percent-encoded) and file name in the
/// `x-dir` and `x-name` headers.
#[tauri::command]
pub async fn sync_folder_write_file(folders: State<'_, Folders>, request: Request<'_>) -> Result<(), String> {
  let bytes = crate::body::bytes(request.body()).ok_or("Expected the file's contents")?;
  let header = |key: &str| request.headers().get(key).and_then(|value| value.to_str().ok()).map(str::to_owned);
  let dir = header("x-dir").and_then(|dir| percent_decode(&dir)).ok_or("Missing folder")?;
  let name = header("x-name").ok_or("Missing file name")?;
  let path = folders.file(&dir, &name)?;
  blocking(move || write_atomic(&path, &bytes).map(|_| ())).await
}

/// `%2F`-style escapes, as `encodeURIComponent` writes them.
pub(crate) fn percent_decode(text: &str) -> Option<String> {
  let mut bytes = Vec::with_capacity(text.len());
  let mut rest = text.as_bytes();
  while let Some((&byte, tail)) = rest.split_first() {
    if byte == b'%' {
      let hex = std::str::from_utf8(tail.get(..2)?).ok()?;
      bytes.push(u8::from_str_radix(hex, 16).ok()?);
      rest = &tail[2..];
    } else {
      bytes.push(byte);
      rest = tail;
    }
  }
  String::from_utf8(bytes).ok()
}

/// Deletes a file. Given the tag it's `expected` to have, only if it still has it: `false` if the
/// drive brought in another device's version since.
#[tauri::command]
pub async fn sync_folder_delete(folders: State<'_, Folders>, dir: String, name: String, expected: Option<String>) -> Result<bool, String> {
  let path = folders.file(&dir, &name)?;
  blocking(move || delete(&path, expected)).await
}

fn delete(path: &Path, expected: Option<String>) -> Result<bool, String> {
  if let Some(expected) = expected {
    let etag = etag_of(path)?;
    if !etag.is_empty() && etag != expected {
      return Ok(false);
    }
  }
  match std::fs::remove_file(path) {
    Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(describe(path, e)),
    _ => Ok(true),
  }
}

/// File work runs off the async runtime: reading a file a drive hasn't downloaded yet can block.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

/// The tag listed for a file iCloud hasn't downloaded yet.
const PLACEHOLDER: &str = "icloud-placeholder";

/// Lets the person choose any folder with the system's folder picker; `prompt` and `message` in the
/// app's language (Windows and Linux show only the message, as the picker's title). The folder
/// chosen may be synced through (`sync_folder_use`).
#[tauri::command]
pub async fn sync_folder_pick(app: AppHandle, prompt: String, message: String) -> Option<String> {
  let picked = pick(&app, prompt, message).await?;
  app.state::<Folders>().picked(PathBuf::from(&picked));
  Some(picked)
}

async fn pick(app: &AppHandle, prompt: String, message: String) -> Option<String> {
  #[cfg(target_os = "macos")]
  {
    let (send, receive) = std::sync::mpsc::channel();
    app
      .run_on_main_thread(move || {
        let _ = send.send(macos::pick_folder(&prompt, &message));
      })
      .ok()?;
    tauri::async_runtime::spawn_blocking(move || receive.recv().ok().flatten()).await.ok().flatten()
  }
  #[cfg(any(windows, target_os = "linux"))]
  {
    use tauri_plugin_dialog::DialogExt;
    let _ = prompt;
    let picker = app.dialog().file().set_title(message);
    let folder = tauri::async_runtime::spawn_blocking(move || picker.blocking_pick_folder()).await.ok().flatten()?;
    folder.into_path().ok().map(|path| path.to_string_lossy().into_owned())
  }
  #[cfg(mobile)]
  {
    let _ = (app, prompt, message);
    None
  }
}

fn folder(dir: &str) -> Result<PathBuf, String> {
  let dir = PathBuf::from(dir);
  if !dir.is_absolute() || dir.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
    return Err(CHOOSE_AGAIN.into());
  }
  Ok(dir)
}

fn file(dir: &Path, name: &str) -> Result<PathBuf, String> {
  if !synced_name(name) {
    return Err(format!("Not a note or attachment: {name}"));
  }
  Ok(dir.join(name))
}

/// A note (`<id>.md`) or an attachment (`<hash>.<ext>`): a plain name, with an extension.
pub(crate) fn valid_name(name: &str) -> bool {
  let Some((stem, ext)) = name.rsplit_once('.') else { return false };
  !stem.is_empty()
    && (1..=10).contains(&ext.len())
    && ext.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    && !name.starts_with('.')
    && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A plain name (`valid_name`), or the name of a drive's own copy of such a file, which it keeps
/// beside it when it can't merge two versions: `<id> 2.md` (iCloud), `<id> (1).md` (Google Drive),
/// `<id> (MacBook's conflicted copy 2026-11-09).md` (Dropbox). OneDrive's, `<id>-MacBook.md`, is plain.
fn synced_name(name: &str) -> bool {
  if valid_name(name) {
    return true;
  }
  let Some((stem, ext)) = name.rsplit_once('.') else { return false };
  let Some((original, _)) = stem.split_once(' ') else { return false };
  valid_name(&format!("{original}.{ext}")) && !name.contains(['/', '\\', ':']) && !name.chars().any(char::is_control)
}

/// iCloud Drive stands in for files it hasn't downloaded with `.<name>.icloud`.
fn icloud_placeholder(name: &str) -> Option<&str> {
  name.strip_prefix('.')?.strip_suffix(".icloud").filter(|real| synced_name(real))
}

/// Modification time and size: changes whenever the file does, including when the drive
/// brings in another device's version.
fn etag(meta: &std::fs::Metadata) -> String {
  let modified = meta
    .modified()
    .ok()
    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    .map_or(0, |d| d.as_nanos());
  format!("{modified:x}-{:x}", meta.len())
}

fn describe(path: &Path, error: std::io::Error) -> String {
  match error.kind() {
    std::io::ErrorKind::PermissionDenied if cfg!(target_os = "macos") => format!(
      "Lines isn't allowed to use {}. Allow it in System Settings → Privacy & Security → Files and Folders.",
      path.display()
    ),
    std::io::ErrorKind::PermissionDenied => format!("Lines isn't allowed to use {}. Choose another folder.", path.display()),
    _ => format!("{}: {error}", path.display()),
  }
}

fn request_download(path: &Path) {
  #[cfg(target_os = "macos")]
  macos::start_download(path);
  #[cfg(not(target_os = "macos"))]
  let _ = path;
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
  use std::path::Path;

  use objc2::MainThreadMarker;
  use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
  use objc2_foundation::{NSFileManager, NSString, NSURL};

  pub fn start_download(path: &Path) {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let _ = NSFileManager::defaultManager().startDownloadingUbiquitousItemAtURL_error(&url);
  }

  /// A folder the person chooses, with `prompt` on its button and `message` above. Must run on the main thread.
  pub fn pick_folder(prompt: &str, message: &str) -> Option<String> {
    let mtm = MainThreadMarker::new()?;
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseDirectories(true);
    panel.setCanChooseFiles(false);
    panel.setCanCreateDirectories(true);
    panel.setAllowsMultipleSelection(false);
    panel.setPrompt(Some(&NSString::from_str(prompt)));
    panel.setMessage(Some(&NSString::from_str(message)));
    if panel.runModal() != NSModalResponseOK {
      return None;
    }
    panel.URL()?.path().map(|p| p.to_string())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_plain_note_names() {
    assert!(valid_name("6f1c2b3a-1234-4abc-9def-0123456789ab.md"));
    assert!(!valid_name(".hidden.md"));
    assert!(!valid_name("../escape.md"));
    assert!(!valid_name("sub/dir.md"));
    assert!(valid_name("3f9c0a1b2c3d4e5f60718293a4b5c6d7.pdf"));
    assert!(!valid_name("notes.TXT"));
    assert!(!valid_name("archive.toolongextension"));
    assert!(!valid_name(".md"));
    assert!(valid_name("3f9c0a1b2c3d4e5f60718293a4b5c6d7.png"));
    assert!(!valid_name("noextension"));
    assert_eq!(percent_decode("/Users/me/Google%20Drive%20(me%40x.com)/lines"), Some("/Users/me/Google Drive (me@x.com)/lines".into()));
    assert_eq!(percent_decode("%E2%9C%93"), Some("✓".into()));
    assert_eq!(percent_decode("%2"), None);
    assert_eq!(icloud_placeholder(".abc.md.icloud"), Some("abc.md"));
    assert_eq!(icloud_placeholder("abc.md"), None);
  }

  #[test]
  fn drives_copies_of_notes() {
    let id = "6f1c2b3a-1234-4abc-9def-0123456789ab";
    for copy in [" 2.md", " (1).md", " (MacBook's conflicted copy 2026-11-09).md", " (Oleksandr’s MacBook Pro’s conflicted copy).enc"] {
      assert!(synced_name(&format!("{id}{copy}")), "{copy}");
    }
    assert_eq!(icloud_placeholder(&format!(".{id} 2.md.icloud")), Some(&*format!("{id} 2.md")));
    for not in [" ../escape.md", " a\\b.md", " a:b.md", " 2.TXT", " \n.md"] {
      assert!(!synced_name(&format!("{id}{not}")), "{not}");
    }
    assert!(!synced_name(".hidden 2.md"));
    assert!(!synced_name(" 2.md"));
  }

  #[test]
  fn finds_cloud_drives() {
    let home = std::env::temp_dir().join(format!("lines-home-{}", std::process::id()));
    for dir in [
      "Library/Mobile Documents/com~apple~CloudDocs",
      "Library/CloudStorage/GoogleDrive-me@gmail.com/My Drive",
      "Library/CloudStorage/ProtonDrive-me@proton.me-folder",
      "Library/CloudStorage/Dropbox",
      "Library/CloudStorage/OneDrive-Personal",
    ] {
      std::fs::create_dir_all(home.join(dir)).unwrap();
    }
    let found: Vec<_> = candidates_in(&home).into_iter().map(|c| (c.provider, c.name)).collect();
    assert_eq!(
      found,
      [
        ("icloud", "iCloud Drive".to_string()),
        ("dropbox", "Dropbox".to_string()),
        ("google", "Google Drive (me@gmail.com)".to_string()),
        ("onedrive", "OneDrive (Personal)".to_string()),
        ("proton", "Proton Drive (me@proton.me)".to_string()),
      ]
    );
    std::fs::remove_dir_all(&home).unwrap();
  }

  #[test]
  fn finds_windows_drives() {
    let home = std::env::temp_dir().join(format!("lines-windows-home-{}", std::process::id()));
    for dir in ["OneDrive", "OneDrive - Contoso", "iCloudDrive", "My Drive", "Documents"] {
      std::fs::create_dir_all(home.join(dir)).unwrap();
    }
    let found: Vec<_> = windows_drives(&home).into_iter().map(|c| (c.provider, c.name)).collect();
    assert_eq!(
      found,
      [
        ("google", "Google Drive".to_string()),
        ("onedrive", "OneDrive".to_string()),
        ("onedrive", "OneDrive (Contoso)".to_string()),
        ("icloud", "iCloud Drive".to_string()),
      ]
    );
    std::fs::remove_dir_all(&home).unwrap();
  }

  #[test]
  fn rejects_relative_folders() {
    // Absolute on every system: Windows' have a drive letter.
    let absolute = std::env::temp_dir().join("lines");
    assert!(folder("relative/path").is_err());
    assert!(folder(&absolute.join("..").join("etc").to_string_lossy()).is_err());
    assert!(folder(&absolute.to_string_lossy()).is_ok());
  }

  #[test]
  fn writes_only_over_the_file_expected() {
    let dir = std::env::temp_dir().join(format!("lines-folder-expected-{}", std::process::id()));
    let path = dir.join("a.md");
    let write = |text: &str, expected: Option<&str>| write(&path, text, expected.map(Into::into));
    // A new note, where there's none: written, and not again over the one now there.
    let mine = write("mine", Some("")).unwrap().unwrap();
    assert_eq!(write("mine again", Some("")).unwrap(), None);
    // The drive brings in another device's version after this one listed the folder.
    let theirs = write("theirs, longer", None).unwrap().unwrap();
    assert_eq!(write("mine, edited", Some(&mine)).unwrap(), None);
    assert_eq!(read(&path).unwrap().unwrap().text, "theirs, longer");
    assert!(write("mine, edited", Some(&theirs)).unwrap().is_some());
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn deletes_only_the_file_expected() {
    let dir = std::env::temp_dir().join(format!("lines-folder-delete-{}", std::process::id()));
    let folders = Folders::load(None);
    folders.picked(dir.clone());
    folders.use_folder(dir.clone(), &[]).unwrap();
    let path = folders.file(&dir.to_string_lossy(), "a.md").unwrap();
    let mine = write(&path, "mine", None).unwrap().unwrap();
    // The drive brings in another device's version after this one listed the folder: kept.
    write(&path, "theirs, longer", None).unwrap();
    assert!(!delete(&path, Some(mine)).unwrap());
    assert_eq!(read(&path).unwrap().unwrap().text, "theirs, longer");
    let theirs = read(&path).unwrap().unwrap().etag;
    assert!(delete(&path, Some(theirs.clone())).unwrap());
    // Gone already, as it's meant to be.
    assert!(delete(&path, Some(theirs)).unwrap());
    // Only in the folder chosen for sync.
    assert!(folders.file(&dir.to_string_lossy(), "../a.md").is_err());
    assert!(folders.file(&dir.with_extension("else").to_string_lossy(), "a.md").is_err());
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn reads_notes_another_app_saved() {
    assert_eq!(decode("\u{feff}---\nid: a\n---\n# Café".as_bytes()), "---\nid: a\n---\n# Café");
    // Latin-1, as an older editor saves it: read, not a stop.
    assert_eq!(decode(b"# Caf\xe9"), "# Caf\u{fffd}");
    let utf16 = |unit: fn(u16) -> [u8; 2], mark: [u8; 2]| mark.into_iter().chain("# Café".encode_utf16().flat_map(unit)).collect::<Vec<_>>();
    assert_eq!(decode(&utf16(u16::to_le_bytes, [0xff, 0xfe])), "# Café");
    assert_eq!(decode(&utf16(u16::to_be_bytes, [0xfe, 0xff])), "# Café");
  }

  #[test]
  fn round_trip() {
    let dir = std::env::temp_dir().join(format!("lines-folder-sync-{}", std::process::id()));
    let folders = Folders::load(None);
    folders.picked(dir.clone());
    folders.use_folder(dir.clone(), &[]).unwrap();
    let d = dir.to_string_lossy().into_owned();
    let file = |name: &str| folders.file(&d, name);
    assert!(list(&dir).unwrap().is_empty());
    let etag = write(&file("a.md").unwrap(), "hello", None).unwrap().unwrap();
    let listed = list(&dir).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].etag, etag);
    assert_eq!(read(&file("a.md").unwrap()).unwrap().unwrap().text, "hello");
    delete(&file("a.md").unwrap(), None).unwrap();
    assert!(read(&file("a.md").unwrap()).unwrap().is_none());
    assert!(file("../x.md").is_err());
    // A drive's copy of a note is listed, read and deleted.
    write_atomic(&dir.join("a (1).md"), b"theirs").unwrap();
    assert_eq!(list(&dir).unwrap()[0].name, "a (1).md");
    assert_eq!(read(&file("a (1).md").unwrap()).unwrap().unwrap().text, "theirs");
    delete(&file("a (1).md").unwrap(), None).unwrap();
    assert!(list(&dir).unwrap().is_empty());
    // An empty attachment is there; a missing one isn't.
    let empty = dir.join("3f9c0a1b2c3d4e5f60718293a4b5c6d7.txt");
    write_atomic(&empty, b"").unwrap();
    assert_eq!(read_file(&empty).unwrap(), Some(Vec::new()));
    assert_eq!(read_file(&dir.join("0f9c0a1b2c3d4e5f60718293a4b5c6d7.txt")).unwrap(), None);
    std::fs::remove_dir_all(&dir).unwrap();
    // A drive that's gone isn't recreated as an empty folder.
    let gone = dir.join("signed-out-drive/lines/notes");
    assert!(list(&gone).is_err());
    assert!(!dir.exists());
    // Listing notes makes their folder; listing feeds, with nothing in them yet, doesn't make theirs.
    let notes = dir.join("lines/notes");
    std::fs::create_dir_all(&dir).unwrap();
    assert!(list(&notes).unwrap().is_empty());
    assert!(notes.is_dir());
    let feeds = dir.join("lines/feeds");
    assert!(list(&feeds).unwrap().is_empty());
    assert!(!feeds.exists());
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn only_folders_chosen_for_sync() {
    let base = std::env::temp_dir().join(format!("lines-chosen-{}", std::process::id()));
    let file = base.join("data/sync-folders.json");
    let drive = base.join("Drive");
    let drives = [candidate("dropbox", "Dropbox".into(), drive.clone())];
    let picked = base.join("Picked");
    let synced_before = base.join("Synced before");
    std::fs::create_dir_all(synced_before.join("notes")).unwrap();
    let elsewhere = base.join("Library/LaunchAgents");
    let inside = |folders: &Folders, dir: &Path| folders.inside(&dir.to_string_lossy()).is_ok();

    let folders = Folders::load(Some(file.clone()));
    assert!(!inside(&folders, &drive.join("lines")));
    // Before Lines remembered any, a folder that already has notes is one synced through before.
    folders.use_folder(synced_before.clone(), &drives).unwrap();
    assert!(inside(&folders, &synced_before.join("notes")));
    // From then on, only a folder in a drive, or one picked.
    assert!(folders.use_folder(elsewhere.clone(), &drives).is_err());
    std::fs::create_dir_all(elsewhere.join("notes")).unwrap();
    assert!(folders.use_folder(elsewhere.clone(), &drives).is_err());
    assert!(folders.use_folder(picked.clone(), &drives).is_err());
    folders.picked(picked.clone());
    folders.use_folder(picked.clone(), &drives).unwrap();
    folders.use_folder(drive.join("lines"), &drives).unwrap();
    for dir in [drive.join("lines/notes"), drive.join("lines"), picked.join("attachments")] {
      assert!(inside(&folders, &dir), "{}", dir.display());
    }
    for dir in [drive.clone(), elsewhere.clone(), base.join("Picked else"), picked.join("../Synced before")] {
      assert!(!inside(&folders, &dir), "{}", dir.display());
    }
    assert!(folders.file(&picked.to_string_lossy(), "x.plist").is_ok());
    assert!(folders.file(&elsewhere.to_string_lossy(), "x.plist").is_err());

    // Remembered at the next start.
    let again = Folders::load(Some(file));
    assert!(inside(&again, &picked.join("notes")) && inside(&again, &synced_before));
    assert!(again.use_folder(elsewhere, &[]).is_err());
    std::fs::remove_dir_all(&base).unwrap();
  }
}
