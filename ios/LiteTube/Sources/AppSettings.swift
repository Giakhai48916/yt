import Foundation
import WebKit

/// Quản lý cài đặt cấu hình cho LiteTube iOS lưu trữ qua UserDefaults
/// và xuất JSON đồng bộ xuống tầng Web Scriptlets (`window.__bravePip.applySettings(...)`).
final class AppSettings {
    static let shared = AppSettings()

    private let defaults = UserDefaults.standard
    private let keyAdBlock = "adblock_enabled"
    private let keyBackgroundPlay = "background_play_enabled"
    private let keyAutoPip = "auto_pip_enabled"
    private let keyPreloadCache = "preload_cache_enabled"

    static let sleepTimerOff = 0
    static let sleepTimerEndOfVideo = -1

    var sleepTimerMode: Int = AppSettings.sleepTimerOff
    var sleepTimerTargetDate: Date?

    private init() {
        defaults.register(defaults: [
            keyAdBlock: true,
            keyBackgroundPlay: true,
            keyAutoPip: true,
            keyPreloadCache: true
        ])
    }

    var isAdBlockEnabled: Bool {
        get { defaults.bool(forKey: keyAdBlock) }
        set { defaults.set(newValue, forKey: keyAdBlock) }
    }

    var isBackgroundPlayEnabled: Bool {
        get { defaults.bool(forKey: keyBackgroundPlay) }
        set { defaults.set(newValue, forKey: keyBackgroundPlay) }
    }

    var isAutoPipEnabled: Bool {
        get { defaults.bool(forKey: keyAutoPip) }
        set { defaults.set(newValue, forKey: keyAutoPip) }
    }

    var isPreloadCacheEnabled: Bool {
        get { defaults.bool(forKey: keyPreloadCache) }
        set { defaults.set(newValue, forKey: keyPreloadCache) }
    }

    func getSleepTimerLabel() -> String {
        if sleepTimerMode == AppSettings.sleepTimerEndOfVideo {
            return "Khi hết video"
        } else if sleepTimerMode > 0 {
            if let target = sleepTimerTargetDate {
                let remaining = Int(ceil(target.timeIntervalSinceNow / 60.0))
                if remaining > 0 {
                    return "Sau \(remaining) phút"
                }
            }
            return "Sau \(sleepTimerMode) phút"
        }
        return "Không"
    }

    func toJsonString() -> String {
        let dict: [String: Any] = [
            "adblock": isAdBlockEnabled,
            "backgroundPlay": isBackgroundPlayEnabled,
            "autoPip": isAutoPipEnabled,
            "preloadCache": isPreloadCacheEnabled,
            "sleepTimerMode": sleepTimerMode,
            "stopAtVideoEnd": sleepTimerMode == AppSettings.sleepTimerEndOfVideo
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return "{\"adblock\":true,\"backgroundPlay\":true,\"autoPip\":true}"
        }
        return str
    }

    func clearWebCache(completion: @escaping () -> Void) {
        URLCache.shared.removeAllCachedResponses()
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        // Giữ lại cookies đăng nhập tài khoản YouTube, chỉ xóa bộ nhớ đệm mạng & disk cache
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeOfflineWebApplicationCache,
            WKWebsiteDataTypeFetchCache
        ]
        WKWebsiteDataStore.default().removeData(
            ofTypes: cacheTypes.intersection(dataTypes),
            modifiedSince: Date(timeIntervalSince1970: 0),
            completionHandler: completion
        )
    }

    func formattedCacheSize() -> String {
        let bytes = URLCache.shared.currentDiskUsage + URLCache.shared.currentMemoryUsage
        let mb = Double(bytes) / (1024.0 * 1024.0)
        return String(format: "%.1f MB", mb)
    }
}
