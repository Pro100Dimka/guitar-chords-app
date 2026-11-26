import AVFoundation
import Foundation
import React

@objc(OfflineChordAnalysis)
final class OfflineChordAnalysis: NSObject, RCTBridgeModule {
  static func moduleName() -> String! { "OfflineChordAnalysis" }
  @objc static func requiresMainQueueSetup() -> Bool { false }
  private let control = DispatchQueue(label: "chord.analysis.control")
  private let worker = DispatchQueue(label: "chord.analysis.worker", qos: .userInitiated)
  @objc var methodQueue: DispatchQueue! { control }
  private let fileWorkers: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "chord.analysis.files"
    queue.qualityOfService = .userInitiated
    queue.maxConcurrentOperationCount = 2
    return queue
  }()
  private var active: ChordAnalysisSession?
  private var invalidated = false

  @objc func analyzeFile(_ uri: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard !invalidated else { reject("AnalysisUnsupported", "Module unavailable", nil); return }
    guard active == nil, fileWorkers.operationCount < 4 else { reject("Busy", "Analysis is already running", nil); return }
    guard let url = URL(string: uri), url.isFileURL else {
      reject("FileUnavailable", "Choose a local audio file", nil); return
    }
    let started = ProcessInfo.processInfo.systemUptime
    let session = ChordAnalysisSession()
    active = session
    let operation = BlockOperation {
      session.didStart()
      let scoped = url.startAccessingSecurityScopedResource()
      var result: [String: Any]?
      var failure: Error?
      do {
        try session.check()
        let coordinator = NSFileCoordinator(filePresenter: nil)
        session.attach(coordinator)
        var coordinationError: NSError?
        coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { localURL in
          do { result = try Self.decodeFile(localURL, session: session) }
          catch { failure = error }
        }
        try session.check()
        if let failure = failure { throw failure }
        guard coordinationError == nil, result != nil else { throw Self.error("FileUnavailable") }
        result?["elapsedMs"] = (ProcessInfo.processInfo.systemUptime - started) * 1000
      } catch { failure = error }
      session.detach()
      if scoped { url.stopAccessingSecurityScopedResource() }
      session.complete(result, error: failure)
    }
    session.attach(operation)
    fileWorkers.addOperation(operation)
    worker.async {
      var result: [String: Any]?
      var failure: Error?
      do { result = try session.awaitResult() } catch { failure = error }
      self.control.async {
        // An abandoned provider owns only its session and cannot publish a late result.
        if self.active === session { self.active = nil }
        do { try session.check() } catch { failure = error }
        if let failure = failure {
          let code = (failure as NSError).domain
          let known = ["Cancelled", "Busy", "FileReadTimeout", "FileUnavailable", "AudioTooShort", "AudioTooLong", "UnsupportedAudio", "UnsupportedPcmFormat", "AudioAnalysisFailed"]
          let message = known.contains(code) ? code : "AudioDecodeFailed"
          reject(message, message, failure)
        } else { resolve(result) }
      }
    }
  }

  @objc func cancel(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session = active else { resolve(nil); return }
    session.stop()
    // Wait for logical detachment. A blocked provider retains its own core until cleanup.
    worker.async { self.control.async { resolve(nil) } }
  }

  @objc func invalidate() {
    control.async {
      self.invalidated = true
      self.active?.stop()
      self.fileWorkers.cancelAllOperations()
    }
  }
  deinit { active?.stop(); fileWorkers.cancelAllOperations() }

  private static func error(_ code: String) -> NSError { NSError(domain: code, code: 1) }

  private static func decodeFile(_ url: URL, session: ChordAnalysisSession) throws -> [String: Any] {
    try session.check()
    let audio = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
    let format = audio.processingFormat
    guard format.sampleRate.isFinite, (8000...384000).contains(format.sampleRate),
          (1...32).contains(format.channelCount), audio.length > 0,
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else {
      throw error("UnsupportedAudio")
    }
    let duration = Double(audio.length) / format.sampleRate
    guard duration <= 900 else { throw error("AudioTooLong") }
    guard duration >= 1 else { throw error("AudioTooShort") }
    guard let analyzer = freetune_chords_new() else { throw error("AudioAnalysisFailed") }
    defer { freetune_chords_free(analyzer) }
    let stream = ChordPCMStream(rate: format.sampleRate) { samples, count in
      try session.check()
      let status = samples.withUnsafeBufferPointer { freetune_chords_push(analyzer, $0.baseAddress, UInt(count)) }
      if status == 1 { throw error("AudioTooLong") }
      guard status == 0 else { throw error("AudioAnalysisFailed") }
    }
    while audio.framePosition < audio.length {
      try session.check()
      try audio.read(into: buffer, frameCount: 4096)
      guard buffer.frameLength > 0 else { throw error("AudioDecodeFailed") }
      guard let samples = buffer.floatChannelData else { throw error("UnsupportedPcmFormat") }
      for frame in 0..<Int(buffer.frameLength) {
        if (frame & 2047) == 0 { try session.check() }
        var mono = 0.0
        for channel in 0..<Int(format.channelCount) {
          let value = Double(samples[channel][frame])
          guard value.isFinite else { throw error("UnsupportedPcmFormat") }
          mono += value
        }
        try stream.append(mono / Double(format.channelCount) * 32768)
      }
    }
    try stream.finish()
    try session.check()
    guard stream.outputFrames >= 16000 else { throw error("AudioTooShort") }
    guard let pointer = freetune_chords_finish(analyzer) else { throw error("AudioAnalysisFailed") }
    defer { freetune_fingerprint_free(pointer) }
    guard let json = String(validatingUTF8: pointer), let data = json.data(using: .utf8),
          let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw error("AudioAnalysisFailed")
    }
    try session.check()
    return result
  }
}

private final class ChordAnalysisSession {
  private static let cancellation = DispatchQueue(label: "chord.analysis.cancel")
  private let lock = NSLock()
  private let started = DispatchSemaphore(value: 0)
  private let completed = DispatchSemaphore(value: 0)
  private var failureCode: String?
  private var coordinator: NSFileCoordinator?
  private weak var operation: BlockOperation?
  private var result: [String: Any]?
  private var failure: Error?

  func check() throws {
    lock.lock()
    let code = failureCode
    lock.unlock()
    if let code = code { throw NSError(domain: code, code: 1) }
  }

  func stop(code: String = "Cancelled") {
    lock.lock()
    guard failureCode == nil else { lock.unlock(); return }
    failureCode = code
    let pending = coordinator
    let task = operation
    lock.unlock()
    task?.cancel()
    started.signal()
    completed.signal()
    if let pending = pending { Self.cancellation.async { pending.cancel() } }
  }

  func attach(_ value: NSFileCoordinator) {
    lock.lock()
    coordinator = value
    let stopped = failureCode != nil
    lock.unlock()
    if stopped { value.cancel() }
  }

  func attach(_ value: BlockOperation) {
    lock.lock()
    operation = value
    let stopped = failureCode != nil
    lock.unlock()
    if stopped { value.cancel() }
  }

  func didStart() { started.signal() }
  func detach() { lock.lock(); coordinator = nil; lock.unlock() }

  func complete(_ value: [String: Any]?, error: Error?) {
    lock.lock()
    if failureCode == nil { result = value; failure = error }
    lock.unlock()
    completed.signal()
  }

  func awaitResult() throws -> [String: Any] {
    if started.wait(timeout: .now() + 1) != .success { stop(code: "Busy") }
    try check()
    if completed.wait(timeout: .now() + 180) != .success { stop(code: "FileReadTimeout") }
    try check()
    lock.lock()
    let value = result
    let error = failure
    lock.unlock()
    if let error = error { throw error }
    guard let value = value else { throw NSError(domain: "AudioDecodeFailed", code: 1) }
    return value
  }
}

/** Retains fractional source/output timing across AVAudioFile chunks. */
private final class ChordPCMStream {
  private let rate: Double
  private let push: ([Int16], Int) throws -> Void
  private var buffer = [Int16](repeating: 0, count: 4096)
  private var count = 0
  private var sourceFrames: Int64 = 0
  private var sum = 0.0
  private var averaged = 0
  private(set) var outputFrames: Int64 = 0

  init(rate: Double, push: @escaping ([Int16], Int) throws -> Void) { self.rate = rate; self.push = push }

  func append(_ sample: Double) throws {
    sourceFrames += 1
    guard Double(sourceFrames) <= rate * 900 else { throw NSError(domain: "AudioTooLong", code: 1) }
    sum += sample
    averaged += 1
    let target = Int64(Double(sourceFrames) * 16000 / rate)
    if target > outputFrames {
      let value = Int16(max(-32768, min(32767, (sum / Double(averaged)).rounded())))
      while outputFrames < target {
        buffer[count] = value
        count += 1
        outputFrames += 1
        if count == buffer.count { try push(buffer, count); count = 0 }
      }
      sum = 0
      averaged = 0
    }
  }

  func finish() throws { if count > 0 { try push(buffer, count); count = 0 } }
}
