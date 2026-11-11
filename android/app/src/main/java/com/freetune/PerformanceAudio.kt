package com.freetune

import android.media.AudioManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.content.Context
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap

class PerformanceAudio(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var cue: MediaPlayer? = null
    private var guitar: AudioTrack? = null
    private var take: File? = null
    private var lastTake: String? = null
    private val processing = ConcurrentHashMap.newKeySet<String>()
    private val worker = Executors.newSingleThreadExecutor()
    private val directory get() = File(context.filesDir, "performances").apply { mkdirs() }
    private val audioManager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change < 0) { finishTake(); stopPlayback() }
    }
    init { context.addLifecycleEventListener(this) }
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
        if (!songId.matches(Regex("[1-9][0-9]*")) || recorder != null) { promise.reject("RECORDING_BUSY", "Recording unavailable"); return }
        stopPlayback()
        val file = File(directory, "song-${songId}-${System.currentTimeMillis()}.m4a")
        val capture = MediaRecorder()
        try {
            focus()
            capture.setAudioSource(MediaRecorder.AudioSource.MIC)
            capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            capture.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            capture.setAudioEncodingBitRate(128000)
            capture.setAudioSamplingRate(44100)
            capture.setAudioChannels(1)
            capture.setMaxDuration(30 * 60 * 1000)
            capture.setMaxFileSize(50L * 1024 * 1024)
            capture.setOutputFile(file.absolutePath)
            capture.setOnInfoListener { _, what, _ ->
                if (what in listOf(MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED, MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED)) finishTake()
            }
            capture.setOnErrorListener { _, _, _ -> finishTake(); emit("error") }
            capture.prepare()
            capture.start()
            take = file
            recorder = capture
            lastTake = null
            promise.resolve(file.absolutePath)
        } catch (error: Exception) {
            capture.release()
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
        try {
            capture.stop()
            lastTake = file?.absolutePath
            if (file != null) polish(file)
        } catch (_: Exception) {
            file?.delete()
            lastTake = null
            emit("error")
        } finally { capture.release(); audioManager.abandonAudioFocus(focusListener) }
        return lastTake
    }
    @ReactMethod fun stopTake(promise: Promise) { promise.resolve(finishTake()) }
    private fun localFile(path: String): File {
        val file = File(path).canonicalFile
        require(file.parentFile == directory.canonicalFile && file.name.matches(Regex("song-[0-9]+-[0-9]+\\.m4a")))
        return file
    }
    @ReactMethod fun listTakes(songId: String, promise: Promise) {
        val rows = Arguments.createArray()
        directory.listFiles()?.filter { it.name.startsWith("song-${songId}-") && it.name.matches(Regex("song-[0-9]+-[0-9]+\\.m4a")) && it != take }?.sortedByDescending { it.lastModified() }?.forEach { file ->
            rows.pushMap(Arguments.createMap().apply {
                putString("path", file.absolutePath); putDouble("date", file.lastModified().toDouble()); putDouble("bytes", file.length().toDouble())
                putBoolean("processing", processing.contains(file.absolutePath))
            })
        }
        promise.resolve(rows)
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
    @ReactMethod fun deleteTake(path: String, promise: Promise) {
        try { require(recorder == null && !processing.contains(path)); stopPlayback(); require(localFile(path).delete()); promise.resolve(true) }
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
    @ReactMethod @Synchronized fun playGuitar(wave: String) {
        if (recorder != null || wave.length > 400000) return
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
            val bytes = android.util.Base64.decode(wave, android.util.Base64.DEFAULT)
            require(bytes.size > 44)
            guitar = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(22050).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(bytes.size - 44)
                .build()
            check(guitar?.write(bytes, 44, bytes.size - 44) == bytes.size - 44)
            guitar?.play()
        } catch (_: Exception) { guitar?.release(); guitar = null }
    }
    private fun polish(file: File) {
        processing.add(file.absolutePath)
        emit("processing", file.absolutePath)
        worker.execute {
            val output = File(directory, file.nameWithoutExtension + ".processing.m4a")
            var state = "saved"
            try {
                val date = file.lastModified()
                renderPolished(file, output)
                require(output.length() > 0)
                check(output.renameTo(file))
                file.setLastModified(date)
            } catch (_: Exception) {
                state = "processingFailed"
            } finally {
                output.delete()
                processing.remove(file.absolutePath)
                emit(state, file.absolutePath)
            }
        }
    }

    private fun renderPolished(input: File, output: File) {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        var muxing = false
        try {
            extractor.setDataSource(input.absolutePath)
            val track = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            require(format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) == 1)
            val effect = RecordingPolish(rate)
            val reader = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            decoder = reader
            reader.configure(format, null, null, 0)
            reader.start()
            val writer = MediaCodec.createEncoderByType("audio/mp4a-latm")
            encoder = writer
            writer.configure(MediaFormat.createAudioFormat("audio/mp4a-latm", rate, 1).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, 160000)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
            }, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            writer.start()
            val container = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            muxer = container
            var outputTrack = -1
            var encodedEnd = false
            val encodedInfo = MediaCodec.BufferInfo()
            var lastProgress = System.nanoTime()
            fun guardProgress() { check(System.nanoTime() - lastProgress < 30_000_000_000L) { "Audio processing stalled" } }
            fun drain() {
                while (true) {
                    val index = writer.dequeueOutputBuffer(encodedInfo, 0)
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        outputTrack = container.addTrack(writer.outputFormat)
                        container.start()
                        muxing = true
                    } else if (index >= 0) {
                        val buffer = writer.getOutputBuffer(index)!!
                        if (encodedInfo.size > 0 && encodedInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                            check(muxing)
                            buffer.position(encodedInfo.offset)
                            buffer.limit(encodedInfo.offset + encodedInfo.size)
                            container.writeSampleData(outputTrack, buffer, encodedInfo)
                        }
                        encodedEnd = encodedInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        writer.releaseOutputBuffer(index, false)
                        lastProgress = System.nanoTime()
                    } else break
                }
            }
            var samples = 0L
            fun encode(bytes: ByteArray?, end: Boolean = false) {
                var offset = 0
                while (true) {
                    drain()
                    guardProgress()
                    val index = writer.dequeueInputBuffer(10000)
                    if (index < 0) continue
                    val buffer = writer.getInputBuffer(index)!!
                    buffer.clear()
                    val count = minOf(bytes?.size?.minus(offset) ?: 0, buffer.remaining() / 2 * 2)
                    if (bytes != null) buffer.put(bytes, offset, count)
                    writer.queueInputBuffer(index, 0, count, samples * 1_000_000 / rate, if (end) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0)
                    samples += count / 2
                    offset += count
                    lastProgress = System.nanoTime()
                    if (end || offset >= (bytes?.size ?: 0)) break
                }
            }
            var inputEnd = false
            var decodedEnd = false
            val info = MediaCodec.BufferInfo()
            while (!decodedEnd) {
                guardProgress()
                if (!inputEnd) {
                    val index = reader.dequeueInputBuffer(10000)
                    if (index >= 0) {
                        val buffer = reader.getInputBuffer(index)!!
                        val size = extractor.readSampleData(buffer, 0)
                        inputEnd = size < 0
                        reader.queueInputBuffer(index, 0, maxOf(0, size), if (inputEnd) 0 else extractor.sampleTime, if (inputEnd) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0)
                        if (!inputEnd) extractor.advance()
                    }
                }
                val index = reader.dequeueOutputBuffer(info, 10000)
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val pcm = reader.outputFormat
                    require(pcm.getInteger(MediaFormat.KEY_CHANNEL_COUNT) == 1 && pcm.getInteger(MediaFormat.KEY_SAMPLE_RATE) == rate)
                    require(!pcm.containsKey(MediaFormat.KEY_PCM_ENCODING) || pcm.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_16BIT)
                } else if (index >= 0) {
                    val buffer = reader.getOutputBuffer(index)!!.order(ByteOrder.LITTLE_ENDIAN)
                    buffer.position(info.offset)
                    buffer.limit(info.offset + info.size)
                    val bytes = ByteArray(info.size)
                    val result = java.nio.ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
                    while (buffer.remaining() >= 2) result.putShort((effect.process(buffer.short / 32768.0) * 32767).toInt().toShort())
                    if (bytes.isNotEmpty()) encode(bytes)
                    decodedEnd = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    reader.releaseOutputBuffer(index, false)
                    lastProgress = System.nanoTime()
                }
                drain()
            }
            var tail = rate
            while (tail > 0) {
                val frames = minOf(tail, 4096)
                val bytes = java.nio.ByteBuffer.allocate(frames * 2).order(ByteOrder.LITTLE_ENDIAN)
                repeat(frames) { index -> bytes.putShort((effect.process(0.0) * minOf(1.0, (tail - index - 1) / (rate * .08)) * 32767).toInt().toShort()) }
                encode(bytes.array())
                tail -= frames
            }
            encode(null, true)
            while (!encodedEnd) { drain(); guardProgress(); Thread.sleep(2) }
            check(samples > 0 && muxing)
            container.stop()
            muxing = false
        } finally {
            runCatching { decoder?.stop() }; decoder?.release()
            runCatching { encoder?.stop() }; encoder?.release()
            if (muxing) runCatching { muxer?.stop() }
            muxer?.release()
            extractor.release()
        }
    }

    override fun onHostResume() {}
    override fun onHostPause() { finishTake(); stopPlayback() }
    override fun onHostDestroy() { finishTake(); stopPlayback() }
    override fun invalidate() { finishTake(); stopPlayback(); worker.shutdown(); context.removeLifecycleEventListener(this); super.invalidate() }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
