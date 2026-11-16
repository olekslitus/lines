//! The bytes a page sends a command as its body (a file, a key).

use serde::Deserialize;
use tauri::ipc::InvokeBody;

/// The body's bytes, or None if it isn't bytes. They come as they are, except from Android, where
/// Tauri's IPC sends every body as JSON: a number for each byte. Copied, since Tauri only lends a
/// command its body.
pub fn bytes(body: &InvokeBody) -> Option<Vec<u8>> {
  match body {
    InvokeBody::Raw(bytes) => Some(bytes.clone()),
    InvokeBody::Json(numbers) => Vec::deserialize(numbers).ok(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_bytes_as_android_sends_them_too() {
    assert_eq!(bytes(&InvokeBody::Raw(vec![0, 7, 255])), Some(vec![0, 7, 255]));
    assert_eq!(bytes(&InvokeBody::Json(serde_json::json!([0, 7, 255]))), Some(vec![0, 7, 255]));
    assert_eq!(bytes(&InvokeBody::Json(serde_json::json!([]))), Some(Vec::new()));
    assert_eq!(bytes(&InvokeBody::Json(serde_json::json!({ "key": 1 }))), None);
    assert_eq!(bytes(&InvokeBody::Json(serde_json::json!([256]))), None);
  }
}
