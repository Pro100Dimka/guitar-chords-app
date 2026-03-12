import AVFoundation
import Accelerate
// ios/MicrophoneStream.swift
import Foundation
import React

@objc(MicrophoneStream)
class MicrophoneStream: RCTEventEmitter {

    static let BUF_PER_SEC = 15
    private let sampleRate: Double = 44100.0

    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var isRecording = false

    private var pitchHistory: [Float] = []
    private var targetNotes: [NoteSpec] = []

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
        targetNotes = list
    }

    @objc
    func startRecording() {
        if isRecording { return }

        audioEngine = AVAudioEngine()
        inputNode = audioEngine?.inputNode
        guard let inputNode = inputNode else { return }

        let format = inputNode.outputFormat(forBus: 0)
        let bufferSize = AVAudioFrameCount(max(sampleRate / Double(Self.BUF_PER_SEC), 2048))

        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: format) {
            [weak self] buffer, _ in
            guard let self = self else { return }
            let channelData = buffer.floatChannelData![0]
            let floatData = Array(
                UnsafeBufferPointer(start: channelData, count: Int(buffer.frameLength)))

            let rms = sqrt(floatData.map { $0 * $0 }.reduce(0, +) / Float(floatData.count))
            if rms < 0.02 {
                self.pitchHistory.removeAll()
                self.sendEvent(
                    "onAudioBuffer",
                    body: [
                        "samples": floatData.map { Double($0) },
                        "rms": Double(rms),
                        "note": "Silence",
                        "pitch": 0.0,
                        "refFreq": 0.0,
                        "octave": 0,
                        "direction": "=",
                    ])
                return
            }

            let rawPitch = self.estimatePitchFFT(floatData, sampleRate: self.sampleRate)
            let pitch = self.smoothPitch(rawPitch)
            var noteData = self.frequencyToNoteData(pitch)
            noteData["samples"] = floatData.map { Double($0) }
            noteData["rms"] = Double(rms)
            self.sendEvent("onAudioBuffer", body: noteData)
        }

        do {
            try audioEngine?.start()
            isRecording = true
        } catch {
            print("AudioEngine start error: \(error)")
        }
    }

    @objc
    func stopRecording() {
        isRecording = false
        inputNode?.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        pitchHistory.removeAll()
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

    private func smoothPitch(_ pitch: Float) -> Float {
        if pitch > 0 {
            if pitchHistory.count >= 15 { pitchHistory.removeFirst() }
            pitchHistory.append(pitch)
        }
        return pitchHistory.isEmpty ? 0 : pitchHistory.reduce(0, +) / Float(pitchHistory.count)
    }

    private func frequencyToNoteData(_ freq: Float) -> [String: Any] {
        var map: [String: Any] = [:]
        if freq <= 20 || freq > 5000 || freq.isNaN || freq.isInfinite {
            map["note"] = "Silence"
            map["pitch"] = 0.0
            map["refFreq"] = 0.0
            map["octave"] = 0
            map["direction"] = "="
            pitchHistory.removeAll()
            return map
        }

        if let closest = targetNotes.min(by: {
            abs(freq - Float($0.refFreq)) < abs(freq - Float($1.refFreq))
        }) {
            let direction: String
            if freq > Float(closest.refFreq) + 0.5 {
                direction = ">"
            } else if freq < Float(closest.refFreq) - 0.5 {
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
        let direction: String
        if Double(freq) > refFreq + 0.5 {
            direction = ">"
        } else if Double(freq) < refFreq - 0.5 {
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
    // Новый метод pitch через FFT
    private func estimatePitchFFT(_ buffer: [Float], sampleRate: Double) -> Float {
        let n = buffer.count
        guard n > 0 else { return 0 }

        let log2n = vDSP_Length(log2(Float(n)))
        var realp = [Float](repeating: 0, count: n / 2)
        var imagp = [Float](repeating: 0, count: n / 2)
        var output = DSPSplitComplex(realp: &realp, imagp: &imagp)

        buffer.withUnsafeBufferPointer { ptr in
            ptr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: n) { complexPtr in
                if let fftSetup = vDSP_create_fftsetup(log2n, Int32(kFFTRadix2)) {
                    vDSP_ctoz(complexPtr, 2, &output, 1, vDSP_Length(n / 2))
                    vDSP_fft_zrip(fftSetup, &output, 1, log2n, Int32(FFT_FORWARD))
                    vDSP_destroy_fftsetup(fftSetup)
                }
            }
        }

        // Амплитуды спектра
        var magnitudes = [Float](repeating: 0.0, count: n / 2)
        vDSP_zvmags(&output, 1, &magnitudes, 1, vDSP_Length(n / 2))

        // Находим индекс максимальной амплитуды
        var maxMag: Float = 0
        var maxIndex: vDSP_Length = 0
        vDSP_maxvi(magnitudes, 1, &maxMag, &maxIndex, vDSP_Length(n / 2))

        // Интерполяция пика (parabolic interpolation)
        let i = Int(maxIndex)
        if i > 0 && i < magnitudes.count - 1 {
            let alpha = magnitudes[i - 1]
            let beta = magnitudes[i]
            let gamma = magnitudes[i + 1]
            let p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma)
            let refinedIndex = Float(i) + Float(p)
            let freq = refinedIndex * Float(sampleRate) / Float(n)

            // Проверка на гармоники: если частота слишком высокая, попробуем делить на 2
            if freq > 1000 {
                return freq / 2
            }
            return freq
        }

        // Если интерполяция невозможна — обычный расчёт
        let freq = Float(maxIndex) * Float(sampleRate) / Float(n)
        return freq > 1000 ? freq / 2 : freq
    }

    // MARK: - RCTEventEmitter

    override func supportedEvents() -> [String]! {
        return ["onAudioBuffer"]
    }

    private func sendEvent(_ name: String, body: [String: Any]) {
        self.sendEvent(withName: name, body: body)
    }
}
