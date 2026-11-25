package com.freetune

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.ReactApplicationContext
import java.io.Closeable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Owns the visible, user-approved projection. No screen frames or audio files are recorded. */
class PlaybackCaptureService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var failure: Exception? = null
    private var listener: ((MediaProjection?, Exception?) -> Unit)? = null
    private val expiry = Runnable { finishCapture("PlaybackCaptureTimeout") }
    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() { finishCapture("PlaybackCaptureCancelled") }
    }
    inner class CaptureBinder : Binder() {
        fun connect(callback: (MediaProjection?, Exception?) -> Unit) {
            listener = callback
            if (projection != null || failure != null) callback(projection, failure)
        }
        fun disconnect() {
            listener = null
            finishCapture("Cancelled")
        }
    }
    override fun onBind(intent: Intent): IBinder = CaptureBinder()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            finishCapture("PlaybackCaptureCancelled")
            return START_NOT_STICKY
        }
        if (Build.VERSION.SDK_INT < 29) { stopSelf(); return START_NOT_STICKY }
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL,
                getString(R.string.recognition_tile), NotificationManager.IMPORTANCE_LOW))
            val open = PendingIntent.getActivity(this, 0, RecognitionTileService.recognitionIntent(this, false),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val stop = PendingIntent.getService(this, 0,
                Intent(this, PlaybackCaptureService::class.java).setAction(STOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_recognize_song)
                .setContentTitle(getString(R.string.recognition_tile))
                .setContentText(getString(R.string.recognition_playback_active))
                .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                .addAction(Notification.Action.Builder(null, getString(R.string.recognition_stop), stop).build())
                .build()
            // Android 14+ requires this BEFORE getMediaProjection, and only after consent.
            startForeground(714, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            @Suppress("DEPRECATION")
            val data = intent?.getParcelableExtra<Intent>(CONSENT)
                ?: throw IllegalStateException("PlaybackCaptureFailed")
            check(projection == null) { "PlaybackCaptureFailed" }
            projection = getSystemService(MediaProjectionManager::class.java)
                .getMediaProjection(Activity.RESULT_OK, data)
                ?: throw IllegalStateException("PlaybackCaptureFailed")
            projection!!.registerCallback(projectionCallback, handler)
            handler.postDelayed(expiry, 90_000)
            listener?.invoke(projection, null)
        } catch (error: Exception) {
            failure = IllegalStateException("PlaybackCaptureFailed", error)
            finishCapture("PlaybackCaptureFailed")
        }
        // A capture token must never be reused after process death.
        return START_NOT_STICKY
    }

    private fun finishCapture(code: String) {
        handler.removeCallbacks(expiry)
        val active = projection
        projection = null
        if (failure == null) failure = IllegalStateException(code)
        runCatching { active?.unregisterCallback(projectionCallback) }
        runCatching { active?.stop() }
        val callback = listener
        listener = null
        try { callback?.invoke(null, failure) }
        finally { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    }
    override fun onDestroy() { finishCapture("PlaybackCaptureCancelled"); super.onDestroy() }

    companion object {
        const val CONSENT = "playbackConsent"
        private const val STOP = "com.freetune.STOP_RECOGNITION"
        private const val CHANNEL = "song_recognition"
    }
}

/** One consent request, one service binding, one projection. Late consent after cancel is ignored. */
internal class PlaybackAudioCapture(
    private val context: ReactApplicationContext,
    private val onStopped: () -> Unit
) : BaseActivityEventListener(), ServiceConnection, Closeable {
    private val handler = Handler(Looper.getMainLooper())
    private val consentRequest = requests.updateAndGet { if (it >= 65534) 24000 else it + 1 }
    private val closed = AtomicBoolean(false)
    private val ready = CountDownLatch(1)
    private val cleaned = CountDownLatch(1)
    private var bound = false
    private var serviceStarted = false
    private var binder: PlaybackCaptureService.CaptureBinder? = null
    @Volatile private var projection: MediaProjection? = null
    @Volatile private var failure: Exception? = null
    @Volatile private var deadline = 0L
    private val serviceIntent get() = Intent(context, PlaybackCaptureService::class.java)

    fun awaitProjection(ensureActive: () -> Unit): MediaProjection {
        if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("PlaybackCaptureUnavailable")
        deadline = SystemClock.elapsedRealtime() + 120_000
        handler.post {
            if (!closed.get()) {
                try {
                    val activity = context.currentActivity
                        ?: throw IllegalStateException("PlaybackCaptureUnavailable")
                    context.addActivityEventListener(this)
                    val manager = context.getSystemService(MediaProjectionManager::class.java)
                    activity.startActivityForResult(manager.createScreenCaptureIntent(), consentRequest)
                } catch (error: Exception) { fail(error) }
            }
        }
        while (!ready.await(50, TimeUnit.MILLISECONDS)) {
            ensureActive()
            if (SystemClock.elapsedRealtime() >= deadline) throw IllegalStateException("PlaybackCaptureTimeout")
        }
        ensureActive()
        ensureAvailable()
        return projection ?: throw IllegalStateException("PlaybackCaptureFailed")
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != consentRequest) return
        context.removeActivityEventListener(this)
        if (closed.get()) return
        if (resultCode != Activity.RESULT_OK || data == null) {
            fail(IllegalStateException("PlaybackCaptureCancelled"))
            return
        }
        try {
            deadline = SystemClock.elapsedRealtime() + 10_000
            context.startForegroundService(serviceIntent.putExtra(PlaybackCaptureService.CONSENT, data))
            serviceStarted = true
            bound = context.bindService(serviceIntent, this, Context.BIND_AUTO_CREATE)
            if (!bound) throw IllegalStateException("PlaybackCaptureFailed")
        } catch (error: Exception) { fail(IllegalStateException("PlaybackCaptureFailed", error)) }
    }

    override fun onServiceConnected(name: ComponentName, service: IBinder) {
        if (closed.get()) return
        binder = service as? PlaybackCaptureService.CaptureBinder
        if (binder == null) { fail(IllegalStateException("PlaybackCaptureFailed")); return }
        binder!!.connect { value, error ->
            if (!closed.get()) {
                projection = value
                if (error != null) {
                    fail(error)
                    onStopped()
                } else ready.countDown()
            }
        }
    }
    override fun onServiceDisconnected(name: ComponentName) {
        if (!closed.get()) { fail(IllegalStateException("PlaybackCaptureCancelled")); onStopped() }
    }
    override fun onBindingDied(name: ComponentName) = onServiceDisconnected(name)
    override fun onNullBinding(name: ComponentName) = onServiceDisconnected(name)

    fun ensureAvailable() {
        failure?.let { throw it }
        check(!closed.get()) { "Cancelled" }
    }
    private fun fail(error: Exception) { failure = error; ready.countDown() }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            ready.countDown()
            val cleanup = Runnable {
                try {
                    context.removeActivityEventListener(this)
                    runCatching { binder?.disconnect() }
                    binder = null
                    if (bound) { runCatching { context.unbindService(this) }; bound = false }
                    if (serviceStarted) { runCatching { context.stopService(serviceIntent) }; serviceStarted = false }
                    projection = null
                } finally { cleaned.countDown() }
            }
            if (Looper.myLooper() == Looper.getMainLooper()) cleanup.run() else handler.post(cleanup)
        }
        // The next recognition cannot take ownership before this one's main-thread cleanup.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            var interrupted = false
            while (cleaned.count != 0L) {
                try { cleaned.await() } catch (_: InterruptedException) { interrupted = true }
            }
            if (interrupted) Thread.currentThread().interrupt()
        }
    }
    companion object { private val requests = AtomicInteger(24000) }
}
