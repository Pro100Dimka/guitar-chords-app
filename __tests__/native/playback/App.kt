package android.app

import android.content.Context
import android.content.Intent
import android.os.IBinder
import com.freetune.PlaybackCaptureService

open class Activity : Context() {
    var request = 0
    var launches = 0
    fun startActivityForResult(intent: Intent, requestCode: Int) { request=requestCode; launches++ }
    companion object { const val RESULT_OK = -1 }
}
open class Service : Context() {
    var foreground = false
    var stopped = false
    open fun onBind(intent: Intent): IBinder? = null
    open fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = 0
    open fun onDestroy() {}
    fun startForeground(id: Int, notification: Notification, type: Int) {
        check(consentGranted) { "Foreground service started before consent" }
        foreground=true
    }
    fun stopForeground(flags: Int) { foreground=false }
    fun stopSelf() { stopped=true }
    companion object {
        var consentGranted = false
        var running: PlaybackCaptureService? = null
        const val START_NOT_STICKY = 2
        const val STOP_FOREGROUND_REMOVE = 1
    }
}
class PendingIntent(val intent: Intent) {
    companion object {
        const val FLAG_UPDATE_CURRENT = 1
        const val FLAG_IMMUTABLE = 2
        fun getActivity(context: Context, id: Int, intent: Intent, flags: Int) = PendingIntent(intent)
        fun getService(context: Context, id: Int, intent: Intent, flags: Int) = PendingIntent(intent)
    }
}
class Notification {
    class Builder(context: Context, channel: String) {
        fun setSmallIcon(id: Int) = this
        fun setContentTitle(text: String) = this
        fun setContentText(text: String) = this
        fun setContentIntent(intent: PendingIntent) = this
        fun setOngoing(value: Boolean) = this
        fun setOnlyAlertOnce(value: Boolean) = this
        fun addAction(action: Action) = this
        fun build() = Notification()
    }
    class Action {
        class Builder(icon: Any?, text: String, intent: PendingIntent) { fun build() = Action() }
    }
}
class NotificationChannel(id: String, title: String, importance: Int)
class NotificationManager {
    fun createNotificationChannel(channel: NotificationChannel) {}
    companion object { const val IMPORTANCE_LOW = 2 }
}
