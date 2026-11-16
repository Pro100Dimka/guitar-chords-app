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
fixture = r'''
import AVFoundation
import Foundation
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void
enum UIApplication { static let didEnterBackgroundNotification = Notification.Name("background") }
final class CaptureSession {
  enum Category { case playAndRecord }
  enum Mode { case measurement }
  enum Permission { case granted }
  struct Options: OptionSet {
    let rawValue: Int
    static let defaultToSpeaker = Options(rawValue: 1)
    static let allowBluetoothHFP = Options(rawValue: 2)
    static let notifyOthersOnDeactivation = Options(rawValue: 4)
  }
  static let interruptionNotification = Notification.Name("interruption")
  static let instance = CaptureSession()
  static func sharedInstance() -> CaptureSession { instance }
  var recordPermission = Permission.granted
  var active = false
  func setCategory(_ category: Category, mode: Mode, options: Options) throws {}
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
    let body = #"{"track":{"title":"Example","subtitle":"Performer","sections":[{"metadata":[{"title":"BPM","text":"123"}]}]}}"#.data(using: .utf8)!
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
print("Production iOS recognition passed: PCM rates, metadata, cached audio, HTTP 429, cancellation and microphone cleanup.")
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
    subprocess.run([str(temporary / "probe")], check=True, timeout=30)
