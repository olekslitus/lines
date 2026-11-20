//! The iPhone and iPad status bar and home indicator, over the top and bottom of lines' page, which
//! draws its own panes under them (app.css). Their text is light over a dark top of the screen and
//! dark over a light one: iOS chooses by the system's appearance, which lines' theme, or a pane shown
//! dark, can differ from (themes/show.svelte.ts says which it is).

/// Makes the status bar's text light (`dark`: the top of the screen is dark) or dark.
#[tauri::command]
pub fn set_status_bar(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
  #[cfg(target_os = "ios")]
  {
    ios::DARK.store(dark, std::sync::atomic::Ordering::Relaxed);
    window
      .with_webview(|webview| unsafe { ios::update_status_bar(webview.view_controller().cast()) })
      .map_err(|e| e.to_string())?;
  }
  #[cfg(not(target_os = "ios"))]
  let _ = (window, dark);
  Ok(())
}

/// Takes away the shade iOS 26 puts over the web view's top and bottom edges, as over a list's under
/// a toolbar: the page's own title bars are there, in their colors, and the shade darkened them.
#[cfg(target_os = "ios")]
pub fn clear_edges(window: &tauri::WebviewWindow) {
  let cleared = window.with_webview(|webview| unsafe { ios::hide_edge_effects(webview.inner().cast()) });
  if let Err(error) = cleared {
    log::error!("couldn't clear the web view's edges: {error}");
  }
}

#[cfg(target_os = "ios")]
mod ios {
  use objc2::ffi::class_replaceMethod;
  use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
  use objc2::{msg_send, sel};
  use std::sync::Once;
  use std::sync::atomic::{AtomicBool, Ordering};

  pub static DARK: AtomicBool = AtomicBool::new(false);
  static ANSWERS: Once = Once::new();

  /// UIStatusBarStyle's light content and dark content.
  const LIGHT_CONTENT: isize = 1;
  const DARK_CONTENT: isize = 3;

  extern "C-unwind" fn preferred_status_bar_style(_controller: &AnyObject, _cmd: Sel) -> isize {
    if DARK.load(Ordering::Relaxed) { LIGHT_CONTENT } else { DARK_CONTENT }
  }

  /// Has the window's view controller (Tauri's own class) answer which style the status bar takes,
  /// once, and asks iOS to ask it again. On the main thread, as UIKit wants.
  pub unsafe fn update_status_bar(controller: *mut AnyObject) {
    let Some(controller) = (unsafe { controller.as_ref() }) else { return };
    ANSWERS.call_once(|| {
      let class: *const AnyClass = controller.class();
      let imp: Imp = unsafe { std::mem::transmute(preferred_status_bar_style as extern "C-unwind" fn(&AnyObject, Sel) -> isize) };
      // NSInteger (q), from self (@) and the selector (:).
      unsafe { class_replaceMethod(class.cast_mut(), sel!(preferredStatusBarStyle), imp, c"q@:".as_ptr()) };
    });
    let _: () = unsafe { msg_send![controller, setNeedsStatusBarAppearanceUpdate] };
  }

  /// The scroll view's top and bottom edge effects (UIScrollEdgeEffect, iOS 26), hidden; earlier
  /// versions have none.
  pub unsafe fn hide_edge_effects(webview: *mut AnyObject) {
    let Some(webview) = (unsafe { webview.as_ref() }) else { return };
    let scroll: &AnyObject = unsafe { msg_send![webview, scrollView] };
    let has_edges: bool = unsafe { msg_send![scroll, respondsToSelector: sel!(topEdgeEffect)] };
    if !has_edges {
      return;
    }
    let top: &AnyObject = unsafe { msg_send![scroll, topEdgeEffect] };
    let bottom: &AnyObject = unsafe { msg_send![scroll, bottomEdgeEffect] };
    for edge in [top, bottom] {
      let _: () = unsafe { msg_send![edge, setHidden: Bool::YES] };
    }
  }
}
