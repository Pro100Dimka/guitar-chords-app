package com.freetune

import android.media.AudioManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.content.Context
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

class PerformanceAudio(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var cue: MediaPlayer? = null
    private var take: File? = null
    private var lastTake: String? = null
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
            emit("saved", lastTake)
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
        directory.listFiles()?.filter { it.name.startsWith("song-${songId}-") && it.extension == "m4a" && it != take }?.sortedByDescending { it.lastModified() }?.forEach { file ->
            rows.pushMap(Arguments.createMap().apply {
                putString("path", file.absolutePath); putDouble("date", file.lastModified().toDouble()); putDouble("bytes", file.length().toDouble())
            })
        }
        promise.resolve(rows)
    }
    @ReactMethod @Synchronized fun playTake(path: String, promise: Promise) {
        if (recorder != null) { promise.reject("RECORDING_BUSY", "Recording in progress"); return }
        stopPlayback()
        try {
            val file = localFile(path)
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
        if (recorder == null) audioManager.abandonAudioFocus(focusListener)
        if (wasPlaying) emit("stopped")
    }
    @ReactMethod fun deleteTake(path: String, promise: Promise) {
        try { require(recorder == null); stopPlayback(); require(localFile(path).delete()); promise.resolve(true) }
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
        stopPlayback()
        try {
            val file = File(context.cacheDir, "guitar-preview.wav")
            file.writeBytes(android.util.Base64.decode(wave, android.util.Base64.DEFAULT))
            cue = MediaPlayer().apply {
                setDataSource(file.absolutePath)
                setOnCompletionListener { synchronized(this@PerformanceAudio) { if (cue === it) cue = null; it.release(); file.delete() } }
                prepare()
                start()
            }
        } catch (_: Exception) { cue?.release(); cue = null }
    }
    override fun onHostResume() {}
    override fun onHostPause() { finishTake(); stopPlayback() }
    override fun onHostDestroy() { finishTake(); stopPlayback() }
    override fun invalidate() { finishTake(); stopPlayback(); context.removeLifecycleEventListener(this); super.invalidate() }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
