import com.freetune.MicrophoneStreamModule
import com.facebook.react.bridge.ReactApplicationContext
import android.media.AudioRecord
import java.util.concurrent.TimeUnit
import kotlin.math.*
import java.io.File
import javax.sound.sampled.AudioSystem

fun checkAccuracy(module: MicrophoneStreamModule, recordingsDirectory: File) {
    val estimator = module.javaClass.getDeclaredMethod("estimatePitch", ShortArray::class.java, Int::class.javaPrimitiveType).apply { isAccessible = true }
    val smoother = module.javaClass.getDeclaredMethod("smoothPitch", Float::class.javaPrimitiveType).apply { isAccessible = true }
    val reset = module.javaClass.getDeclaredMethod("resetPitch").apply { isAccessible = true }
    val noteData = module.javaClass.getDeclaredMethod("frequencyToNoteData", Float::class.javaPrimitiveType).apply { isAccessible = true }
    fun estimate(samples: ShortArray, rate: Int) = (estimator.invoke(module, samples, rate) as Float).toDouble()
    fun track(samples: ShortArray, rate: Int) = (smoother.invoke(module, estimate(samples, rate).toFloat()) as Float).toDouble()
    fun tone(frequency: Double, rate: Int, frame: Int, level: Double): ShortArray = ShortArray(rate / 15) { i ->
        val phase = 2 * PI * frequency * (frame * (rate / 15) + i) / rate
        ((0.4 * sin(phase) + 0.15 * sin(2 * phase) + 0.06 * sin(3 * phase)) * level * 32767).toInt().toShort()
    }
    val failures = mutableListOf<String>()
    var worst = 0.0
    var cases = 0
    var transitions = 0
    for (rate in listOf(44100, 48000)) {
        val frequencies = listOf(82.4069, 110.0, 146.8324, 195.9977, 246.9417, 329.6276)
        for (from in frequencies) for (to in frequencies.filter { it != from }) {
            for (level in listOf(0.3, 1.0, 1.5)) {
                reset.invoke(module)
                repeat(5) { frame -> track(tone(from, rate, frame, 1.0), rate) }
                val pitches = (0..4).map { frame -> track(tone(to, rate, frame + 5, level), rate) }
                if (pitches.drop(2).any { it <= 0 || abs(1200 * log2(it / to)) > 3 }) failures.add("Slow/stuck transition $from -> $to at $rate, level=$level: $pitches")
                transitions++
            }
        }
        for (frequency in frequencies) {
            reset.invoke(module)
            repeat(60) { frame ->
                val cents = frame / 3.0
                val detuned = frequency * 2.0.pow(cents / 1200)
                val pitch = track(tone(detuned, rate, frame, exp(-frame / 20.0)), rate)
                if (frame >= 3 && (pitch <= 0 || abs(1200 * log2(pitch / detuned)) > 3)) failures.add("Decay/drift failed $frequency at $rate frame=$frame pitch=$pitch")
            }
            repeat(3) {
                if (track(ShortArray(rate / 15), rate) != 0.0) failures.add("Stale output after silence")
            }
            val restarted = (0..2).map { track(tone(440.0, rate, it, 0.2), rate) }.last()
            if (restarted <= 0 || abs(1200 * log2(restarted / 440)) > 3) failures.add("Stale state after silence")
        }
    }
    for (rate in listOf(44100, 48000)) {
        for (reference in listOf(73.4162, 82.4069, 110.0, 146.8324, 195.9977, 246.9417, 329.6276, 440.0, 987.7666)) {
            for (detune in listOf(-50, -10, 0, 10, 50)) {
                val frequency = reference * 2.0.pow(detune / 1200.0)
                for (harmonics in 0..2) {
                    val random = java.util.Random(42)
                    val samples = ShortArray(rate / 15) { i ->
                        val phase = 2 * PI * frequency * i / rate
                        val signal = when (harmonics) {
                            1 -> 0.08 * sin(phase) + 0.35 * sin(2 * phase) + 0.12 * sin(3 * phase)
                            2 -> 0.035 * sin(phase) + 0.35 * sin(2 * phase) + 0.01 * sin(3 * phase)
                            else -> 0.4 * sin(phase)
                        }
                        ((signal + (random.nextDouble() - 0.5) * 0.02) * 32767).toInt().toShort()
                    }
                    reset.invoke(module)
                    val pitch = estimate(samples, rate)
                    val error = if (pitch > 0) abs(1200 * log2(pitch / frequency)) else Double.POSITIVE_INFINITY
                    worst = max(worst, error)
                    cases++
                    if (error > 3) failures.add("rate=$rate frequency=$frequency harmonics=$harmonics pitch=$pitch error=$error cents")
                }
            }
        }
        val random = java.util.Random(7)
        val noise = ShortArray(rate / 15) { ((random.nextDouble() - 0.5) * 12000).toInt().toShort() }
        if (estimate(noise, rate) != 0.0) failures.add("Noise accepted at $rate")
        if (estimate(ShortArray(rate / 15), rate) != 0.0) failures.add("Silence accepted at $rate")
        val quiet = ShortArray(rate / 15) { i -> ((0.02 + 0.008 * sin(2 * PI * 82.4069 * i / rate)) * 32767).toInt().toShort() }
        val quietPitch = estimate(quiet, rate)
        if (quietPitch <= 0 || abs(1200 * log2(quietPitch / 82.4069)) > 3) failures.add("Quiet tone with DC offset failed at $rate: $quietPitch")
    }
    reset.invoke(module)
    repeat(5) { smoother.invoke(module, 82.4069f) }
    smoother.invoke(module, 329.6276f)
    val switched = smoother.invoke(module, 329.6276f) as Float
    if (abs(1200 * log2(switched / 329.6276)) > 3) failures.add("String transition retained old pitch: $switched")
    if (smoother.invoke(module, 0f) as Float != 0f) failures.add("Invalid estimate retained old pitch")
    smoother.invoke(module, 110f)
    val adjusted = (110 * 2.0.pow(10.0 / 1200)).toFloat()
    var settled = 0f
    repeat(8) { settled = smoother.invoke(module, adjusted) as Float }
    if (abs(1200 * log2(settled / adjusted)) > 0.5) failures.add("Slow tuning adjustment did not settle: $settled")
    for (reference in listOf(82.4069, 110.0, 146.8324, 195.9977, 246.9417, 329.6276)) {
        for (cents in listOf(-6, -4, 0, 4, 6)) {
            val data = noteData.invoke(module, (reference * 2.0.pow(cents / 1200.0)).toFloat()) as com.facebook.react.bridge.WritableMap
            val expectedDirection = when { cents < -5 -> "<"; cents > 5 -> ">"; else -> "=" }
            if (data.values["direction"] != expectedDirection) failures.add("Inconsistent cents tolerance: $reference, $cents")
        }
    }
    val recordings = recordingsDirectory.listFiles { f -> f.extension == "wav" && f.name != "nylon_all.wav" } ?: emptyArray()
    check(recordings.size == 10) { "Expected ten guitar recordings in $recordingsDirectory" }
    for (file in recordings.sortedBy { it.name }) {
        AudioSystem.getAudioInputStream(file).use { audio ->
            val bytes = audio.readBytes()
            val rate = audio.format.sampleRate.toInt()
            val samples = ShortArray(bytes.size / 2) { i -> ((bytes[i * 2].toInt() and 255) or (bytes[i * 2 + 1].toInt() shl 8)).toShort() }
            val frames = samples.toList().chunked(rate / 15).filter { it.size == rate / 15 }
            val energy = frames.map { frame -> sqrt(frame.sumOf { (it / 32768.0).pow(2) } / frame.size) }
            val floor = max(0.01, (energy.maxOrNull() ?: 0.0) * 0.1)
            val expected = when {
                file.name.startsWith("1st") -> 329.6276
                file.name.startsWith("5th") -> 110.0
                file.name.startsWith("6th") -> 82.4069
                else -> 146.8324
            }
            reset.invoke(module)
            var locked = false
            var decayErrors = 0
            var detectedFrames = 0
            val tracked = frames.mapIndexed { index, frame ->
                val rawPitch = estimate(frame.toShortArray(), rate).toFloat()
                if (energy[index] >= floor && rawPitch > 0) detectedFrames++
                val pitch = (smoother.invoke(module, rawPitch) as Float).toDouble()
                val correct = pitch > 0 && abs(1200 * log2(pitch / expected)) < 100
                if (correct) locked = true
                if (locked && energy[index] >= floor && pitch > 0 && !correct) {
                    decayErrors++
                }
                pitch
            }
            if (decayErrors > 0) failures.add("Decay register jumps in ${file.name}: $decayErrors")
            val pitches = tracked.filterIndexed { index, _ -> energy[index] >= floor }.filter { it > 0 }.sorted()
            val eligible = energy.count { it >= floor }
            if (pitches.size < 10 || pitches.size < detectedFrames * 0.8) failures.add("Tracker discarded too many detected frames in ${file.name}: ${pitches.size}/$detectedFrames")
            val correctRegister = pitches.count { abs(1200 * log2(it / expected)) < 100 }
            val ratio = correctRegister.toDouble() / pitches.size.coerceAtLeast(1)
            println("Recording ${file.name}: voiced=${pitches.size}/$eligible, correct register=${100*ratio}%, median=${pitches.getOrNull(pitches.size / 2)} Hz (not a calibrated reference)")
            // Uncalibrated recordings may contain other resonances; verify the dominant register,
            // while reporting frame-level ambiguity rather than treating it as reference accuracy.
            val median = pitches.getOrNull(pitches.size / 2) ?: 0.0
            if (median <= 0 || abs(1200 * log2(median / expected)) >= 100) failures.add("Wrong dominant register in ${file.name}: $median")
        }
    }
    println("Accuracy: $cases cases, worst=$worst cents; $transitions string transitions, 12 decay/drift sequences; failures=${failures.size}")
    failures.take(12).forEach { println(it) }
    check(failures.isEmpty()) { "Pitch accuracy regression" }
}
fun main(args: Array<String>) {
    val context = ReactApplicationContext()
    val module = MicrophoneStreamModule(context)
    try {
    repeat(200) {
        module.startRecording()
        module.startRecording()
        val event = context.events.poll(2, TimeUnit.SECONDS) ?: error("No audio event")
        check(event.values["note"] == "Silence")
        check(event.values["rms"] == 0.0)
        module.stopRecording()
        module.stopRecording()
        check(Thread.getAllStackTraces().keys.none { it.name == "MicrophoneCapture" && it.isAlive })
    }
    module.invalidate()
    check(AudioRecord.released.get() == 200)
    for (frequency in listOf(82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 440.0)) {
        AudioRecord.frequency = frequency
        module.startRecording()
        var event = context.events.poll(2, TimeUnit.SECONDS) ?: error("No tone event")
        if (event.values["note"] == "Silence") event = context.events.poll(2, TimeUnit.SECONDS) ?: error("No confirmed tone event")
        val pitch = event.values["pitch"] as? Double ?: error("Missing pitch")
        module.stopRecording()
        val cents = 1200 * kotlin.math.log2(pitch / frequency)
        check(kotlin.math.abs(cents) < 10) { "Frequency $frequency detected as $pitch ($cents cents)" }
    }
    println("Seven synthetic guitar/reference tones detected within 10 cents.")
    println("Native Kotlin source passed 200 start/stop cycles, idempotent calls, no overlapping readers, silence RMS, and release checks with deterministic device stubs.")
    checkAccuracy(module, File(args.single()))
    } finally { module.invalidate() }
}
