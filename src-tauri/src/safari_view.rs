//! Web pages opened from lines on iPhone and iPad, in Safari's view over it (SFSafariViewController):
//! Safari's own page, with Done, Reader, sharing and Open in Safari, closing back to where lines was.
//! Its buttons take the theme's accent, and it's light or dark as lines is. Android's are Custom Tabs
//! (MainActivity.kt); the desktop apps open the browser (src/lib/platform.ts).

/// Shows `url`, a web page's, over lines: `tint`, `#rrggbb`, on its buttons, dark if `dark`.
#[tauri::command]
pub async fn open_safari_view(window: tauri::WebviewWindow, url: String, tint: String, dark: bool) -> Result<(), String> {
  let tint = rgb(&tint).ok_or_else(|| format!("Not a color: {tint}"))?;
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return Err(format!("Not a web page: {url}"));
  }
  show(window, url, tint, dark).await
}

#[cfg(target_os = "ios")]
async fn show(window: tauri::WebviewWindow, url: String, tint: [f64; 3], dark: bool) -> Result<(), String> {
  // UIKit's on the main thread, which says how it went.
  let (sent, mut shown) = tauri::async_runtime::channel(1);
  window
    .with_webview(move |webview| {
      let _ = sent.try_send(unsafe { ios::present(webview.view_controller().cast(), &url, tint, dark) });
    })
    .map_err(|error| error.to_string())?;
  shown.recv().await.unwrap_or_else(|| Err("The Safari view wasn't shown".into()))
}

#[cfg(not(target_os = "ios"))]
async fn show(window: tauri::WebviewWindow, url: String, tint: [f64; 3], dark: bool) -> Result<(), String> {
  let _ = (window, url, tint, dark);
  Err("Safari's view is on iPhone and iPad only".into())
}

/// `#rrggbb` as red, green and blue from 0 to 1.
fn rgb(hex: &str) -> Option<[f64; 3]> {
  let digits = hex.strip_prefix('#').filter(|digits| digits.len() == 6)?;
  let channel = |at: usize| Some(f64::from(u8::from_str_radix(digits.get(at..at + 2)?, 16).ok()?) / 255.0);
  Some([channel(0)?, channel(2)?, channel(4)?])
}

#[cfg(target_os = "ios")]
mod ios {
  use block2::Block;
  use objc2::msg_send;
  use objc2::rc::{Allocated, Retained};
  use objc2::runtime::{AnyClass, AnyObject, Bool};
  use objc2_foundation::{NSString, NSURL};
  use objc2_ui_kit::UIColor;

  /// UIUserInterfaceStyle's light and dark.
  const LIGHT: isize = 1;
  const DARK: isize = 2;

  /// Presents a Safari view of `url` from `controller` (the window's), or over what it has up already.
  pub unsafe fn present(controller: *mut AnyObject, url: &str, [red, green, blue]: [f64; 3], dark: bool) -> Result<(), String> {
    let mut top = unsafe { Retained::retain(controller) }.ok_or("lines has no view controller")?;
    loop {
      let presented: Option<Retained<AnyObject>> = unsafe { msg_send![&top, presentedViewController] };
      let Some(presented) = presented else { break };
      top = presented;
    }
    let url = NSURL::URLWithString(&NSString::from_str(url)).ok_or_else(|| format!("Not an address: {url}"))?;
    // SafariServices, which the Xcode project links (gen/apple/project.yml).
    let class = AnyClass::get(c"SFSafariViewController").ok_or("There's no Safari view here")?;
    let safari: Allocated<AnyObject> = unsafe { msg_send![class, alloc] };
    let safari: Option<Retained<AnyObject>> = unsafe { msg_send![safari, initWithURL: &*url] };
    let safari = safari.ok_or("The Safari view didn't start")?;
    let tint = UIColor::colorWithRed_green_blue_alpha(red, green, blue, 1.0);
    unsafe {
      let _: () = msg_send![&safari, setPreferredControlTintColor: &*tint];
      let _: () = msg_send![&safari, setOverrideUserInterfaceStyle: if dark { DARK } else { LIGHT }];
      let _: () = msg_send![&top, presentViewController: &*safari, animated: Bool::YES, completion: None::<&Block<dyn Fn()>>];
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::rgb;

  #[test]
  fn reads_the_accent_as_the_page_gives_it() {
    assert_eq!(rgb("#ff8000"), Some([1.0, 128.0 / 255.0, 0.0]));
    assert_eq!(rgb("#FFFFFF"), Some([1.0, 1.0, 1.0]));
    assert_eq!(rgb("ff8000"), None);
    assert_eq!(rgb("#f80"), None);
    assert_eq!(rgb("#gg0000"), None);
    assert_eq!(rgb("#ü0000"), None);
  }
}
