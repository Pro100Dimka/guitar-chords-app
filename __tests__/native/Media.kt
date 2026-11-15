package android.media
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
class AudioFormat {
    companion object { const val CHANNEL_IN_MONO = 1; const val ENCODING_PCM_16BIT = 2 }
    class Builder {
        fun setSampleRate(rate: Int) = this
        fun setEncoding(encoding: Int) = this
        fun setChannelMask(mask: Int) = this
        fun build() = AudioFormat()
    }
}
object MediaRecorder { object AudioSource { const val MIC = 1 } }
class AudioRecord(source: Int, rate: Int, channel: Int, encoding: Int, size: Int) {
    private val stopped = CountDownLatch(1)
    private var frames = 0
    companion object {
        val readers = AtomicInteger()
        val released = AtomicInteger()
        var frequency = 0.0
        var permissionGranted = true
        var stoppedRead = -1
        var failedRead: Int? = null
        var throwRead = false
        var successfulReads = 2
        var blocked = CountDownLatch(1)
        const val STATE_INITIALIZED = 1
        const val RECORDSTATE_RECORDING = 3
        const val READ_BLOCKING = 0
        fun getMinBufferSize(rate: Int, channel: Int, encoding: Int) = 2940
    }
    class Builder {
        fun setAudioSource(source: Int) = this
        fun setAudioFormat(format: AudioFormat) = this
        fun setBufferSizeInBytes(size: Int) = this
        fun build() = AudioRecord(1, 44100, 1, 2, 4096)
    }
    val state = STATE_INITIALIZED
    var recordingState = 0
    init { if (!permissionGranted) throw SecurityException("Microphone denied") }
    fun startRecording() { recordingState = RECORDSTATE_RECORDING }
    fun read(buffer: ShortArray, offset: Int, size: Int, mode: Int) = read(buffer, offset, size)
    fun read(buffer: ShortArray, offset: Int, size: Int): Int {
        check(readers.incrementAndGet() == 1) { "Overlapping capture threads" }
        try {
            if (frames++ < successfulReads) {
                for (i in 0 until size) buffer[i] = (kotlin.math.sin(2 * Math.PI * frequency * i / 44100) * 16384).toInt().toShort()
                return size
            }
            blocked.countDown()
            if (throwRead) throw IllegalStateException("Audio device lost")
            failedRead?.let { return it }
            stopped.await()
            return stoppedRead
        } finally { readers.decrementAndGet() }
    }
    fun stop() { recordingState = 0; stopped.countDown() }
    fun release() { check(readers.get() == 0); released.incrementAndGet() }
}
