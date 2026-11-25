import ReplayKit
import UIKit

/// The actual system button remains visible; starting capture always requires the person's tap.
final class PlaybackCaptureViewController: UIViewController, UIAdaptivePresentationControllerDelegate {
  var onCancel: (() -> Void)?
  private var completed = false
  private static var language: String { Locale.preferredLanguages.first?.prefix(2).lowercased() ?? "en" }
  static func text(_ en: String, _ ru: String, _ uk: String) -> String {
    language == "ru" ? ru : language == "uk" ? uk : en
  }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let title = UILabel()
    title.font = .preferredFont(forTextStyle: .title2)
    title.text = Self.text("Recognize phone audio", "Распознать звук телефона", "Розпізнати звук телефона")
    let instructions = UILabel()
    instructions.text = Self.text(
      "Tap the broadcast button and choose Start Broadcast. Return to your player for up to 20 seconds, then return to FreeTune. Only audio is used; protected audio may be unavailable.",
      "Нажмите кнопку трансляции и выберите «Начать вещание». Перейдите к плееру на 20 секунд, затем вернитесь в FreeTune. Используется только звук; защищённое аудио может быть недоступно.",
      "Натисніть кнопку трансляції та виберіть «Почати трансляцію». Перейдіть до плеєра на 20 секунд, потім поверніться у FreeTune. Використовується лише звук; захищене аудіо може бути недоступне.")
    instructions.font = .preferredFont(forTextStyle: .body)
    for label in [title, instructions] { label.numberOfLines = 0; label.textAlignment = .center; label.adjustsFontForContentSizeCategory = true }
    let picker = RPSystemBroadcastPickerView(frame: .zero)
    picker.preferredExtension = "com.freetune.PlaybackBroadcast"
    picker.showsMicrophoneButton = false
    let cancel = UIButton(type: .system)
    cancel.setTitle(Self.text("Cancel", "Отмена", "Скасувати"), for: .normal)
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
  @objc private func cancelCapture() { if !completed { completed = true; onCancel?() }; dismiss(animated: true) }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if !completed { completed = true; onCancel?() }
  }
  func finish() { if !completed { completed = true; dismiss(animated: true) } }
}
