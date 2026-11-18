/**
 * BRAVE SHIELDS SCRIPTLET DÀNH CHO LITETUBE
 * 1. Chặn và gọt sạch metadata quảng cáo (InnerTube & SSAI 16x)
 * 2. Điều hướng SPA siêu tốc (Instant SPA Video Switch) tránh reload toàn trang
 * 3. Cơ chế chạy nền & Chống tự động ngắt video khi ở kích thước nhỏ (PLAYER_VIEW_TOO_SMALL)
 * 4. Đồng bộ trạng thái phát & Media Metadata với Android Native Bridge
 */

(function() {
    'use strict';
    if (window.__brave_yt_shield_active) return;
    window.__brave_yt_shield_active = true;

    window.__braveSettings = Object.assign({
        adblock: true,
        backgroundPlay: true,
        autoPip: true
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
        // Fast-path: Chỉ kiểm tra xóa quảng cáo khi chuỗi JSON thực sự có chứa trường quảng cáo
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
            window.__braveProtectPlayUntil = Date.now() + 3000;

            const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            const ytmApp = document.querySelector('ytm-app') || document.querySelector('ytd-app');

            // Cách 1: Nếu đang ở sẵn trang /watch và có YouTube Player API -> loadVideoById tức thì (< 200ms)
            if (videoId && window.location.pathname.indexOf('/watch') !== -1 &&
                player && typeof player.loadVideoById === 'function') {
                let pathUrl = targetUrl;
                try {
                    const u = new URL(targetUrl, window.location.origin);
                    pathUrl = u.pathname + u.search;
                } catch (eUrl) {}

                // Thử điều hướng qua SPA router của ytm-app hoặc thẻ <a> ẩn để cập nhật cả phần mô tả/gợi ý bên dưới
                const tempAnchor = document.createElement('a');
                tempAnchor.href = pathUrl;
                tempAnchor.style.display = 'none';
                (document.body || document.documentElement).appendChild(tempAnchor);
                tempAnchor.click();
                setTimeout(function() {
                    if (tempAnchor.parentNode) tempAnchor.parentNode.removeChild(tempAnchor);
                }, 100);

                // Đảm bảo player chuyển ngay sang videoId mới nếu router SPA chưa kích hoạt kịp
                setTimeout(function() {
                    try {
                        const curV = new URL(window.location.href).searchParams.get('v');
                        if (curV !== videoId && typeof player.loadVideoById === 'function') {
                            player.loadVideoById(videoId);
                        }
                        if (typeof player.playVideo === 'function') player.playVideo();
                    } catch (eInner) {}
                }, 60);
                return true;
            }

            // Cách 2: Nếu playerWebView đang được pre-warm ở trang chủ m.youtube.com -> kích hoạt SPA click
            if (ytmApp && window.location.hostname.indexOf('youtube.com') !== -1) {
                let pathUrl = targetUrl;
                try {
                    const u = new URL(targetUrl, window.location.origin);
                    pathUrl = u.pathname + u.search;
                } catch (eUrl2) {}

                const a = document.createElement('a');
                a.href = pathUrl;
                a.style.display = 'none';
                (document.body || document.documentElement).appendChild(a);
                a.click();
                setTimeout(function() {
                    if (a.parentNode) a.parentNode.removeChild(a);
                }, 100);

                setTimeout(function() {
                    if (window.location.href.indexOf('/watch') === -1) {
                        window.location.href = targetUrl;
                    }
                }, 250);
                return true;
            }
        } catch (e) {}
        return false;
    };

    // ==============================================================
    // 2. KHẮC CHẾ QUẢNG CÁO GHÉP LUỒNG (SSAI) - TUA 16X & AUTO-SKIP
    // ==============================================================
    let isAdPlaying = false;
    let savedVolume = 1.0;

    function checkAndDefuseAds() {
        if (!isAdblockEnabled()) return;

        // Fast-path: Kiểm tra trạng thái quảng cáo trên #movie_player trước khi quét DOM
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
    // 3. DUY TRÌ ÂM THANH KHI TẮT MÀN HÌNH & CHỐNG TỰ DỪNG KHI THU NHỎ (PLAYER_VIEW_TOO_SMALL)
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
    // 4. TỈ LỆ KHUNG HÌNH VIDEO CHO CỬA SỔ PIP
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

    // Kiểm tra hiển thị siêu nhẹ KHÔNG gọi getComputedStyle để tránh Forced Synchronous Layout (Reflow)
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
            // Nếu không còn trong cửa sổ khởi tạo video và video đã có tiếng -> thoát ngay O(1), không quét DOM!
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

        // Nếu đang ở trang chủ (không phải /watch hay /shorts) và không có video đang phát -> bỏ qua
        const path = window.location.pathname || '';
        if (path.indexOf('/watch') === -1 && path.indexOf('/shorts') === -1) {
            return;
        }

        tryAutoUnmute();

        const video = pickMainVideo();
        if (video) reportVideoSize(video);

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

    // Gộp chung vòng lặp kiểm tra quảng cáo & unmute ở chu kỳ hợp lý (300ms) và chỉ chạy khi đang ở trang xem video
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
