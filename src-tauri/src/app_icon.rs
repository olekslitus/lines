//! The app icon chosen in Settings → Theme → App Icon (src/lib/appIcon/): on iPhone and iPad one of
//! the asset catalog's alternate icons, which iOS says it's changed to; on a Mac the Dock's, while
//! Lines runs (the bundle's own icon can't change without breaking its signature); on Windows and
//! Linux the window's, in the taskbar. Android's is an activity alias (MainActivity.kt).

/// Shows the alternate icon `alternate` names (`AppIcon-…`; none for Lines' own) on iPhone and iPad;
/// on the desktops the picture `picture` (none for the bundle's own): on a Mac a PNG's bytes, on
/// Windows and Linux its pixels, `size` across, as RGBA (which needs no decoder).
#[tauri::command]
pub fn set_app_icon(window: tauri::WebviewWindow, alternate: Option<String>, picture: Option<Vec<u8>>, size: u32) -> Result<(), String> {
  #[cfg(target_os = "ios")]
  {
    let _ = (picture, size);
    window.run_on_main_thread(move || unsafe { ios::set(alternate.as_deref()) }).map_err(|e| e.to_string())
  }
  #[cfg(target_os = "macos")]
  {
    let _ = (alternate, size);
    window.run_on_main_thread(move || unsafe { mac::set(picture.as_deref()) }).map_err(|e| e.to_string())
  }
  #[cfg(any(windows, target_os = "linux"))]
  {
    use tauri::Manager as _;
    let _ = alternate;
    let icon = match picture {
      Some(rgba) if rgba.len() == (size * size * 4) as usize => tauri::image::Image::new_owned(rgba, size, size),
      Some(_) => return Err(format!("Not a {size}×{size} picture")),
      None => window.app_handle().default_window_icon().cloned().ok_or("Lines has no icon of its own")?,
    };
    window.set_icon(icon).map_err(|e| e.to_string())
  }
  #[cfg(target_os = "android")]
  {
    let _ = (window, alternate, picture, size);
    Ok(())
  }
}

#[cfg(target_os = "ios")]
mod ios {
  use block2::Block;
  use objc2::rc::Retained;
  use objc2::runtime::AnyObject;
  use objc2::{class, msg_send};
  use objc2_foundation::NSString;

  /// Changes the home screen's icon to `name`, unless it's that already: iOS tells each change with an alert.
  pub unsafe fn set(name: Option<&str>) {
    let app: Retained<AnyObject> = unsafe { msg_send![class!(UIApplication), sharedApplication] };
    let supported: bool = unsafe { msg_send![&app, supportsAlternateIcons] };
    if !supported {
      return;
    }
    let current: Option<Retained<NSString>> = unsafe { msg_send![&app, alternateIconName] };
    if current.map(|current| current.to_string()).as_deref() == name {
      return;
    }
    let name = name.map(NSString::from_str);
    let done: Option<&Block<dyn Fn(*mut AnyObject)>> = None;
    let _: () = unsafe { msg_send![&app, setAlternateIconName: name.as_deref(), completionHandler: done] };
  }
}

#[cfg(target_os = "macos")]
mod mac {
  use objc2::rc::{Allocated, Retained};
  use objc2::runtime::AnyObject;
  use objc2::{class, msg_send};
  use objc2_foundation::NSData;

  /// The Dock's icon, from a PNG's bytes, or the bundle's again.
  pub unsafe fn set(png: Option<&[u8]>) {
    let image: Option<Retained<AnyObject>> = png.and_then(|bytes| {
      let data = NSData::with_bytes(bytes);
      let image: Allocated<AnyObject> = unsafe { msg_send![class!(NSImage), alloc] };
      unsafe { msg_send![image, initWithData: &*data] }
    });
    let app: Retained<AnyObject> = unsafe { msg_send![class!(NSApplication), sharedApplication] };
    let _: () = unsafe { msg_send![&app, setApplicationIconImage: image.as_deref()] };
  }
}
