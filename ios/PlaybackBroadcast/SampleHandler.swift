import AVFoundation
import ReplayKit

/// ReplayKit provides other apps' allowed audio. Video and microphone buffers are ignored.
final class SampleHandler: RPBroadcastSampleHandler {
  private let captureQueue = DispatchQueue(label: "freetune.playback.capture")
  private var store: PlaybackCaptureStore?
  private var request: PlaybackCaptureStore.Request?
  private var timer: DispatchSourceTimer?
  private var samples = [Int16]()
  private var inputFrames: Int64 = 0
  private var outputFrames: Int64 = 0
  private var sampleSum: Float = 0
  private var sampleCount = 0
  private var sampleRate: Double = 0
  private var audible = false
  private var finished = false

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    captureQueue.sync {
      do {
        let shared = try PlaybackCaptureStore.shared()
        guard let pending = shared.request(), shared.isCurrent(pending) else { throw PlaybackCaptureStore.failure("PlaybackCaptureUnavailable") }
        store = shared; request = pending
        samples.reserveCapacity(PlaybackCaptureStore.maximumSamples)
        let deadline = Date().addingTimeInterval(20)
        let timeout = DispatchSource.makeTimerSource(queue: captureQueue)
        timeout.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timeout.setEventHandler { [weak self] in
          guard let self = self, !self.finished else { return }
          if !shared.isCurrent(pending) { self.finish("Cancelled") }
          else if Date() >= deadline { self.finish(self.samples.count >= 32000 ? nil : "PlaybackAudioUnavailable") }
        }
        timer = timeout; timeout.resume()
      } catch { finish("PlaybackCaptureUnavailable") }
    }
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .audioApp else { return }
    // Process synchronously: ReplayKit owns the sample buffer only until this callback returns.
    captureQueue.sync {
      guard !finished, let store = store, let request = request else { return }
      guard store.isCurrent(request) else { finish("Cancelled"); return }
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
        while outputFrames < target, samples.count < PlaybackCaptureStore.maximumSamples {
          samples.append(Int16(max(-32767, min(32767, sampleSum / Float(sampleCount) * 32767))))
          outputFrames += 1
        }
        if before < outputFrames { sampleSum = 0; sampleCount = 0 }
        if samples.count == PlaybackCaptureStore.maximumSamples { finish(nil); break }
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
    var status = error
    if let store = store, let request = request, store.isCurrent(request) {
      do { try store.complete(request, samples: samples, error: error) }
      catch { status = "PlaybackCaptureFailed"; try? store.complete(request, samples: [], error: status) }
    } else { status = error ?? "Cancelled" }
    samples.removeAll(keepingCapacity: false)
    if stopBroadcast {
      // ReplayKit's extension API ends a broadcast via its completion/error callback.
      let message = status == nil
        ? NSLocalizedString("Audio captured. Return to FreeTune to find chords.", comment: "ReplayKit capture complete")
        : NSLocalizedString("Audio capture stopped. Return to FreeTune.", comment: "ReplayKit capture ended")
      let completion = NSError(domain: "FreeTunePlaybackCapture", code: status == nil ? 0 : 1, userInfo: [NSLocalizedDescriptionKey: message])
      DispatchQueue.main.async { self.finishBroadcastWithError(completion) }
    }
  }
}
