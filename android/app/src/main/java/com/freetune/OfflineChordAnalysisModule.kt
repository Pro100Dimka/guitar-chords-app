package com.freetune

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.CancellationSignal
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.Closeable
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CancellationException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import kotlin.math.roundToInt

/** File decoding and analysis stay on the worker; only the chord timeline crosses the bridge. */
class OfflineChordAnalysisModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    private val worker = Executors.newSingleThreadExecutor()
    private val fileWorkers = ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(2))
    private val cancellationWorker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(4))
    private val lock = Any()
    private var active: ChordAnalysisJob? = null
    private var invalidated = false

    override fun getName() = "OfflineChordAnalysis"

    @ReactMethod
    fun analyzeFile(uri: String, promise: Promise) {
        if (!uri.startsWith("file://") && !uri.startsWith("content://")) {
            promise.reject("FileUnavailable", "Choose a local audio file")
            return
        }
        val job: ChordAnalysisJob
        synchronized(lock) {
            if (invalidated) { promise.reject("AnalysisUnsupported", "Module unavailable"); return }
            if (active != null) { promise.reject("Busy", "Analysis is already running"); return }
            job = ChordAnalysisJob()
            active = job
        }
        try {
            worker.execute {
                val started = SystemClock.elapsedRealtime()
                var result: WritableMap? = null
                var failure: Throwable? = null
                try {
                    job.check()
                    result = readFile(Uri.parse(uri), job)
                    job.check()
                    result.putDouble("elapsedMs", (SystemClock.elapsedRealtime() - started).toDouble())
                } catch (error: Exception) {
                    failure = error
                } catch (error: LinkageError) {
                    failure = IllegalStateException("AnalysisUnsupported", error)
                }
                val waiters = synchronized(lock) {
                    if (active === job) active = null
                    job.waiters.toList().also { job.waiters.clear() }
                }
                val code = when {
                    job.cancelled.get() -> "Cancelled"
                    job.expired.get() -> "FileReadTimeout"
                    failure == null -> null
                    failure.message in ERROR_CODES -> failure.message
                    failure is SecurityException || failure is java.io.FileNotFoundException -> "FileUnavailable"
                    else -> "AudioDecodeFailed"
                }
                if (code != null) promise.reject(code, code, failure)
                else promise.resolve(result)
                waiters.forEach { it.resolve(null) }
            }
        } catch (_: RejectedExecutionException) {
            synchronized(lock) { if (active === job) active = null }
            promise.reject("AnalysisUnsupported", "Module unavailable")
        }
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        val job = synchronized(lock) {
            val current = active
            if (current != null) {
                current.cancelled.set(true)
                current.waiters.add(promise)
            }
            current
        }
        if (job == null) promise.resolve(null) else stop(job)
    }

    private fun stop(job: ChordAnalysisJob, expired: Boolean = false) {
        if (expired) job.expired.set(true) else job.cancelled.set(true)
        job.task?.let { it.cancel(true); fileWorkers.remove(it) }
        job.started.countDown()
        // A remote document provider may block cancellation/close. Keep that off the bridge.
        runCatching { cancellationWorker.execute {
            runCatching { job.signal.cancel() }
            runCatching { job.asset.getAndSet(null)?.close() }
        } }
    }

    private fun readFile(uri: Uri, job: ChordAnalysisJob): WritableMap {
        val task = FutureTask {
            job.started.countDown()
            job.check()
            // This worker owns the core and every descriptor until its finally block runs,
            // even when a document provider ignores cancellation and returns much later.
            decodeFile(uri, job).also { job.check() }
        }
        job.task = task
        job.check()
        try { fileWorkers.execute(task) }
        catch (error: RejectedExecutionException) { task.cancel(false); throw IllegalStateException("Busy", error) }
        if (job.cancelled.get()) fileWorkers.remove(task)
        if (!job.started.await(1, TimeUnit.SECONDS)) {
            task.cancel(true)
            fileWorkers.remove(task)
            throw IllegalStateException("Busy")
        }
        job.check()
        return try { task.get(180, TimeUnit.SECONDS) }
        catch (error: TimeoutException) { stop(job, expired = true); throw IllegalStateException("FileReadTimeout", error) }
        catch (error: CancellationException) { job.check(); throw IllegalStateException("Cancelled", error) }
        catch (error: ExecutionException) { throw error.cause ?: error }
    }

    private fun decodeFile(uri: Uri, job: ChordAnalysisJob): WritableMap {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var asset: android.content.res.AssetFileDescriptor? = null
        var analyzer = 0L
        try {
            job.check()
            asset = context.contentResolver.openAssetFileDescriptor(uri, "r", job.signal)
                ?: throw IllegalStateException("FileUnavailable")
            job.asset.set(asset)
            job.check()
            if (asset.length >= 0) extractor.setDataSource(asset.fileDescriptor, asset.startOffset, asset.length)
            else extractor.setDataSource(asset.fileDescriptor)
            job.check()
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IllegalStateException("NoAudioTrack")
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            if (format.containsKey(MediaFormat.KEY_DURATION) && format.getLong(MediaFormat.KEY_DURATION) > 900_000_000L)
                throw IllegalStateException("AudioTooLong")
            val mime = format.getString(MediaFormat.KEY_MIME) ?: throw IllegalStateException("UnsupportedAudio")
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            checkFormat(rate, channels)
            var encoding = AudioFormat.ENCODING_PCM_16BIT
            decoder = MediaCodec.createDecoderByType(mime)
            decoder.configure(format, null, null, 0)
            decoder.start()
            analyzer = OfflineChordAnalyzer.create()
            if (analyzer == 0L) throw IllegalStateException("AudioAnalysisFailed")
            val resampler = ChordPcmStream(rate) { samples, count ->
                job.check()
                when (OfflineChordAnalyzer.push(analyzer, samples, count)) {
                    0 -> Unit
                    1 -> throw IllegalStateException("AudioTooLong")
                    else -> throw IllegalStateException("AudioAnalysisFailed")
                }
            }
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            while (!outputDone) {
                job.check()
                if (!inputDone) {
                    val index = decoder.dequeueInputBuffer(10_000)
                    if (index >= 0) {
                        val input = decoder.getInputBuffer(index) ?: throw IllegalStateException("AudioDecodeFailed")
                        val size = extractor.readSampleData(input, 0)
                        job.check()
                        if (size < 0) {
                            decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val index = decoder.dequeueOutputBuffer(info, 10_000)
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val actual = decoder.outputFormat
                    val actualRate = actual.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    checkFormat(actualRate, channels)
                    if (actualRate != rate) {
                        resampler.setRate(actualRate)
                        rate = actualRate
                    }
                    encoding = if (actual.containsKey(MediaFormat.KEY_PCM_ENCODING))
                        actual.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
                    if (encoding != AudioFormat.ENCODING_PCM_16BIT && encoding != AudioFormat.ENCODING_PCM_FLOAT)
                        throw IllegalStateException("UnsupportedPcmFormat")
                } else if (index >= 0) {
                    try {
                        if (info.size > 0) {
                            val bytes = decoder.getOutputBuffer(index) ?: throw IllegalStateException("AudioDecodeFailed")
                            bytes.position(info.offset)
                            bytes.limit(info.offset + info.size)
                            bytes.order(ByteOrder.LITTLE_ENDIAN)
                            val frameBytes = channels * if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
                            if (bytes.remaining() % frameBytes != 0) throw IllegalStateException("UnsupportedPcmFormat")
                            val frames = bytes.remaining() / frameBytes
                            for (frame in 0 until frames) {
                                if ((frame and 2047) == 0) job.check()
                                var mono = 0.0
                                repeat(channels) {
                                    val sample = if (encoding == AudioFormat.ENCODING_PCM_FLOAT)
                                        bytes.float.toDouble() * 32768.0 else bytes.short.toDouble()
                                    if (!sample.isFinite()) throw IllegalStateException("UnsupportedPcmFormat")
                                    mono += sample
                                }
                                resampler.append(mono / channels)
                            }
                        }
                        outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    } finally {
                        decoder.releaseOutputBuffer(index, false)
                    }
                }
            }
            resampler.finish()
            job.check()
            if (resampler.outputFrames < 16000L) throw IllegalStateException("AudioTooShort")
            val json = OfflineChordAnalyzer.finish(analyzer) ?: throw IllegalStateException("AudioAnalysisFailed")
            job.check()
            return chordResult(JSONObject(json))
        } finally {
            if (analyzer != 0L) OfflineChordAnalyzer.destroy(analyzer)
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { extractor.release() }
            if (job.asset.compareAndSet(asset, null)) runCatching { asset?.close() }
        }
    }

    override fun invalidate() {
        synchronized(lock) {
            invalidated = true
            active?.let { stop(it) }
        }
        // Let an admitted task run its cancellation/settlement path even if it has not started.
        worker.shutdown()
        fileWorkers.shutdownNow()
        cancellationWorker.shutdown()
        super.invalidate()
    }

    companion object {
        private val ERROR_CODES = setOf("AnalysisUnsupported", "Busy", "Cancelled", "FileReadTimeout", "FileUnavailable",
            "AudioTooShort", "AudioTooLong", "NoAudioTrack", "UnsupportedAudio", "UnsupportedPcmFormat",
            "AudioDecodeFailed", "AudioAnalysisFailed")

        private fun checkFormat(rate: Int, channels: Int) {
            if (rate !in 8000..384000 || channels !in 1..32) throw IllegalStateException("UnsupportedAudio")
        }

        private fun chordResult(json: JSONObject): WritableMap = Arguments.createMap().apply {
            putString("engine", json.getString("engine"))
            putDouble("duration", json.getDouble("duration"))
            if (json.isNull("key")) putNull("key") else putString("key", json.getString("key"))
            if (json.isNull("tempo")) putNull("tempo") else putDouble("tempo", json.getDouble("tempo"))
            val segments = json.getJSONArray("segments")
            putArray("segments", Arguments.createArray().apply {
                for (index in 0 until segments.length()) {
                    val segment = segments.getJSONObject(index)
                    pushMap(Arguments.createMap().apply {
                        putDouble("start", segment.getDouble("start"))
                        putDouble("end", segment.getDouble("end"))
                        putString("chord", segment.getString("chord"))
                        putDouble("confidence", segment.getDouble("confidence"))
                    })
                }
            })
        }
    }
}

private class ChordAnalysisJob {
    val signal = CancellationSignal()
    val asset = AtomicReference<Closeable?>()
    val cancelled = AtomicBoolean(false)
    val expired = AtomicBoolean(false)
    val started = CountDownLatch(1)
    @Volatile var task: FutureTask<WritableMap>? = null
    val waiters = mutableListOf<Promise>() // guarded by the module lock

    fun check() {
        if (cancelled.get() || Thread.currentThread().isInterrupted || task?.isCancelled == true)
            throw IllegalStateException("Cancelled")
        if (expired.get()) throw IllegalStateException("FileReadTimeout")
    }
}

/** Continuous box averaging before downsampling; boundaries never reset the sample clock. */
internal class ChordPcmStream(private var rate: Int, private val push: (ShortArray, Int) -> Unit) {
    private val buffer = ShortArray(4096)
    private var count = 0
    private var sourceFrames = 0L
    private var sum = 0.0
    private var averaged = 0
    var outputFrames = 0L
        private set

    fun setRate(value: Int) {
        if (sourceFrames != 0L) throw IllegalStateException("UnsupportedAudio")
        rate = value
    }

    fun append(sample: Double) {
        sourceFrames++
        if (sourceFrames > rate.toLong() * 900L) throw IllegalStateException("AudioTooLong")
        sum += sample
        averaged++
        val target = sourceFrames * 16000L / rate
        if (target > outputFrames) {
            val value = (sum / averaged).coerceIn(-32768.0, 32767.0).roundToInt().toShort()
            while (outputFrames < target) {
                buffer[count++] = value
                outputFrames++
                if (count == buffer.size) { push(buffer, count); count = 0 }
            }
            sum = 0.0
            averaged = 0
        }
    }

    fun finish() { if (count > 0) { push(buffer, count); count = 0 } }
}

internal object OfflineChordAnalyzer {
    init { System.loadLibrary("freetune_song_fingerprint") }
    external fun create(): Long
    external fun push(handle: Long, samples: ShortArray, count: Int): Int
    external fun finish(handle: Long): String?
    external fun destroy(handle: Long)
}
