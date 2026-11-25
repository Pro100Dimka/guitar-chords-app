package android.media.projection

import android.app.Service
import android.content.Intent
import android.os.Handler

class MediaProjection {
    var stopped = false
    var stops = 0
    private var callback: Callback? = null
    private var handler: Handler? = null
    abstract class Callback { open fun onStop() {} }
    fun registerCallback(value: Callback, queue: Handler) { callback=value; handler=queue }
    fun unregisterCallback(value: Callback) { if (callback === value) callback=null }
    fun stop() {
        stopped=true; stops++
        callback?.let { value -> handler!!.post { value.onStop() } }
    }
}
class MediaProjectionManager {
    fun createScreenCaptureIntent() = Intent(android.content.Context(), MediaProjection::class.java)
    fun getMediaProjection(result: Int, data: Intent): MediaProjection {
        check(Service.running?.foreground == true) { "Projection created before foreground service" }
        check(!fail) { "Projection denied by system" }
        check(consumed.add(data)) { "Consent token reused" }
        return MediaProjection().also { last=it }
    }
    companion object {
        var last: MediaProjection? = null
        var fail = false
        val consumed = mutableSetOf<Intent>()
    }
}
