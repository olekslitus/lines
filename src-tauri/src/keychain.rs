//! Lines' own secrets, the sync connection's keys, in the system's keychain rather than the page's
//! storage: the login keychain on the Mac, the Keychain on iPhone and iPad, Credential Manager on
//! Windows. Linux and Android have none here yet, and the page keeps them as it did
//! (src/lib/keychain.ts).

/// The secrets the page may keep here, by name. Nothing else in the keychain is reachable through
/// these commands.
const NAMES: [&str; 1] = ["sync"];

fn checked(name: String) -> Result<String, String> {
  if NAMES.contains(&name.as_str()) { Ok(name) } else { Err(format!("No secret named {name}")) }
}

#[tauri::command]
pub fn keychain_available() -> bool {
  cfg!(any(target_os = "macos", target_os = "ios", windows))
}

/// The secret, or nothing if none is kept.
#[tauri::command]
pub async fn keychain_get(name: String) -> Result<Option<String>, String> {
  let name = checked(name)?;
  blocking(move || system::get(&name)).await
}

#[tauri::command]
pub async fn keychain_set(name: String, value: String) -> Result<(), String> {
  let name = checked(name)?;
  blocking(move || system::set(&name, &value)).await
}

#[tauri::command]
pub async fn keychain_delete(name: String) -> Result<(), String> {
  let name = checked(name)?;
  blocking(move || system::delete(&name)).await
}

/// Off the async runtime: the keychain can wait on the person (macOS asks before an app whose
/// signature changed reads its item).
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod system {
  use security_framework::passwords;

  const SERVICE: &str = "Lines";
  /// errSecItemNotFound
  const NOT_FOUND: i32 = -25300;

  pub fn get(name: &str) -> Result<Option<String>, String> {
    match passwords::get_generic_password(SERVICE, name) {
      Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|e| e.to_string()),
      Err(e) if e.code() == NOT_FOUND => Ok(None),
      Err(e) => Err(e.to_string()),
    }
  }

  pub fn set(name: &str, value: &str) -> Result<(), String> {
    passwords::set_generic_password(SERVICE, name, value.as_bytes()).map_err(|e| e.to_string())
  }

  pub fn delete(name: &str) -> Result<(), String> {
    match passwords::delete_generic_password(SERVICE, name) {
      Err(e) if e.code() != NOT_FOUND => Err(e.to_string()),
      _ => Ok(()),
    }
  }
}

#[cfg(windows)]
mod system {
  use windows::Win32::Foundation::ERROR_NOT_FOUND;
  use windows::Win32::Security::Credentials::{
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
  };
  use windows::core::{HSTRING, PWSTR};

  /// Credential Manager's name for it, as it lists it.
  fn target(name: &str) -> String {
    format!("Lines/{name}")
  }

  pub fn get(name: &str) -> Result<Option<String>, String> {
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    match unsafe { CredReadW(&HSTRING::from(target(name)), CRED_TYPE_GENERIC, None, &mut credential) } {
      Err(e) if e.code() == ERROR_NOT_FOUND.into() => return Ok(None),
      Err(e) => return Err(e.message()),
      Ok(()) => {}
    }
    // SAFETY: CredReadW succeeded, so `credential` is one it allocated, with a blob of that size,
    // which is copied before it's freed.
    let bytes = unsafe {
      let blob = std::slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize).to_vec();
      CredFree(credential.cast());
      blob
    };
    String::from_utf8(bytes).map(Some).map_err(|e| e.to_string())
  }

  pub fn set(name: &str, value: &str) -> Result<(), String> {
    let mut target: Vec<u16> = target(name).encode_utf16().chain([0]).collect();
    let mut blob = value.as_bytes().to_vec();
    let credential = CREDENTIALW {
      Type: CRED_TYPE_GENERIC,
      TargetName: PWSTR(target.as_mut_ptr()),
      CredentialBlobSize: u32::try_from(blob.len()).map_err(|e| e.to_string())?,
      CredentialBlob: blob.as_mut_ptr(),
      Persist: CRED_PERSIST_LOCAL_MACHINE,
      ..Default::default()
    };
    // SAFETY: the credential's name and blob outlive the call, which copies them.
    unsafe { CredWriteW(&credential, 0) }.map_err(|e| e.message())
  }

  pub fn delete(name: &str) -> Result<(), String> {
    match unsafe { CredDeleteW(&HSTRING::from(target(name)), CRED_TYPE_GENERIC, None) } {
      Err(e) if e.code() != ERROR_NOT_FOUND.into() => Err(e.message()),
      _ => Ok(()),
    }
  }
}

#[cfg(not(any(target_os = "macos", target_os = "ios", windows)))]
mod system {
  const NONE: &str = "There's no keychain here";

  pub fn get(_: &str) -> Result<Option<String>, String> {
    Err(NONE.into())
  }

  pub fn set(_: &str, _: &str) -> Result<(), String> {
    Err(NONE.into())
  }

  pub fn delete(_: &str) -> Result<(), String> {
    Err(NONE.into())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_lines_own_secrets() {
    assert!(checked("sync".into()).is_ok());
    for other in ["", "lines app lock", "Sync", "../sync"] {
      assert!(checked(other.into()).is_err(), "{other}");
    }
  }

  /// Credential Manager, which the Windows app can't be tried in here: an item of the tests' own.
  #[cfg(windows)]
  #[test]
  fn keeps_a_secret_in_credential_manager() {
    let name = format!("test-{}", std::process::id());
    assert_eq!(system::get(&name), Ok(None));
    system::set(&name, "{\"secretAccessKey\":\"é\"}").unwrap();
    system::set(&name, "{\"secretAccessKey\":\"ü\"}").unwrap();
    assert_eq!(system::get(&name), Ok(Some("{\"secretAccessKey\":\"ü\"}".into())));
    system::delete(&name).unwrap();
    system::delete(&name).unwrap();
    assert_eq!(system::get(&name), Ok(None));
  }
}
