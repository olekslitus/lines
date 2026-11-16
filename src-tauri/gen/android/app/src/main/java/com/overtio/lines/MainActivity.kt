package com.overtio.lines

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  // lines' pages are one page, with no history to go back through: Back asks lines instead.
  override val handleBackNavigation = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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

  // lines draws under the status and navigation bars, so their icons follow the colors it shows,
  // which can be dark while the system is light, and change while it's open (themes/show.svelte.ts).
  inner class SystemBars {
    @JavascriptInterface
    fun setDark(dark: Boolean) {
      runOnUiThread {
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }
  }
}
