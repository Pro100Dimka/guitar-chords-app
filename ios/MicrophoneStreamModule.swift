import AVFoundation
import Accelerate
// ios/MicrophoneStream.swift
import Foundation
import UIKit
import React

@objc(MicrophoneStream)
class MicrophoneStream: RCTEventEmitter {

    @objc func setKeepAwake(_ enabled: Bool) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
        }
    }

    static let BUF_PER_SEC = 15
    private var sampleRate: Double = 44100.0

    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var isRecording = false

    private var pitchHistory: [Float] = []
    private var previousRms = 0.0
    private var pendingPitch: Float = 0
    private var missingFrames = 0
    private var targetNotes: [NoteSpec] = []
    private let processingLock = NSLock()

    @objc
    class NoteSpec: NSObject {
        let name: String
        let octave: Int
        let refFreq: Double
        let thickness: Double?
        let baseColor: [Double]?

        init(name: String, octave: Int, refFreq: Double, thickness: Double?, baseColor: [Double]?) {
            self.name = name
            self.octave = octave
            self.refFreq = refFreq
            self.thickness = thickness
            self.baseColor = baseColor
        }
    }

    // MARK: - JS Methods

    @objc
    func setTargetNotes(_ notes: [NSDictionary]) {
        var list: [NoteSpec] = []
        for obj in notes {
            guard let name = obj["name"] as? String,
                let octave = obj["octave"] as? Int
            else { continue }
            let thickness = obj["thickness"] as? Double
            let baseColor = obj["baseColor"] as? [Double]

            let midi: Int
            switch name {
            case "C": midi = 0
            case "C#": midi = 1
            case "D": midi = 2
            case "D#": midi = 3
            case "E": midi = 4
            case "F": midi = 5
            case "F#": midi = 6
            case "G": midi = 7
            case "G#": midi = 8
            case "A": midi = 9
            case "A#": midi = 10
            case "B": midi = 11
            default: midi = 0
            }
            let midiTotal = midi + (octave + 1) * 12
            let refFreq = 440.0 * pow(2.0, Double(midiTotal - 69) / 12.0)
            list.append(
                NoteSpec(
                    name: name, octave: octave, refFreq: refFreq,
                    thickness: thickness, baseColor: baseColor))
        }
        processingLock.lock()
        targetNotes = list
        processingLock.unlock()
    }

    @objc
    func startRecording() {
        if isRecording { return }

        do {
            try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Audio session start error: \(error)")
            return
        }

        audioEngine = AVAudioEngine()
        inputNode = audioEngine?.inputNode
        guard let inputNode = inputNode else { return }

        let format = inputNode.outputFormat(forBus: 0)
        sampleRate = format.sampleRate
        let bufferSize = AVAudioFrameCount(max(sampleRate / Double(Self.BUF_PER_SEC), 2048))

        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: format) {
            [weak self] buffer, _ in
            guard let self = self else { return }
            guard let channelData = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
            self.processingLock.lock()
            defer { self.processingLock.unlock() }
            let floatData = Array(
                UnsafeBufferPointer(start: channelData, count: Int(buffer.frameLength)))

            let rms = sqrt(floatData.map { $0 * $0 }.reduce(0, +) / Float(floatData.count))
            if rms < 0.003 {
                self.resetPitch()
                self.sendEvent(
                    "onAudioBuffer",
                    body: [
                        "rms": Double(rms),
                        "note": "Silence",
                        "pitch": 0.0,
                        "refFreq": 0.0,
                        "octave": 0,
                        "direction": "=",
                    ])
                return
            }

            let rawPitch = self.estimatePitch(floatData, sampleRate: buffer.format.sampleRate)
            let pitch = self.smoothPitch(rawPitch)
            var noteData = self.frequencyToNoteData(pitch)
            noteData["rms"] = Double(rms)
            self.sendEvent("onAudioBuffer", body: noteData)
        }

        do {
            try audioEngine?.start()
            isRecording = true
        } catch {
            print("AudioEngine start error: \(error)")
            stopRecording()
        }
    }

    @objc
    func stopRecording() {
        isRecording = false
        inputNode?.removeTap(onBus: 0)
        inputNode = nil
        audioEngine?.stop()
        audioEngine = nil
        processingLock.lock()
        resetPitch()
        processingLock.unlock()
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Audio session stop error: \(error)")
        }
    }

    @objc
    func getSampleRate(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        resolve(sampleRate)
    }

    @objc
    func getBufPerSec(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        resolve(Self.BUF_PER_SEC)
    }

    // MARK: - Pitch и ноты

    private func resetPitch() {
        pitchHistory.removeAll()
        previousRms = 0
        pendingPitch = 0
        missingFrames = 0
    }

    private func smoothPitch(_ pitch: Float) -> Float {
        guard pitch.isFinite, pitch > 0 else {
            pendingPitch = 0
            missingFrames += 1
            if missingFrames >= 3 { resetPitch() }
            return 0
        }
        missingFrames = 0
        let previous = pitchHistory.first
        let cents = previous.map { 1200 * log2(pitch / $0) } ?? 0
        if previous == nil || abs(cents) >= 100 {
            let confirmed = pendingPitch > 0 && abs(1200 * log2(pitch / pendingPitch)) < 50
            if !confirmed {
                pendingPitch = pitch
                return previous ?? 0
            }
        }
        pendingPitch = 0
        let smoothed: Float
        if let previous = previous, abs(cents) < 100 {
            smoothed = previous * pow(2, cents * 0.35 / 1200)
        } else {
            smoothed = pitch
        }
        pitchHistory = [smoothed]
        return smoothed
    }

    private func frequencyToNoteData(_ freq: Float) -> [String: Any] {
        var map: [String: Any] = [:]
        if freq <= 20 || freq > 5000 || freq.isNaN || freq.isInfinite {
            map["note"] = "Silence"
            map["pitch"] = 0.0
            map["refFreq"] = 0.0
            map["octave"] = 0
            map["direction"] = "="
            return map
        }

        if let closest = targetNotes.min(by: {
            abs(log2(Double(freq) / $0.refFreq)) < abs(log2(Double(freq) / $1.refFreq))
        }) {
            let cents = 1200 * log2(Double(freq) / closest.refFreq)
            let direction: String
            if cents > 5 {
                direction = ">"
            } else if cents < -5 {
                direction = "<"
            } else {
                direction = "="
            }

            map["note"] = closest.name
            map["pitch"] = Double(freq)
            map["refFreq"] = closest.refFreq
            map["octave"] = closest.octave
            map["direction"] = direction
            if let thickness = closest.thickness { map["thickness"] = thickness }
            if let baseColor = closest.baseColor { map["baseColor"] = baseColor }
            return map
        }

        let midiExact = 69 + 12 * log2(Double(freq) / 440.0)
        let midi = Int(round(midiExact))
        let noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        let noteIndex = (midi % 12 + 12) % 12
        let note = noteNames[noteIndex]
        let octave = midi / 12 - 1
        let refFreq = 440.0 * pow(2.0, Double(midi - 69) / 12.0)
        let cents = 1200 * log2(Double(freq) / refFreq)
        let direction: String
        if cents > 5 {
            direction = ">"
        } else if cents < -5 {
            direction = "<"
        } else {
            direction = "="
        }

        map["note"] = note
        map["pitch"] = Double(freq)
        map["refFreq"] = refFreq
        map["octave"] = octave
        map["direction"] = direction
        return map
    }
    private func estimatePitch(_ buffer: [Float], sampleRate: Double) -> Float {
        guard !buffer.isEmpty, sampleRate > 0, sampleRate.isFinite else { return 0 }
        let mean = buffer.reduce(0.0) { $0 + Double($1) } / Double(buffer.count)
        let norm = buffer.map { Double($0) - mean }
        let rms = sqrt(norm.reduce(0.0) { $0 + $1 * $1 } / Double(norm.count))
        guard rms >= 0.003 else { return 0 }
        let sustaining = previousRms > 0 && rms <= previousRms * 1.2
        previousRms = rms
        let minLag = max(1, Int(sampleRate / 2000))
        let maxLag = min(Int(sampleRate / 40), buffer.count / 2 - 1)
        guard maxLag >= minLag else { return 0 }
        var correlations = [Double](repeating: 0, count: maxLag + 2)
        norm.withUnsafeBufferPointer { samples in
            guard let start = samples.baseAddress else { return }
            for lag in (minLag - 1)...(maxLag + 1) {
                let count = vDSP_Length(norm.count - lag)
                var correlation = 0.0
                var leftEnergy = 0.0
                var rightEnergy = 0.0
                vDSP_dotprD(start, 1, start + lag, 1, &correlation, count)
                vDSP_svesqD(start, 1, &leftEnergy, count)
                vDSP_svesqD(start + lag, 1, &rightEnergy, count)
                let energy = sqrt(leftEnergy * rightEnergy)
                correlations[lag] = energy > 0 ? correlation / energy : 0
            }
        }
        let bestCorrelation = correlations[minLag...maxLag].max() ?? 0
        guard bestCorrelation >= 0.6 else { return 0 }
        // Relax peak selection for noisy/inharmonic strings without accepting clean overtones.
        let peakThreshold = max(0.9, min(0.99, 1 - 4 * (1 - bestCorrelation)))
        let peaks = (minLag...maxLag).filter {
            correlations[$0] >= correlations[$0 - 1] && correlations[$0] > correlations[$0 + 1]
        }
        guard let bestLag = peaks.first(where: { correlations[$0] >= bestCorrelation * peakThreshold }) else { return 0 }
        func frequency(_ lag: Int) -> Double {
            let left = correlations[lag - 1]
            let right = correlations[lag + 1]
            let curvature = left - 2 * correlations[lag] + right
            let shift = curvature != 0 ? max(-0.5, min(0.5, 0.5 * (left - right) / curvature)) : 0
            return sampleRate / (Double(lag) + shift)
        }
        let detected = frequency(bestLag)
        guard let lastPitch = pitchHistory.first else { return Float(detected) }
        let previous = Double(lastPitch)
        let ratio = max(detected, previous) / min(detected, previous)
        let harmonic = ratio.rounded()
        guard sustaining, (2...6).contains(harmonic), abs(1200 * log2(ratio / harmonic)) <= 70 else { return Float(detected) }
        guard let trackedLag = peaks.filter({
            correlations[$0] >= max(0.45, bestCorrelation * 0.5) &&
                abs(1200 * log2(frequency($0) / previous)) < 50
        }).max(by: { correlations[$0] < correlations[$1] }) else { return Float(detected) }
        let tracked = frequency(trackedLag)
        func amplitude(_ frequency: Double) -> Double {
            var real = 0.0
            var imaginary = 0.0
            for i in norm.indices {
                let windowed = norm[i] * (0.5 - 0.5 * cos(2 * Double.pi * Double(i) / Double(norm.count - 1)))
                let phase = 2 * Double.pi * frequency * Double(i) / sampleRate
                real += windowed * cos(phase)
                imaginary += windowed * sin(phase)
            }
            return sqrt(real * real + imaginary * imaginary)
        }
        // Follow a measured peak, never substitute the previous frequency itself.
        let requiredSupport = detected < tracked ? 1.25 : 0.08
        return Float(amplitude(tracked) > amplitude(detected) * requiredSupport ? tracked : detected)
    }

    // MARK: - RCTEventEmitter

    override func supportedEvents() -> [String]! {
        return ["onAudioBuffer"]
    }

    private func sendEvent(_ name: String, body: [String: Any]) {
        self.sendEvent(withName: name, body: body)
    }
}
