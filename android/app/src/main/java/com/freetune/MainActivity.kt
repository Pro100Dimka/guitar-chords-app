package com.freetune

import android.os.Bundle
import android.content.pm.ActivityInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import org.devio.rn.splashscreen.SplashScreen


class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    SplashScreen.show(this) // 👈 обязательно
    super.onCreate(savedInstanceState)
  }
  override fun getMainComponentName(): String = "freetune"
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}

class ScreenOrientation(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var previousOrientation: Int? = null
  override fun getName() = "ScreenOrientation"

  @ReactMethod
  fun setLandscape(enabled: Boolean) {
    reactApplicationContext.currentActivity?.runOnUiThread {
      val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
      if (enabled) {
        if (previousOrientation == null) previousOrientation = activity.requestedOrientation
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
      } else {
        previousOrientation?.let { activity.requestedOrientation = it }
        previousOrientation = null
      }
    }
  }

  override fun invalidate() {
    setLandscape(false)
    super.invalidate()
  }
}
