import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var window: UIWindow?
  var tablatureLandscape = false

  func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
    tablatureLandscape ? .landscapeRight : .allButUpsideDown
  }

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  private var recognitionLaunchObserver: NSObjectProtocol?

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if let requestId = response.notification.request.content.userInfo["recognitionRequestId"] as? String {
      RecognitionLaunch.open("result", requestId: requestId)
    }
    completionHandler()
  }

  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    RCTLinkingManager.application(app, open: url, options: options)
  }

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "freetune",
      in: window,
      launchOptions: launchOptions
    )

    recognitionLaunchObserver = NotificationCenter.default.addObserver(forName: RecognitionLaunch.notification, object: nil, queue: .main) { notification in
      guard let value = notification.object as? String, let url = URL(string: value) else { return }
      _ = RCTLinkingManager.application(application, open: url, options: [:])
    }

    return true
  }
}

@objc(ScreenOrientation)
class ScreenOrientation: NSObject, RCTInvalidating {
  private var previousOrientation: UIInterfaceOrientationMask = .portrait
  private var locked = false
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func setLandscape(_ enabled: Bool) {
    DispatchQueue.main.async {
      if !enabled && !self.locked { return }
      guard let delegate = UIApplication.shared.delegate as? AppDelegate,
            let window = delegate.window,
            let scene = window.windowScene else { return }
      if enabled && !self.locked {
        self.previousOrientation = scene.interfaceOrientation.isLandscape ? .landscape : .portrait
      }
      self.locked = enabled
      delegate.tablatureLandscape = enabled
      if #available(iOS 16.0, *) {
        window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        window.rootViewController?.presentedViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: enabled ? .landscapeRight : self.previousOrientation))
      }
    }
  }

  @objc func invalidate() { setLandscape(false) }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
