package android.media
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
object AudioFormat { const val CHANNEL_IN_MONO = 1; const val ENCODING_PCM_16BIT = 2 }
object MediaRecorder { object AudioSource { const val MIC = 1 } }
class AudioRecord(source: Int, rate: Int, channel: Int, encoding: Int, size: Int) {
    private val stopped = CountDownLatch(1)
    private var frames = 0
    companion object {
        val readers = AtomicInteger()
        val released = AtomicInteger()
        var frequency = 0.0
        var permissionGranted = true
        fun getMinBufferSize(rate: Int, channel: Int, encoding: Int) = 2940
    }
    init { if (!permissionGranted) throw SecurityException("Microphone denied") }
    fun startRecording() {}
    fun read(buffer: ShortArray, offset: Int, size: Int): Int {
        check(readers.incrementAndGet() == 1) { "Overlapping capture threads" }
        try {
            if (frames++ < 2) {
                for (i in 0 until size) buffer[i] = (kotlin.math.sin(2 * Math.PI * frequency * i / 44100) * 16384).toInt().toShort()
                return size
            }
            stopped.await()
            return -1
        } finally { readers.decrementAndGet() }
    }
    fun stop() { stopped.countDown() }
    fun release() { check(readers.get() == 0); released.incrementAndGet() }
}
