package com.freetune

import android.app.Activity
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.atomic.AtomicReference

class MainActivity : Activity()
object R {
    object string { const val recognition_tile=1; const val recognition_playback_active=2; const val recognition_stop=3 }
    object drawable { const val ic_recognize_song=4 }
}
private fun pumpUntil(done: () -> Boolean) {
    val end = System.nanoTime() + 3_000_000_000L
    while (!done()) {
        Handler.drain()
        check(System.nanoTime() < end) { "Capture callback did not settle" }
        Thread.sleep(1)
    }
    Handler.drain()
}
private class Attempt(val context: ReactApplicationContext = ReactApplicationContext()) {
    val outcome = AtomicReference<Result<MediaProjection>?>()
    var interruptions = 0
    val capture = PlaybackAudioCapture(context) { interruptions++ }
    val worker = Thread { outcome.set(runCatching { capture.awaitProjection {} }) }.apply { start() }
    fun dialog() = pumpUntil { context.currentActivity!!.launches > 0 }
    fun result(approved: Boolean) {
        Looper.onMain {
            Service.consentGranted=approved
            capture.onActivityResult(context.currentActivity!!, context.currentActivity!!.request,
                if (approved) Activity.RESULT_OK else 0,
                if (approved) Intent(context, MainActivity::class.java) else null)
        }
    }
    fun finish() { pumpUntil { outcome.get() != null }; worker.join() }
    fun close() = Looper.onMain { capture.close() }
    fun error() = outcome.get()!!.exceptionOrNull()?.message
}

fun main() {
    // Cancellation can win before the queued UI launch, or while the dialog is visible.
    val early = Attempt()
    while (Handler.queue.isEmpty()) Thread.yield()
    early.close(); early.finish()
    check(early.error() == "Cancelled" && early.context.currentActivity!!.launches == 0)
    val denied = Attempt(); denied.dialog(); denied.result(false); denied.finish(); denied.close()
    check(denied.error() == "PlaybackCaptureCancelled" && denied.context.starts == 0)
    val cancelled = Attempt(); cancelled.dialog(); cancelled.close(); cancelled.result(true); cancelled.finish()
    check(cancelled.error() == "Cancelled" && cancelled.context.starts == 0 && cancelled.context.listeners.isEmpty())

    val success = Attempt(); success.dialog(); success.result(true); success.finish()
    check(success.outcome.get()!!.isSuccess && success.context.service!!.foreground)
    val projection = success.outcome.get()!!.getOrThrow()
    success.close(); success.close()
    check(projection.stopped && projection.stops == 1 && !success.context.service!!.foreground)
    check(success.context.stops == 1 && success.context.unbinds == 1 && success.interruptions == 0)
    check(success.context.listeners.isEmpty() && Handler.delayed.isEmpty())

    // Revocation while decoding/networking must reach the native caller, not leave silence recording.
    val revoked = Attempt(); revoked.dialog(); revoked.result(true); revoked.finish()
    revoked.outcome.get()!!.getOrThrow().stop(); Handler.drain()
    check(runCatching { revoked.capture.ensureAvailable() }.exceptionOrNull()?.message == "PlaybackCaptureCancelled")
    check(revoked.interruptions == 1 && !revoked.context.service!!.foreground)
    revoked.close()

    val failedBind = Attempt(ReactApplicationContext().apply { allowBind=false })
    failedBind.dialog(); failedBind.result(true); failedBind.finish(); failedBind.close()
    check(failedBind.error() == "PlaybackCaptureFailed")
    check(MediaProjectionManager.last!!.stopped && !failedBind.context.service!!.foreground)

    val pending = Attempt(ReactApplicationContext().apply { autoConnect=false })
    pending.dialog(); pending.result(true); pending.close(); pending.finish()
    Looper.onMain { pending.capture.onServiceConnected(ComponentName(), pending.context.service!!.onBind(Intent(Context(), MainActivity::class.java))) }
    check(pending.error() == "Cancelled" && pending.context.unbinds == 1 && pending.context.stops == 1)

    val timed = Attempt(ReactApplicationContext().apply { autoConnect=false })
    timed.dialog(); timed.result(true); SystemClock.extra.addAndGet(10_001); timed.finish(); timed.close()
    check(timed.error() == "PlaybackCaptureTimeout" && MediaProjectionManager.last!!.stopped)
    val unanswered = Attempt(); unanswered.dialog(); SystemClock.extra.addAndGet(120_001)
    unanswered.finish(); unanswered.close()
    check(unanswered.error() == "PlaybackCaptureTimeout" && unanswered.context.starts == 0)

    MediaProjectionManager.fail=true
    val rejected = Attempt(); rejected.dialog(); rejected.result(true); rejected.finish(); rejected.close()
    check(rejected.error() == "PlaybackCaptureFailed" && !rejected.context.service!!.foreground)
    MediaProjectionManager.fail=false

    val stopped = Attempt(); stopped.dialog(); stopped.result(true); stopped.finish()
    Looper.onMain {
        stopped.context.service!!.onStartCommand(Intent(Context(), MainActivity::class.java)
            .setAction("com.freetune.STOP_RECOGNITION"), 0, 2)
    }
    check(stopped.interruptions == 1 && !stopped.context.service!!.foreground)
    stopped.close()

    val expires = Attempt(); expires.dialog(); expires.result(true); expires.finish()
    Looper.onMain { Handler.delayed.toList().forEach { it.run() } }
    check(runCatching { expires.capture.ensureAvailable() }.exceptionOrNull()?.message == "PlaybackCaptureTimeout")
    expires.close()

    Build.VERSION.SDK_INT=28
    val unsupported = Attempt(); unsupported.finish(); unsupported.close()
    check(unsupported.error() == "PlaybackCaptureUnavailable")
    val legacyTile = RecognitionTileService(); legacyTile.onStartListening(); legacyTile.onClick()
    check(!legacyTile.pendingLaunch && legacyTile.launched!!.data.toString().contains("/auto?autoStart=true"))
    Build.VERSION.SDK_INT=36
    val tile = RecognitionTileService(); tile.onClick()
    val first = tile.launched!!.data.toString()
    check(tile.pendingLaunch && first.contains("/auto?autoStart=true&requestId="))
    tile.onClick(); check(first != tile.launched!!.data.toString())
    check(!RecognitionTileService.recognitionIntent(Context(), false).data.toString().contains("requestId"))
    println("PASS: Android playback consent, grant/deny, early cancel, late consent/binding, revocation, startup failure, deadlines, notification stop, foreground cleanup and API-specific Quick Settings launch. Android/React services are controlled test doubles.")
}
