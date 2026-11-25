package android.content

import android.app.NotificationManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.IBinder

open class Context {
    fun <T> getSystemService(type: Class<T>): T = type.cast(when (type) {
        NotificationManager::class.java -> NotificationManager()
        MediaProjectionManager::class.java -> MediaProjectionManager()
        else -> error("Unexpected service $type")
    })
    fun getString(id: Int) = "string-$id"
    companion object { const val BIND_AUTO_CREATE = 1 }
}
class ComponentName
class Intent {
    var action: String? = null
    var data: Uri? = null
    val extras = mutableMapOf<String, Any>()
    constructor(context: Context, type: Class<*>)
    constructor(action: String, uri: Uri, context: Context, type: Class<*>) { this.action=action; data=uri }
    fun setAction(value: String): Intent { action=value; return this }
    fun addFlags(value: Int) = this
    fun putExtra(key: String, value: Intent): Intent { extras[key]=value; return this }
    @Suppress("UNCHECKED_CAST") fun <T> getParcelableExtra(key: String): T? = extras[key] as? T
    companion object {
        const val ACTION_VIEW = "android.intent.action.VIEW"
        const val FLAG_ACTIVITY_NEW_TASK = 1
        const val FLAG_ACTIVITY_SINGLE_TOP = 2
    }
}
interface ServiceConnection {
    fun onServiceConnected(name: ComponentName, service: IBinder)
    fun onServiceDisconnected(name: ComponentName)
    fun onBindingDied(name: ComponentName) {}
    fun onNullBinding(name: ComponentName) {}
}
