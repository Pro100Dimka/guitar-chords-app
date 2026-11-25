package com.facebook.react.bridge

import android.app.Activity
import android.app.Service
import android.content.*
import android.os.Handler
import com.freetune.PlaybackCaptureService

open class BaseActivityEventListener {
    open fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {}
}
class ReactApplicationContext : Context() {
    val currentActivity: Activity? = Activity()
    val listeners = mutableSetOf<BaseActivityEventListener>()
    var starts = 0
    var unbinds = 0
    var stops = 0
    var allowBind = true
    var autoConnect = true
    var connection: ServiceConnection? = null
    var service: PlaybackCaptureService? = null
    fun addActivityEventListener(listener: BaseActivityEventListener) { listeners.add(listener) }
    fun removeActivityEventListener(listener: BaseActivityEventListener) { listeners.remove(listener) }
    fun startForegroundService(intent: Intent) {
        check(Service.consentGranted)
        starts++
        service=PlaybackCaptureService()
        Service.running=service
        service!!.onStartCommand(intent, 0, starts)
    }
    fun bindService(intent: Intent, value: ServiceConnection, flags: Int): Boolean {
        if (!allowBind) return false
        connection=value
        if (autoConnect) Handler.queue.add { value.onServiceConnected(ComponentName(), service!!.onBind(intent)) }
        return true
    }
    fun unbindService(value: ServiceConnection) { unbinds++ }
    fun stopService(intent: Intent) { stops++; service?.onDestroy() }
}
