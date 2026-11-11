package com.freetune

import kotlin.math.*

internal class RecordingPolish(rate: Int) {
    private val equalizers = arrayOf(380.0 to -2.5, 3200.0 to -3.5).map { (frequency, db) ->
        val a = 10.0.pow(db / 40)
        val w = 2 * PI * frequency / rate
        val alpha = sin(w) / 1.6
        val divisor = 1 + alpha / a
        doubleArrayOf((1 + alpha * a) / divisor, -2 * cos(w) / divisor,
            (1 - alpha * a) / divisor, -2 * cos(w) / divisor, (1 - alpha / a) / divisor)
    }
    private val eqState = Array(equalizers.size) { DoubleArray(2) }
    private val roomDamping = exp(-2 * PI * 2400 / rate)
    private val highPass = exp(-2 * PI * 75 / rate)
    private val envelopeRate = exp(-1.0 / (.025 * rate))
    private val attack = exp(-1.0 / (.015 * rate))
    private val release = exp(-1.0 / (.25 * rate))
    private val delays = doubleArrayOf(.0437, .0573, .0719, .0893, .1091, .1317).map { DoubleArray((it * rate).toInt()) }
    private val diffusion = doubleArrayOf(.005, .0017).map { DoubleArray((it * rate).toInt()) }
    private val diffusionPositions = IntArray(diffusion.size)
    private val positions = IntArray(delays.size)
    private val damping = DoubleArray(delays.size)
    private var previous = 0.0
    private var filtered = 0.0
    private var power = 0.0
    private var gain = 1.0
    private var limiter = 1.0

    fun process(input: Double): Double {
        val sample = if (input.isFinite()) input else 0.0
        filtered = highPass * (filtered + sample - previous)
        previous = sample
        var tone = filtered
        for (i in equalizers.indices) {
            val c = equalizers[i]
            val state = eqState[i]
            val output = c[0] * tone + state[0]
            state[0] = c[1] * tone - c[3] * output + state[1]
            state[1] = c[2] * tone - c[4] * output
            tone = output
        }
        power = envelopeRate * power + (1 - envelopeRate) * tone * tone
        val level = sqrt(power)
        val compression = if (level > .15) sqrt(.15 / level) else 1.0
        val quiet = .85 + .15 * (level / .002).coerceIn(0.0, 1.0)
        val target = 1.05 * compression * quiet
        val smoothing = if (target < gain) attack else release
        gain = smoothing * gain + (1 - smoothing) * target
        val dry = tone * gain
        var diffuse = dry
        for (i in diffusion.indices) {
            val delayed = diffusion[i][diffusionPositions[i]]
            val output = delayed - .55 * diffuse
            diffusion[i][diffusionPositions[i]] = diffuse + .55 * output
            diffusionPositions[i] = (diffusionPositions[i] + 1) % diffusion[i].size
            diffuse = output
        }
        var room = 0.0
        for (i in delays.indices) {
            val delayed = delays[i][positions[i]]
            damping[i] = roomDamping * damping[i] + (1 - roomDamping) * delayed
            delays[i][positions[i]] = diffuse + .48 * damping[i]
            positions[i] = (positions[i] + 1) % delays[i].size
            room += delayed
        }
        val mixed = dry + .12 * room / delays.size
        val ceiling = min(1.0, .88 / max(abs(mixed), 1e-12))
        limiter = if (ceiling < limiter) ceiling else release * limiter + (1 - release) * ceiling
        return (mixed * limiter).coerceIn(-.88, .88)
    }
}
