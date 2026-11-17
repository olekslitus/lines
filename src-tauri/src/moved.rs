//! lines was `com.overtio.lines` up to 0.6, and is `com.olekslitus.lines` since. Each system
//! keeps an app's web view data (notes in IndexedDB, settings in localStorage) in a folder named
//! for its identifier, so the first start under the new one copies that folder over from the old
//! one's, before any web view opens. The old folder is left as it was, for going back to 0.6.
//!
//! Nothing else needs to come along: the cache folders hold only what's fetched again, and the
//! Touch ID keys in the keychain are under a service name of their own ("lines app lock"), not the
//! identifier.

use std::{
  fs, io,
  path::{Path, PathBuf},
};

/// The identifier lines had up to 0.6.
pub const OLD: &str = "com.overtio.lines";

/// What became of bringing the data along.
#[derive(Debug, PartialEq, Eq)]
pub enum Moved {
  /// Done on an earlier start.
  Before,
  /// There was nothing under the old identifier.
  Nothing,
  /// The new folder had data of its own already, which is never overwritten.
  Kept,
  /// Copied over.
  Copied,
}

/// Brings the web view's data along from the old identifier's folder, once. Only an installed
/// build does: a debug build, or on a Mac a binary not in its app (whose web view keeps its data
/// under the binary's name), would copy a snapshot that the installed app then found and kept.
/// A failure is retried twice, as Windows may still be closing the old version's web view, then
/// left: lines opens either way, and tries again next time if nothing was written since.
pub fn bring_along(identifier: &str) {
  if cfg!(debug_assertions) || identifier == OLD || !installed_as(identifier) {
    return;
  }
  let (Some(from), Some(to), Some(mark)) = (web_data(OLD), web_data(identifier), mark(identifier)) else {
    return;
  };
  for attempt in 1..=3 {
    match bring(&from, &to, &mark) {
      Ok(_) => return,
      Err(error) => {
        eprintln!("couldn't bring lines' data along from {}: {error}", from.display());
        if attempt < 3 {
          std::thread::sleep(std::time::Duration::from_secs(1));
        }
      }
    }
  }
}

/// Copies `from` to `to`, unless `mark` says it was done before, there's nothing at `from`, or
/// `to` has something in it already; then marks it done. The copy is made beside `to` and renamed
/// into place once whole, so a copy cut short is never taken for the data.
pub fn bring(from: &Path, to: &Path, mark: &Path) -> io::Result<Moved> {
  if mark.exists() {
    return Ok(Moved::Before);
  }
  let moved = if !from.is_dir() {
    Moved::Nothing
  } else if !is_empty(to)? {
    Moved::Kept
  } else {
    let partial = partial(to);
    if partial.exists() {
      fs::remove_dir_all(&partial)?;
    }
    if let Err(error) = copy_dir(from, &partial) {
      let _ = fs::remove_dir_all(&partial);
      return Err(error);
    }
    if to.exists() {
      fs::remove_dir(to)?;
    }
    fs::rename(&partial, to)?;
    Moved::Copied
  };
  if let Some(folder) = mark.parent() {
    fs::create_dir_all(folder)?;
  }
  fs::write(mark, format!("{moved:?} from {}\n", from.display()))?;
  Ok(moved)
}

/// The folder an app's web view keeps its data in: WebKit's on a Mac; on Windows (WebView2's
/// `EBWebView` inside it) and Linux (WebKitGTK's), the one Tauri gives it, its local data folder.
fn web_data(identifier: &str) -> Option<PathBuf> {
  #[cfg(target_os = "macos")]
  return Some(dirs::home_dir()?.join("Library/WebKit").join(identifier));
  #[cfg(not(target_os = "macos"))]
  Some(dirs::data_local_dir()?.join(identifier))
}

/// Where lines notes it's been done, in its local data folder: never roaming to another computer
/// with a Windows profile, where it would still have to be done.
fn mark(identifier: &str) -> Option<PathBuf> {
  Some(dirs::data_local_dir()?.join(identifier).join(format!("moved-from-{OLD}")))
}

/// Whether this is the app installed as `identifier`: on a Mac, WebKit names the web view's
/// folder after the app's bundle, which a binary run on its own doesn't have.
fn installed_as(identifier: &str) -> bool {
  #[cfg(target_os = "macos")]
  return objc2_foundation::NSBundle::mainBundle()
    .bundleIdentifier()
    .is_some_and(|bundle| bundle.to_string() == identifier);
  #[cfg(not(target_os = "macos"))]
  {
    let _ = identifier;
    true
  }
}

fn is_empty(folder: &Path) -> io::Result<bool> {
  match fs::read_dir(folder) {
    Ok(mut entries) => Ok(entries.next().is_none()),
    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
    Err(error) => Err(error),
  }
}

fn partial(to: &Path) -> PathBuf {
  let mut name = to.file_name().unwrap_or_default().to_os_string();
  name.push(".copying");
  to.with_file_name(name)
}

/// Files and folders; links and anything else aren't a web view's data.
fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
  fs::create_dir_all(to)?;
  for entry in fs::read_dir(from)? {
    let entry = entry?;
    let kind = entry.file_type()?;
    let target = to.join(entry.file_name());
    if kind.is_dir() {
      copy_dir(&entry.path(), &target)?;
    } else if kind.is_file() {
      fs::copy(entry.path(), target)?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A temporary folder with the old identifier's web view data in it, shaped as WebKit's is.
  fn fixture(name: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("lines-moved-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let from = root.join(OLD);
    let origin = from.join("WebsiteData/Default/salted/salted");
    fs::create_dir_all(origin.join("IndexedDB")).unwrap();
    fs::create_dir_all(origin.join("LocalStorage")).unwrap();
    fs::write(origin.join("IndexedDB/IndexedDB.sqlite3"), b"notes").unwrap();
    fs::write(origin.join("LocalStorage/localstorage.sqlite3"), b"prefs").unwrap();
    fs::write(from.join("WebsiteData/Default/salt"), b"salt").unwrap();
    let to = root.join("com.olekslitus.lines");
    let mark = root.join("marks").join(format!("moved-from-{OLD}"));
    (root, from, to, mark)
  }

  fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
  }

  #[test]
  fn copies_the_old_data_once_and_leaves_it_in_place() {
    let (root, from, to, mark) = fixture("copies");
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Copied);
    let origin = "WebsiteData/Default/salted/salted";
    assert_eq!(read(&to.join(origin).join("IndexedDB/IndexedDB.sqlite3")), "notes");
    assert_eq!(read(&to.join(origin).join("LocalStorage/localstorage.sqlite3")), "prefs");
    assert_eq!(read(&to.join("WebsiteData/Default/salt")), "salt");
    assert_eq!(read(&from.join(origin).join("IndexedDB/IndexedDB.sqlite3")), "notes");
    assert!(read(&mark).starts_with("Copied"));
    assert!(!partial(&to).exists());

    // Notes written since, under the new identifier, are never copied over again.
    fs::write(to.join(origin).join("IndexedDB/IndexedDB.sqlite3"), b"newer notes").unwrap();
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Before);
    assert_eq!(read(&to.join(origin).join("IndexedDB/IndexedDB.sqlite3")), "newer notes");
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn once_marked_it_never_copies_again() {
    let (root, from, to, mark) = fixture("marked");
    fs::create_dir_all(mark.parent().unwrap()).unwrap();
    fs::write(&mark, "Copied").unwrap();
    // Even with the new folder gone, as after deleting lines' data on purpose.
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Before);
    assert!(!to.exists());
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn never_overwrites_data_already_there() {
    let (root, from, to, mark) = fixture("kept");
    fs::create_dir_all(to.join("WebsiteData")).unwrap();
    fs::write(to.join("WebsiteData/notes"), b"the new app's own").unwrap();
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Kept);
    assert_eq!(read(&to.join("WebsiteData/notes")), "the new app's own");
    assert!(!to.join("WebsiteData/Default").exists());
    assert!(read(&mark).starts_with("Kept"));
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn copies_into_an_empty_folder() {
    let (root, from, to, mark) = fixture("empty");
    fs::create_dir_all(&to).unwrap();
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Copied);
    assert_eq!(read(&to.join("WebsiteData/Default/salt")), "salt");
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn with_nothing_to_bring_it_only_marks_it_done() {
    let (root, from, to, mark) = fixture("nothing");
    fs::remove_dir_all(&from).unwrap();
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Nothing);
    assert!(!to.exists());
    assert!(mark.exists());
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn a_copy_cut_short_is_started_again() {
    let (root, from, to, mark) = fixture("cut-short");
    fs::create_dir_all(partial(&to).join("WebsiteData")).unwrap();
    fs::write(partial(&to).join("WebsiteData/half"), b"half").unwrap();
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Copied);
    assert!(!to.join("WebsiteData/half").exists());
    assert_eq!(read(&to.join("WebsiteData/Default/salt")), "salt");
    fs::remove_dir_all(root).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn a_failed_copy_leaves_nothing_behind_and_isnt_marked() {
    use std::os::unix::fs::PermissionsExt;
    let (root, from, to, mark) = fixture("failed");
    let locked = from.join("WebsiteData/Default/salted");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    let result = bring(&from, &to, &mark);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(result.is_err());
    assert!(!to.exists());
    assert!(!partial(&to).exists());
    assert!(!mark.exists());
    // And the next try copies it.
    assert_eq!(bring(&from, &to, &mark).unwrap(), Moved::Copied);
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn the_folders_are_named_for_the_identifier() {
    let old = web_data(OLD).unwrap();
    let new = web_data("com.olekslitus.lines").unwrap();
    assert!(old.ends_with(OLD));
    assert_eq!(old.parent(), new.parent());
    #[cfg(target_os = "macos")]
    assert!(old.parent().unwrap().ends_with("Library/WebKit"));
    let mark = mark("com.olekslitus.lines").unwrap();
    assert!(mark.parent().unwrap().ends_with("com.olekslitus.lines"));
  }
}
