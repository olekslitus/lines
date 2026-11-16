package com.overtio.lines

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // lines draws under the status and navigation bars, so their icons follow the colors it shows,
  // which can be dark while the system is light, and change while it's open (themes/show.svelte.ts).
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(SystemBars(), "linesSystemBars")
  }

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
