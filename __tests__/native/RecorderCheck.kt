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
            try { write.invoke(capture, output, {}, { captured = true }) }
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
    println("Actual recorder drained both zero and negative read results after Stop, preserving captured frames, tail and encoder EOS (device/codec stubs).")
}
