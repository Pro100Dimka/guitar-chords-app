import ReplayKit
import UIKit

/// The actual system button remains visible; starting capture always requires the person's tap.
final class PlaybackCaptureViewController: UIViewController, UIAdaptivePresentationControllerDelegate {
  static var broadcastExtension: String? {
    guard let directory = Bundle.main.builtInPlugInsURL,
          let plugins = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return nil }
    return plugins.compactMap { Bundle(url: $0) }.first {
      ($0.infoDictionary?["NSExtension"] as? [String: Any])?["NSExtensionPointIdentifier"] as? String == "com.apple.broadcast-services-upload"
    }?.bundleIdentifier
  }
  var onCancel: (() -> Void)?
  private var completed = false
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let title = UILabel()
    title.font = .preferredFont(forTextStyle: .title2)
    title.text = RecognitionNotice.text("Recognize phone audio", "Распознать звук телефона", "Розпізнати звук телефона")
    let instructions = UILabel()
    instructions.text = RecognitionNotice.text(
      "Tap the broadcast button and choose Start Broadcast, then return to your player. FreeTune will notify you of the result. Tap a found song to open its form. Only audio is used; protected audio may be unavailable.",
      "Нажмите кнопку трансляции и выберите «Начать вещание», затем вернитесь к плееру. FreeTune сообщит результат уведомлением. Нажмите на найденную песню, чтобы открыть форму. Используется только звук; защищённое аудио может быть недоступно.",
      "Натисніть кнопку трансляції та виберіть «Почати трансляцію», потім поверніться до плеєра. FreeTune повідомить результат сповіщенням. Натисніть знайдену пісню, щоб відкрити форму. Використовується лише звук; захищене аудіо може бути недоступне.")
    instructions.font = .preferredFont(forTextStyle: .body)
    for label in [title, instructions] { label.numberOfLines = 0; label.textAlignment = .center; label.adjustsFontForContentSizeCategory = true }
    let picker = RPSystemBroadcastPickerView(frame: .zero)
    picker.preferredExtension = Self.broadcastExtension
    picker.showsMicrophoneButton = false
    let cancel = UIButton(type: .system)
    cancel.setTitle(RecognitionNotice.text("Cancel", "Отмена", "Скасувати"), for: .normal)
    cancel.addTarget(self, action: #selector(cancelCapture), for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [title, instructions, picker, cancel])
    stack.axis = .vertical; stack.spacing = 24; stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll); scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 32),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
      stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48),
      title.widthAnchor.constraint(equalTo: stack.widthAnchor),
      instructions.widthAnchor.constraint(equalTo: stack.widthAnchor),
      picker.widthAnchor.constraint(equalToConstant: 64), picker.heightAnchor.constraint(equalToConstant: 64),
      cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
    ])
    presentationController?.delegate = self
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    presentationController?.delegate = self
  }
  @objc private func cancelCapture() { if !completed { completed = true; onCancel?() }; dismiss(animated: true) }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if !completed { completed = true; onCancel?() }
  }
  func finish() { if !completed { completed = true; dismiss(animated: true) } }
}
