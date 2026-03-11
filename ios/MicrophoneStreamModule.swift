// ios/MicrophoneStreamModule.swift
import Foundation
import AVFoundation
import React

@objc(MicrophoneStream)
class MicrophoneStream: RCTEventEmitter {
    private var audioEngine: AVAudioEngine?
    private var pitchHistory: [Float] = []
    private var targetNotes: [NoteSpec] = []
    private let sampleRate: Double = 44100.0
    private let bufPerSec: Int = 15

    struct NoteSpec {
        let name: String
        let octave: Int
        let refFreq: Double
        let thickness: Double?
        let baseColor: [Double]?
    }

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    override func supportedEvents() -> [String]! {
        return ["onAudioBuffer"]
    }

    // MARK: - JS Methods
    @objc func setTargetNotes(_ notes: NSArray) {
        var list: [NoteSpec] = []
        for case let obj as NSDictionary in notes {
            guard let name = obj["name"] as? String,
                  let octave = obj["octave"] as? Int else { continue }
            let thickness = obj["thickness"] as? Double
            let baseColor = obj["baseColor"] as? [Double]

            let midiBase: Int
            switch name {
            case "C": midiBase = 0; case "C#": midiBase = 1
            case "D": midiBase = 2; case "D#": midiBase = 3
            case "E": midiBase = 4; case "F": midiBase = 5
            case "F#": midiBase = 6; case "G": midiBase = 7
            case "G#": midiBase = 8; case "A": midiBase = 9
            case "A#": midiBase = 10; case "B": midiBase = 11
            default: midiBase = 0
            }
            let midi = midiBase + (octave + 1) * 12
            let refFreq = 440.0 * pow(2.0, Double(midi - 69) / 12.0)

            list.append(NoteSpec(name: name, octave: octave, refFreq: refFreq,
                                 thickness: thickness, baseColor: baseColor))
        }
        targetNotes = list
    }

    @objc func startRecording() {
        audioEngine = AVAudioEngine()
        guard let input = audioEngine?.inputNode else { return }
        let format = input.outputFormat(forBus: 0)

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameCount = Int(buffer.frameLength)
            let samples = Array(UnsafeBufferPointer(start: channelData, count: frameCount))

            // RMS
            let rms = sqrt(samples.map { Double($0 * $0) }.reduce(0, +) / Double(frameCount))
            if rms < 0.02 {
                self.pitchHistory.removeAll()
                self.sendEvent(withName: "onAudioBuffer", body: [
                    "samples": samples,
                    "rms": rms,
                    "note": "Silence",
                    "pitch": 0.0,
                    "refFreq": 0.0,
                    "octave": 0,
                    "direction": "="
                ])
                return
            }

            let rawPitch = self.estimatePitch(samples: samples, sampleRate: self.sampleRate)
            let pitch = self.smoothPitch(rawPitch)
            let noteData = self.frequencyToNoteData(freq: pitch)

            var map: [String: Any] = [
                "samples": samples,
                "rms": rms
            ]
            noteData.forEach { map[$0.key] = $0.value }
            self.sendEvent(withName: "onAudioBuffer", body: map)
        }

        try? audioEngine?.start()
    }

    @objc func stopRecording() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
        pitchHistory.removeAll()
    }

    @objc func getSampleRate(_ resolve: RCTPromiseResolveBlock,
                            rejecter reject: RCTPromiseRejectBlock) {
        resolve(sampleRate)
    }

    @objc func getBufPerSec(_ resolve: RCTPromiseResolveBlock,
                            rejecter reject: RCTPromiseRejectBlock) {
        resolve(bufPerSec)
    }

    // MARK: - Helpers
    private func smoothPitch(_ pitch: Float) -> Float {
        if pitch > 0 {
            if pitchHistory.count >= 5 { pitchHistory.removeFirst() }
            pitchHistory.append(pitch)
        }
        return pitchHistory.isEmpty ? 0 : pitchHistory.reduce(0,+)/Float(pitchHistory.count)
    }

    private func frequencyToNoteData(freq: Float) -> [String: Any] {
        if freq <= 20 || freq > 5000 || freq.isNaN || !freq.isFinite {
            pitchHistory.removeAll()
            return [
                "note": "Silence",
                "pitch": 0.0,
                "refFreq": 0.0,
                "octave": 0,
                "direction": "="
            ]
        }

        if let closest = targetNotes.min(by: { abs(Double(freq) - $0.refFreq) < abs(Double(freq) - $1.refFreq) }) {
            let direction: String
            if Double(freq) > closest.refFreq + 0.5 { direction = ">" }
            else if Double(freq) < closest.refFreq - 0.5 { direction = "<" }
            else { direction = "=" }

            var map: [String: Any] = [
                "note": closest.name,
                "pitch": Double(freq),
                "refFreq": closest.refFreq,
                "octave": closest.octave,
                "direction": direction
            ]
            if let t = closest.thickness { map["thickness"] = t }
            if let c = closest.baseColor { map["baseColor"] = c }
            return map
        }

        // стандартное вычисление
        let midiExact = 69 + 12 * log(Double(freq)/440.0)/log(2.0)
        let midi = Int(round(midiExact))
        let noteNames = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
        let noteIndex = midi % 12
        let note = noteNames[noteIndex]
        let octave = midi/12 - 1
        let refFreq = 440.0 * pow(2.0, Double(midi - 69)/12.0)
        let direction: String
        if Double(freq) > refFreq + 0.5 { direction = ">" }
        else if Double(freq) < refFreq - 0.5 { direction = "<" }
        else { direction = "=" }

        return [
            "note": note,
            "pitch": Double(freq),
            "refFreq": refFreq,
            "octave": octave,
            "direction": direction
        ]
    }

    private func estimatePitch(samples: [Float], sampleRate: Double) -> Float {
        let rms = sqrt(samples.map { Double($0*$0) }.reduce(0,+)/Double(samples.count))
        if rms < 0.01 { return 0 }

        let minFreq = 80.0, maxFreq = 1000.0
        let minLag = Int(sampleRate/maxFreq), maxLag = Int(sampleRate/minFreq)
        var bestLag = -1
        var bestCorr = 0.0

        for lag in minLag...maxLag {
            var corr = 0.0
            for i in 0..<(samples.count - lag) {
                corr += Double(samples[i] * samples[i+lag])
            }
            if corr > bestCorr {
                bestCorr = corr
                bestLag = lag
            }
        }
        if bestLag <= 0 { return 0 }

        // параболическая интерполяция
        let prev = max(bestLag-1, minLag)
        let next = min(bestLag+1, maxLag)
        let corrPrev = (0..<(samples.count-prev)).map { Double(samples[$0]*samples[$0+prev]) }.reduce(0,+)
        let corrNext = (0..<(samples.count-next)).map { Double(samples[$0]*samples[$0+next]) }.reduce(0,+)
        let shift = 0.5 * (corrPrev - corrNext) / (corrPrev - 2*bestCorr + corrNext)
        let refinedLag = Double(bestLag) + shift
        return Float(sampleRate/refinedLag)
    }
}
