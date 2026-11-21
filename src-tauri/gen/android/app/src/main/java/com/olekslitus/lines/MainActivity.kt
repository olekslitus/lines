package com.olekslitus.lines

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.pm.PackageManager
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

  // The app icon chosen (AppIcon), shown once Lines is out of sight: switching the launcher's entry
  // closes the task it was opened from, which would close Lines in front of you.
  @Volatile private var chosenIcon: String? = null

  override fun onStop() {
    super.onStop()
    chosenIcon?.let { AppIcon().show(it) }
    chosenIcon = null
  }

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
    webView.addJavascriptInterface(AppIcon(), "linesAppIcon")
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

  // The launcher's icon, chosen in Settings → Theme → App Icon (src/lib/appIcon/): each icon is an
  // alias of this activity in the manifest (scripts/icons.mjs writes them), and only the chosen one
  // is on, from when Lines is next out of sight (onStop). Launchers can take a moment to show it.
  inner class AppIcon {
    private val prefix = "${MainActivity::class.java.name.substringBeforeLast('.')}.AppIcon_"

    @JavascriptInterface
    fun set(id: String) {
      chosenIcon = id
    }

    fun show(id: String) {
      val aliases = packageManager
        .getPackageInfo(packageName, PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS)
        .activities.orEmpty()
        .filter { it.name.startsWith(prefix) }
        .map { ComponentName(packageName, it.name) }
      val chosen = aliases.find { it.className == prefix + id } ?: return
      // The chosen one on first, so there's always an icon to open Lines from.
      for (alias in aliases.sortedBy { it != chosen }) {
        val on = alias == chosen
        if (isOn(alias) == on) continue
        val state = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        packageManager.setComponentEnabledSetting(alias, state, PackageManager.DONT_KILL_APP)
      }
    }

    // Whether the launcher shows `alias`: as set here, or else as the manifest has it.
    private fun isOn(alias: ComponentName) = when (packageManager.getComponentEnabledSetting(alias)) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT ->
        packageManager.getActivityInfo(alias, PackageManager.MATCH_DISABLED_COMPONENTS).enabled
      else -> false
    }
  }
}
