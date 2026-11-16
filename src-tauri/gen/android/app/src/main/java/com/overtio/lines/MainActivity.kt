package com.overtio.lines

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
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
    // all, and what shows behind the bars is the page's background (SystemBars.setColors).
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

  // The bars show lines' background, and their icons follow it: it can be dark while the system is
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
}
