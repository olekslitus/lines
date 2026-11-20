package com.olekslitus.lines

import android.content.ActivityNotFoundException
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // lines' pages are one page, with no history to go back through: Back asks lines instead.
  override val handleBackNavigation = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge to edge, the web view would lie under the status bar, the navigation bar and the
    // keyboard, and it tells the page only of a camera's cutout. So lines is kept clear of them
    // all, and what shows behind the bars is the pane on screen's color (SystemBars.setColors).
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
      val clear = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(clear.left, clear.top, clear.right, clear.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(SystemBars(), "linesSystemBars")
    webView.addJavascriptInterface(Browser(), "linesBrowser")
    // Back closes what's open in lines, or goes back to the list (App.svelte); with nothing to go
    // back to, it leaves lines as usual.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("window.linesBack?.() === true") { wentBack ->
          if (wentBack == "true") return@evaluateJavascript
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
        }
      }
    })
  }

  // The bars show the pane on screen's color, and their icons follow it: it can be dark while the system is
  // light, and change while lines is open (themes/show.svelte.ts).
  inner class SystemBars {
    @JavascriptInterface
    fun setColors(background: String, dark: Boolean) {
      val color = runCatching { Color.parseColor(background) }.getOrNull()
      runOnUiThread {
        if (color != null) findViewById<View>(android.R.id.content).setBackgroundColor(color)
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }
  }

  // A web page opened from lines shows over it in a Custom Tab, the browser's own view of it, which
  // closes back to where lines was; its toolbar in lines' background, light or dark as lines is
  // (src/lib/platform.ts). Settings → General can send links to the browser instead.
  inner class Browser {
    @JavascriptInterface
    fun open(url: String, toolbar: String, dark: Boolean): Boolean {
      val page = Uri.parse(url)
      if (page.scheme != "https" && page.scheme != "http") return false
      val colors = CustomTabColorSchemeParams.Builder()
      runCatching { Color.parseColor(toolbar) }.getOrNull()?.let { colors.setToolbarColor(it) }
      val tab = CustomTabsIntent.Builder()
        .setDefaultColorSchemeParams(colors.build())
        .setColorScheme(if (dark) CustomTabsIntent.COLOR_SCHEME_DARK else CustomTabsIntent.COLOR_SCHEME_LIGHT)
        .setShowTitle(true)
        .build()
      runOnUiThread {
        try {
          tab.launchUrl(this@MainActivity, page)
        } catch (error: ActivityNotFoundException) {
          Log.e("lines", "No browser to open $url in", error)
        }
      }
      return true
    }
  }
}
