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
        check(!closed) { "Work submitted after shutdown" }
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
    val tracks = mutableListOf<InstrumentTrack>()
    val worker = InstrumentWorker()
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
    fun guitarTrack(bytes: ByteArray) = pcmTrack(bytes, 22050, 1)
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
        val submitted = module.worker.submitted
        module.onHostResume() // delayed callback posted before the pause
        check(!module.instrumentPlaybackActive) { "Stale resume re-enabled instrument playback in background" }
        module.playGuitarString("a", 0)
        module.playMetronomeBeat(2.0, 0.7)
        check(module.tracks.size == created && module.worker.submitted == submitted)
        check(module.guitarStrings.isEmpty() && module.metronomeBeats.isEmpty())
        check(module.events == listOf("playbackInterrupted"))
        context.lifecycleState = LifecycleState.RESUMED
        module.onHostResume()
        check(module.tracks.none { it.playing }) { "Resume must not start audio itself" }
        module.playGuitarString("a", 0)
        module.playMetronomeBeat(2.0, 0.7)
        check(module.guitarStrings[0]?.playing == true && module.metronomeBeats[2]?.playing == true)
        module.invalidate()
        module.worker.drain()
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
        module.worker.drain()
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
        module.worker.drain()
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
        module.worker.drain()
        module.invalidate()
        module.worker.drain()
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
        val submitted = module.worker.submitted
        module.onHostResume()
        module.playGuitarString("a", 0)
        module.playMetronomeBeat(2.0, 1.0)
        module.worker.drain()
        module.finishFades()
        check(module.invalidated && !module.instrumentPlaybackActive && module.context.removed)
        check(module.worker.closed && module.worker.submitted == submitted && module.tracks.size == created)
        check(module.preparedGuitars.isEmpty() && module.guitarPcm.isEmpty() && module.tracks.all { it.released })
    }
    println("Production Android instrument checks passed: stale lifecycle callbacks, click cache/ownership, rapid string retriggers and queued invalidate cleanup (deterministic audio/worker boundaries).")
}
