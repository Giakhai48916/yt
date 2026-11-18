package com.brave.youtubelite.network

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * Engine lọc URL mạng siêu tốc theo mô hình Brave Shields Native.
 * Sử dụng HashSet để đối chiếu Domain và Subdomain trong O(1) thay vì duyệt tuyến tính,
 * đồng thời kiểm tra chuỗi nhanh trước khi gọi Uri.parse() để giảm áp lực GC trên luồng IO.
 */
object AdBlockEngine {
    private const val TAG = "AdBlockEngine"
    @Volatile var isEnabled: Boolean = true

    // Tách riêng domain thuần và rule có chứa path (vd: youtube.com/pagead/)
    private val blockedDomains = HashSet<String>()
    private val blockedHostAndPaths = ArrayList<Pair<String, String>>()
    private val blockedPathPatterns = listOf(
        "/api/stats/ads",
        "/pagead/",
        "/ptracking",
        "/youtubei/v1/log_event"
    )

    fun init(context: Context) {
        if (blockedDomains.isNotEmpty()) return
        try {
            val inputStream = context.assets.open("filters/blocked_domains.txt")
            val reader = BufferedReader(InputStreamReader(inputStream))
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val trimmed = line?.trim()?.lowercase() ?: continue
                if (trimmed.isEmpty() || trimmed.startsWith("#")) continue

                val slashIdx = trimmed.indexOf('/')
                if (slashIdx > 0) {
                    val hostPart = trimmed.substring(0, slashIdx)
                    val pathPart = trimmed.substring(slashIdx)
                    blockedHostAndPaths.add(hostPart to pathPart)
                } else {
                    blockedDomains.add(trimmed)
                }
            }
            reader.close()
            Log.d(
                TAG,
                "Đã nạp ${blockedDomains.size} domain và ${blockedHostAndPaths.size} path rule chặn quảng cáo."
            )
        } catch (e: Exception) {
            Log.e(TAG, "Lỗi khi nạp danh sách chặn: ${e.message}")
        }
    }

    fun isBlocked(url: String): Boolean {
        if (!isEnabled || url.isEmpty()) return false

        // Fast-path: Không bao giờ chặn luồng stream video/audio chính hoặc tài nguyên tĩnh ytimg/gstatic
        if (url.contains(".googlevideo.com/videoplayback")) {
            return false
        }

        try {
            val uri = Uri.parse(url)
            val host = uri.host?.lowercase() ?: return false
            val path = uri.path?.lowercase() ?: ""

            // 1. Đối chiếu Domain & Subdomain trong O(k) với k là số dấu chấm trong host (tối đa 3-4 bước)
            if (isHostBlocked(host)) {
                return true
            }

            // 2. Kiểm tra các rule kết hợp host + path trong blocked_domains.txt
            for (i in 0 until blockedHostAndPaths.size) {
                val (ruleHost, rulePath) = blockedHostAndPaths[i]
                if ((host == ruleHost || host.endsWith(".$ruleHost")) && path.contains(rulePath)) {
                    return true
                }
            }

            // 3. Kiểm tra các endpoint quảng cáo & telemetry ngầm trên YouTube
            for (i in 0 until blockedPathPatterns.size) {
                if (path.contains(blockedPathPatterns[i])) {
                    return true
                }
            }
        } catch (_: Exception) {
            return false
        }

        return false
    }

    private fun isHostBlocked(host: String): Boolean {
        if (blockedDomains.contains(host)) return true
        var dotIndex = host.indexOf('.')
        while (dotIndex != -1 && dotIndex + 1 < host.length) {
            val parentDomain = host.substring(dotIndex + 1)
            if (blockedDomains.contains(parentDomain)) {
                return true
            }
            dotIndex = host.indexOf('.', dotIndex + 1)
        }
        return false
    }
}
