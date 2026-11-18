/**
 * BRAVE SHIELDS SCRIPTLET DÀNH CHO LITETUBE
 * 1. Chặn và gọt sạch metadata quảng cáo (InnerTube & SSAI 16x)
 * 2. Điều hướng SPA siêu tốc (Instant SPA Video Switch) không cần tải lại trang
 * 3. Tích hợp "Hẹn giờ tắt video" (Giống Cốc Cốc: Tự tắt khi hết video / Hẹn giờ) ngay trong menu bánh răng (⚙) của trình phát
 * 4. Cơ chế chạy nền & Chống tự động ngắt video khi ở kích thước nhỏ (PLAYER_VIEW_TOO_SMALL)
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
    // 1.5. ĐIỀU HƯỚNG SPA SIÊU TỐC KHI ĐỔI VIDEO TRONG PLAYER WEBVIEW
    //      (Tránh loadUrl toàn bộ trang HTML + 4MB JS mỗi lần bấm video mới)
    // ==============================================================
    window.__braveOpenWatchSpa = function(targetUrl, videoId) {
        try {
            if (!targetUrl) return false;
            window.__braveUserPaused = false;
            window.__braveEndedHandledForVid = '';
            window.__braveProtectPlayUntil = Date.now() + 3000;

            const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            const ytmApp = document.querySelector('ytm-app') || document.querySelector('ytd-app');

            // Dừng ngay âm thanh của video cũ để người dùng không nghe tiếng video cũ trong lúc chuyển
            const oldVid = document.querySelector('video');
            if (oldVid && !oldVid.paused) {
                try {
                    window.__braveAllowPauseUntil = Date.now() + 300;
                    (window.__braveNativePause || oldVid.pause).call(oldVid);
                } catch (eOld) {}
            }

            let pathUrl = targetUrl;
            try {
                const u = new URL(targetUrl, window.location.origin);
                pathUrl = u.pathname + u.search;
            } catch (eUrl) {}

            // Kích hoạt SPA Router của YouTube Mobile bằng thẻ <a> ẩn
            if (ytmApp && window.location.hostname.indexOf('youtube.com') !== -1) {
                const tempAnchor = document.createElement('a');
                tempAnchor.href = pathUrl;
                tempAnchor.style.display = 'none';
                (document.body || document.documentElement).appendChild(tempAnchor);
                tempAnchor.click();
                setTimeout(function() {
                    if (tempAnchor.parentNode) tempAnchor.parentNode.removeChild(tempAnchor);
                }, 80);

                // Đồng thời gọi trực tiếp player.loadVideoById(videoId) để bộ giải mã nạp stream video mới NGAY LẬP TỨC (0ms chờ router)
                if (videoId && player && typeof player.loadVideoById === 'function') {
                    try {
                        player.loadVideoById(videoId);
                        if (typeof player.playVideo === 'function') player.playVideo();
                    } catch (eLoad) {}
                }

                setTimeout(function() {
                    try {
                        if (videoId && window.location.href.indexOf(videoId) === -1) {
                            if (player && typeof player.loadVideoById === 'function') {
                                player.loadVideoById(videoId);
                            } else {
                                window.location.href = targetUrl;
                            }
                        }
                    } catch (eCheck) {}
                }, 180);
                return true;
            }
        } catch (e) {}
        return false;
    };

    // ==============================================================
    // 1.8. TÍCH HỢP MỤC "HẸN GIỜ TẮT VIDEO" VÀO MENU BÁNH RĂNG (⚙) CỦA YOUTUBE PLAYER
    //      (Giống giao diện Tùy chỉnh video trên Cốc Cốc / YouTube)
    // ==============================================================
    function injectSleepTimerIntoPlayerMenu() {
        try {
            if (document.getElementById('__brave_sleep_timer_menu_item')) {
                const sub = document.getElementById('__brave_sleep_timer_menu_sub');
                if (sub) sub.textContent = window.__braveSleepTimerLabel || 'Không';
                return;
            }

            // Tìm menu bottom-sheet đang mở của YouTube Mobile khi bấm vào nút bánh răng (⚙)
            const menuList = document.querySelector(
                'ytm-menu-popup-renderer .menu-content, ' +
                'bottom-sheet-layout .bottom-sheet-media-menu-item, ' +
                'div.bottom-sheet-content ytm-Single-column-watch-next-results-renderer, ' +
                '.ytp-settings-menu .ytp-panel-menu, ' +
                'ytm-bottom-sheet-renderer [role="menu"], ' +
                'div[role="dialog"] ytm-menu-item, ' +
                'ytm-menu-item'
            );
            if (!menuList) return;

            const container = menuList.tagName === 'YTM-MENU-ITEM' ? menuList.parentElement : (
                menuList.classList.contains('bottom-sheet-media-menu-item') ? menuList.parentElement : menuList
            );
            if (!container || container.offsetHeight <= 0) return;

            const item = document.createElement('div');
            item.id = '__brave_sleep_timer_menu_item';
            item.setAttribute('role', 'menuitem');
            item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:13px 16px;cursor:pointer;color:#fff;font-family:Roboto,Arial,sans-serif;font-size:16px;-webkit-tap-highlight-color:rgba(255,255,255,0.12);user-select:none;';

            const leftWrap = document.createElement('div');
            leftWrap.style.cssText = 'display:flex;align-items:center;min-width:0;flex:1;';

            const svgNs = 'http://www.w3.org/2000/svg';
            const icon = document.createElementNS(svgNs, 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('width', '24');
            icon.setAttribute('height', '24');
            icon.style.cssText = 'fill:#fff;margin-right:16px;flex-shrink:0;';
            const path = document.createElementNS(svgNs, 'path');
            path.setAttribute('d', 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z');
            icon.appendChild(path);

            const title = document.createElement('span');
            title.textContent = 'Hẹn giờ tắt video';
            title.style.cssText = 'font-size:16px;color:#f1f1f1;font-weight:400;';

            leftWrap.appendChild(icon);
            leftWrap.appendChild(title);

            const rightLabel = document.createElement('span');
            rightLabel.id = '__brave_sleep_timer_menu_sub';
            rightLabel.textContent = (window.__braveSleepTimerLabel || 'Không') + ' ›';
            rightLabel.style.cssText = 'font-size:14px;color:#aaa;margin-left:12px;flex-shrink:0;';

            item.appendChild(leftWrap);
            item.appendChild(rightLabel);

            item.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                // Đóng menu bánh răng của YouTube bằng cách chạm nhẹ backdrop nếu có
                try {
                    const backdrop = document.querySelector('c3-overlay, .bottom-sheet-Show-overlay, .ytm-menu-popup-renderer-backdrop');
                    if (backdrop) backdrop.click();
                } catch (eClose) {}
                if (window.AndroidBridge && typeof window.AndroidBridge.openSleepTimerDialog === 'function') {
                    window.AndroidBridge.openSleepTimerDialog();
                }
            }, true);

            container.appendChild(item);
        } catch (e) {}
    }

    // Khi người dùng bấm vào nút bánh răng cài đặt video trên trình phát -> chèn ngay mục "Hẹn giờ tắt video"
    document.addEventListener('click', function(e) {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.player-settings-icon, button[aria-label*="Settings" i], button[aria-label*="Cài đặt" i], .ytp-settings-button')) {
            setTimeout(injectSleepTimerIntoPlayerMenu, 80);
            setTimeout(injectSleepTimerIntoPlayerMenu, 220);
            setTimeout(injectSleepTimerIntoPlayerMenu, 450);
        }
    }, true);

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
    // 4. TỈ LỆ KHUNG HÌNH VIDEO CHO CỬA SỔ PIP & BẮT SỰ KIỆN KẾT THÚC VIDEO
    // ==============================================================
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

    // Bắt sự kiện khi video phát đến cuối để xử lý chế độ "Tự động tắt khi hết video" (chặn luôn Autoplay sang bài tiếp theo)
    window.__braveEndedHandledForVid = '';
    function handleCheckVideoEnd(v) {
        if (!v || !isStopAtVideoEndEnabled() || isAdPlaying || isAdShowingNow()) return;
        const dur = v.duration;
        const cur = v.currentTime;
        if (!isFinite(dur) || dur <= 3) return;

        // Khi video kết thúc (ended) hoặc còn dưới 0.45 giây cuối cùng: dừng ngay trước khi YouTube kịp chuyển sang bài tiếp theo trong Mix/Playlist
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
                window.__braveUserPaused = false;
                tryAutoUnmute();
                syncNativeState();
            }
        }, true);
    });

    ['loadedmetadata', 'durationchange', 'seeked', 'ratechange'].forEach(function(eventType) {
        document.addEventListener(eventType, function(e) {
            if (e.target && e.target.tagName === 'VIDEO') {
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
