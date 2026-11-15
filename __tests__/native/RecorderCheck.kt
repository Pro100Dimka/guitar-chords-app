import android.media.AudioRecord
import android.media.MediaCodec
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

fun checkRecorderStop(directory: File) {
    val type = Class.forName("com.freetune.PolishedRecorder")
    val constructor = type.getDeclaredConstructor().apply { isAccessible = true }
    val write = type.getDeclaredMethod("write", File::class.java, kotlin.jvm.functions.Function0::class.java, kotlin.jvm.functions.Function0::class.java).apply { isAccessible = true }
    val stop = type.getDeclaredMethod("stop").apply { isAccessible = true }
    val release = type.getDeclaredMethod("release").apply { isAccessible = true }
    for (terminal in listOf(0, -1)) {
        AudioRecord.stoppedRead = terminal
        AudioRecord.blocked = CountDownLatch(1)
        val capture = constructor.newInstance()
        val output = File(directory, "stop-$terminal.pcm")
        val failure = AtomicReference<Throwable?>()
        var captured = false
        val worker = Thread {
            try { check(write.invoke(capture, output, {}, { captured = true }) == false) { "Normal Stop marked the take interrupted" } }
            catch (error: Throwable) { failure.set(error.cause ?: error) }
        }
        try {
            worker.start()
            check(AudioRecord.blocked.await(5, TimeUnit.SECONDS)) { "Recorder never entered blocking read" }
            stop.invoke(capture)
            worker.join(5000)
            check(!worker.isAlive) { "Stop did not finish capture" }
            failure.get()?.let { throw it }
            check(captured && MediaCodec.ended) { "Capture callback or encoder EOS missing" }
            check(output.length() == (4096L + 44100) * 4) { "Captured frames or processed tail were lost" }
        } finally {
            stop.invoke(capture); worker.join(5000); release.invoke(capture)
            check(!output.exists() || output.delete())
        }
    }
    AudioRecord.stoppedRead = -1
    for (terminal in listOf(0, -1, -6, null)) {
        AudioRecord.failedRead = terminal
        AudioRecord.throwRead = terminal == null
        val capture = constructor.newInstance()
        val output = File(directory, "interrupted-$terminal.pcm")
        try {
            val interrupted = write.invoke(capture, output, {}, {})
            check(interrupted == true) { "Microphone failure was not reported as an interrupted take" }
            check(MediaCodec.ended && output.length() == (4096L + 44100) * 4) { "Interrupted take lost frames or its fading tail" }
        } finally {
            release.invoke(capture)
            output.delete()
            AudioRecord.failedRead = null
            AudioRecord.throwRead = false
        }
    }
    AudioRecord.successfulReads = 0
    AudioRecord.failedRead = -6
    val emptyCapture = constructor.newInstance()
    val emptyOutput = File(directory, "empty-interrupted.pcm")
    try {
        var rejected = false
        try { write.invoke(emptyCapture, emptyOutput, {}, {}) } catch (_: java.lang.reflect.InvocationTargetException) { rejected = true }
        check(rejected) { "An empty interrupted take was accepted" }
    } finally {
        release.invoke(emptyCapture)
        emptyOutput.delete()
        AudioRecord.successfulReads = 2
        AudioRecord.failedRead = null
    }
    AudioRecord.failedRead = -6
    MediaCodec.failEnd = true
    val brokenCapture = constructor.newInstance()
    val brokenOutput = File(directory, "broken-encoder.pcm")
    try {
        var rejected = false
        try { write.invoke(brokenCapture, brokenOutput, {}, {}) } catch (_: java.lang.reflect.InvocationTargetException) { rejected = true }
        check(rejected) { "Encoder failure was reported as a saved interrupted take" }
    } finally {
        release.invoke(brokenCapture)
        brokenOutput.delete()
        AudioRecord.failedRead = null
        MediaCodec.failEnd = false
    }
    println("Actual recorder passed normal Stop, zero/negative/throwing microphone failures, empty capture rejection and encoder failure rejection; frames, processed tail and EOS preserved (device/codec stubs).")
}
