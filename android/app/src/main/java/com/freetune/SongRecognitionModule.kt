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
import android.os.SystemClock
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.*
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Audio stays on the device: microphone capture is bounded to 20 seconds; fingerprints use up to 12 seconds.
 * Only the Shazam signature is sent over HTTPS. No audio files or DB rows are created.
 */
class SongRecognitionModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    private val worker = Executors.newSingleThreadExecutor()
    private val captureWorker = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    @Volatile private var recorder: AudioRecord? = null
    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var running = false
    @Volatile private var rateLimitedUntil = 0L

    override fun getName() = "SongRecognition"

    @ReactMethod
    fun recognizeMicrophone(promise: Promise) = start(promise) { captureMicrophone() }

    @ReactMethod
    fun recognizeFile(uri: String, promise: Promise) = start(promise) {
        require(uri.startsWith("content://") || uri.startsWith("file://")) { "Invalid audio URI" }
        identify(decodeFile(Uri.parse(uri)))
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        cancelled.set(true)
        try { recorder?.stop() } catch (_: Exception) {}
        connection?.disconnect()
        promise.resolve(null)
    }

    private fun start(promise: Promise, recognize: () -> JSONObject?) {
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
                val result = recognize()
                ensureActive()
                if (result == null) promise.resolve(null)
                else promise.resolve(Arguments.createMap().apply {
                    putString("title", result.optString("title"))
                    putString("artist", result.optString("subtitle"))
                    putString("cover", result.optJSONObject("images")?.optString("coverarthq") ?: "")
                    putString("genre", result.optJSONObject("genres")?.optString("primary") ?: "")
                    val key = result.optString("key")
                    if (key.matches(Regex("[0-9]+"))) putString("url", "https://www.shazam.com/track/$key")
                    val sections = result.optJSONArray("sections")
                    for (i in 0 until (sections?.length() ?: 0)) {
                        val section = sections?.optJSONObject(i) ?: continue
                        if (section.optString("type") == "LYRICS") {
                            val lines = section.optJSONArray("text")
                            val lyrics = (0 until (lines?.length() ?: 0))
                                .mapNotNull { lines?.opt(it) as? String }.joinToString("\n").trim()
                            if (lyrics.isNotEmpty() && lyrics.length <= 200000) {
                                putString("lyrics", lyrics)
                                putString("lyricsCredit", section.optString("footer").take(2000))
                            }
                        }
                        val metadata = section.optJSONArray("metadata") ?: continue
                        for (j in 0 until metadata.length()) {
                            val entry = metadata.optJSONObject(j) ?: continue
                            if (entry.optString("title").equals("Album", ignoreCase = true))
                                putString("album", entry.optString("text"))
                        }
                    }
                    putString("source", "Shazam")
                })
            } catch (error: LinkageError) {
                promise.reject("RecognitionUnsupported", "Audio recognition is unavailable for this device", error)
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

    private fun identify(samples: ShortArray): JSONObject? {
        ensureActive()
        if (samples.size < 32_000) throw IllegalStateException("AudioTooShort")
        val signature = SongFingerprint.fingerprint(samples)
        ensureActive()
        return submit(signature, samples.size * 1000 / 16_000)
    }

    private fun captureMicrophone(): JSONObject? {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            throw SecurityException("MicrophonePermissionDenied")
        val minBuffer = AudioRecord.getMinBufferSize(16_000,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuffer <= 0) throw IllegalStateException("AudioDeviceUnavailable")
        val record = AudioRecord(MediaRecorder.AudioSource.MIC, 16_000,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuffer, 4096))
        recorder = record
        if (record.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("AudioDeviceUnavailable")
        val collected = ShortArray(20 * 16_000)
        val count = AtomicInteger(0)
        val done = AtomicBoolean(false)
        val captureError = AtomicReference<Exception?>(null)
        val deadline = SystemClock.elapsedRealtime() + 20_000L
        record.startRecording()
        val capture = captureWorker.submit {
            val buffer = ShortArray(2048)
            try {
                while (!done.get() && count.get() < collected.size && SystemClock.elapsedRealtime() < deadline) {
                    ensureActive()
                    val offset = count.get()
                    val n = record.read(buffer, 0, min(buffer.size, collected.size - offset), AudioRecord.READ_NON_BLOCKING)
                    if (n < 0) throw IllegalStateException("MicrophoneReadFailed")
                    if (n == 0) { Thread.sleep(10); continue }
                    buffer.copyInto(collected, offset, 0, n)
                    count.addAndGet(n)
                }
            } catch (error: Exception) {
                if (!done.get()) captureError.set(error)
            } finally {
                try { record.stop() } catch (_: Exception) {}
            }
        }
        try {
            var previousCount = 0
            for (seconds in intArrayOf(3, 7, 12, 20)) {
                if (seconds * 16_000 <= previousCount) continue
                while (count.get() < seconds * 16_000 && !capture.isDone && SystemClock.elapsedRealtime() < deadline) {
                    ensureActive()
                    Thread.sleep(25)
                }
                ensureActive()
                captureError.get()?.let { throw it }
                val available = count.get()
                if (available < 32_000 || available <= previousCount) continue
                val snapshot = collected.copyOfRange(maxOf(0, available - 12 * 16_000), available)
                previousCount = available
                val result = identify(snapshot)
                if (result != null) return result
            }
            return null
        } finally {
            done.set(true)
            try { record.stop() } catch (_: Exception) {}
            try { capture.get(1, TimeUnit.SECONDS) } catch (_: Exception) {}
        }
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
                if (asset.length >= 0) extractor.setDataSource(asset.fileDescriptor, asset.startOffset, asset.length)
                else extractor.setDataSource(asset.fileDescriptor)
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
            var sampleSum = 0L
            var sampleCount = 0
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
                                sampleSum += mono.toLong()
                                sampleCount++
                                val next16 = ((decodedFrames + frame + 1).toDouble() * 16000.0 / rate).toInt()
                                // Average each input window before downsampling; repeat only when upsampling.
                                val previousOutput = outputCount
                                while (outputCount < next16 && outputCount < selected.size) {
                                    selected[outputCount++] = (sampleSum / sampleCount).toInt().toShort()
                                }
                                if (outputCount > previousOutput) {
                                    sampleSum = 0L
                                    sampleCount = 0
                                }
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

    private fun submit(signature: String, durationMs: Int): JSONObject? {
        val timestamp = System.currentTimeMillis()
        if (timestamp < rateLimitedUntil) throw IllegalStateException("RateLimited")
        val url = URL("https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag/" +
            UUID.randomUUID() + "/" + UUID.randomUUID() +
            "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3")
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
            conn.setRequestProperty("User-Agent", "Dalvik/2.1.0 (Linux; U; Android 11)")
            conn.setRequestProperty("X-Shazam-Platform", "IPHONE")
            conn.setRequestProperty("X-Shazam-AppVersion", "14.1.0")
            conn.setRequestProperty("Accept-Language", "en-US")
            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            ensureActive()
            if (conn.responseCode == 429) {
                val seconds = conn.getHeaderField("Retry-After")?.toLongOrNull()?.coerceIn(1L, 3600L) ?: 30L
                rateLimitedUntil = System.currentTimeMillis() + seconds * 1000L
                throw IllegalStateException("RateLimited")
            }
            if (conn.responseCode !in 200..299) throw IllegalStateException("ServiceHttp${conn.responseCode}")
            val response = conn.inputStream.bufferedReader().use { it.readText() }
            val track = JSONObject(response).optJSONObject("track") ?: return null
            val title = track.optString("title").trim()
            val artist = track.optString("subtitle").trim()
            return if (title.isNotEmpty() && artist.isNotEmpty()) track else null
        } finally {
            conn.disconnect()
        }
    }

    override fun invalidate() {
        cancelled.set(true)
        try { recorder?.stop() } catch (_: Exception) {}
        connection?.disconnect()
        worker.shutdownNow()
        captureWorker.shutdownNow()
        super.invalidate()
    }
}
