package android.service.quicksettings

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build

class Tile {
    var label: String = ""
    var state = -1
    fun updateTile() {}
    companion object { const val STATE_INACTIVE = 1 }
}
open class TileService : Service() {
    val qsTile: Tile? = Tile()
    var launched: Intent? = null
    var pendingLaunch = false
    open fun onStartListening() {}
    open fun onClick() {}
    fun unlockAndRun(action: Runnable) { action.run() }
    fun startActivityAndCollapse(intent: Intent) {
        check(Build.VERSION.SDK_INT < 34) { "Deprecated tile launch crashes on Android 14+" }
        launched=intent
    }
    fun startActivityAndCollapse(intent: PendingIntent) { launched=intent.intent; pendingLaunch=true }
}
