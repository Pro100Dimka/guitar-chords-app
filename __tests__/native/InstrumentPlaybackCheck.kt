/** Platform boundaries for extracted production instrument/lifecycle methods.
 * AudioTrack output, fade completion and worker dispatch are deterministic doubles;
 * no Android device audio or latency is measured here.
 */
enum class LifecycleState { BEFORE_CREATE, BEFORE_RESUME, RESUMED }

class InstrumentContext(var lifecycleState: LifecycleState = LifecycleState.RESUMED) {
    var connected = true
    var removed = false
    fun hasActiveReactInstance() = connected
    fun removeLifecycleEventListener(listener: Any) { removed = true }
}

class InstrumentTrack(val pcm: ByteArray) {
    companion object { const val SUCCESS = 0 }
    var released = false
    var playing = false
    var plays = 0
    var gain = 1f
    var head = 0
    fun setVolume(value: Float) { check(!released); gain = value }
    fun setPlaybackHeadPosition(value: Int): Int { check(!released && !playing); head = value; return SUCCESS }
    fun play() { check(!released); playing = true; plays++ }
    fun pause() { check(!released); playing = false }
    fun release() { check(!released) { "AudioTrack released twice" }; released = true; playing = false }
}

class InstrumentWorker {
    private val pending = ArrayDeque<() -> Unit>()
    var closed = false
    var submitted = 0
    fun execute(work: () -> Unit) {
        if (closed || pending.size >= 32) throw java.util.concurrent.RejectedExecutionException()
        submitted++
        pending.addLast(work)
    }
    fun shutdown() { closed = true }
    fun drain() { while (pending.isNotEmpty()) pending.removeFirst().invoke() }
}

class InstrumentAudioManager {
    var abandoned = 0
    fun abandonAudioFocus(listener: Any) { abandoned++ }
}

open class InstrumentModule(val context: InstrumentContext) {
    var recorder: Any? = null
    var player: InstrumentTrack? = null
    var cue: InstrumentTrack? = null
    var guitar: InstrumentTrack? = null
    var metronome: InstrumentTrack? = null
    val metronomeBeats = mutableMapOf<Int, InstrumentTrack>()
    val guitarStrings = mutableMapOf<Int, InstrumentTrack>()
    val guitarPcm = linkedMapOf<String, ByteArray>()
    val preparedGuitars = linkedMapOf<String, InstrumentTrack>()
    val preparingGuitars = mutableSetOf<String>()
    var onCreateGuitar: (() -> Unit)? = null
    val tracks = mutableListOf<InstrumentTrack>()
    val worker = InstrumentWorker()
    val samplerWorker = InstrumentWorker()
    var instrumentPlaybackActive = context.lifecycleState == LifecycleState.RESUMED
    var invalidated = false
    val audioManager = InstrumentAudioManager()
    val focusListener = Any()
    val events = mutableListOf<String>()
    private val fades = ArrayDeque<() -> Unit>()
    fun emit(state: String) { events.add(state) }
    fun finishTake() { recorder = null }
    fun pcmTrack(bytes: ByteArray, rate: Int, channels: Int): InstrumentTrack =
        InstrumentTrack(bytes).also { tracks.add(it) }
    fun guitarTrack(bytes: ByteArray): InstrumentTrack {
        onCreateGuitar?.invoke()
        return pcmTrack(bytes, 22050, 1)
    }
    fun fadeGuitar(previous: InstrumentTrack?, volume: Float = 1f) {
        if (previous != null) fades.addLast { previous.release() }
    }
    fun finishFades() { while (fades.isNotEmpty()) fades.removeFirst().invoke() }
    open fun onHostResume() {}
    open fun onHostPause() {}
    open fun onHostDestroy() {}
    open fun invalidate() {}
}

fun main() {
    // RN addLifecycleEventListener queues onHostResume when attached to a
    // resumed context. Its callback can arrive after onHostPause changed state.
    run {
        val context = InstrumentContext()
        val module = PerformanceAudio(context)
        module.guitarPcm["a"] = byteArrayOf(1)
        module.playGuitarString("a", 0)
        module.playMetronomeBeat(2.0, 0.7)
        context.lifecycleState = LifecycleState.BEFORE_RESUME
        module.onHostPause()
        val created = module.tracks.size
        val submitted = module.samplerWorker.submitted
        module.onHostResume() // delayed callback posted before the pause
        check(!module.instrumentPlaybackActive) { "Stale resume re-enabled instrument playback in background" }
        module.playGuitarString("a", 0)
        module.playMetronomeBeat(2.0, 0.7)
        check(module.tracks.size == created && module.samplerWorker.submitted == submitted)
        check(module.guitarStrings.isEmpty() && module.metronomeBeats.isEmpty())
        check(module.events == listOf("playbackInterrupted"))
        context.lifecycleState = LifecycleState.RESUMED
        module.onHostResume()
        check(module.tracks.none { it.playing }) { "Resume must not start audio itself" }
        module.playGuitarString("a", 0)
        module.playMetronomeBeat(2.0, 0.7)
        check(module.guitarStrings[0]?.playing == true && module.metronomeBeats[2]?.playing == true)
        module.invalidate()
        module.samplerWorker.drain()
        module.finishFades()
        check(module.tracks.all { it.released })
    }
    // Clicks reuse a bounded cache, and their stop must not mute guitar voices.
    run {
        val module = PerformanceAudio(InstrumentContext())
        module.guitarPcm["a"] = byteArrayOf(1)
        module.playGuitarString("a", 0)
        val string = module.guitarStrings.getValue(0)
        repeat(120) { module.playMetronomeBeat((it % 3).toDouble(), 0.7) }
        check(module.metronomeBeats.size == 3 && module.tracks.size == 4)
        check(module.metronomeBeats.values.all { it.plays == 40 && it.gain == 0.7f })
        module.stopMetronomeBeats()
        check(string.playing && module.metronomeBeats.values.none { it.playing })
        check(module.metronomeBeats.values.none { it.released })
        module.playMetronomeBeat(9.0, 2.0)
        check(module.metronomeBeats.getValue(2).gain == 1f && module.tracks.size == 4)
        for (invalid in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            module.playMetronomeBeat(invalid, 0.7)
            module.playMetronomeBeat(2.0, invalid)
        }
        module.playMetronomeBeat(2.0, 0.0)
        check(module.metronomeBeats.getValue(2).plays == 41)
        module.invalidate()
        module.samplerWorker.drain()
        module.finishFades()
        check(module.tracks.all { it.released })
    }
    // Replenishing/retriggering never reuses the currently sounding track.
    // A late release owns only the old voice, including on the same string/key.
    run {
        val module = PerformanceAudio(InstrumentContext())
        module.guitarPcm["a"] = byteArrayOf(1)
        module.guitarPcm["b"] = byteArrayOf(2)
        module.playGuitarString("a", 0)
        val first = module.guitarStrings.getValue(0)
        module.samplerWorker.drain()
        module.playGuitarString("a", 0)
        val second = module.guitarStrings.getValue(0)
        check(first !== second)
        module.playGuitarString("b", 5)
        val other = module.guitarStrings.getValue(5)
        module.stopGuitarString(0)
        module.playGuitarString("a", 0)
        val latest = module.guitarStrings.getValue(0)
        module.finishFades()
        check(first.released && second.released && !latest.released && latest.playing && other.playing)
        module.samplerWorker.drain()
        module.invalidate()
        module.samplerWorker.drain()
        module.finishFades()
        check(module.tracks.all { it.released })
    }
    // Pending cache work after invalidate must not allocate tracks or submit
    // new work, and even a late resume on a resumed context cannot revive it.
    run {
        val module = PerformanceAudio(InstrumentContext())
        module.guitarPcm["a"] = byteArrayOf(1)
        module.playGuitarString("a", 0)
        module.invalidate()
        val created = module.tracks.size
        val submitted = module.samplerWorker.submitted
        module.onHostResume()
        module.playGuitarString("a", 0)
        module.playMetronomeBeat(2.0, 1.0)
        module.samplerWorker.drain()
        module.finishFades()
        check(module.invalidated && !module.instrumentPlaybackActive && module.context.removed)
        check(module.samplerWorker.closed && module.samplerWorker.submitted == submitted && module.tracks.size == created)
        check(module.preparedGuitars.isEmpty() && module.guitarPcm.isEmpty() && module.tracks.all { it.released })
    }
    // A hot preview starts immediately; rebuilding its spare voice cannot
    // block pause, navigation or another native audio command behind the lock.
    run {
        val module = PerformanceAudio(InstrumentContext())
        val bytes = byteArrayOf(1)
        module.guitarPcm["preview"] = bytes
        module.preparedGuitars["preview"] = module.guitarTrack(bytes)
        module.playPreparedGuitar("preview")
        check(module.guitar?.playing == true && module.tracks.size == 1)
        check(module.samplerWorker.submitted == 1)
        module.onCreateGuitar = {
            check(!Thread.holdsLock(module)) { "Spare voice allocation held the audio/lifecycle lock" }
        }
        module.samplerWorker.drain()
        check(module.preparedGuitars.containsKey("preview") && module.tracks.size == 2)
        module.invalidate()
        module.finishFades()
        check(module.tracks.all { it.released })
    }
    // Rapid taps enqueue at most one spare per key, and a voice completed
    // after invalidation is released instead of resurrecting the native cache.
    run {
        val module = PerformanceAudio(InstrumentContext())
        module.guitarPcm["a"] = byteArrayOf(1)
        repeat(20) { module.playGuitarString("a", 0) }
        check(module.samplerWorker.submitted == 1)
        module.onCreateGuitar = {
            check(!Thread.holdsLock(module))
            module.invalidate()
        }
        module.samplerWorker.drain()
        module.finishFades()
        check(module.preparedGuitars.isEmpty() && module.preparingGuitars.isEmpty())
        check(module.tracks.all { it.released })
    }
    // A newly decoded fingering is not advertised as ready until worker
    // allocation finishes; repeated queued requests reuse the first result.
    run {
        val module = PerformanceAudio(InstrumentContext())
        val answers = mutableListOf<Any>()
        val promise = object : com.facebook.react.bridge.Promise {
            override fun resolve(value: Any) { answers.add(value) }
        }
        val wave = java.util.Base64.getEncoder().encodeToString(ByteArray(48))
        module.onCreateGuitar = { check(!Thread.holdsLock(module)) }
        module.prepareFingering("cold", wave, promise)
        module.prepareFingering("cold", wave, promise)
        check(answers.isEmpty() && module.tracks.isEmpty())
        module.samplerWorker.drain()
        check(answers == listOf(true, true) && module.tracks.size == 1)
        module.prepareFingering("cold", "", promise)
        check(answers == listOf(true, true, true))
        module.invalidate()
        module.finishFades()
        check(module.tracks.all { it.released })
    }
    run {
        val module = PerformanceAudio(InstrumentContext())
        val answers = mutableListOf<Any>()
        val promise = object : com.facebook.react.bridge.Promise {
            override fun resolve(value: Any) { answers.add(value) }
        }
        val wave = java.util.Base64.getEncoder().encodeToString(ByteArray(48))
        module.onCreateGuitar = {
            check(!Thread.holdsLock(module))
            module.invalidate()
        }
        module.prepareFingering("cancelled", wave, promise)
        module.samplerWorker.drain()
        check(answers == listOf(false) && module.preparedGuitars.isEmpty())
        check(module.tracks.all { it.released })
    }
    // A pending long recording job uses a separate queue and cannot delay a
    // first fingering/strum while its recording is being finalized.
    run {
        val module = PerformanceAudio(InstrumentContext())
        var recordingFinished = false
        var ready = false
        module.worker.execute { recordingFinished = true }
        val wave = java.util.Base64.getEncoder().encodeToString(ByteArray(48))
        module.prepareFingering("independent", wave, object : com.facebook.react.bridge.Promise {
            override fun resolve(value: Any) { ready = value == true }
        })
        module.samplerWorker.drain()
        check(ready && !recordingFinished)
        module.invalidate()
        check(module.worker.closed && module.samplerWorker.closed)
        module.worker.drain()
        check(recordingFinished)
    }
    // Saturated preparation remains bounded: resolve rather than leave a
    // pending JS promise, and do not leak the deduplication marker.
    run {
        val module = PerformanceAudio(InstrumentContext())
        repeat(32) { module.samplerWorker.execute {} }
        val answers = mutableListOf<Any>()
        module.prepareFingering("overflow", "AAAA", object : com.facebook.react.bridge.Promise {
            override fun resolve(value: Any) { answers.add(value) }
        })
        check(answers == listOf(false))
        module.guitarPcm["a"] = byteArrayOf(1)
        module.playGuitarString("a", 0)
        check(module.guitarStrings[0]?.playing == true && module.preparingGuitars.isEmpty())
        module.invalidate()
        module.samplerWorker.drain()
        module.finishFades()
        check(module.tracks.all { it.released })
    }
    // The transport warms twelve distinct notes in order. Its earliest note
    // must remain a ready voice rather than being evicted by later lookahead.
    run {
        val module = PerformanceAudio(InstrumentContext())
        val wave = java.util.Base64.getEncoder().encodeToString(ByteArray(48))
        repeat(12) { index ->
            var ready = false
            module.prepareFingering("window-$index", wave, object : com.facebook.react.bridge.Promise {
                override fun resolve(value: Any) { ready = value == true }
            })
            module.samplerWorker.drain()
            check(ready)
        }
        check(module.preparedGuitars.size == 12)
        check(module.preparedGuitars.containsKey("window-0"))
        val created = module.tracks.size
        module.onCreateGuitar = { check(!Thread.holdsLock(module)) { "Lookahead's first note fell back to a cold allocation" } }
        module.playGuitarString("window-0", 0)
        check(module.tracks.size == created && module.guitarStrings[0]?.playing == true)
        module.samplerWorker.drain()
        module.prepareFingering("window-12", wave, object : com.facebook.react.bridge.Promise {
            override fun resolve(value: Any) { check(value == true) }
        })
        module.samplerWorker.drain()
        check(module.preparedGuitars.size == 12)
        module.invalidate()
        module.finishFades()
        check(module.tracks.all { it.released })
    }
    println("Production Android instrument checks passed: stale lifecycle callbacks, click cache/ownership, rapid string retriggers and queued invalidate cleanup (deterministic audio/worker boundaries).")
}
