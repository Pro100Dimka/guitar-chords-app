// android/app/src/main/java/com/freetune/MicrophoneStreamModule.kt
package com.freetune

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.concurrent.thread
import android.util.Log

class MicrophoneStreamModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
    companion object {
        const val BUF_PER_SEC = 15
    }
    private var audioRecord: AudioRecord? = null
    private var isRecording = false
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
    private var targetNotes: List<NoteSpec> = emptyList() // список целевых нот
    data class NoteSpec(
        val name: String,
        val octave: Int,
        val refFreq: Double,
        val thickness: Double?,
        val baseColor: List<Double>?
    )
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

    private fun smoothPitch(pitch: Float): Float {
        if (pitch > 0) {
            if (pitchHistory.size >= 5) pitchHistory.removeFirst()
            pitchHistory.addLast(pitch)
        }
        return if (pitchHistory.isEmpty()) 0f else pitchHistory.average().toFloat()
    }
    private fun frequencyToNoteData(freq: Float): WritableMap {
        val map = Arguments.createMap()
        if (freq <= 20f || freq > 5000f || freq.isNaN() || freq.isInfinite()) {
            map.putString("note", "Silence")
            map.putDouble("pitch", 0.0)
            map.putDouble("refFreq", 0.0)
            map.putInt("octave", 0)
            map.putString("direction", "=")
            pitchHistory.clear()
            return map
        }
                // если список нот задан — ищем ближайшую из него
        val closest = if (targetNotes.isNotEmpty()) {
            targetNotes.minByOrNull { Math.abs(freq - it.refFreq) }
        } else null

        if (closest != null) {
            val direction = when {
                freq > closest.refFreq + 0.5 -> ">"
                freq < closest.refFreq - 0.5 -> "<"
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
        val direction = when {
            freq > refFreq + 0.5 -> ">"   // выше эталона
            freq < refFreq - 0.5 -> "<"   // ниже эталона
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
        val norm = DoubleArray(buffer.size) { buffer[it] / 32768.0 }
        val rms = Math.sqrt(norm.map { it * it }.average()) // RMS для фильтрации тишины
        if (rms < 0.01) return 0f
        val minFreq = 80      // минимальная частота (Гц)
        val maxFreq = 1000    // максимальная частота (Гц)
        val minLag = sampleRate / maxFreq
        val maxLag = sampleRate / minFreq
        var bestLag = -1
        var bestCorr = 0.0
        for (lag in minLag..maxLag) {
            var corr = 0.0
            for (i in 0 until buffer.size - lag) {
                corr += norm[i] * norm[i + lag]
            }
            if (corr > bestCorr) {
                bestCorr = corr
                bestLag = lag
            }
        }
        if (bestLag <= 0) return 0f
        // Параболическая интерполяция для уточнения
        val prev = if (bestLag > minLag) bestLag - 1 else bestLag
        val next = if (bestLag < maxLag) bestLag + 1 else bestLag
        val corrPrev = norm.indices.take(buffer.size - prev).sumOf { norm[it] * norm[it + prev] }
        val corrNext = norm.indices.take(buffer.size - next).sumOf { norm[it] * norm[it + next] }
        val shift = 0.5 * (corrPrev - corrNext) / (corrPrev - 2 * bestCorr + corrNext)
        val refinedLag = bestLag + shift
        return (sampleRate / refinedLag).toFloat()
    }
    @ReactMethod
    fun startRecording() {
    if (isRecording) return

    audioRecord = AudioRecord(
        MediaRecorder.AudioSource.MIC,
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferSize
    )

    isRecording = true
    audioRecord?.startRecording()

    thread {
        val buffer = ShortArray(bufferSize)
        var wasSilent = false // флаг, чтобы слать одно уведомление "тишина"

        while (isRecording) {
            val read = audioRecord?.read(buffer, 0, buffer.size) ?: 0
            if (read <= 0) {
                Thread.sleep(10)
                continue
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
                    map.putDouble("pitch", 0.0)
                    map.putDouble("refFreq", 0.0)
                    map.putInt("octave", 0)
                    map.putString("direction", "=")
                    sendEvent("onAudioBuffer", map)
                }
                pitchHistory.clear()
                continue
            }

            // если есть звук, сбрасываем флаг
            wasSilent = false

            // формируем массив нормализованных сэмплов
            val array = Arguments.createArray()
            for (i in 0 until read) array.pushDouble(buffer[i] / 32768.0)

            // вычисляем pitch
            val rawPitch = estimatePitch(buffer, sampleRate)
            val pitch = smoothPitch(rawPitch)
            val noteData = frequencyToNoteData(pitch)

            // формируем карту для отправки
            val map = Arguments.createMap()
            map.putArray("samples", array)
            map.putDouble("rms", rms)
            map.merge(noteData)

            sendEvent("onAudioBuffer", map)
        }
    }
}
    @ReactMethod
    fun stopRecording() {
        isRecording = false
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        pitchHistory.clear()
    }
    @ReactMethod
    fun releaseRecorder() {
        audioRecord?.release()
        audioRecord = null
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