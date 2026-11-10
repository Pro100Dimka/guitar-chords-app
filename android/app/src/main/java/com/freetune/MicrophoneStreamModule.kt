// android/app/src/main/java/com/freetune/MicrophoneStreamModule.kt
package com.freetune

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.concurrent.thread
import android.util.Log
import android.view.WindowManager

class MicrophoneStreamModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
    companion object {
        const val BUF_PER_SEC = 15
    }
    private var audioRecord: AudioRecord? = null
    @Volatile private var isRecording = false
    private var recordingThread: Thread? = null
    private val sampleRate = 44100
    private val bufferSize = maxOf(
        sampleRate / BUF_PER_SEC,
        AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
    )
    private val pitchHistory = ArrayDeque<Float>() // история для сглаживания
    private var previousRms = 0.0
    private var pendingPitch = 0f
    private var missingFrames = 0
    @Volatile private var targetNotes: List<NoteSpec> = emptyList()
    data class NoteSpec(
        val name: String,
        val octave: Int,
        val refFreq: Double,
        val thickness: Double?,
        val baseColor: List<Double>?
    )
    @ReactMethod
    fun setKeepAwake(enabled: Boolean) {
        reactContext.currentActivity?.runOnUiThread {
            val window = reactContext.currentActivity?.window ?: return@runOnUiThread
            if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
    override fun getName(): String = "MicrophoneStream"
    @ReactMethod
    fun setTargetNotes(notes: ReadableArray) {
        val list = mutableListOf<NoteSpec>()
        for (i in 0 until notes.size()) {
            val obj = notes.getMap(i) ?: continue
            val name = obj.getString("name") ?: continue
            val octave = obj.getInt("octave")
            val thickness = if (obj.hasKey("thickness")) obj.getDouble("thickness") else null
            val baseColor = if (obj.hasKey("baseColor")) {
                val arr = obj.getArray("baseColor") ?: continue
                List(arr.size()) { arr.getDouble(it) }
            } else null

            val midi = when (name) {
                "C" -> 0; "C#" -> 1; "D" -> 2; "D#" -> 3; "E" -> 4; "F" -> 5
                "F#" -> 6; "G" -> 7; "G#" -> 8; "A" -> 9; "A#" -> 10; "B" -> 11
                else -> 0
            } + (octave + 1) * 12
            val refFreq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0)

            list.add(NoteSpec(name, octave, refFreq, thickness, baseColor))
        }
        targetNotes = list
    }

    private fun resetPitch() {
        pitchHistory.clear()
        previousRms = 0.0
        pendingPitch = 0f
        missingFrames = 0
    }

    private fun smoothPitch(pitch: Float): Float {
        if (!pitch.isFinite() || pitch <= 0) {
            pendingPitch = 0f
            if (++missingFrames >= 3) resetPitch()
            return 0f
        }
        missingFrames = 0
        val previous = pitchHistory.firstOrNull()
        val cents = if (previous != null) 1200 * kotlin.math.log2(pitch / previous) else 0f
        if (previous == null || kotlin.math.abs(cents) >= 100) {
            val confirmed = pendingPitch > 0 && kotlin.math.abs(1200 * kotlin.math.log2(pitch / pendingPitch)) < 50
            if (!confirmed) {
                pendingPitch = pitch
                return previous ?: 0f
            }
        }
        pendingPitch = 0f
        val smoothed = if (previous == null || kotlin.math.abs(cents) >= 100) pitch
            else (previous * Math.pow(2.0, cents * 0.35 / 1200)).toFloat()
        pitchHistory.clear()
        pitchHistory.addLast(smoothed)
        return smoothed
    }
    private fun frequencyToNoteData(freq: Float): WritableMap {
        val map = Arguments.createMap()
        if (freq <= 20f || freq > 5000f || freq.isNaN() || freq.isInfinite()) {
            map.putString("note", "Silence")
            map.putDouble("pitch", 0.0)
            map.putDouble("refFreq", 0.0)
            map.putInt("octave", 0)
            map.putString("direction", "=")
            return map
        }
                // если список нот задан — ищем ближайшую из него
        val closest = targetNotes.minByOrNull { kotlin.math.abs(kotlin.math.log2(freq / it.refFreq)) }

        if (closest != null) {
            val cents = 1200 * kotlin.math.log2(freq / closest.refFreq)
            val direction = when {
                cents > 5 -> ">"
                cents < -5 -> "<"
                else -> "="
            }
            map.putString("note", closest.name)
            map.putDouble("pitch", freq.toDouble())
            map.putDouble("refFreq", closest.refFreq)
            map.putInt("octave", closest.octave)
            map.putString("direction", direction)
            closest.thickness?.let { map.putDouble("thickness", it) }
            closest.baseColor?.let {
                val arr = Arguments.createArray()
                it.forEach { d -> arr.pushDouble(d) }
                map.putArray("baseColor", arr)
            }
            return map
        }

        // если список пуст — стандартное вычисление
        val midiExact = 69 + 12 * Math.log(freq / 440.0) / Math.log(2.0)
        val midi = Math.round(midiExact).toInt()
        val noteNames = arrayOf("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
        val noteIndex = Math.floorMod(midi, 12)
        val note = noteNames[noteIndex]
        val octave = midi / 12 - 1
        val refFreq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0)
        val cents = 1200 * kotlin.math.log2(freq / refFreq)
        val direction = when {
            cents > 5 -> ">"   // выше эталона
            cents < -5 -> "<"   // ниже эталона
            else -> "="                   // совпадает
        }
        map.putString("note", note)
        map.putDouble("pitch", freq.toDouble())
        map.putDouble("refFreq", refFreq)
        map.putInt("octave", octave)
        map.putString("direction", direction)
        return map
    }

    private fun estimatePitch(buffer: ShortArray, sampleRate: Int): Float {
        if (buffer.isEmpty() || sampleRate <= 0) return 0f
        val mean = buffer.average() / 32768.0
        val norm = DoubleArray(buffer.size) { buffer[it] / 32768.0 - mean }
        val rms = Math.sqrt(norm.sumOf { it * it } / norm.size)
        if (rms < 0.003) return 0f
        val sustaining = previousRms > 0 && rms <= previousRms * 1.2
        previousRms = rms
        val minFreq = 50
        val maxFreq = 2000
        val minLag = maxOf(1, sampleRate / maxFreq)
        val maxLag = minOf(sampleRate / minFreq, buffer.size / 2 - 1)
        if (maxLag < minLag) return 0f
        val correlations = DoubleArray(maxLag + 2)
        for (lag in (minLag - 1)..(maxLag + 1)) {
            var corr = 0.0
            var leftEnergy = 0.0
            var rightEnergy = 0.0
            for (i in 0 until buffer.size - lag) {
                corr += norm[i] * norm[i + lag]
                leftEnergy += norm[i] * norm[i]
                rightEnergy += norm[i + lag] * norm[i + lag]
            }
            val energy = Math.sqrt(leftEnergy * rightEnergy)
            correlations[lag] = if (energy > 0) corr / energy else 0.0
        }
        val bestCorr = (minLag..maxLag).maxOf { correlations[it] }
        if (bestCorr < 0.6) return 0f
        // Relax peak selection for noisy/inharmonic strings without accepting clean overtones.
        val peakThreshold = (1 - 4 * (1 - bestCorr)).coerceIn(0.9, 0.99)
        val peaks = (minLag..maxLag).filter {
            correlations[it] >= correlations[it - 1] &&
                correlations[it] > correlations[it + 1]
        }
        val bestLag = peaks.firstOrNull { correlations[it] >= bestCorr * peakThreshold } ?: return 0f
        fun frequency(lag: Int): Double {
            val left = correlations[lag - 1]
            val right = correlations[lag + 1]
            val curvature = left - 2 * correlations[lag] + right
            val shift = if (curvature != 0.0) (0.5 * (left - right) / curvature).coerceIn(-0.5, 0.5) else 0.0
            return sampleRate / (lag + shift)
        }
        val detected = frequency(bestLag)
        val previous = pitchHistory.firstOrNull()?.toDouble() ?: return detected.toFloat()
        val ratio = maxOf(detected, previous) / minOf(detected, previous)
        val harmonic = Math.round(ratio)
        if (!sustaining || harmonic !in 2..6 || kotlin.math.abs(1200 * kotlin.math.log2(ratio / harmonic)) > 70) return detected.toFloat()
        val trackedLag = peaks.filter {
            correlations[it] >= maxOf(0.45, bestCorr * 0.5) &&
                kotlin.math.abs(1200 * kotlin.math.log2(frequency(it) / previous)) < 50
        }.maxByOrNull { correlations[it] } ?: return detected.toFloat()
        val tracked = frequency(trackedLag)
        fun amplitude(freq: Double): Double {
            var real = 0.0
            var imaginary = 0.0
            for (i in norm.indices) {
                val windowed = norm[i] * (0.5 - 0.5 * kotlin.math.cos(2 * Math.PI * i / (norm.size - 1)))
                val phase = 2 * Math.PI * freq * i / sampleRate
                real += windowed * kotlin.math.cos(phase)
                imaginary += windowed * kotlin.math.sin(phase)
            }
            return Math.sqrt(real * real + imaginary * imaginary)
        }
        // Follow a measured peak, never substitute the previous frequency itself.
        val requiredSupport = if (detected < tracked) 1.25 else 0.08
        return if (amplitude(tracked) > amplitude(detected) * requiredSupport) tracked.toFloat() else detected.toFloat()
    }
    @ReactMethod
    @Synchronized
    fun startRecording() {
        if (isRecording) return
        stopRecording()

        val recorder = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )

        try {
            recorder.startRecording()
        } catch (error: RuntimeException) {
            recorder.release()
            throw error
        }
        audioRecord = recorder
        isRecording = true

        recordingThread = thread(start = false, name = "MicrophoneCapture") {
            try {
                val buffer = ShortArray(bufferSize)
                var wasSilent = false // флаг, чтобы слать одно уведомление "тишина"

                while (isRecording) {
                    val read = recorder.read(buffer, 0, buffer.size)
                    if (!isRecording) break
                    if (read <= 0) {
                        Log.e("MicrophoneStream", "Audio read failed: $read")
                        break
                    }

                    // вычисляем RMS
                    var sumSquares = 0.0
                    for (i in 0 until read) {
                        val normalized = buffer[i] / 32768.0
                        sumSquares += normalized * normalized
                    }
                    val rms = Math.sqrt(sumSquares / read)

                    if (rms < 0.003) {
                        // если был звук раньше, отправляем событие "Silence"
                        if (!wasSilent) {
                            wasSilent = true
                            val map = Arguments.createMap()
                            map.putString("note", "Silence")
                            map.putDouble("rms", rms)
                            map.putDouble("pitch", 0.0)
                            map.putDouble("refFreq", 0.0)
                            map.putInt("octave", 0)
                            map.putString("direction", "=")
                            sendEvent("onAudioBuffer", map)
                        }
                        resetPitch()
                        continue
                    }

                    // если есть звук, сбрасываем флаг
                    wasSilent = false

                    // формируем массив нормализованных сэмплов
                    val array = Arguments.createArray()
                    for (i in 0 until read) array.pushDouble(buffer[i] / 32768.0)

                    // вычисляем pitch
                    val rawPitch = estimatePitch(if (read == buffer.size) buffer else buffer.copyOf(read), sampleRate)
                    val pitch = smoothPitch(rawPitch)
                    val noteData = frequencyToNoteData(pitch)

                    // формируем карту для отправки
                    val map = Arguments.createMap()
                    map.putArray("samples", array)
                    map.putDouble("rms", rms)
                    map.merge(noteData)

                    sendEvent("onAudioBuffer", map)
                }
            } finally {
                isRecording = false
            }
        }
        recordingThread?.start()
    }
    @ReactMethod
    @Synchronized
    fun stopRecording() {
        isRecording = false
        try {
            audioRecord?.stop()
        } finally {
            recordingThread?.join()
            recordingThread = null
            audioRecord?.release()
            audioRecord = null
            resetPitch()
        }
    }
    @ReactMethod
    fun releaseRecorder() {
        stopRecording()
    }
    override fun invalidate() {
        stopRecording()
        super.invalidate()
    }
    @ReactMethod
    fun getSampleRate(promise: Promise) {
        promise.resolve(sampleRate)
    }
    @ReactMethod
    fun getBufPerSec(promise: Promise) {
        promise.resolve(BUF_PER_SEC)
    }
    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
    @ReactMethod
fun addListener(eventName: String) {
    // required for NativeEventEmitter
}

@ReactMethod
fun removeListeners(count: Int) {
    // required for NativeEventEmitter
}
}
