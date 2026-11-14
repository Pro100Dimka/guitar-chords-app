package android.media

import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.util.ArrayDeque

class MediaFormat {
    fun setInteger(key: String, value: Int) {}
    fun getString(key: String) = "audio/mp4a-latm"
    companion object {
        const val KEY_MIME = "mime"
        const val KEY_AAC_PROFILE = "profile"
        const val KEY_BIT_RATE = "bitrate"
        const val KEY_MAX_INPUT_SIZE = "input"
        fun createAudioFormat(mime: String, rate: Int, channels: Int) = MediaFormat()
    }
}
class MediaExtractor {
    private var complete = false
    fun setDataSource(path: String) { complete = java.io.File(path).inputStream().use { String(it.readNBytes(8)) == "complete" } }
    val trackCount get() = if (complete) 1 else 0
    val sampleTime get() = if (complete) 0L else -1L
    fun getTrackFormat(index: Int) = MediaFormat()
    fun selectTrack(index: Int) {}
    fun readSampleData(buffer: ByteBuffer, offset: Int) = if (complete) 4 else -1
    fun release() {}
}
object MediaCodecInfo { object CodecProfileLevel { const val AACObjectLC = 2 } }
class MediaCodec {
    class BufferInfo { var offset = 0; var size = 0; var flags = 0; var presentationTimeUs = 0L }
    private val input = ByteBuffer.allocate(16384)
    private val queue = ArrayDeque<Pair<ByteArray, Int>>()
    private var output = ByteArray(0)
    private var formatted = false
    val outputFormat = MediaFormat()
    companion object {
        const val CONFIGURE_FLAG_ENCODE = 1
        const val INFO_OUTPUT_FORMAT_CHANGED = -2
        const val BUFFER_FLAG_CODEC_CONFIG = 2
        const val BUFFER_FLAG_END_OF_STREAM = 4
        var ended = false
        fun createEncoderByType(mime: String) = MediaCodec().also { ended = false }
    }
    fun configure(format: MediaFormat, surface: Any?, crypto: Any?, flags: Int) {}
    fun start() {}
    fun stop() {}
    fun release() {}
    fun dequeueInputBuffer(timeout: Long) = 0
    fun getInputBuffer(index: Int) = input
    fun queueInputBuffer(index: Int, offset: Int, size: Int, time: Long, flags: Int) {
        queue.add(input.array().copyOfRange(offset, offset + size) to flags)
    }
    fun dequeueOutputBuffer(info: BufferInfo, timeout: Long): Int {
        if (!formatted) { formatted = true; return INFO_OUTPUT_FORMAT_CHANGED }
        val next = queue.poll() ?: return -1
        output = next.first; info.offset = 0; info.size = output.size; info.flags = next.second
        if (info.flags and BUFFER_FLAG_END_OF_STREAM != 0) ended = true
        return 0
    }
    fun getOutputBuffer(index: Int) = ByteBuffer.wrap(output)
    fun releaseOutputBuffer(index: Int, render: Boolean) {}
}
class MediaMuxer(path: String, format: Int) {
    object OutputFormat { const val MUXER_OUTPUT_MPEG_4 = 0 }
    private val stream = FileOutputStream(path)
    fun addTrack(format: MediaFormat) = 0
    fun start() {}
    fun stop() { stream.flush() }
    fun release() { stream.close() }
    fun writeSampleData(track: Int, buffer: ByteBuffer, info: MediaCodec.BufferInfo) {
        val bytes = ByteArray(info.size); buffer.get(bytes); stream.write(bytes)
    }
}
