package com.freetune

import android.content.ContentResolver
import android.content.res.AssetFileDescriptor
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin

private class Result : Promise {
    val done = CountDownLatch(1)
    var code: String? = null
    var resolved = false
    override fun resolve(value: Any?) { resolved = true; done.countDown() }
    override fun reject(code: String, message: String?, cause: Throwable?) { this.code = code; done.countDown() }
    fun await(seconds: Long = 2): Result { check(done.await(seconds, TimeUnit.SECONDS)); return this }
}

private fun checkCancellation() {
    val module = OfflineChordAnalysisModule(ReactApplicationContext())
    val gates = listOf(CountDownLatch(1), CountDownLatch(1))
    try {
        val remote = Result()
        module.analyzeFile("https://example.com/song.mp3", remote)
        check(remote.await().code == "FileUnavailable")
        for (gate in gates) {
            ContentResolver.gates.add(gate)
            val pending = Result()
            module.analyzeFile("content://provider/song", pending)
            check(ContentResolver.opened.poll(2, TimeUnit.SECONDS) === gate)
            val concurrent = Result()
            module.analyzeFile("file:///another.wav", concurrent)
            check(concurrent.await().code == "Busy")
            val cancelled = Result()
            val started = System.nanoTime()
            module.cancel(cancelled)
            check(cancelled.await(1).resolved)
            check(pending.await(1).code == "Cancelled" && !pending.resolved)
            check(System.nanoTime() - started < 1_000_000_000L)
            check(gate.count == 1L) { "Cancellation waited for the blocked provider" }
        }
        val pool = module.javaClass.getDeclaredField("fileWorkers").apply { isAccessible = true }.get(module) as ThreadPoolExecutor
        check(pool.poolSize == 2)
        val saturated = Result()
        module.analyzeFile("content://provider/third", saturated)
        check(saturated.await(3).code == "Busy")
        check(pool.poolSize == 2 && pool.queue.isEmpty()) { "Blocked providers grew the worker/queue count" }
        gates.forEach { it.countDown() }
        repeat(2) { check(AssetFileDescriptor.closed.poll(2, TimeUnit.SECONDS) == true) }
        val retry = Result()
        module.analyzeFile("file:///missing.wav", retry)
        check(retry.await().code == "FileUnavailable") { "Old provider blocked retry or published a result" }
        module.invalidate()
        val invalidated = Result()
        module.analyzeFile("file:///missing.wav", invalidated)
        check(invalidated.await().code == "AnalysisUnsupported")
    } finally {
        gates.forEach { it.countDown() }
        module.invalidate()
    }
}

private fun checkNoteEventMapping() {
    val mapper = OfflineChordAnalysisModule.Companion.javaClass
        .getDeclaredMethod("chordResult", JSONObject::class.java).apply { isAccessible = true }
    val event = JSONObject(mapOf(
        "start" to 0.25, "end" to 0.5, "midi" to 64,
        "noteEvidence" to 0.8, "onsetEvidence" to 0.9
    ))
    val input = JSONObject(mapOf(
        "engine" to "chroma-v2", "duration" to 2.0,
        "noteEventsVersion" to 1, "noteEventsLimit" to 24000,
        "noteEventsTruncated" to true, "noteEventsCoverageEnd" to 0.7,
        "noteEvents" to JSONArray(listOf(event))
    ))
    val mapped = mapper.invoke(OfflineChordAnalysisModule.Companion, input) as WritableMap
    check(mapped.values["noteEventsVersion"] == 1)
    check(mapped.values["noteEventsLimit"] == 24000)
    check(mapped.values["noteEventsTruncated"] == true)
    check(mapped.values["noteEventsCoverageEnd"] == 0.7)
    val notes = (mapped.values["noteEvents"] as WritableArray).values
    check(notes.size == 1)
    check(notes[0].values == mapOf(
        "start" to 0.25, "end" to 0.5, "midi" to 64,
        "noteEvidence" to 0.8, "onsetEvidence" to 0.9
    ))
    val legacy = mapper.invoke(OfflineChordAnalysisModule.Companion, JSONObject()) as WritableMap
    check(!legacy.values.containsKey("noteEvents")) { "Unavailable legacy notes became a silent take" }
}

fun main() {
    for (rate in listOf(8000, 16000, 22050, 44100, 48000, 96000, 192000, 384000)) {
        var total = 0
        val output = mutableListOf<Short>()
        val stream = ChordPcmStream(rate) { samples, count ->
            check(count in 1..4096)
            total += count
            output.addAll(samples.take(count))
        }
        repeat(rate * 2 + rate / 3) { frame -> stream.append(sin(2 * PI * 440 * frame / rate) * 12000) }
        stream.finish()
        check(total.toLong() == (rate * 2L + rate / 3) * 16000 / rate)
        check(stream.outputFrames == total.toLong() && output.max() > 10000)
    }
    val initial = ChordPcmStream(48000) { _, _ -> }
    initial.setRate(44100)
    initial.append(1.0)
    check(runCatching { initial.setRate(48000) }.exceptionOrNull()?.message == "UnsupportedAudio")
    val bounded = ChordPcmStream(8000) { _, _ -> }
    repeat(8000 * 900) { bounded.append(0.0) }
    bounded.finish()
    check(bounded.outputFrames == 14_400_000L)
    check(runCatching { bounded.append(0.0) }.exceptionOrNull()?.message == "AudioTooLong")
    checkCancellation()
    checkNoteEventMapping()
    println("Production Kotlin offline bridge passed: eight sample rates, exact durations, bounded chunks, 15-minute cap; Busy, prompt blocked-provider cancellation, bounded workers, late cleanup, retry and invalidation; versioned note events with truncation coverage and legacy absence. Android/RN/provider stubs; no Android codec or Rust recognition quality claims.")
}
