import AVFoundation
import ReplayKit

/// ReplayKit provides other apps' allowed audio. Video and microphone buffers are ignored.
final class SampleHandler: RPBroadcastSampleHandler {
  private let captureQueue = DispatchQueue(label: "freetune.playback.capture")
  private let recognitionQueue = DispatchQueue(label: "freetune.playback.recognition", qos: .userInitiated)
  private let capture = RecognitionCapture(allowsBackground: true, ignoresAudioInterruptions: true)
  private let requestId = UUID().uuidString
  private var startedAt = Date()
  private static let maximumSamples = 12 * 16000
  private var timer: DispatchSourceTimer?
  private var samples = [Int16]()
  private var inputFrames: Int64 = 0
  private var outputFrames: Int64 = 0
  private var sampleSum: Float = 0
  private var sampleCount = 0
  private var sampleRate: Double = 0
  private var audible = false
  private var finished = false

  override init() {
    super.init()
    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
      guard let observer = observer else { return }
      let handler = Unmanaged<SampleHandler>.fromOpaque(observer).takeUnretainedValue()
      handler.capture.cancel()
      handler.captureQueue.async { handler.finish("Cancelled") }
    }, RecognitionNotice.cancellationName, nil, .deliverImmediately)
  }
  deinit {
    timer?.cancel()
    capture.cancel()
    CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), CFNotificationName(rawValue: RecognitionNotice.cancellationName), nil)
  }
  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    captureQueue.sync {
      startedAt = Date()
      samples.reserveCapacity(Self.maximumSamples)
      let deadline = startedAt.addingTimeInterval(20)
      let timeout = DispatchSource.makeTimerSource(queue: captureQueue)
      timeout.schedule(deadline: .now() + 0.25, repeating: 0.25)
      timeout.setEventHandler { [weak self] in
        guard let self = self, !self.finished else { return }
        if self.capture.cancelled { self.finish("Cancelled") }
        else if Date() >= deadline { self.finish(self.samples.count >= 32000 ? nil : "PlaybackAudioUnavailable") }
      }
      timer = timeout; timeout.resume()
    }
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .audioApp else { return }
    // Process synchronously: ReplayKit owns the sample buffer only until this callback returns.
    captureQueue.sync {
      guard !finished else { return }
      guard !capture.cancelled else { finish("Cancelled"); return }
      guard let description = CMSampleBufferGetFormatDescription(sampleBuffer),
            let stream = CMAudioFormatDescriptionGetStreamBasicDescription(description),
            let format = AVAudioFormat(streamDescription: stream) else { finish("PlaybackCaptureFailed"); return }
      let frames = CMSampleBufferGetNumSamples(sampleBuffer)
      guard (1...65536).contains(frames), format.sampleRate.isFinite, (8000...192000).contains(format.sampleRate),
            (1...8).contains(format.channelCount), [.pcmFormatFloat32, .pcmFormatInt16, .pcmFormatInt32].contains(format.commonFormat),
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { finish("PlaybackCaptureFailed"); return }
      buffer.frameLength = AVAudioFrameCount(frames)
      guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sampleBuffer, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList) == noErr else {
        finish("PlaybackCaptureFailed"); return
      }
      // Reset the resampling phase if ReplayKit changes the output route/rate.
      if sampleRate != format.sampleRate { sampleRate = format.sampleRate; inputFrames = 0; outputFrames = 0; sampleSum = 0; sampleCount = 0 }
      let channels = Int(format.channelCount)
      for frame in 0..<frames {
        var mono: Float = 0
        for channel in 0..<channels {
          let plane = format.isInterleaved ? 0 : channel
          let offset = format.isInterleaved ? frame * channels + channel : frame
          switch format.commonFormat {
          case .pcmFormatFloat32: mono += buffer.floatChannelData![plane][offset]
          case .pcmFormatInt16: mono += Float(buffer.int16ChannelData![plane][offset]) / 32768
          case .pcmFormatInt32: mono += Float(buffer.int32ChannelData![plane][offset]) / 2147483648
          default: break
          }
        }
        mono /= Float(channels)
        if !mono.isFinite { mono = 0 }
        if !audible { audible = abs(mono) > 0.002; if !audible { continue } }
        sampleSum += mono; sampleCount += 1; inputFrames += 1
        let target = Int64(Double(inputFrames) * 16000 / sampleRate)
        let before = outputFrames
        while outputFrames < target, samples.count < Self.maximumSamples {
          samples.append(Int16(max(-32767, min(32767, sampleSum / Float(sampleCount) * 32767))))
          outputFrames += 1
        }
        if before < outputFrames { sampleSum = 0; sampleCount = 0 }
        if samples.count == Self.maximumSamples { finish(nil); break }
      }
    }
  }

  override func broadcastFinished() {
    captureQueue.sync { if !finished { finish(samples.count >= 32000 ? nil : "PlaybackAudioUnavailable", stopBroadcast: false) } }
  }
  private func finish(_ error: String?, stopBroadcast: Bool = true) {
    guard !finished else { return }
    finished = true
    timer?.cancel(); timer = nil
    let captured = samples
    samples.removeAll(keepingCapacity: false)
    recognitionQueue.async {
      var status = error
      var song: [String: Any]?
      if error == nil {
        do {
          song = try SongFingerprintRecognizer().identify(captured, cancelled: { self.capture.cancelled }, attach: { self.capture.attach($0) })
        } catch { status = (error as NSError).domain }
      }
      let finishBroadcast = {
        guard stopBroadcast else { return }
        let message = RecognitionNotice.content(song, requestId: self.requestId, error: status).body
        let completion = NSError(domain: "FreeTunePlaybackCapture", code: status == nil ? 0 : 1, userInfo: [NSLocalizedDescriptionKey: message])
        DispatchQueue.main.async { self.finishBroadcastWithError(completion) }
      }
      if self.capture.cancelled { finishBroadcast() }
      else { RecognitionNotice.show(song, requestId: self.requestId, error: status, startedAt: self.startedAt, playback: true, completion: finishBroadcast) }
    }
  }
}
