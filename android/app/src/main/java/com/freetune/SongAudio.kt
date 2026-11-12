package com.freetune

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaCodecList
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Original recording playback. All times returned by this bridge are milliseconds. */
class SongAudio(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    private val io = Executors.newSingleThreadExecutor()
    private val thread = HandlerThread("FreeTuneSongAudio").apply { start() }
    private val handler = Handler(thread.looper)
    private val imports = ConcurrentHashMap<String, AtomicBoolean>()
    private val directory get() = File(context.filesDir, "FreeTuneAudio").apply { mkdirs() }
    private val audioManager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var player: MediaPlayer? = null
    private var path: String? = null
    private var state = "idle"
    private var duration = 0
    private var position = 0
    private var loopStart: Int? = null
    private var loopEnd: Int? = null
    private var loading: Promise? = null
    private var seeking = false
    private var queuedSeek: Int? = null
    private var resumeAfterSeek = false
    private val seekPromises = mutableListOf<Promise>()
    @Volatile private var invalidated = false
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change < 0) handler.post { pauseInternal() }
    }
    private val focusRequest: AudioFocusRequest? = if (Build.VERSION.SDK_INT >= 26)
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener(focusListener, handler)
            .setWillPauseWhenDucked(true).build() else null

    init {
        context.addLifecycleEventListener(this)
        // A process killed while importing may leave a partial copy. Never treat it as a song.
        io.execute { directory.listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() } }
    }

    override fun getName() = "SongAudio"

    private class AudioFailure(val code: String, message: String) : IOException(message)
    private fun reject(promise: Promise, error: Throwable) {
        val code = if (error is AudioFailure) error.code else if (error is OutOfMemoryError)
            "AUDIO_MEMORY" else "AUDIO_FAILED"
        promise.reject(code, error.message ?: code, error)
    }

    private fun safeFile(value: String): File {
        return try { SongAudioRules.file(directory, value) }
        catch (_: Exception) { throw AudioFailure("AUDIO_PATH", "Invalid library audio path") }
    }

    private fun checkCanceled(canceled: AtomicBoolean) {
        if (canceled.get() || invalidated) throw AudioFailure("AUDIO_CANCELED", "Audio import canceled")
    }

    private fun checkSpace(bytes: Long) {
        if (directory.usableSpace < bytes + SPACE_RESERVE)
            throw AudioFailure("AUDIO_SPACE", "Not enough free storage")
    }

    private fun format(file: File): Pair<String, String> {
        val header = ByteArray(16)
        val size = file.inputStream().use { it.read(header) }
        return SongAudioRules.format(header, size)
            ?: throw AudioFailure("AUDIO_FORMAT", "Choose an MP3, WAV or M4A recording")
    }

    private fun inspect(file: File): Int {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.absolutePath)
            var audio: MediaFormat? = null
            for (index in 0 until extractor.trackCount) {
                val candidate = extractor.getTrackFormat(index)
                val mime = candidate.getString(MediaFormat.KEY_MIME) ?: ""
                if (mime.startsWith("video/")) throw AudioFailure("AUDIO_FORMAT", "Video files are not supported")
                if (audio == null && mime.startsWith("audio/")) {
                    audio = candidate
                    extractor.selectTrack(index)
                }
            }
            val track = audio ?: throw AudioFailure("AUDIO_FORMAT", "No decodable audio track")
            if (MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(track) == null)
                throw AudioFailure("AUDIO_FORMAT", "This phone cannot decode the recording")
            if (!track.containsKey(MediaFormat.KEY_DURATION)) throw AudioFailure("AUDIO_FORMAT", "Unknown audio duration")
            val milliseconds = track.getLong(MediaFormat.KEY_DURATION) / 1000
            if (milliseconds <= 0 || milliseconds > MAX_DURATION_MS)
                throw AudioFailure("AUDIO_DURATION", "Choose a recording between 1 ms and 30 minutes")
            // Verify actual packet data, not just a filename or container header.
            val buffer = java.nio.ByteBuffer.allocate(256 * 1024)
            if (extractor.readSampleData(buffer, 0) <= 0) throw AudioFailure("AUDIO_FORMAT", "Audio track contains no samples")
            return milliseconds.toInt()
        } finally { extractor.release() }
    }

    private fun metadata(file: File, originalName: String, sha: String, milliseconds: Int, mime: String): WritableMap =
        Arguments.createMap().apply {
            putString("path", file.absolutePath)
            putString("uri", Uri.fromFile(file).toString())
            putString("fileName", file.name)
            putString("originalName", originalName)
            putString("mimeType", mime)
            putString("sha256", sha)
            putDouble("bytes", file.length().toDouble())
            putDouble("durationMs", milliseconds.toDouble())
        }

    @ReactMethod
    fun importAudio(source: String, name: String, requestId: String, promise: Promise) {
        if (invalidated) { promise.reject("AUDIO_CANCELED", "Audio module closed"); return }
        val canceled = AtomicBoolean(false)
        if (imports.putIfAbsent(requestId, canceled) != null) {
            promise.reject("AUDIO_BUSY", "Import already in progress"); return
        }
        io.execute {
            var temporary: File? = null
            try {
                checkCanceled(canceled)
                val sourceUri = Uri.parse(source)
                if (sourceUri.scheme !in listOf("content", "file"))
                    throw AudioFailure("AUDIO_SOURCE", "Choose a local audio file")
                val declaredSize = if (sourceUri.scheme == "file") File(sourceUri.path ?: "").length() else {
                    context.contentResolver.query(sourceUri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use {
                        if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else -1L
                    } ?: -1L
                }
                if (declaredSize > MAX_BYTES) throw AudioFailure("AUDIO_SIZE", "Audio exceeds 256 MB")
                checkSpace(maxOf(declaredSize, 1024 * 1024L))
                val staging = File(directory, "${UUID.randomUUID()}.part")
                temporary = staging
                val digest = MessageDigest.getInstance("SHA-256")
                val input = context.contentResolver.openInputStream(sourceUri)
                    ?: throw AudioFailure("AUDIO_READ", "Cannot open the selected recording")
                var total = 0L
                input.use { sourceStream ->
                    staging.outputStream().use { output ->
                        val buffer = ByteArray(128 * 1024)
                        while (true) {
                            checkCanceled(canceled)
                            val count = sourceStream.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > MAX_BYTES) throw AudioFailure("AUDIO_SIZE", "Audio exceeds 256 MB")
                            checkSpace(count.toLong())
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                        output.fd.sync()
                    }
                }
                checkCanceled(canceled)
                val (extension, mime) = format(staging)
                val milliseconds = inspect(staging)
                checkCanceled(canceled)
                val sha = digest.digest().joinToString("") { "%02x".format(it) }
                val destination = File(directory, "$sha.$extension")
                try { SongAudioRules.commitCopy(staging, destination, sha) { checkCanceled(canceled) } }
                catch (error: AudioFailure) { throw error }
                catch (_: Exception) { throw AudioFailure("AUDIO_SAVE", "Cannot save the recording") }
                promise.resolve(metadata(destination, name.take(1000), sha, milliseconds, mime))
            } catch (error: Exception) { reject(promise, error) }
            catch (error: OutOfMemoryError) { reject(promise, error) }
            finally { temporary?.delete(); imports.remove(requestId, canceled) }
        }
    }

    @ReactMethod fun cancelImport(requestId: String) { imports[requestId]?.set(true) }

    @ReactMethod fun probe(fileName: String, promise: Promise) {
        if (invalidated) { promise.reject("AUDIO_CANCELED", "Audio module closed"); return }
        io.execute {
            try {
                val file = safeFile(fileName)
                if (!file.isFile) throw AudioFailure("AUDIO_MISSING", "Original recording is missing")
                val digest = MessageDigest.getInstance("SHA-256")
                FileInputStream(file).use { stream ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        digest.update(buffer, 0, count)
                    }
                }
                val sha = digest.digest().joinToString("") { "%02x".format(it) }
                if (sha != file.nameWithoutExtension) throw AudioFailure("AUDIO_CHANGED", "Original recording has changed")
                val (_, mime) = format(file)
                promise.resolve(metadata(file, file.name, sha, inspect(file), mime))
            } catch (error: Exception) { reject(promise, error) }
            catch (error: OutOfMemoryError) { reject(promise, error) }
        }
    }

    private fun snapshot(): WritableMap {
        if (state in listOf("paused", "playing", "ended"))
            position = runCatching { player?.currentPosition ?: position }.getOrDefault(position)
        return Arguments.createMap().apply {
            putString("path", path)
            putString("state", state)
            putDouble("positionMs", position.toDouble())
            putDouble("durationMs", duration.toDouble())
            putBoolean("seeking", seeking)
            if (loopStart != null) putDouble("loopStartMs", loopStart!!.toDouble()) else putNull("loopStartMs")
            if (loopEnd != null) putDouble("loopEndMs", loopEnd!!.toDouble()) else putNull("loopEndMs")
        }
    }

    private fun emit(error: String? = null) {
        if (invalidated) return
        val value = snapshot()
        if (error != null) value.putString("error", error)
        runCatching { context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("onSongAudio", value) }
    }

    private fun focus() {
        val granted = if (Build.VERSION.SDK_INT >= 26)
            audioManager.requestAudioFocus(focusRequest!!)
        else audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw AudioFailure("AUDIO_FOCUS", "Audio is in use")
    }

    private fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= 26) audioManager.abandonAudioFocusRequest(focusRequest!!)
        else audioManager.abandonAudioFocus(focusListener)
    }

    private val tick = object : Runnable {
        override fun run() {
            if (state != "playing") return
            val actual = runCatching { player?.currentPosition ?: position }.getOrDefault(position)
            val end = loopEnd
            if (!seeking && end != null && actual >= end) seekInternal(loopStart!!)
            emit()
            handler.postDelayed(this, 50)
        }
    }

    private fun pauseInternal() {
        if (state == "playing") {
            runCatching { player?.pause() }
            state = "paused"
        }
        resumeAfterSeek = false
        handler.removeCallbacks(tick)
        abandonFocus()
        emit()
    }

    private val prepareTimeout = Runnable {
        if (state == "loading") {
            loading?.reject("AUDIO_PLAYBACK", "The recording did not become ready")
            loading = null
            player?.release()
            player = null
            state = "error"
            emit("AUDIO_PLAYBACK")
        }
    }

    private val seekTimeout = Runnable {
        if (seeking) {
            seekPromises.forEach { it.reject("AUDIO_PLAYBACK", "Audio seek timed out") }
            seekPromises.clear()
            seeking = false
            queuedSeek = null
            resumeAfterSeek = false
            handler.removeCallbacks(tick)
            player?.release()
            player = null
            state = "error"
            abandonFocus()
            emit("AUDIO_PLAYBACK")
        }
    }

    private fun release() {
        handler.removeCallbacks(tick)
        handler.removeCallbacks(prepareTimeout)
        handler.removeCallbacks(seekTimeout)
        loading?.reject("AUDIO_CANCELED", "Loading canceled")
        loading = null
        seekPromises.forEach { it.reject("AUDIO_CANCELED", "Playback changed") }
        seekPromises.clear()
        player?.release()
        player = null
        path = null
        state = "idle"
        duration = 0
        position = 0
        loopStart = null
        loopEnd = null
        seeking = false
        queuedSeek = null
        resumeAfterSeek = false
        abandonFocus()
    }

    private fun onPlayer(promise: Promise, action: () -> Unit) {
        if (invalidated) { promise.reject("AUDIO_CANCELED", "Audio module closed"); return }
        handler.post {
            try { action() }
            catch (error: Exception) { reject(promise, error) }
        }
    }

    @ReactMethod fun load(value: String, promise: Promise) = onPlayer(promise) {
        release()
        val file = safeFile(value)
        if (!file.isFile) throw AudioFailure("AUDIO_MISSING", "Original recording is missing")
        path = file.absolutePath
        state = "loading"
        loading = promise
        emit()
        val current = MediaPlayer()
        player = current
        try {
            current.setAudioAttributes(attributes)
            current.setDataSource(file.absolutePath)
            current.setOnPreparedListener {
                if (player !== it) return@setOnPreparedListener
                handler.removeCallbacks(prepareTimeout)
                duration = it.duration
                state = "paused"
                loading?.resolve(snapshot())
                loading = null
                emit()
            }
            current.setOnSeekCompleteListener {
                if (player !== it) return@setOnSeekCompleteListener
                handler.removeCallbacks(seekTimeout)
                seeking = false
                val next = queuedSeek
                queuedSeek = null
                if (next != null) { seekInternal(next); return@setOnSeekCompleteListener }
                if (resumeAfterSeek) {
                    resumeAfterSeek = false
                    it.start()
                    state = "playing"
                    handler.removeCallbacks(tick)
                    handler.post(tick)
                }
                val waiting = seekPromises.toList()
                seekPromises.clear()
                waiting.forEach { pending -> pending.resolve(snapshot()) }
                emit()
            }
            current.setOnCompletionListener {
                if (player !== it) return@setOnCompletionListener
                if (loopStart != null) {
                    resumeAfterSeek = true
                    seekInternal(loopStart!!)
                } else {
                    state = "ended"
                    position = duration
                    handler.removeCallbacks(tick)
                    abandonFocus()
                    emit()
                }
            }
            current.setOnErrorListener { failed, what, extra ->
                if (player !== failed) return@setOnErrorListener true
                handler.removeCallbacks(prepareTimeout)
                handler.removeCallbacks(seekTimeout)
                loading?.reject("AUDIO_PLAYBACK", "Cannot decode this recording ($what/$extra)")
                loading = null
                seekPromises.forEach { it.reject("AUDIO_PLAYBACK", "Audio decoding failed") }
                seekPromises.clear()
                seeking = false
                queuedSeek = null
                resumeAfterSeek = false
                failed.release()
                player = null
                state = "error"
                handler.removeCallbacks(tick)
                abandonFocus()
                emit("AUDIO_PLAYBACK")
                true
            }
            current.prepareAsync()
            handler.postDelayed(prepareTimeout, 30000)
        } catch (error: Exception) {
            loading = null
            release()
            throw error
        }
    }

    @ReactMethod fun play(promise: Promise) = onPlayer(promise) {
        if (state !in listOf("paused", "playing", "ended")) throw AudioFailure("AUDIO_NOT_READY", "Load a recording first")
        focus()
        val start = loopStart
        if (start != null && (position < start || position >= loopEnd!!)) {
            resumeAfterSeek = true
            seekInternal(start)
        } else {
            player!!.start()
            state = "playing"
            handler.removeCallbacks(tick)
            handler.post(tick)
        }
        promise.resolve(snapshot())
        emit()
    }

    @ReactMethod fun pause(promise: Promise) = onPlayer(promise) { pauseInternal(); promise.resolve(snapshot()) }

    private fun seekInternal(target: Int) {
        if (seeking) { queuedSeek = target; return }
        seeking = true
        if (Build.VERSION.SDK_INT >= 26) player!!.seekTo(target.toLong(), MediaPlayer.SEEK_CLOSEST)
        else player!!.seekTo(target)
        handler.removeCallbacks(seekTimeout)
        handler.postDelayed(seekTimeout, 10000)
    }

    @ReactMethod fun seek(milliseconds: Double, promise: Promise) = onPlayer(promise) {
        if (!milliseconds.isFinite() || state !in listOf("paused", "playing", "ended"))
            throw AudioFailure("AUDIO_NOT_READY", "Cannot seek before the recording is ready")
        val target = milliseconds.toInt().coerceIn(0, duration)
        if (state == "ended") state = "paused"
        seekPromises.add(promise)
        seekInternal(target)
        emit()
    }

    @ReactMethod fun setLoop(startMs: Double, endMs: Double, promise: Promise) = onPlayer(promise) {
        // Legacy React Native numeric arguments cannot be null. The typed TS
        // wrapper maps clearLoop's (null, null) to this explicit sentinel pair.
        val clear = startMs == -1.0 && endMs == -1.0
        val interval = try { SongAudioRules.loop(if (clear) null else startMs, if (clear) null else endMs, duration) }
        catch (_: IllegalArgumentException) { throw AudioFailure("AUDIO_LOOP", "Choose a valid repeat interval") }
        loopStart = interval?.first
        loopEnd = interval?.second
        if (interval != null) {
            if (state == "playing" && (player!!.currentPosition < loopStart!! || player!!.currentPosition >= loopEnd!!))
                seekInternal(loopStart!!)
        }
        promise.resolve(snapshot())
        emit()
    }

    @ReactMethod fun getState(promise: Promise) = onPlayer(promise) { promise.resolve(snapshot()) }
    @ReactMethod fun unload(promise: Promise) = onPlayer(promise) { release(); promise.resolve(snapshot()); emit() }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
    override fun onHostPause() { handler.post { pauseInternal() } }
    override fun onHostResume() { handler.post { emit() } }
    // The Activity can be recreated while its React context survives. Keep the
    // paused source/position until explicit unload or module invalidation.
    override fun onHostDestroy() { handler.post { pauseInternal() } }
    override fun invalidate() {
        invalidated = true
        imports.values.forEach { it.set(true) }
        io.shutdown()
        handler.post { release(); thread.quitSafely() }
        context.removeLifecycleEventListener(this)
        super.invalidate()
    }

    companion object {
        private const val MAX_BYTES = 256L * 1024 * 1024
        private const val SPACE_RESERVE = 32L * 1024 * 1024
        private const val MAX_DURATION_MS = 30L * 60 * 1000
    }
}
