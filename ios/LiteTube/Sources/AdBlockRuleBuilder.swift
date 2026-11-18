import Foundation
import WebKit

/// Bộ lọc quảng cáo Native iOS dựa trên WKContentRuleListStore (tương tự Brave iOS):
/// Biên dịch danh sách domain & đường dẫn quảng cáo thành bytecode của WebKit để chặn ngay từ tầng mạng 0ms.
final class AdBlockRuleBuilder {

    static func compileContentRuleList(completion: @escaping (WKContentRuleList?) -> Void) {
        let rulesJson = buildRulesJson()
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "LiteTubeAdBlockRules",
            encodedContentRuleList: rulesJson
        ) { ruleList, error in
            if let error = error {
                print("[LiteTube] Lỗi biên dịch WKContentRuleList: \(error)")
            }
            completion(ruleList)
        }
    }

    private static func buildRulesJson() -> String {
        let urlPatterns = [
            "googleads\\\\.g\\\\.doubleclick\\\\.net",
            "pagead2\\\\.googlesyndication\\\\.com",
            "ad\\\\.doubleclick\\\\.net",
            "static\\\\.doubleclick\\\\.net",
            "securepubads\\\\.g\\\\.doubleclick\\\\.net",
            "stats\\\\.g\\\\.doubleclick\\\\.net",
            "pubads\\\\.g\\\\.doubleclick\\\\.net",
            "www\\\\.google-analytics\\\\.com",
            "ssl\\\\.google-analytics\\\\.com",
            "adservice\\\\.google\\\\.",
            "ade\\\\.googlesyndication\\\\.com",
            "tpc\\\\.googlesyndication\\\\.com",
            "video-ad-stats\\\\.googlevideo\\\\.com",
            "youtube\\\\.com/api/stats/ads",
            "youtube\\\\.com/pagead/",
            "youtube\\\\.com/ptracking",
            "youtube\\\\.com/youtubei/v1/log_event"
        ]

        var entries: [String] = []
        for pattern in urlPatterns {
            entries.append("""
            {"trigger":{"url-filter":"\(pattern)"},"action":{"type":"block"}}
            """)
        }
        return "[\(entries.joined(separator: ","))]"
    }
}
