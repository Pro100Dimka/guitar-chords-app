package com.freetune

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.*
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Audio stays on the device: at most 12 seconds are decoded and fingerprinted locally.
 * Only the Shazam signature is sent over HTTPS. No audio files or DB rows are created.
 */
class SongRecognitionModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    private val worker = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    @Volatile private var recorder: AudioRecord? = null
    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var running = false

    override fun getName() = "SongRecognition"

    @ReactMethod
    fun recognizeMicrophone(promise: Promise) = start(promise) { captureMicrophone() }

    @ReactMethod
    fun recognizeFile(uri: String, promise: Promise) = start(promise) {
        require(uri.startsWith("content://") || uri.startsWith("file://")) { "Invalid audio URI" }
        decodeFile(Uri.parse(uri))
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        cancelled.set(true)
        try { recorder?.stop() } catch (_: Exception) {}
        connection?.disconnect()
        promise.resolve(null)
    }

    private fun start(promise: Promise, pcm: () -> ShortArray) {
        synchronized(this) {
            if (running) {
                promise.reject("Busy", "Recognition is already running")
                return
            }
            running = true
            cancelled.set(false)
        }
        worker.execute {
            try {
                val samples = pcm()
                ensureActive()
                if (samples.size < 32_000) throw IllegalStateException("AudioTooShort")
                val signature = SongFingerprint.fingerprint(samples)
                ensureActive()
                val result = submit(signature, samples.size * 1000 / 16_000)
                ensureActive()
                if (result == null) promise.resolve(null)
                else promise.resolve(Arguments.createMap().apply {
                    putString("title", result.first)
                    putString("artist", result.second)
                    putString("source", "Shazam")
                })
            } catch (error: Exception) {
                promise.reject(if (cancelled.get()) "Cancelled" else "RecognitionFailed",
                    error.message ?: "Recognition failed", error)
            } finally {
                try { recorder?.release() } catch (_: Exception) {}
                recorder = null
                connection?.disconnect()
                connection = null
                synchronized(this) { running = false }
            }
        }
    }

    private fun ensureActive() {
        if (cancelled.get() || Thread.currentThread().isInterrupted)
            throw IllegalStateException("Cancelled")
    }

    private fun captureMicrophone(): ShortArray {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            throw SecurityException("MicrophonePermissionDenied")
        val minBuffer = AudioRecord.getMinBufferSize(16_000,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuffer <= 0) throw IllegalStateException("AudioDeviceUnavailable")
        val record = AudioRecord(MediaRecorder.AudioSource.MIC, 16_000,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuffer, 4096))
        recorder = record
        if (record.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("AudioDeviceUnavailable")
        val collected = ShortArray(12 * 16_000)
        val buffer = ShortArray(2048)
        var count = 0
        try {
            record.startRecording()
            while (count < collected.size) {
                ensureActive()
                val n = record.read(buffer, 0, min(buffer.size, collected.size - count))
                if (n < 0) throw IllegalStateException("MicrophoneReadFailed")
                if (n == 0) continue
                buffer.copyInto(collected, count, 0, n)
                count += n
            }
        } finally {
            try { record.stop() } catch (_: Exception) {}
        }
        return collected.copyOf(count)
    }

    /**
     * MediaExtractor accepts content:// directly through the provider's fd.
     * Decode packets until a bounded 12-second section is available; never read the entire file.
     */
    private fun decodeFile(uri: Uri): ShortArray {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { asset ->
                extractor.setDataSource(asset.fileDescriptor, asset.startOffset, asset.length)
            } ?: throw IllegalStateException("FileUnavailable")
            val index = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IllegalStateException("NoAudioTrack")
            extractor.selectTrack(index)
            val format = extractor.getTrackFormat(index)
            val duration = if (format.containsKey(MediaFormat.KEY_DURATION))
                format.getLong(MediaFormat.KEY_DURATION) else 0L
            val startUs = if (duration > 15_000_000L) (duration / 2 - 6_000_000L).coerceAtLeast(0) else 0L
            if (startUs > 0) extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: throw IllegalStateException("UnsupportedAudio")
            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(format, null, null, 0)
            codec.start()
            val selected = ShortArray(192_000)
            val bufferInfo = MediaCodec.BufferInfo()
            var outputCount = 0
            var inputDone = false
            var outputDone = false
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var firstTimeUs = -1L
            var decodedFrames = 0L
            while (!outputDone && outputCount < selected.size) {
                ensureActive()
                if (!inputDone) {
                    val inputIndex = codec.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val input = codec.getInputBuffer(inputIndex)!!
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000)
                when (outputIndex) {
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val actual = codec.outputFormat
                        rate = actual.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (actual.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            actual.getInteger(MediaFormat.KEY_PCM_ENCODING) != AudioFormat.ENCODING_PCM_16BIT)
                            throw IllegalStateException("UnsupportedPcmFormat")
                    }
                    else -> if (outputIndex >= 0) {
                        if (bufferInfo.size > 0) {
                            val bytes = codec.getOutputBuffer(outputIndex)!!
                            bytes.position(bufferInfo.offset)
                            bytes.limit(bufferInfo.offset + bufferInfo.size)
                            val samples = bytes.slice().order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                            if (firstTimeUs < 0) firstTimeUs = bufferInfo.presentationTimeUs
                            val frameCount = samples.remaining() / channels
                            for (frame in 0 until frameCount) {
                                if ((frame and 2047) == 0) ensureActive()
                                var sum = 0
                                for (channel in 0 until channels) sum += samples.get()
                                val mono = (sum / channels).toShort()
                                val index16 = ((decodedFrames + frame).toDouble() * 16000.0 / rate).toInt()
                                val next16 = ((decodedFrames + frame + 1).toDouble() * 16000.0 / rate).toInt()
                                // Zero-order hold, bounded; sufficient for a robust signature input.
                                for (i in index16 until min(next16, selected.size))
                                    selected[i] = mono
                                outputCount = min(next16, selected.size)
                                if (outputCount >= selected.size) break
                            }
                            decodedFrames += frameCount
                        }
                        outputDone = bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        codec.releaseOutputBuffer(outputIndex, false)
                    }
                }
            }
            return selected.copyOf(outputCount)
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            extractor.release()
        }
    }

    private fun submit(signature: String, durationMs: Int): Pair<String, String>? {
        val timestamp = System.currentTimeMillis()
        val url = URL("https://amp.shazam.com/discovery/v5/en/US/iphone/-/tag/" +
            UUID.randomUUID() + "/" + UUID.randomUUID() +
            "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3")
        val payload = JSONObject().apply {
            put("timezone", "Europe/Paris")
            put("timestamp", timestamp)
            put("signature", JSONObject().apply {
                put("samplems", durationMs)
                put("uri", signature)
            })
            put("geolocation", JSONObject())
            put("context", JSONObject())
        }
        val conn = url.openConnection() as HttpURLConnection
        connection = conn
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("User-Agent", "FreeTune/1.0 Android")
            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            ensureActive()
            if (conn.responseCode == 429) throw IllegalStateException("RateLimited")
            if (conn.responseCode !in 200..299) throw IllegalStateException("ServiceHttp${conn.responseCode}")
            val response = conn.inputStream.bufferedReader().use { it.readText() }
            val track = JSONObject(response).optJSONObject("track") ?: return null
            val title = track.optString("title").trim()
            val artist = track.optString("subtitle").trim()
            return if (title.isNotEmpty() && artist.isNotEmpty()) title to artist else null
        } finally {
            conn.disconnect()
        }
    }

    override fun invalidate() {
        cancelled.set(true)
        try { recorder?.stop() } catch (_: Exception) {}
        connection?.disconnect()
        worker.shutdownNow()
        super.invalidate()
    }
}
