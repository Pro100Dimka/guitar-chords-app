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
source = source.replace("SHManagedSession", "TestManagedSession")
source += (root / "ios/PlaybackCaptureStore.swift").read_text(encoding="utf-8").replace("private ", "")
source += ((root / "ios/PlaybackBroadcast/SampleHandler.swift").read_text(encoding="utf-8")
           .replace("import ReplayKit", "").replace("private ", "")
           .replace("SongFingerprintRecognizer().identify(captured, cancelled:", "captureFixture(captured, cancelled:")
           .replace("RecognitionNotice.show(song,", "recordExtensionNotice(song,")
           .replace("DispatchQueue.main.async { self.finishBroadcastWithError(completion) }", "self.finishBroadcastWithError(completion)"))
source += ((root / "ios/OpenRecognitionIntent.swift").read_text(encoding="utf-8").split("@available", 1)[0]
           .replace("import AppIntents", "").replace("import ActivityKit", "").replace("private ", ""))
fixture = r'''
import AVFoundation
import Foundation
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void
enum UIApplication { static let didEnterBackgroundNotification = Notification.Name("background") }
final class TestManagedSession {
  static var feed = true, stopped = 0
  static let signature: SHSignature = {
    let generator = SHSignatureGenerator()
    try! generator.append(pcm(48000, 144000), at: nil)
    return generator.signature()
  }()
  private var cancelled = false
  init(catalog: SHCatalog) {}
  func result() async -> SHSession.Result {
    while !Self.feed && !cancelled { try? await Task.sleep(nanoseconds: 1_000_000) }
    return .noMatch(Self.signature)
  }
  func cancel() { cancelled = true; Self.stopped += 1 }
}
enum RPSampleBufferType { case video, audioApp, audioMic }
class RPBroadcastSampleHandler {
  func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {}
  func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {}
  func broadcastFinished() {}
  var broadcastStopped = false
  func finishBroadcastWithError(_ error: Error) { broadcastStopped = true }
}
let CaptureSessionInterruptionTypeKey = "type"
final class CaptureSession {
  enum InterruptionType: UInt { case ended = 0, began = 1 }
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
  static var expectedSignature: String?
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "amp.shazam.com" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.count += 1
    if let expected = Self.expectedSignature {
      let data = try! JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
      let signature = data["signature"] as! [String: Any]
      precondition(signature["uri"] as? String == expected)
      precondition(signature["samplems"] as? Int == 3000)
    }
    let body = #"{"track":{"title":"Example","subtitle":"Performer","sections":[{"type":"LYRICS","text":["Example words"],"footer":"Source"},{"metadata":[{"title":"BPM","text":"123"}]}]}}"#.data(using: .utf8)!
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: ["Retry-After": "60"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
let extensionReady = DispatchSemaphore(value: 0)
let extensionCaptureLock = NSLock()
var extensionCapture = [Int16]()
var extensionPayload = [AnyHashable: Any]()
var extensionCompletion: (() -> Void)?
func captureFixture(_ samples: [Int16], cancelled: () -> Bool, attach: (URLSessionDataTask) -> Void) throws -> [String: Any]? {
  extensionCaptureLock.lock(); extensionCapture = samples; extensionCaptureLock.unlock()
  return try SongFingerprintRecognizer().identify(samples, cancelled: cancelled, attach: attach)
}
func recordExtensionNotice(_ song: [String: Any]?, requestId: String, error: String?, startedAt: Date, playback: Bool, completion: @escaping () -> Void = {}) {
  let content = RecognitionNotice.content(song, requestId: requestId, error: error, startedAt: startedAt, playback: playback)
  extensionCaptureLock.lock(); extensionPayload = content.userInfo; extensionCompletion = completion; extensionCaptureLock.unlock()
  extensionReady.signal()
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
recognizer.fingerprint.cached.removeAll()
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

if #available(macOS 14.0, *) {
  let signature = TestManagedSession.signature
  let catalog = try running.recognitionCatalog()
  let localCatalogDone = DispatchSemaphore(value: 0)
  Task.detached {
    let result = await SHSession(catalog: catalog).result(from: signature)
    switch result {
    case .noMatch(let captured): precondition(captured.duration >= 2)
    default: fatalError("The local catalog must return the captured query signature without an App ID service")
    }
    localCatalogDone.signal()
  }
  precondition(localCatalogDone.wait(timeout: .now() + 10) == .success)

  HTTPFixture.expectedSignature = "data:audio/vnd.shazam.sig;base64," + (try signature.dataRepresentation()).base64EncodedString()
  let managed = SongRecognition()
  let managedDone = DispatchSemaphore(value: 0)
  managed.control.async {
    managed.startManagedRecognition({ value in
      precondition((value as? [String: Any])?["title"] as? String == "Example")
      managedDone.signal()
    }, rejecter: { code, _, _ in fatalError(code ?? "Managed recognition failed") }, allowsBackground: true)
  }
  precondition(managedDone.wait(timeout: .now() + 5) == .success)
  precondition(TestManagedSession.stopped > 0)
  TestManagedSession.feed = false
  let managedStopped = DispatchSemaphore(value: 0), managedCancelled = DispatchSemaphore(value: 0)
  managed.control.async {
    managed.startManagedRecognition({ _ in fatalError("Cancelled managed session resolved") }, rejecter: { code, _, _ in
      precondition(code == "Cancelled"); managedStopped.signal()
    }, allowsBackground: true)
    managed.cancel({ _ in managedCancelled.signal() }, rejecter: { _, _, _ in fatalError("Managed cancellation failed") })
  }
  precondition(managedStopped.wait(timeout: .now() + 3) == .success)
  precondition(managedCancelled.wait(timeout: .now() + 3) == .success)
  HTTPFixture.expectedSignature = nil
}

// The ReplayKit extension owns capture while the main app is suspended/interrupted.
let independent = RecognitionCapture(allowsBackground: true, ignoresAudioInterruptions: true)
running.control.sync { running.active = independent }
NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
NotificationCenter.default.post(name: CaptureSession.interruptionNotification, object: nil, userInfo: [CaptureSessionInterruptionTypeKey: UInt(1)])
running.control.sync { precondition(!independent.cancelled); running.active = nil }
let foreground = RecognitionCapture()
running.control.sync { running.active = foreground }
NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
running.control.sync { precondition(foreground.cancelled); running.active = nil }

let notificationCapture = RecognitionCapture(allowsBackground: true, ignoresAudioInterruptions: true)
let metadata = ["title": "Example", "artist": "Performer", "source": "Shazam", "lyrics": "Not transferred"]
let notification = RecognitionNotice.content(metadata, requestId: "notice", startedAt: notificationCapture.createdAt, playback: true)
let encodedNotice = try PropertyListSerialization.data(fromPropertyList: notification.userInfo, format: .binary, options: 0)
let decodedNotice = try PropertyListSerialization.propertyList(from: encodedNotice, format: nil) as! [AnyHashable: Any]
notificationCapture.receivePlayback(decodedNotice)
precondition(RecognitionNotice.song(notificationCapture.playbackResult!)?["title"] as? String == "Example")
precondition(RecognitionNotice.song(decodedNotice)?["lyrics"] == nil, "Lyrics unnecessarily enlarge notification metadata")
let oldNotification = RecognitionNotice.content(metadata, requestId: "old", startedAt: Date().addingTimeInterval(-60), playback: true)
let laterCapture = RecognitionCapture(allowsBackground: true, ignoresAudioInterruptions: true)
laterCapture.receivePlayback(oldNotification.userInfo)
precondition(laterCapture.playbackResult == nil, "A stale notification completed a newer capture")
laterCapture.cancel()
laterCapture.receivePlayback(notification.userInfo)
precondition(laterCapture.playbackResult == nil, "A cancelled capture accepted a late result")

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
      let handler = SampleHandler()
      let buffer = broadcastBuffer(rate: rate, common: common, interleaved: interleaved)
      handler.processSampleBuffer(buffer, with: .video)
      handler.processSampleBuffer(buffer, with: .audioMic)
      precondition(handler.samples.isEmpty, "Private video or microphone data was captured")
      for _ in 0..<14 { handler.processSampleBuffer(buffer, with: .audioApp) }
      precondition(extensionReady.wait(timeout: .now() + 10) == .success)
      extensionCaptureLock.lock(); let captured = extensionCapture; let payload = extensionPayload; extensionCaptureLock.unlock()
      precondition(payload["recognitionError"] as? String == "" && handler.finished)
      precondition(!handler.broadcastStopped, "The extension stopped before its notification was scheduled")
      extensionCaptureLock.lock(); let completeNotice = extensionCompletion!; extensionCompletion = nil; extensionCaptureLock.unlock()
      completeNotice()
      precondition(handler.broadcastStopped, "A scheduled notification did not finish the broadcast")
      let song = RecognitionNotice.song(payload)!
      precondition(song["title"] as? String == "Example", "The extension failed to identify audio independently")
      precondition(captured.count == SampleHandler.maximumSamples, "Capture exceeded 12 seconds")
      precondition(captured.allSatisfy { abs(Int($0) - 12287) <= 1 }, "Channel mixing/resampling corrupts the fingerprint input")
      precondition(handler.samples.isEmpty, "Completed audio remains in extension memory")
    }
  }
}
let silentHandler = SampleHandler()
silentHandler.processSampleBuffer(broadcastBuffer(rate: 48000, common: .pcmFormatFloat32, interleaved: false, silent: true), with: .audioApp)
silentHandler.broadcastFinished()
precondition(extensionReady.wait(timeout: .now() + 10) == .success)
extensionCaptureLock.lock(); let silentPayload = extensionPayload; extensionCaptureLock.unlock()
precondition(silentPayload["recognitionError"] as? String == "PlaybackAudioUnavailable", "Protected or silent playback was reported as usable")
let cancelledHandler = SampleHandler()
let audio = broadcastBuffer(rate: 48000, common: .pcmFormatFloat32, interleaved: true)
cancelledHandler.processSampleBuffer(audio, with: .audioApp)
cancelledHandler.capture.cancel()
cancelledHandler.processSampleBuffer(audio, with: .audioApp)
precondition(cancelledHandler.finished && cancelledHandler.samples.isEmpty)
precondition(extensionReady.wait(timeout: .now() + 0.1) == .timedOut, "Cancellation posted a result notification")

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
