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
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PerformanceAudio(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    private var recorder: PolishedRecorder? = null
    private var player: MediaPlayer? = null
    private var cue: MediaPlayer? = null
    private var guitar: AudioTrack? = null
    private val guitarPcm = linkedMapOf<String, ByteArray>()
    private val preparedGuitars = linkedMapOf<String, AudioTrack>()
    private var take: File? = null
    private var lastTake: String? = null
    private val processing = ConcurrentHashMap.newKeySet<String>()
    private val worker = Executors.newSingleThreadExecutor()
    private val directory get() = File(context.filesDir, "performances").apply { mkdirs() }
    private val audioManager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change < 0) { finishTake(); stopPlayback() }
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
        val file = File(directory, "song-${songId}-${System.currentTimeMillis()}.m4a")
        var capture: PolishedRecorder? = null
        try {
            focus()
            val recording = PolishedRecorder()
            capture = recording
            check(file.createNewFile())
            take = file
            recorder = recording
            lastTake = null
            worker.execute {
                val output = File(directory, file.nameWithoutExtension + ".processing.m4a")
                var state = "saved"
                var began = false
                try {
                    android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
                    recording.write(output, {
                        began = true
                        promise.resolve(file.absolutePath)
                    }) {
                        synchronized(this) { if (recorder === recording) finishTake() }
                    }
                    check(output.length() > 0 && output.renameTo(file))
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
            file.delete()
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
            } else check(partial.delete())
        }
        directory.listFiles()?.filter {
            it.name.matches(Regex("song-[0-9]+-[0-9]+\\.m4a")) && it.length() == 0L && it.canonicalPath !in active
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
            promise.resolve(true)
        }
        catch (error: Exception) { promise.reject("DELETE_FAILED", error) }
    }
    @ReactMethod @Synchronized fun playSuccess() {
        if (recorder != null || player != null) return
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
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(if (channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(bytes.size - 44)
            .apply { if (android.os.Build.VERSION.SDK_INT >= 26) setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY) }
            .build()
        try {
            check(track.write(bytes, 44, bytes.size - 44) == bytes.size - 44)
            return track
        } catch (error: Exception) { track.release(); throw error }
    }
    @ReactMethod @Synchronized fun prepareGuitar(key: String, wave: String) {
        if (key.length > 256 || wave.length > 8_000_000) return
        try {
            val bytes = guitarPcm[key] ?: android.util.Base64.decode(wave, android.util.Base64.DEFAULT).also {
                require(it.size > 44)
                guitarPcm[key] = it
            }
            if (!preparedGuitars.containsKey(key)) preparedGuitars[key] = guitarTrack(bytes)
            while (preparedGuitars.size > 8) preparedGuitars.remove(preparedGuitars.keys.first())?.release()
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
        if (wave.isNotEmpty() || guitarPcm.containsKey(key)) prepareGuitar(key, wave)
        promise.resolve(preparedGuitars.containsKey(key))
    }
    @ReactMethod @Synchronized fun playPreparedGuitar(key: String) {
        if (recorder != null) return
        val bytes = guitarPcm[key] ?: return
        val prepared = try { preparedGuitars.remove(key) ?: guitarTrack(bytes) } catch (_: Exception) { return }
        val previous = guitar
        guitar = null
        if (previous != null) {
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
                    runCatching { previous.setVolume((8 - step) / 8f); if (step == 8) previous.release() }
                }, step * 2L)
            }
        }
        stopPlayback()
        try {
            guitar = prepared
            prepared.play()
        } catch (_: Exception) { guitar?.release(); guitar = null; return }
        runCatching {
            preparedGuitars[key] = guitarTrack(bytes)
            while (preparedGuitars.size > 8) preparedGuitars.remove(preparedGuitars.keys.first())?.release()
        }
    }
    override fun onHostResume() {}
    override fun onHostPause() { finishTake(); stopPlayback() }
    @Synchronized private fun clearGuitars() {
        preparedGuitars.values.forEach { it.release() }
        preparedGuitars.clear(); guitarPcm.clear()
    }
    override fun onHostDestroy() { finishTake(); stopPlayback() }
    override fun invalidate() { finishTake(); stopPlayback(); clearGuitars(); worker.shutdown(); context.removeLifecycleEventListener(this); super.invalidate() }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
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

    fun write(output: File, onStarted: () -> Unit, onCaptured: () -> Unit) {
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
            start()
            onStarted()
            while (!stopped && captured < rate * 30L * 60 && output.length() < 50L * 1024 * 1024) {
                val count = capture.read(input, 0, input.size, AudioRecord.READ_BLOCKING)
                if (count <= 0 && stopped) break
                check(count > 0) { "Microphone capture failed: $count" }
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
        } finally {
            runCatching { writer.stop() }
            writer.release()
            if (muxing) runCatching { muxer?.stop() }
            muxer?.release()
        }
    }
}
