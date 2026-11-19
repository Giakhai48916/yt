/**
 * BRAVE SHIELDS SCRIPTLET DÀNH CHO LITETUBE
 * 1. Chặn và gọt sạch metadata quảng cáo (InnerTube & SSAI 16x)
 * 2. Điều hướng SPA đơn luồng (Single-Path SPA Switch): Tránh gọi kép gây chồng 2 tiếng & lỗi mã phát!
 * 3. Tích hợp "Hẹn giờ tắt video" ngay trong menu bánh răng (⚙) và đồng bộ với nút Hẹn giờ góc phải video
 * 4. Tối ưu tốc độ mở Shorts lần đầu (prefetch Shorts chunk & tự động unmute Shorts tức thì)
 * 5. Đồng bộ trạng thái phát & Media Metadata với Android Native Bridge
 */

(function() {
    'use strict';
    if (window.__brave_yt_shield_active) return;
    window.__brave_yt_shield_active = true;

    window.__braveSettings = Object.assign({
        adblock: true,
        backgroundPlay: true,
        autoPip: true,
        sleepTimerMode: 0,
        stopAtVideoEnd: false
    }, window.__braveSettings || {});

    if (typeof window.__braveAppInBackground === 'undefined') {
        window.__braveAppInBackground = false;
    }

    function isAdblockEnabled() {
        return !(window.__braveSettings && window.__braveSettings.adblock === false);
    }

    function isBgPlayEnabled() {
        return !(window.__braveSettings && window.__braveSettings.backgroundPlay === false);
    }

    function isStopAtVideoEndEnabled() {
        return !!(window.__braveSettings && (window.__braveSettings.stopAtVideoEnd === true || window.__braveSettings.sleepTimerMode === -1));
    }

    // ==============================================================
    // 1. TẨY SẠCH DỮ LIỆU QUẢNG CÁO (INNERTUBE API) - TỐI ƯU HIỆU NĂNG
    // ==============================================================
    function sanitizePlayerObj(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        if (!isAdblockEnabled()) return obj;

        if (obj.playerResponse) {
            delete obj.playerResponse.adPlacements;
            delete obj.playerResponse.adSlots;
            delete obj.playerResponse.playerAds;
        }
        delete obj.adPlacements;
        delete obj.adSlots;
        delete obj.playerAds;
        delete obj.adBreakHeartbeatParams;

        return obj;
    }

    const originalJSONParse = JSON.parse;
    JSON.parse = function(text) {
        const result = originalJSONParse.apply(this, arguments);
        if (typeof text === 'string' &&
            text.length > 60 &&
            (text.indexOf('adPlacements') !== -1 ||
             text.indexOf('playerAds') !== -1 ||
             text.indexOf('adSlots') !== -1)) {
            try {
                return sanitizePlayerObj(result);
            } catch (e) {
                return result;
            }
        }
        return result;
    };

    try {
        let initialPlayerResponseVal = sanitizePlayerObj(window.ytInitialPlayerResponse);
        Object.defineProperty(window, 'ytInitialPlayerResponse', {
            get: function() { return initialPlayerResponseVal; },
            set: function(val) { initialPlayerResponseVal = sanitizePlayerObj(val); },
            configurable: true
        });
    } catch (e) {
        try { sanitizePlayerObj(window.ytInitialPlayerResponse); } catch (e2) {}
    }

    if (window.fetch) {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            if (!isAdblockEnabled()) return response;

            const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';

            if (url && url.indexOf('/youtubei/v1/player') !== -1) {
                try {
                    const clone = response.clone();
                    const json = await clone.json();
                    const sanitized = sanitizePlayerObj(json);
                    return new Response(JSON.stringify(sanitized), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                } catch (e) {
                    return response;
                }
            }
            return response;
        };
    }

    // ==============================================================
    // 1.5. ĐIỀU HƯỚNG SPA ĐƠN LUỒNG SIÊU TỐC KHI ĐỔI VIDEO TRONG PLAYER WEBVIEW
    //      QUAN TRỌNG: Chỉ dùng DUY NHẤT 1 luồng điều hướng SPA (click thẻ <a> nội bộ của ytm-app),
    //      TUYỆT ĐỐI KHÔNG gọi chồng chéo tempAnchor.click() + player.loadVideoById() cùng lúc
    //      (nguyên nhân gây lỗi 2 luồng âm thanh phát đè lên nhau và báo "Mã lượt phát" lỗi)!
    // ==============================================================
    window.__braveOpenWatchSpa = function(targetUrl, videoId) {
        try {
            if (!targetUrl) return false;
            window.__braveUserPaused = false;
            window.__braveEndedHandledForVid = '';
            window.__braveProtectPlayUntil = Date.now() + 3000;

            // 1. Dừng ngay lập tức mọi thẻ <video> hiện tại để ngắt 100% tiếng của bài cũ trước khi chuyển bài
            const videos = document.querySelectorAll('video');
            for (let i = 0; i < videos.length; i++) {
                try {
                    window.__braveAllowPauseUntil = Date.now() + 400;
                    (window.__braveNativePause || videos[i].pause).call(videos[i]);
                } catch (eOld) {}
            }

            const ytmApp = document.querySelector('ytm-app') || document.querySelector('ytd-app');
            if (!ytmApp || window.location.hostname.indexOf('youtube.com') === -1) {
                return false;
            }

            let pathUrl = targetUrl;
            try {
                const u = new URL(targetUrl, window.location.origin);
                pathUrl = u.pathname + u.search;
            } catch (eUrl) {}

            // 2. Chỉ dùng duy nhất SPA Router chính chủ của YouTube thông qua 1 lần click <a> ẩn
            const tempAnchor = document.createElement('a');
            tempAnchor.href = pathUrl;
            tempAnchor.style.display = 'none';
            (document.body || document.documentElement).appendChild(tempAnchor);
            tempAnchor.click();
            if (tempAnchor.parentNode) {
                tempAnchor.parentNode.removeChild(tempAnchor);
            }

            // 3. Fallback an toàn: chỉ khi sau 350ms mà URL vẫn chưa chuyển sang videoId mới thì mới gán location.href
            setTimeout(function() {
                try {
                    if (videoId && window.location.href.indexOf(videoId) === -1) {
                        window.location.href = targetUrl;
                    }
                } catch (eCheck) {}
            }, 350);

            return true;
        } catch (e) {}
        return false;
    };

    // ==============================================================
    // 1.8. TÍCH HỢP MỤC "HẸN GIỜ TẮT VIDEO" VÀO MENU CỦA NÚT `button.icon-button.player-settings-icon`
    //      - Gắn trực tiếp sự kiện vào đúng nút `button.icon-button.player-settings-icon` (aria-label="Cài đặt cách phát")
    //      - Dùng MutationObserver nhẹ ở cấp trực tiếp của document.body (subtree: false -> 0% lag)
    //        để bắt ngay khoảnh khắc YouTube mở bottom-sheet cài đặt video và chèn dòng Đồng hồ Hẹn giờ!
    // ==============================================================
    var SLEEP_MENU_KEYWORDS = [
        "chất lượng", "quality",
        "tốc độ", "playback speed",
        "lặp lại", "loop video",
        "thống kê chi tiết", "stats for nerds",
        "sao chép thông tin gỡ lỗi", "copy debug info",
        "chế độ môi trường xung quanh", "ambient mode",
        "âm lượng ổn định", "stable volume"
    ];

    function collectRoots() {
        var roots = [document];
        try {
            var bodyChildren = document.body ? document.body.children : [];
            for (var i = 0; i < bodyChildren.length; i++) {
                if (bodyChildren[i].shadowRoot) roots.push(bodyChildren[i].shadowRoot);
            }
        } catch (e) {}
        return roots;
    }

    function findSettingsMenuListContainer() {
        var roots = collectRoots();
        for (var ri = 0; ri < roots.length; ri++) {
            var root = roots[ri];
            var candidates = root.querySelectorAll(
                "bottom-sheet-layout, bottom-sheet-container, ytm-bottom-sheet-renderer, " +
                "ytm-menu-popup-renderer, tp-yt-paper-dialog, .ytp-settings-menu, " +
                "[role=\"dialog\"], [role=\"menu\"], .bottom-sheet-content, yt-list-view-model, c3-overlay"
            );
            for (var s = 0; s < candidates.length; s++) {
                var sheet = candidates[s];
                if (!sheet || sheet.offsetHeight < 80 || sheet.offsetWidth < 120) continue;
                var fullText = (sheet.textContent || "").toLowerCase();
                var matchedCount = 0;
                for (var k = 0; k < SLEEP_MENU_KEYWORDS.length; k++) {
                    if (fullText.indexOf(SLEEP_MENU_KEYWORDS[k]) !== -1) {
                        matchedCount++;
                        if (matchedCount >= 2) break;
                    }
                }
                if (matchedCount < 2) continue;

                // Ưu tiên thẻ danh sách chuẩn của YouTube Mobile (yt-list-view-model / role=menu / .menu-content)
                var listEl = sheet.querySelector(
                    "yt-list-view-model, [role=\"menu\"], .menu-content, .ytp-panel-menu, .bottom-sheet-media-menu-item-list"
                );
                if (listEl && listEl.children && listEl.children.length >= 2) {
                    return listEl;
                }

                // Fallback: đi tìm trực tiếp dòng có chữ "Chất lượng" / "Lặp lại" / "Thống kê" rồi lấy thẻ cha chứa danh sách các dòng
                var allRows = sheet.querySelectorAll(
                    "yt-list-item-view-model, ytm-menu-item, .bottom-sheet-media-menu-item, " +
                    "ytm-option-service-item-renderer, [role=\"menuitem\"], [role=\"listitem\"], " +
                    ".ytp-menuitem, button, div[tabindex], div"
                );
                for (var r = 0; r < allRows.length; r++) {
                    var row = allRows[r];
                    if (!row || row.offsetHeight < 32 || row.offsetHeight > 88) continue;
                    var rt = (row.textContent || "").trim().toLowerCase();
                    if (rt.length > 40) continue;
                    if (rt.indexOf("chất lượng") !== -1 || rt.indexOf("quality") !== -1 ||
                        rt.indexOf("lặp lại") !== -1 || rt.indexOf("thống kê chi tiết") !== -1 ||
                        rt.indexOf("stats for nerds") !== -1) {
                        var p = row.parentElement;
                        for (var up = 0; up < 4 && p && p !== sheet; up++) {
                            if (p.children && p.children.length >= 4) {
                                return p;
                            }
                            p = p.parentElement;
                        }
                        if (row.parentElement) return row.parentElement;
                    }
                }
            }
        }
        return null;
    }

    function updateSleepMenuSubLabel() {
        var sub = document.getElementById("__brave_sleep_timer_menu_sub");
        if (!sub) return;
        var label = window.__braveSleepTimerLabel || "Không";
        sub.textContent = label + " ›";
        sub.style.color = (label === "Không") ? "#aaa" : "#4caf50";
    }

    function injectSleepTimerIntoPlayerMenu() {
        try {
            var existing = document.getElementById("__brave_sleep_timer_menu_item");
            if (existing && existing.isConnected && existing.offsetHeight > 0) {
                updateSleepMenuSubLabel();
                return true;
            }

            var container = findSettingsMenuListContainer();
            if (!container) return false;

            if (existing && existing.parentNode) {
                existing.parentNode.removeChild(existing);
            }

            var item = document.createElement("div");
            item.id = "__brave_sleep_timer_menu_item";
            item.setAttribute("role", "menuitem");
            item.setAttribute("tabindex", "0");
            item.style.cssText =
                "display:flex;align-items:center;justify-content:space-between;" +
                "min-height:48px;padding:12px 16px;box-sizing:border-box;width:100%;" +
                "cursor:pointer;color:#f1f1f1;font-family:Roboto,Arial,sans-serif;" +
                "font-size:16px;-webkit-tap-highlight-color:rgba(255,255,255,0.12);user-select:none;";

            var leftWrap = document.createElement("div");
            leftWrap.style.cssText = "display:flex;align-items:center;min-width:0;flex:1;";

            var svgNs = "http://www.w3.org/2000/svg";
            var icon = document.createElementNS(svgNs, "svg");
            icon.setAttribute("viewBox", "0 0 24 24");
            icon.setAttribute("width", "24");
            icon.setAttribute("height", "24");
            icon.style.cssText = "fill:#f1f1f1;margin-right:20px;flex-shrink:0;";
            var path = document.createElementNS(svgNs, "path");
            path.setAttribute("d", "M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z");
            icon.appendChild(path);

            var title = document.createElement("span");
            title.textContent = "Hẹn giờ tắt video";
            title.style.cssText = "font-size:16px;color:#f1f1f1;font-weight:400;line-height:22px;";

            leftWrap.appendChild(icon);
            leftWrap.appendChild(title);

            var label = window.__braveSleepTimerLabel || "Không";
            var rightLabel = document.createElement("span");
            rightLabel.id = "__brave_sleep_timer_menu_sub";
            rightLabel.textContent = label + " ›";
            rightLabel.style.cssText =
                "font-size:14px;margin-left:12px;flex-shrink:0;font-weight:400;color:" +
                (label === "Không" ? "#aaa;" : "#4caf50;");

            item.appendChild(leftWrap);
            item.appendChild(rightLabel);

            function onOpenTimer(e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                try {
                    var backdrop = document.querySelector(
                        "c3-overlay, .bottom-sheet-layout-Takeover-backdrop, " +
                        ".ytm-menu-popup-renderer-backdrop, .overlay-backdrop, [role=\"presentation\"]"
                    );
                    if (backdrop && typeof backdrop.click === "function") backdrop.click();
                } catch (eClose) {}
                if (window.AndroidBridge && typeof window.AndroidBridge.openSleepTimerDialog === "function") {
                    window.AndroidBridge.openSleepTimerDialog();
                }
            }

            item.addEventListener("click", onOpenTimer, true);

            // Chèn ngay sau mục "Lặp lại" / "Loop", hoặc ở cuối danh sách
            var inserted = false;
            var children = container.children;
            for (var i = 0; i < children.length; i++) {
                var ct = (children[i].textContent || "").toLowerCase();
                if (ct.indexOf("lặp lại") !== -1 || ct.indexOf("loop") !== -1) {
                    if (children[i].nextSibling) {
                        container.insertBefore(item, children[i].nextSibling);
                    } else {
                        container.appendChild(item);
                    }
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                container.appendChild(item);
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    var sleepMenuPollTimer = null;
    function scheduleSleepMenuInjection() {
        if (sleepMenuPollTimer) {
            clearInterval(sleepMenuPollTimer);
            sleepMenuPollTimer = null;
        }
        var attempts = 0;
        if (injectSleepTimerIntoPlayerMenu()) return;
        sleepMenuPollTimer = setInterval(function() {
            attempts++;
            if (injectSleepTimerIntoPlayerMenu() || attempts >= 20) {
                clearInterval(sleepMenuPollTimer);
                sleepMenuPollTimer = null;
            }
        }, 80);
    }

    // 1) Bắt trực tiếp vào nút `button.icon-button.player-settings-icon` (đúng class của nút bánh răng YouTube)
    ["click", "touchend", "pointerup"].forEach(function(evType) {
        document.addEventListener(evType, function(e) {
            var t = e.target;
            if (!t || !t.closest) return;
            var settingsBtn = t.closest(
                "button.icon-button.player-settings-icon, .player-settings-icon, " +
                "button[aria-label*=\"Cài đặt cách phát\" i], button[aria-label*=\"Playback settings\" i], " +
                ".ytp-settings-button"
            );
            if (settingsBtn) {
                scheduleSleepMenuInjection();
            }
        }, true);
    });

    // 2) MutationObserver siêu nhẹ CHỈ quan sát con trực tiếp của document.body (subtree: false -> không gây lag)
    //    để tự động chèn ngay khi YouTube gắn bottom-sheet cài đặt vào cuối body
    function attachTopLevelSheetObserver() {
        if (!document.body || window.__braveSheetObsAttached) return;
        window.__braveSheetObsAttached = true;
        try {
            var obs = new MutationObserver(function(mutations) {
                if ((window.location.pathname || "").indexOf("/watch") === -1) return;
                for (var i = 0; i < mutations.length; i++) {
                    if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
                        scheduleSleepMenuInjection();
                        break;
                    }
                }
            });
            obs.observe(document.body, { childList: true, subtree: false });
        } catch (e) {}
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", attachTopLevelSheetObserver);
    } else {
        attachTopLevelSheetObserver();
    }

    // ==============================================================
    // 2. KHẮC CHẾ QUẢNG CÁO GHÉP LUỒNG (SSAI) - TUA 16X & AUTO-SKIP
    // ==============================================================
    let isAdPlaying = false;
    let savedVolume = 1.0;

    function checkAndDefuseAds() {
        if (!isAdblockEnabled()) return;

        const player = document.getElementById('movie_player');
        const hasAdClass = player
            ? (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
            : !!document.querySelector('.ad-showing, .ad-interrupting');

        const video = document.querySelector('video');
        if (hasAdClass && video) {
            if (!isAdPlaying) {
                isAdPlaying = true;
                savedVolume = video.volume;
            }

            video.muted = true;
            video.playbackRate = 16.0;

            if (isFinite(video.duration) && video.duration > 0) {
                video.currentTime = video.duration;
            }

            const skipButtons = document.querySelectorAll(
                '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .videoAdUiSkipButton, button[class*="skip-button"], .ytp-ad-skip-button-text'
            );
            for (let i = 0; i < skipButtons.length; i++) {
                try { skipButtons[i].click(); } catch (err) {}
            }
        } else if (isAdPlaying && video) {
            isAdPlaying = false;
            video.playbackRate = 1.0;
            video.muted = false;
            video.volume = savedVolume;
        }
    }

    // ==============================================================
    // 3. DUY TRÌ ÂM THANH KHI TẮT MÀN HÌNH & CHỐNG TỰ DỪNG KHI THU NHỎ
    // ==============================================================
    function isPipActive() {
        return !!(window.__bravePip && typeof window.__bravePip.isActive === 'function' && window.__bravePip.isActive()) || !!window.__braveEnteringPip;
    }

    ['visibilitychange', 'webkitvisibilitychange', 'pagehide'].forEach(eventType => {
        window.addEventListener(eventType, function(e) {
            if (isBgPlayEnabled() || isPipActive()) {
                e.stopImmediatePropagation();
            }
        }, true);
        document.addEventListener(eventType, function(e) {
            if (isBgPlayEnabled() || isPipActive()) {
                e.stopImmediatePropagation();
            }
        }, true);
    });

    try {
        Object.defineProperty(document, 'hidden', {
            get: function() {
                if (isBgPlayEnabled() || isPipActive()) return false;
                return !!window.__braveAppInBackground;
            },
            configurable: true
        });
        Object.defineProperty(document, 'visibilityState', {
            get: function() {
                if (isBgPlayEnabled() || isPipActive()) return 'visible';
                return window.__braveAppInBackground ? 'hidden' : 'visible';
            },
            configurable: true
        });
    } catch (e) {}

    window.__isUserExplicitPause = false;
    window.__braveAllowPauseUntil = 0;

    if (!window.__braveNativePlay && window.HTMLMediaElement) {
        window.__braveNativePlay = HTMLMediaElement.prototype.play;
    }
    if (!window.__braveNativePause && window.HTMLMediaElement) {
        window.__braveNativePause = HTMLMediaElement.prototype.pause;
    }
    const nativeMediaPause = window.__braveNativePause || HTMLMediaElement.prototype.pause;

    function kickPlayerReRender() {
        try {
            const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (player) {
                if (typeof player.wakeUpControls === 'function') player.wakeUpControls();
                if (typeof player.updateDimensions === 'function') player.updateDimensions();
            }
        } catch (e) {}
        try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    }
    window.__braveKickReRender = kickPlayerReRender;

    HTMLMediaElement.prototype.pause = function() {
        if (window.__braveUserPaused === true ||
            window.__isUserExplicitPause === true ||
            (window.__braveAllowPauseUntil && Date.now() < window.__braveAllowPauseUntil)) {
            window.__isUserExplicitPause = false;
            window.__braveProtectPlayUntil = 0;
            return nativeMediaPause.apply(this, arguments);
        }

        if (window.__braveProtectPlayUntil && Date.now() < window.__braveProtectPlayUntil) {
            return;
        }

        const isPipMode = isPipActive();
        const isBackground = !!window.__braveAppInBackground;
        const bgPlayEnabled = isBgPlayEnabled();

        if (!isPipMode && !isBackground) {
            return nativeMediaPause.apply(this, arguments);
        }

        if (isBackground && !isPipMode && !bgPlayEnabled) {
            return nativeMediaPause.apply(this, arguments);
        }

        return;
    };

    // ==============================================================
    // 4. TỈ LỆ KHUNG HÌNH VIDEO, SINGLE-VIDEO GUARD & TỰ TẮT KHI HẾT VIDEO
    // ==============================================================
    // Đảm bảo trong cùng 1 WebView không bao giờ có 2 thẻ <video> cùng phát âm thanh một lúc!
    document.addEventListener('playing', function(e) {
        const currentV = e.target;
        if (!currentV || currentV.tagName !== 'VIDEO') return;
        const allVideos = document.querySelectorAll('video');
        if (allVideos.length > 1) {
            for (let i = 0; i < allVideos.length; i++) {
                const other = allVideos[i];
                if (other !== currentV && !other.paused) {
                    try {
                        window.__braveAllowPauseUntil = Date.now() + 400;
                        (window.__braveNativePause || other.pause).call(other);
                    } catch (eOther) {}
                }
            }
        }
    }, true);

    function pickMainVideo() {
        if (window.__bravePip && window.__bravePip.mainVideo) return window.__bravePip.mainVideo();
        const videos = document.querySelectorAll('video');
        if (videos.length === 0) return null;
        if (videos.length === 1) return videos[0];
        let best = videos[0];
        let bestScore = -1;
        for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            const score = ((!v.paused && !v.ended) ? 10000000 : 0) + ((v.videoWidth * v.videoHeight) || (v.offsetWidth * v.offsetHeight));
            if (score > bestScore) { best = v; bestScore = score; }
        }
        return best;
    }

    let lastReportedSize = '';
    function reportVideoSize(video) {
        if (!window.AndroidBridge || !video || !video.videoWidth || !video.videoHeight) return;
        const key = video.videoWidth + 'x' + video.videoHeight;
        if (key === lastReportedSize) return;
        lastReportedSize = key;
        try { window.AndroidBridge.onVideoSize(video.videoWidth, video.videoHeight); } catch (e) {}
    }

    ['loadedmetadata', 'resize'].forEach(function(eventType) {
        document.addEventListener(eventType, function(e) {
            if (e.target && e.target.tagName === 'VIDEO') reportVideoSize(e.target);
        }, true);
    });

    window.__braveEndedHandledForVid = '';
    function handleCheckVideoEnd(v) {
        if (!v || !isStopAtVideoEndEnabled() || isAdPlaying || isAdShowingNow()) return;
        const dur = v.duration;
        const cur = v.currentTime;
        if (!isFinite(dur) || dur <= 3) return;

        if (v.ended || (dur - cur <= 0.45 && cur > 1)) {
            const vidKey = extractVideoId() || 'current';
            if (window.__braveEndedHandledForVid === vidKey) return;
            window.__braveEndedHandledForVid = vidKey;

            window.__braveUserPaused = true;
            window.__braveProtectPlayUntil = 0;
            window.__braveAllowPauseUntil = Date.now() + 2500;
            try {
                const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
                if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
            } catch (eP) {}
            try {
                (window.__braveNativePause || v.pause).call(v);
            } catch (eV) {}

            if (window.AndroidBridge && typeof window.AndroidBridge.onVideoEnded === 'function') {
                try { window.AndroidBridge.onVideoEnded(); } catch (eB) {}
            }
        }
    }

    document.addEventListener('ended', function(e) {
        if (e.target && e.target.tagName === 'VIDEO') {
            handleCheckVideoEnd(e.target);
        }
    }, true);

    document.addEventListener('timeupdate', function(e) {
        if (e.target && e.target.tagName === 'VIDEO' && isStopAtVideoEndEnabled()) {
            handleCheckVideoEnd(e.target);
        }
    }, true);

    // ==============================================================
    // 5. ĐỒNG BỘ TRẠNG THÁI PHÁT, AUTO-UNMUTE & MEDIA METADATA VỚI ANDROID NATIVE
    // ==============================================================
    let lastAutoUnmuteKey = '';
    let autoUnmuteWindowUntil = 0;
    let userMutedVideo = false;

    function extractVideoId() {
        try {
            const u = new URL(window.location.href);
            const v = u.searchParams.get('v');
            if (v) return v;
            const m = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
            if (m && m[1]) return m[1];
        } catch (e) {}
        try {
            const p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (p && typeof p.getVideoData === 'function') {
                const vd = p.getVideoData();
                if (vd && vd.video_id) return String(vd.video_id);
            }
        } catch (e) {}
        return '';
    }

    function isElementFastVisible(el) {
        return !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0));
    }

    ['touchstart', 'pointerdown', 'mousedown', 'click'].forEach(function(type) {
        window.addEventListener(type, function(e) {
            const t = e.target;
            if (!t || !t.closest) return;
            const muteBtn = t.closest('.ytp-mute-button');
            if (muteBtn) {
                const v = pickMainVideo();
                if (v && !v.muted) {
                    userMutedVideo = true;
                } else if (v && v.muted) {
                    userMutedVideo = false;
                }
            }
        }, true);
    });

    function isAdShowingNow() {
        const player = document.getElementById('movie_player');
        if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
            return true;
        }
        return false;
    }

    function tryAutoUnmute() {
        try {
            const path = window.location.pathname || '';
            // Trên Browse WebView: chỉ tự động bật tiếng khi đang ở trong tab Shorts (/shorts)
            if (window.__braveIsBrowseWebView && path.indexOf('/shorts') === -1) return;
            if (isAdPlaying || isAdShowingNow()) return;

            const video = pickMainVideo();
            if (!video) return;

            const curVid = extractVideoId();
            const key = (curVid || (location.pathname + location.search)) + '|' + (video.currentSrc || '');
            if (key && key !== lastAutoUnmuteKey) {
                lastAutoUnmuteKey = key;
                autoUnmuteWindowUntil = Date.now() + 6000;
                userMutedVideo = false;
            }

            if (userMutedVideo) return;

            const inWindow = Date.now() < autoUnmuteWindowUntil;
            if (!inWindow && !video.muted && video.volume > 0) return;

            const unmuteBtn = document.querySelector('.ytp-unmute, .ytm-unmute-button');
            if (isElementFastVisible(unmuteBtn)) {
                try { unmuteBtn.click(); } catch (eClick) {}
            }

            if (video.muted || video.volume === 0) {
                const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
                if (player) {
                    try {
                        if (typeof player.isMuted === 'function' && player.isMuted() && typeof player.unMute === 'function') {
                            player.unMute();
                        }
                        if (typeof player.getVolume === 'function' && player.getVolume() === 0 && typeof player.setVolume === 'function') {
                            player.setVolume(100);
                        }
                    } catch (ePl) {}
                }
                video.muted = false;
                if (video.volume === 0) {
                    video.volume = 1.0;
                }
            }
        } catch (e) {}
    }

    window.__braveTryAutoUnmute = tryAutoUnmute;

    function extractMetadata() {
        const videoId = extractVideoId();
        let apiTitle = '';
        let apiAuthor = '';
        try {
            const p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (p && typeof p.getVideoData === 'function') {
                const vd = p.getVideoData();
                if (vd && (!videoId || !vd.video_id || vd.video_id === videoId)) {
                    if (vd.title) apiTitle = String(vd.title).trim();
                    if (vd.author) apiAuthor = String(vd.author).trim();
                }
            }
        } catch (e) {}

        if (apiTitle && apiAuthor) {
            return { videoId: videoId, title: apiTitle, channel: apiAuthor };
        }

        const titleEl = document.querySelector(
            'h1.slim-video-metadata-title, .ytm-slim-video-metadata-renderer-title, .media-item-headline, .ytp-title-link'
        );
        const channelEl = document.querySelector(
            '.ytm-channel-thumbnail-with-profile-name, .slim-owner-channel-name, .subhead, .ytd-channel-name'
        );
        const rawTitle = titleEl && titleEl.textContent ? titleEl.textContent.trim() : '';
        const docTitle = document.title ? document.title.replace(/\s*-\s*YouTube$/i, '').trim() : '';
        const title = apiTitle || rawTitle || docTitle || 'LiteTube';
        const channel = apiAuthor || (channelEl && channelEl.textContent ? channelEl.textContent.trim() : '');
        return { videoId: videoId, title: title, channel: channel };
    }

    function reportMediaToBridge(isPlaying, meta, positionMs, durationMs) {
        if (!window.AndroidBridge) return;
        try {
            if (typeof window.AndroidBridge.onMediaStateWithId === 'function') {
                window.AndroidBridge.onMediaStateWithId(isPlaying, meta.videoId || '', meta.title, meta.channel, positionMs, durationMs);
            } else if (typeof window.AndroidBridge.onMediaStateChanged === 'function') {
                window.AndroidBridge.onMediaStateChanged(isPlaying, meta.title, meta.channel, positionMs, durationMs);
            }
        } catch (e) {}
    }

    function syncNativeState() {
        if (!window.AndroidBridge) return;

        const path = window.location.pathname || '';
        if (path.indexOf('/watch') === -1 && path.indexOf('/shorts') === -1) {
            return;
        }

        tryAutoUnmute();

        const video = pickMainVideo();
        if (video) {
            reportVideoSize(video);
            handleCheckVideoEnd(video);
        }

        const meta = extractMetadata();
        const isPlaying = !!(video && !video.paused && !video.ended);
        const positionMs = video && isFinite(video.currentTime) ? Math.round(video.currentTime * 1000) : 0;
        const durationMs = video && isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : 0;

        if (isPlaying) {
            window.__braveUserPaused = false;
            reportMediaToBridge(true, meta, positionMs, durationMs);
        } else {
            if (window.__bravePlayPendingUntil && Date.now() < window.__bravePlayPendingUntil) {
                return;
            }
            reportMediaToBridge(false, meta, positionMs, durationMs);
        }
    }

    window.__braveSyncMediaState = syncNativeState;

    ['play', 'playing'].forEach(function(eventType) {
        document.addEventListener(eventType, function(e) {
            if (e.target && e.target.tagName === 'VIDEO') {
                const path = window.location.pathname || '';
                if (window.__braveIsBrowseWebView && path.indexOf('/shorts') === -1) return;
                window.__braveUserPaused = false;
                tryAutoUnmute();
                syncNativeState();
            }
        }, true);
    });

    ['loadedmetadata', 'durationchange', 'seeked', 'ratechange'].forEach(function(eventType) {
        document.addEventListener(eventType, function(e) {
            if (e.target && e.target.tagName === 'VIDEO') {
                const path = window.location.pathname || '';
                if (window.__braveIsBrowseWebView && path.indexOf('/shorts') === -1) return;
                tryAutoUnmute();
                syncNativeState();
            }
        }, true);
    });

    document.addEventListener('volumechange', function(e) {
        if (e.target && e.target.tagName === 'VIDEO' && Date.now() < autoUnmuteWindowUntil && !userMutedVideo) {
            tryAutoUnmute();
        }
    }, true);

    document.addEventListener('pause', function(e) {
        if (e.target && e.target.tagName === 'VIDEO') {
            const inProtect = window.__braveProtectPlayUntil && Date.now() < window.__braveProtectPlayUntil;
            if (!inProtect && !e.target.ended && e.isTrusted) {
                window.__braveUserPaused = true;
            }
            setTimeout(syncNativeState, 200);
        }
    }, true);

    setInterval(function() {
        const path = window.location.pathname || '';
        if (path.indexOf('/watch') === -1 && path.indexOf('/shorts') === -1) return;
        checkAndDefuseAds();
        if (Date.now() < autoUnmuteWindowUntil && !userMutedVideo) {
            tryAutoUnmute();
        }
    }, 300);

    setInterval(syncNativeState, 1000);
})();
