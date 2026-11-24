package com.freetune

import android.media.AudioManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaExtractor
import android.content.Context
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ConcurrentHashMap
import java.nio.ByteBuffer
import java.nio.ByteOrder

// Keep the full twelve-key TabTransport lookahead ready before its first attack.
private const val PREPARED_GUITARS_LIMIT = 12

class PerformanceAudio(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    private var recorder: PolishedRecorder? = null
    private var player: MediaPlayer? = null
    private var cue: MediaPlayer? = null
    private var guitar: AudioTrack? = null
    private var metronome: AudioTrack? = null
    private val metronomeBeats = mutableMapOf<Int, AudioTrack>()
    private val guitarStrings = mutableMapOf<Int, AudioTrack>()
    private val guitarPcm = linkedMapOf<String, ByteArray>()
    private val preparedGuitars = linkedMapOf<String, AudioTrack>()
    private val preparingGuitars = mutableSetOf<String>()
    private var take: File? = null
    private var lastTake: String? = null
    private val processing = ConcurrentHashMap.newKeySet<String>()
    private val worker = Executors.newSingleThreadExecutor()
    private val samplerWorker = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(32))
    private var instrumentPlaybackActive = context.lifecycleState == LifecycleState.RESUMED
    private var invalidated = false
    private val directory get() = File(context.filesDir, "performances").apply { mkdirs() }
    private val audioManager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change < 0) {
            synchronized(this) {
                finishTake(); stopPlayback()
                if (!invalidated && context.hasActiveReactInstance()) emit("playbackInterrupted")
            }
        }
    }
    init {
        context.addLifecycleEventListener(this)
        worker.execute { try { reconcileRecordings() } catch (_: Exception) { emit("error") } }
    }
    override fun getName() = "PerformanceAudio"
    private fun emit(state: String, uri: String? = null) {
        val body = Arguments.createMap().apply { putString("state", state); putString("uri", uri) }
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("onPerformanceAudio", body)
    }
    private fun focus() {
        if (audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
            throw IllegalStateException("Audio is in use")
    }
    @ReactMethod @Synchronized
    fun startTake(songId: String, promise: Promise) {
        if (!songId.matches(Regex("[1-9][0-9]*")) || recorder != null || processing.isNotEmpty()) { promise.reject("RECORDING_BUSY", "Recording unavailable"); return }
        stopPlayback()
        var ownedFile: File? = null
        var capture: PolishedRecorder? = null
        try {
            focus()
            val recording = PolishedRecorder()
            capture = recording
            val file = reserveRecordingFile(directory, songId)
            ownedFile = file
            take = file
            recorder = recording
            lastTake = null
            worker.execute {
                val output = File(directory, file.nameWithoutExtension + ".processing.m4a")
                var state = "saved"
                var began = false
                try {
                    android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
                    val interrupted = recording.write(output, {
                        began = true
                        promise.resolve(file.absolutePath)
                    }) {
                        synchronized(this) { if (recorder === recording) finishTake() }
                    }
                    check(output.length() > 0 && output.renameTo(file))
                    if (interrupted) {
                        state = "interrupted"
                        runCatching { File(directory, file.nameWithoutExtension + ".interrupted").createNewFile() }
                    }
                } catch (error: Exception) {
                    file.delete()
                    state = "error"
                    if (!began) promise.reject("RECORDING_FAILED", error)
                } finally {
                    recording.release()
                    output.delete()
                    synchronized(this) {
                        if (recorder === recording) {
                            recorder = null
                            take = null
                            audioManager.abandonAudioFocus(focusListener)
                        }
                        if (state == "error" && lastTake == file.absolutePath) lastTake = null
                    }
                    processing.remove(file.absolutePath)
                    if (began) emit(state, file.absolutePath)
                }
            }
        } catch (error: Exception) {
            capture?.release()
            recorder = null
            take = null
            ownedFile?.delete()
            audioManager.abandonAudioFocus(focusListener)
            promise.reject("RECORDING_FAILED", error)
        }
    }
    @Synchronized private fun finishTake(): String? {
        val capture = recorder ?: return lastTake
        val file = take
        recorder = null
        take = null
        lastTake = file?.absolutePath
        if (file != null) {
            processing.add(file.absolutePath)
            emit("processing", file.absolutePath)
        }
        capture.stop()
        audioManager.abandonAudioFocus(focusListener)
        return lastTake
    }
    @ReactMethod fun stopTake(promise: Promise) { promise.resolve(finishTake()) }
    private fun localFile(path: String): File {
        val file = File(path).canonicalFile
        require(file.parentFile == directory.canonicalFile && file.name.matches(Regex("song-[0-9]+-[0-9]+\\.m4a")))
        return file
    }
    @Synchronized private fun reconcileRecordings() {
        val active = (processing + listOfNotNull(take?.absolutePath)).map { File(it).canonicalPath }.toSet()
        directory.listFiles()?.filter { it.name.matches(Regex("song-[0-9]+-[0-9]+\\.processing\\.m4a")) }?.forEach { partial ->
            val target = File(directory, partial.name.removeSuffix(".processing.m4a") + ".m4a")
            if (target.canonicalPath in active) return@forEach
            if (target.length() > 0) {
                check(partial.delete())
                return@forEach
            }
            val extractor = MediaExtractor()
            val valid = try {
                extractor.setDataSource(partial.absolutePath)
                val track = (0 until extractor.trackCount).firstOrNull {
                    extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
                }
                if (track == null) false else {
                    extractor.selectTrack(track)
                    extractor.sampleTime >= 0 && extractor.readSampleData(ByteBuffer.allocate(16384), 0) > 0
                }
            } catch (_: Exception) { false } finally { extractor.release() }
            if (valid) {
                check(!target.exists() || target.delete())
                check(partial.renameTo(target))
                runCatching { File(directory, target.nameWithoutExtension + ".interrupted").createNewFile() }
            } else check(partial.delete())
        }
        directory.listFiles()?.filter {
            it.name.matches(Regex("song-[0-9]+-[0-9]+\\.m4a")) && it.length() == 0L && it.canonicalPath !in active
        }?.forEach { check(it.delete()) }
        directory.listFiles()?.filter {
            it.name.matches(Regex("song-[0-9]+-[0-9]+\\.interrupted")) &&
                !File(directory, it.nameWithoutExtension + ".m4a").exists() &&
                !File(directory, it.nameWithoutExtension + ".processing.m4a").exists()
        }?.forEach { check(it.delete()) }
    }
    @ReactMethod @Synchronized fun listTakes(songId: String, promise: Promise) {
        try {
        reconcileRecordings()
        val rows = Arguments.createArray()
        directory.listFiles()?.filter { it.name.startsWith("song-${songId}-") && it.name.matches(Regex("song-[0-9]+-[0-9]+\\.m4a")) && it != take }?.sortedByDescending { it.lastModified() }?.forEach { file ->
            rows.pushMap(Arguments.createMap().apply {
                putString("path", file.absolutePath); putDouble("date", file.lastModified().toDouble()); putDouble("bytes", file.length().toDouble())
                putBoolean("processing", processing.contains(file.absolutePath))
                putBoolean("interrupted", File(directory, file.nameWithoutExtension + ".interrupted").exists())
            })
        }
        promise.resolve(rows)
        } catch (error: Exception) { promise.reject("RECORDING_READ_FAILED", error) }
    }
    @ReactMethod @Synchronized fun playTake(path: String, promise: Promise) {
        if (recorder != null) { promise.reject("RECORDING_BUSY", "Recording in progress"); return }
        stopPlayback()
        try {
            val file = localFile(path)
            require(!processing.contains(file.absolutePath))
            require(file.isFile)
            focus()
            val playback = MediaPlayer()
            player = playback
            playback.setDataSource(file.absolutePath)
            playback.setOnCompletionListener { stopPlayback() }
            playback.setOnErrorListener { _, _, _ -> stopPlayback(); emit("error"); true }
            playback.prepare()
            playback.start()
            promise.resolve(playback.duration.toDouble())
        } catch (error: Exception) { stopPlayback(); promise.reject("PLAYBACK_FAILED", error) }
    }
    @ReactMethod @Synchronized fun stopPlayback() {
        val wasPlaying = player != null
        player?.release(); player = null
        cue?.release(); cue = null
        guitar?.release(); guitar = null
        metronome?.release(); metronome = null
        metronomeBeats.values.forEach { it.release() }; metronomeBeats.clear()
        guitarStrings.values.forEach { it.release() }; guitarStrings.clear()
        if (recorder == null) audioManager.abandonAudioFocus(focusListener)
        if (wasPlaying) emit("stopped")
    }
    @ReactMethod @Synchronized fun deleteTake(path: String, promise: Promise) {
        try {
            val file = localFile(path)
            require(recorder == null && processing.none { File(it).canonicalFile == file })
            stopPlayback()
            val partial = File(file.parentFile, file.nameWithoutExtension + ".processing.m4a")
            require(!partial.exists() || partial.delete())
            require(file.delete())
            File(file.parentFile, file.nameWithoutExtension + ".interrupted").delete()
            promise.resolve(true)
        }
        catch (error: Exception) { promise.reject("DELETE_FAILED", error) }
    }
    @ReactMethod @Synchronized fun playSuccess() {
        if (!instrumentPlaybackActive || recorder != null || player != null) return
        cue?.release()
        cue = MediaPlayer.create(context, R.raw.tuner_success)?.apply {
            setVolume(0.3f, 0.3f)
            setOnCompletionListener { synchronized(this@PerformanceAudio) { if (cue === it) cue = null; it.release() } }
            start()
        }
    }
    private fun guitarTrack(bytes: ByteArray): AudioTrack {
        val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val rate = header.getInt(24)
        val channels = header.getShort(22).toInt()
        require(rate in listOf(22050, 44100, 48000) && channels in listOf(1, 2) && header.getShort(34).toInt() == 16)
        return pcmTrack(bytes, rate, channels, 44)
    }
    private fun pcmTrack(bytes: ByteArray, rate: Int, channels: Int, offset: Int = 0): AudioTrack {
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(if (channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(bytes.size - offset)
            .apply { if (android.os.Build.VERSION.SDK_INT >= 26) setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY) }
            .build()
        try {
            check(track.write(bytes, offset, bytes.size - offset) == bytes.size - offset)
            return track
        } catch (error: Exception) { track.release(); throw error }
    }
    @ReactMethod @Synchronized fun setMetronome(tempo: Double, enabled: Boolean, phase: Double) {
        fadeGuitar(metronome); metronome = null
        if (!enabled || !instrumentPlaybackActive || recorder != null || !tempo.isFinite() || tempo !in 40.0..200.0) return
        val rate = 22050
        val frames = Math.round(rate * 60.0 / tempo).toInt()
        val shift = if (phase.isFinite()) Math.round(frames * phase.coerceIn(0.0, 1.0)).toInt() % frames else 0
        val pcm = ByteBuffer.allocate(frames * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (index in 0 until (rate * 0.025).toInt()) {
            val time = index.toDouble() / rate
            val value = 0.09 * kotlin.math.sin(2 * Math.PI * 1200 * time) *
                (1 - kotlin.math.exp(-2000 * time)) * kotlin.math.exp(-200 * time)
            pcm.putShort(((index - shift + frames) % frames) * 2, (value * 32767).toInt().toShort())
        }
        try {
            val track = pcmTrack(pcm.array(), rate, 1)
            metronome = track
            check(track.setLoopPoints(0, frames, -1) == AudioTrack.SUCCESS)
            track.play()
        } catch (_: Exception) { metronome?.release(); metronome = null }
    }
    // The tab transport owns timing. These cached static voices play one click only.
    @ReactMethod @Synchronized fun playMetronomeBeat(accent: Double, volume: Double) {
        if (!instrumentPlaybackActive || recorder != null || !accent.isFinite() || !volume.isFinite() || volume <= 0) return
        val kind = Math.round(accent.coerceIn(0.0, 2.0)).toInt()
        try {
            val voice = metronomeBeats.getOrPut(kind) {
                val rate = 22050
                val frames = (rate * 0.03).toInt()
                val frequency = when (kind) { 2 -> 1800.0; 1 -> 1350.0; else -> 900.0 }
                val level = when (kind) { 2 -> 0.24; 1 -> 0.18; else -> 0.12 }
                val pcm = ByteBuffer.allocate(frames * 2).order(ByteOrder.LITTLE_ENDIAN)
                for (index in 0 until frames) {
                    val time = index.toDouble() / rate
                    val value = level * kotlin.math.sin(2 * Math.PI * frequency * time) *
                        (1 - kotlin.math.exp(-3000 * time)) * kotlin.math.exp(-180 * time) *
                        (1 - index.toDouble() / (frames - 1))
                    pcm.putShort((value * 32767).toInt().toShort())
                }
                pcmTrack(pcm.array(), rate, 1)
            }
            voice.pause()
            check(voice.setPlaybackHeadPosition(0) == AudioTrack.SUCCESS)
            voice.setVolume(volume.coerceIn(0.0, 1.0).toFloat())
            voice.play()
        } catch (_: Exception) { metronomeBeats.remove(kind)?.release() }
    }
    @ReactMethod @Synchronized fun stopMetronomeBeats() {
        metronomeBeats.values.forEach { runCatching { it.pause(); it.setPlaybackHeadPosition(0) } }
    }
    @ReactMethod @Synchronized fun prepareGuitar(key: String, wave: String) {
        if (invalidated || key.length > 256 || wave.length > 8_000_000) return
        try {
            val bytes = guitarPcm[key] ?: android.util.Base64.decode(wave, android.util.Base64.DEFAULT).also {
                require(it.size > 44)
                guitarPcm[key] = it
            }
            guitarPcm.remove(key); guitarPcm[key] = bytes
            if (!preparedGuitars.containsKey(key)) preparedGuitars[key] = guitarTrack(bytes)
            while (preparedGuitars.size > PREPARED_GUITARS_LIMIT) preparedGuitars.remove(preparedGuitars.keys.first())?.release()
            while (guitarPcm.size > 32 || guitarPcm.values.sumOf { it.size.toLong() } > 32L * 1024 * 1024) {
                val oldest = guitarPcm.keys.first()
                guitarPcm.remove(oldest)
                preparedGuitars.remove(oldest)?.release()
            }
        } catch (_: Exception) { preparedGuitars.remove(key)?.release(); guitarPcm.remove(key) }
    }
    @ReactMethod @Synchronized fun playGuitar(wave: String) {
        val key = wave.hashCode().toString()
        prepareGuitar(key, wave)
        playPreparedGuitar(key)
    }
    @ReactMethod @Synchronized fun prepareFingering(key: String, wave: String, promise: Promise) {
        if (invalidated || key.length > 256 || wave.length > 8_000_000) { promise.resolve(false); return }
        if (preparedGuitars.containsKey(key)) {
            guitarPcm.remove(key)?.let { guitarPcm[key] = it }
            promise.resolve(true); return
        }
        if (wave.isEmpty() && !guitarPcm.containsKey(key)) { promise.resolve(false); return }
        try { samplerWorker.execute {
            var prepared: AudioTrack? = null
            var ready = false
            try {
                val bytes = synchronized(this) {
                    if (invalidated) { promise.resolve(false); return@execute }
                    if (preparedGuitars.containsKey(key)) { promise.resolve(true); return@execute }
                    guitarPcm[key]
                } ?: android.util.Base64.decode(wave, android.util.Base64.DEFAULT)
                require(bytes.size > 44)
                prepared = guitarTrack(bytes)
                synchronized(this) {
                    if (!invalidated) {
                        guitarPcm.remove(key); guitarPcm[key] = bytes
                        if (!preparedGuitars.containsKey(key)) {
                            preparedGuitars[key] = prepared!!
                            prepared = null
                        }
                        while (preparedGuitars.size > PREPARED_GUITARS_LIMIT) preparedGuitars.remove(preparedGuitars.keys.first())?.release()
                        while (guitarPcm.size > 32 || guitarPcm.values.sumOf { it.size.toLong() } > 32L * 1024 * 1024) {
                            val oldest = guitarPcm.keys.first()
                            guitarPcm.remove(oldest)
                            preparedGuitars.remove(oldest)?.release()
                        }
                        ready = preparedGuitars.containsKey(key)
                    }
                }
            } catch (_: Exception) {
                // Failed/invalidated preparation never publishes a partial voice.
            } finally { prepared?.release() }
            promise.resolve(ready)
        } } catch (_: RejectedExecutionException) { promise.resolve(false) }
    }
    @ReactMethod @Synchronized fun playGuitarString(key: String, index: Int) {
        if (!instrumentPlaybackActive || recorder != null || index !in 0..5) return
        val bytes = guitarPcm[key] ?: return
        val voice = try { preparedGuitars.remove(key) ?: guitarTrack(bytes) } catch (_: Exception) { return }
        fadeGuitar(guitarStrings.remove(index), 0.22f)
        try {
            voice.setVolume(0.22f)
            guitarStrings[index] = voice
            voice.play()
        } catch (_: Exception) { guitarStrings.remove(index); voice.release(); return }
        replenishGuitar(key, bytes)
    }
    @Synchronized private fun replenishGuitar(key: String, bytes: ByteArray) {
        if (invalidated || !preparingGuitars.add(key)) return
        try { samplerWorker.execute {
            val needed = synchronized(this) {
                !invalidated && guitarPcm[key] === bytes && !preparedGuitars.containsKey(key)
            }
            // AudioTrack allocation and its PCM write can block. Never hold the
            // module/lifecycle lock while creating a replacement voice.
            val prepared = if (needed) runCatching { guitarTrack(bytes) }.getOrNull() else null
            synchronized(this) {
                preparingGuitars.remove(key)
                if (prepared != null) {
                    if (invalidated || guitarPcm[key] !== bytes || preparedGuitars.containsKey(key)) prepared.release()
                    else {
                        preparedGuitars[key] = prepared
                        while (preparedGuitars.size > PREPARED_GUITARS_LIMIT) preparedGuitars.remove(preparedGuitars.keys.first())?.release()
                    }
                }
            }
        } } catch (_: RejectedExecutionException) { preparingGuitars.remove(key) }
    }
    @ReactMethod @Synchronized fun stopGuitarString(index: Int) {
        fadeGuitar(guitarStrings.remove(index), 0.22f)
    }
    private fun fadeGuitar(previous: AudioTrack?, volume: Float = 1f) {
        if (previous == null) return
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            try {
                val fade = previous.createVolumeShaper(android.media.VolumeShaper.Configuration.Builder()
                    .setDuration(16)
                    .setCurve(floatArrayOf(0f, 1f), floatArrayOf(1f, 0f))
                    .build())
                fade.apply(android.media.VolumeShaper.Operation.PLAY)
                handler.postDelayed({ previous.release(); runCatching { fade.close() } }, 24)
            } catch (_: Exception) { previous.release() }
        } else {
            for (step in 1..8) handler.postDelayed({
                runCatching { previous.setVolume(volume * (8 - step) / 8f); if (step == 8) previous.release() }
            }, step * 2L)
        }
    }
    @ReactMethod @Synchronized fun playPreparedGuitar(key: String) {
        if (!instrumentPlaybackActive || recorder != null) return
        val bytes = guitarPcm[key] ?: return
        val prepared = try { preparedGuitars.remove(key) ?: guitarTrack(bytes) } catch (_: Exception) { return }
        val previous = guitar
        guitar = null
        fadeGuitar(previous)
        stopPlayback()
        try {
            guitar = prepared
            prepared.play()
        } catch (_: Exception) { guitar?.release(); guitar = null; return }
        replenishGuitar(key, bytes)
    }
    @Synchronized override fun onHostResume() { instrumentPlaybackActive = !invalidated && context.lifecycleState == LifecycleState.RESUMED }
    @Synchronized override fun onHostPause() {
        instrumentPlaybackActive = false
        finishTake(); stopPlayback()
        if (!invalidated && context.hasActiveReactInstance()) emit("playbackInterrupted")
    }
    @Synchronized private fun clearGuitars() {
        preparedGuitars.values.forEach { it.release() }
        preparedGuitars.clear(); guitarPcm.clear(); preparingGuitars.clear()
    }
    @Synchronized override fun onHostDestroy() { instrumentPlaybackActive = false; finishTake(); stopPlayback() }
    @Synchronized override fun invalidate() { invalidated = true; instrumentPlaybackActive = false; finishTake(); stopPlayback(); clearGuitars(); worker.shutdown(); samplerWorker.shutdown(); context.removeLifecycleEventListener(this); super.invalidate() }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}

internal fun reserveRecordingFile(directory: File, songId: String, now: Long = System.currentTimeMillis()): File {
    var timestamp = now
    while (true) {
        val file = File(directory, "song-$songId-$timestamp.m4a")
        val partial = File(directory, "song-$songId-$timestamp.processing.m4a")
        val marker = File(directory, "song-$songId-$timestamp.interrupted")
        if (!partial.exists() && !marker.exists() && file.createNewFile()) return file
        check(timestamp < Long.MAX_VALUE) { "No available recording name" }
        timestamp++
    }
}

private class PolishedRecorder {
    private val rate = 44100
    private val capture = AudioRecord.Builder()
        .setAudioSource(MediaRecorder.AudioSource.MIC)
        .setAudioFormat(AudioFormat.Builder().setSampleRate(rate)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
        .setBufferSizeInBytes(maxOf(rate, AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT) * 4))
        .build()
    @Volatile private var stopped = false

    @Synchronized private fun start() {
        check(!stopped)
        check(capture.state == AudioRecord.STATE_INITIALIZED)
        capture.startRecording()
        check(capture.recordingState == AudioRecord.RECORDSTATE_RECORDING)
    }
    @Synchronized fun stop() {
        stopped = true
        runCatching { capture.stop() }
    }
    fun release() { stop(); capture.release() }

    fun write(output: File, onStarted: () -> Unit, onCaptured: () -> Unit): Boolean {
        val effect = RecordingPolish(rate)
        val writer = MediaCodec.createEncoderByType("audio/mp4a-latm")
        var muxer: MediaMuxer? = null
        var muxing = false
        try {
            writer.configure(MediaFormat.createAudioFormat("audio/mp4a-latm", rate, 2).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, 192000)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
            }, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            writer.start()
            val container = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            muxer = container
            var track = -1
            var encodedEnd = false
            var samples = 0L
            var lastProgress = System.nanoTime()
            val info = MediaCodec.BufferInfo()
            fun guardProgress() { check(System.nanoTime() - lastProgress < 30_000_000_000L) { "Audio encoding stalled" } }
            fun drain() {
                while (true) {
                    val index = writer.dequeueOutputBuffer(info, 0)
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        track = container.addTrack(writer.outputFormat)
                        container.start()
                        muxing = true
                    } else if (index >= 0) {
                        if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                            check(muxing)
                            val bytes = writer.getOutputBuffer(index)!!
                            bytes.position(info.offset)
                            bytes.limit(info.offset + info.size)
                            container.writeSampleData(track, bytes, info)
                        }
                        encodedEnd = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        writer.releaseOutputBuffer(index, false)
                        lastProgress = System.nanoTime()
                    } else break
                }
            }
            fun encode(bytes: ByteArray?, size: Int = bytes?.size ?: 0, end: Boolean = false) {
                var offset = 0
                while (true) {
                    drain()
                    guardProgress()
                    val index = writer.dequeueInputBuffer(1000)
                    if (index < 0) continue
                    val buffer = writer.getInputBuffer(index)!!
                    buffer.clear()
                    val count = minOf(size - offset, buffer.remaining() / 4 * 4)
                    check(count > 0 || end)
                    if (bytes != null) buffer.put(bytes, offset, count)
                    writer.queueInputBuffer(index, 0, count, samples * 1_000_000 / rate, if (end) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0)
                    samples += count / 4
                    offset += count
                    lastProgress = System.nanoTime()
                    if (end || offset >= size) break
                }
            }
            val pcm = ByteArray(16384)
            var size = 0
            fun append(left: Int, right: Int) {
                if (size == pcm.size) { encode(pcm, size); size = 0 }
                pcm[size++] = left.toByte()
                pcm[size++] = (left shr 8).toByte()
                pcm[size++] = right.toByte()
                pcm[size++] = (right shr 8).toByte()
            }
            val input = ShortArray(2048)
            var captured = 0L
            var interrupted = false
            start()
            onStarted()
            while (!stopped && captured < rate * 30L * 60 && output.length() < 50L * 1024 * 1024) {
                val count = try {
                    capture.read(input, 0, input.size, AudioRecord.READ_BLOCKING)
                } catch (error: Exception) {
                    if (!stopped && captured == 0L) throw error
                    if (!stopped) interrupted = true
                    break
                }
                if (count <= 0 && stopped) break
                if (count <= 0) {
                    check(captured > 0) { "Microphone capture failed: $count" }
                    interrupted = true
                    break
                }
                for (index in 0 until count) {
                    val stereo = effect.processStereo(input[index] / 32768.0)
                    append((stereo shr 16).toInt().toShort().toInt(), stereo.toShort().toInt())
                }
                captured += count
                drain()
            }
            stop()
            onCaptured()
            check(captured > 0)
            for (index in 0 until rate) {
                val stereo = effect.processStereo(0.0)
                val fade = minOf(1.0, (rate - index - 1) / (rate * .08))
                append(((stereo shr 16).toInt().toShort() * fade).toInt(), (stereo.toShort() * fade).toInt())
            }
            if (size > 0) encode(pcm, size)
            encode(null, end = true)
            while (!encodedEnd) { drain(); guardProgress(); Thread.sleep(2) }
            check(muxing)
            container.stop()
            muxing = false
            return interrupted
        } finally {
            runCatching { writer.stop() }
            writer.release()
            if (muxing) runCatching { muxer?.stop() }
            muxer?.release()
        }
    }
}
