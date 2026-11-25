"""Run the production recognition bridge with deterministic audio and HTTP fixtures."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile


if sys.platform != "darwin":
    raise SystemExit("Requires macOS with Swift and AVFoundation. No checks ran.")
root = Path(__file__).resolve().parent
source = (root / "ios/SongRecognition.swift").read_text(encoding="utf-8")
source = (source.replace("import React", "").replace("import UIKit", "")
          .replace(", RCTBridgeModule", "").replace("@objc(SongRecognition)", "")
          .replace("@objc ", "").replace("private ", "")
          .replace("AVAudioSession", "CaptureSession").replace("AVAudioEngine", "CaptureEngine"))
source += (root / "ios/PlaybackCaptureStore.swift").read_text(encoding="utf-8").replace("private ", "")
source += ((root / "ios/PlaybackBroadcast/SampleHandler.swift").read_text(encoding="utf-8")
           .replace("import ReplayKit", "").replace("private ", ""))
source += ((root / "ios/OpenRecognitionIntent.swift").read_text(encoding="utf-8").split("@available", 1)[0]
           .replace("import AppIntents", "").replace("private ", ""))
fixture = r'''
import AVFoundation
import Foundation
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void
enum UIApplication { static let didEnterBackgroundNotification = Notification.Name("background") }
enum RPSampleBufferType { case video, audioApp, audioMic }
class RPBroadcastSampleHandler {
  func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {}
  func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {}
  func broadcastFinished() {}
  func finishBroadcastWithError(_ error: Error) {}
}
final class CaptureSession {
  enum Category { case playAndRecord }
  enum Mode { case measurement }
  enum Permission { case granted }
  struct Options: OptionSet {
    let rawValue: Int
    static let defaultToSpeaker = Options(rawValue: 1)
    static let allowBluetooth = Options(rawValue: 2)
    static let notifyOthersOnDeactivation = Options(rawValue: 4)
    static let mixWithOthers = Options(rawValue: 8)
    static let allowBluetoothA2DP = Options(rawValue: 16)
  }
  static let interruptionNotification = Notification.Name("interruption")
  static let instance = CaptureSession()
  static func sharedInstance() -> CaptureSession { instance }
  var recordPermission = Permission.granted
  var active = false
  func setCategory(_ category: Category, mode: Mode, options: Options) throws {
    precondition(options.contains(.mixWithOthers), "Recognition interrupts the music player")
    precondition(options.contains(.allowBluetoothA2DP), "Recognition removes stereo Bluetooth output")
    precondition(!options.contains(.allowBluetooth), "Recognition forces the music player onto hands-free audio")
  }
  func setActive(_ value: Bool, options: Options = []) throws { active = value }
}
func pcm(_ rate: Double, _ count: Int) -> AVAudioPCMBuffer {
  let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!, frameCapacity: AVAudioFrameCount(count))!
  buffer.frameLength = AVAudioFrameCount(count)
  for i in 0..<count { buffer.floatChannelData![0][i] = Float(sin(Double(i) * 0.17) * 0.5) }
  return buffer
}
final class CaptureInput {
  var callback: ((AVAudioPCMBuffer, Any?) -> Void)?
  func outputFormat(forBus: Int) -> AVAudioFormat { pcm(48000, 1).format }
  func installTap(onBus: Int, bufferSize: Int, format: AVAudioFormat, block: @escaping (AVAudioPCMBuffer, Any?) -> Void) {
    precondition(callback == nil); callback = block
  }
  func removeTap(onBus: Int) { precondition(callback != nil); callback = nil; CaptureEngine.removed += 1 }
}
final class CaptureEngine {
  static var feed = true, started = 0, removed = 0
  let inputNode = CaptureInput()
  func prepare() {}
  func start() throws {
    Self.started += 1
    if Self.feed { inputNode.callback?(pcm(48000, 144000), nil) }
  }
  func stop() {}
}
final class HTTPFixture: URLProtocol {
  static var count = 0, status = 200
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "amp.shazam.com" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.count += 1
    let body = #"{"track":{"title":"Example","subtitle":"Performer","sections":[{"type":"LYRICS","text":["Example words"],"footer":"Source"},{"metadata":[{"title":"BPM","text":"123"}]}]}}"#.data(using: .utf8)!
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: ["Retry-After": "60"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
URLProtocol.registerClass(HTTPFixture.self)
'''
checks = r'''
for rate in [16000.0, 44100.0, 48000.0] {
  let capture = RecognitionCapture()
  capture.append(pcm(rate, Int(rate) * 2))
  precondition(capture.snapshot(32000)?.count == 32000)
  precondition(capture.snapshot(32001) == nil)
  capture.cancel()
  capture.append(pcm(rate, 4096))
  precondition(capture.snapshot(32001) == nil)
}
let recognizer = SongRecognition()
let samples = (0..<48000).map { Int16(sin(Double($0) * 0.17) * 12000) }
let first = try recognizer.identify(samples, RecognitionCapture())!
precondition(first["title"] as? String == "Example" && first["tempo"] as? Double == 123)
precondition(HTTPFixture.count == 1)
let repeated = try recognizer.identify(samples, RecognitionCapture())
precondition(repeated != nil)
precondition(HTTPFixture.count == 1, "Repeated audio made another network request")
recognizer.cached.removeAll()
HTTPFixture.status = 429
for _ in 0..<2 {
  do { _ = try recognizer.identify(samples, RecognitionCapture()); fatalError("Rate limit ignored") }
  catch { precondition((error as NSError).domain == "RateLimited") }
}
precondition(HTTPFixture.count == 2, "Cooldown made another network request")
let cancelled = RecognitionCapture()
cancelled.cancel()
do { _ = try recognizer.identify(samples, cancelled); fatalError("Cancelled request started") }
catch { precondition((error as NSError).domain == "Cancelled") }
let done = DispatchSemaphore(value: 0)
let running = SongRecognition()
HTTPFixture.status = 200
running.control.async {
  running.recognizeMicrophone({ result in
    precondition((result as? [String: Any])?["title"] as? String == "Example")
    done.signal()
  }, rejecter: { _, message, _ in fatalError(message ?? "Recognition failed") })
}
precondition(done.wait(timeout: .now() + 10) == .success)
precondition(!CaptureSession.instance.active && CaptureEngine.removed == 1)
CaptureEngine.feed = false
let stopped = DispatchSemaphore(value: 0), cancellationDone = DispatchSemaphore(value: 0)
running.control.async {
  running.recognizeMicrophone({ _ in fatalError("Cancelled capture resolved") }, rejecter: { code, _, _ in
    precondition(code == "Cancelled"); stopped.signal()
  })
  running.cancel({ _ in cancellationDone.signal() }, rejecter: { _, _, _ in fatalError("Cancel failed") })
}
precondition(stopped.wait(timeout: .now() + 3) == .success)
precondition(cancellationDone.wait(timeout: .now() + 3) == .success)
precondition(!CaptureSession.instance.active)
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
func audioFile(_ name: String, seconds: Int) throws -> URL {
  let url = directory.appendingPathComponent(name)
  let output = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1])
  try output.write(from: pcm(48000, 48000 * seconds))
  return url
}
let fileURL = try audioFile("recognition.wav", seconds: 3)
let fileRecognizer = SongRecognition()
let beforeFile = HTTPFixture.count
for attempt in 0..<2 {
  let finished = DispatchSemaphore(value: 0)
  fileRecognizer.control.async {
    fileRecognizer.recognizeFile(fileURL.absoluteString, resolver: { value in
      let result = value as! [String: Any]
      precondition(result["title"] as? String == "Example")
      precondition(result["duration"] as? Double == 3)
      precondition(result["tempo"] as? Double == 123)
      precondition(result["lyrics"] as? String == "Example words")
      finished.signal()
    }, rejecter: { code, _, _ in fatalError(code ?? "File recognition failed") })
  }
  precondition(finished.wait(timeout: .now() + 10) == .success)
  precondition(HTTPFixture.count == beforeFile + 1, "File recognition bypassed the cache on attempt \(attempt)")
}
let fileStopped = DispatchSemaphore(value: 0)
let fileCancelled = DispatchSemaphore(value: 0)
fileRecognizer.control.async {
  fileRecognizer.recognizeFile(fileURL.absoluteString, resolver: { _ in fatalError("Cancelled file resolved") }, rejecter: { code, _, _ in
    precondition(code == "Cancelled"); fileStopped.signal()
  })
  fileRecognizer.cancel({ _ in fileCancelled.signal() }, rejecter: { _, _, _ in fatalError("File cancel failed") })
}
precondition(fileStopped.wait(timeout: .now() + 3) == .success)
precondition(fileCancelled.wait(timeout: .now() + 3) == .success)
let invalidDone = DispatchSemaphore(value: 0)
fileRecognizer.control.async {
  fileRecognizer.recognizeFile("https://example.com/audio.mp3", resolver: { _ in fatalError("Remote file accepted") }, rejecter: { code, _, _ in
    precondition(code == "FileUnavailable"); invalidDone.signal()
  })
}
precondition(invalidDone.wait(timeout: .now() + 3) == .success)
let timedOut = RecognitionCapture()
timedOut.attach(NSFileCoordinator(filePresenter: nil))
timedOut.expireReading()
do { try fileRecognizer.check(timedOut); fatalError("File timeout ignored") }
catch { precondition((error as NSError).domain == "FileReadTimeout") }
timedOut.finishReading()
precondition(!CaptureSession.instance.active, "File recognition activated the microphone")

// The ReplayKit extension owns capture while the main app is suspended/interrupted.
let independent = RecognitionCapture(allowsBackground: true)
running.control.sync { running.active = independent }
NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
NotificationCenter.default.post(name: CaptureSession.interruptionNotification, object: nil)
running.control.sync { precondition(!independent.cancelled); running.active = nil }
let foreground = RecognitionCapture()
running.control.sync { running.active = foreground }
NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
running.control.sync { precondition(foreground.cancelled); running.active = nil }

let store = PlaybackCaptureStore(directory: directory.appendingPathComponent("capture"))
let older = try store.begin(), newer = try store.begin()
precondition(!store.isCurrent(older) && store.isCurrent(newer))
store.remove(older)
precondition(store.isCurrent(newer), "Cancelling an old capture revoked a newer request")
do { try store.complete(older, samples: samples); fatalError("Stale capture accepted") }
catch { precondition((error as NSError).domain == "Cancelled") }
try store.complete(newer, samples: samples)
let stored = try store.samples(newer)
precondition(stored == samples, "PCM changed during the extension handoff")
store.remove(newer)
precondition(!store.isCurrent(newer))
let removed = try store.result(newer)
precondition(removed == nil)
let shortRequest = try store.begin()
do { try store.complete(shortRequest, samples: [1]); fatalError("Short capture accepted") }
catch { precondition((error as NSError).domain == "PlaybackAudioUnavailable") }

func broadcastBuffer(rate: Double, common: AVAudioCommonFormat, interleaved: Bool, silent: Bool = false) -> CMSampleBuffer {
  let format = AVAudioFormat(commonFormat: common, sampleRate: rate, channels: 2, interleaved: interleaved)!
  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(rate))!
  buffer.frameLength = buffer.frameCapacity
  for frame in 0..<Int(buffer.frameLength) {
    for channel in 0..<2 {
      let plane = interleaved ? 0 : channel, offset = interleaved ? frame * 2 + channel : frame
      let value: Float = silent ? 0 : channel == 0 ? 0.5 : 0.25
      switch common {
      case .pcmFormatFloat32: buffer.floatChannelData![plane][offset] = value
      case .pcmFormatInt16: buffer.int16ChannelData![plane][offset] = Int16(value * 32768)
      case .pcmFormatInt32: buffer.int32ChannelData![plane][offset] = Int32(value * 2147483648)
      default: fatalError("Unsupported fixture format")
      }
    }
  }
  var result: CMSampleBuffer?
  var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: Int32(rate)), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
  var frameSize = Int(format.streamDescription.pointee.mBytesPerFrame)
  let created = withUnsafePointer(to: &frameSize) { size in
    CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false,
      makeDataReadyCallback: nil, refcon: nil, formatDescription: format.formatDescription,
      sampleCount: Int(buffer.frameLength), sampleTimingEntryCount: 1, sampleTimingArray: &timing,
      sampleSizeEntryCount: interleaved ? 1 : 0, sampleSizeArray: interleaved ? size : nil, sampleBufferOut: &result)
  }
  precondition(created == noErr)
  precondition(CMSampleBufferSetDataBufferFromAudioBufferList(result!, blockBufferAllocator: kCFAllocatorDefault,
    blockBufferMemoryAllocator: kCFAllocatorDefault, flags: 0, bufferList: buffer.audioBufferList) == noErr)
  precondition(CMSampleBufferSetDataReady(result!) == noErr)
  return result!
}
for rate in [16000.0, 44100.0, 48000.0] {
  for common in [AVAudioCommonFormat.pcmFormatFloat32, .pcmFormatInt16, .pcmFormatInt32] {
    for interleaved in [false, true] {
      let request = try store.begin(), handler = SampleHandler()
      handler.store = store; handler.request = request
      let buffer = broadcastBuffer(rate: rate, common: common, interleaved: interleaved)
      handler.processSampleBuffer(buffer, with: .video)
      handler.processSampleBuffer(buffer, with: .audioMic)
      precondition(handler.samples.isEmpty, "Private video or microphone data was captured")
      for _ in 0..<14 { handler.processSampleBuffer(buffer, with: .audioApp) }
      let result = try store.result(request), captured = try store.samples(request)
      precondition(result?.error == nil && handler.finished)
      precondition(captured.count == PlaybackCaptureStore.maximumSamples, "Capture exceeded 12 seconds")
      precondition(captured.allSatisfy { abs(Int($0) - 12287) <= 1 }, "Channel mixing/resampling corrupts the fingerprint input")
      precondition(handler.samples.isEmpty, "Completed audio remains in extension memory")
      store.remove(request)
    }
  }
}
let silentRequest = try store.begin(), silentHandler = SampleHandler()
silentHandler.store = store; silentHandler.request = silentRequest
silentHandler.processSampleBuffer(broadcastBuffer(rate: 48000, common: .pcmFormatFloat32, interleaved: false, silent: true), with: .audioApp)
silentHandler.broadcastFinished()
let silentResult = try store.result(silentRequest)
precondition(silentResult?.error == "PlaybackAudioUnavailable", "Protected or silent playback was reported as a usable capture")
store.remove(silentRequest)
let cancelledRequest = try store.begin(), cancelledHandler = SampleHandler()
cancelledHandler.store = store; cancelledHandler.request = cancelledRequest
let audio = broadcastBuffer(rate: 48000, common: .pcmFormatFloat32, interleaved: true)
cancelledHandler.processSampleBuffer(audio, with: .audioApp)
store.remove(cancelledRequest)
let following = try store.begin()
cancelledHandler.processSampleBuffer(audio, with: .audioApp)
let followingResult = try store.result(following)
precondition(cancelledHandler.finished && cancelledHandler.samples.isEmpty && followingResult == nil && store.isCurrent(following))
store.remove(following)

RecognitionLaunch.open("playback")
let firstLaunch = RecognitionLaunch.consume()!
precondition(firstLaunch.hasPrefix("freetune://recognize/playback?autoStart=true&requestId="))
precondition(RecognitionLaunch.consume() == nil, "Cold launch replayed the same shortcut")
RecognitionLaunch.open("playback")
precondition(RecognitionLaunch.consume() != firstLaunch, "Repeated controls share the same request ID")
RecognitionLaunch.open("mic")
UserDefaults.standard.set(Date().addingTimeInterval(-180), forKey: RecognitionLaunch.createdKey)
precondition(RecognitionLaunch.consume() == nil, "An expired shortcut auto-started recognition")
print("Production iOS recognition passed: microphone mixing, PCM rates, metadata/cache/HTTP 429, cancellation/cleanup, WAV decoding, ReplayKit background lifecycle, bounded stereo PCM handoff across 18 format/rate combinations, silence/private buffer rejection, stale session cancellation, and Control Center launch consumption.")
'''
subprocess.run(["cargo", "build", "--release", "--locked", "--lib", "--manifest-path",
                str(root / "android/song-fingerprint/Cargo.toml")], check=True)
target = Path(os.environ.get("CARGO_TARGET_DIR", root / "android/song-fingerprint/target"))
with tempfile.TemporaryDirectory(prefix="freetune-recognition-") as directory:
    temporary = Path(directory)
    (temporary / "Probe.swift").write_text(fixture + source + checks, encoding="utf-8")
    (temporary / "Bridge.h").write_text("#include <stdint.h>\nchar *freetune_fingerprint(const int16_t *, uintptr_t);\nvoid freetune_fingerprint_free(char *);\n", encoding="utf-8")
    subprocess.run(["swiftc", str(temporary / "Probe.swift"), "-import-objc-header", str(temporary / "Bridge.h"),
                    str(target / "release/libfreetune_song_fingerprint.a"), "-o", str(temporary / "probe")], check=True)
    subprocess.run([str(temporary / "probe"), str(temporary / "audio")], check=True, timeout=60)
