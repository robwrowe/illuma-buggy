package expo.modules.illumakeepalive

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class IllumaKeepAliveModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun definition() = ModuleDefinition {
    Name("IllumaKeepAlive")

    Function("isIgnoringBatteryOptimizations") {
      val ctx = appContext.reactContext ?: return@Function false
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val activity = appContext.currentActivity ?: return@Function false
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${activity.packageName}")
      }
      activity.startActivity(intent)
      true
    }

    Function("acquireRadioLocks") {
      val ctx = appContext.reactContext ?: return@Function false
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (wakeLock == null) {
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "illuma:keepalive").apply {
          setReferenceCounted(false)
        }
      }
      val wake = wakeLock
      if (wake != null && !wake.isHeld) {
        // Safety cap so a missed release cannot hold the CPU forever.
        wake.acquire(12 * 60 * 60 * 1000L)
      }
      val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      if (wifiLock == null) {
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "illuma:wifi").apply {
          setReferenceCounted(false)
        }
      }
      val wifi = wifiLock
      if (wifi != null && !wifi.isHeld) wifi.acquire()
      true
    }

    Function("releaseRadioLocks") {
      val wake = wakeLock
      if (wake != null && wake.isHeld) wake.release()
      val wifi = wifiLock
      if (wifi != null && wifi.isHeld) wifi.release()
      true
    }
  }
}
