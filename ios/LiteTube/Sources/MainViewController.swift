import UIKit
import WebKit
import AVFoundation
import MediaPlayer

/// MainViewController cho LiteTube iOS (hỗ trợ đầy đủ iPhone & iPad màn hình dọc/ngang):
/// Kiến trúc 2 Tầng View (Browse WebView + Sliding Player Layer + MiniPlayer Bar),
/// Nút Hẹn Giờ Tắt Video góc phải, Brave Shields (AdBlock + SSAI 16x), Background Audio & LockScreen Media Controls.
final class MainViewController: UIViewController {

    enum PanelState {
        case hidden
        case expanded
        case collapsed
    }

    // MARK: - Trạng thái điều khiển
    private var panelState: PanelState = .hidden
    private var isVideoPlaying: Bool = false
    private var currentVideoId: String = ""
    private var currentTitle: String = "LiteTube"
    private var currentChannel: String = ""
    private var positionMs: Double = 0
    private var durationMs: Double = 0
    private var currentArtwork: MPMediaItemArtwork?
    private var loadedArtworkVideoId: String = ""
    private var sleepTimer: Timer?
    private var isPlayerPrewarmed: Bool = false

    private let bottomNavHeight: CGFloat = 48.0
    private let miniPlayerHeight: CGFloat = 64.0

    // MARK: - Tầng 1: Browse WebView
    private var browseWebView: WKWebView!
    private let refreshControl = UIRefreshControl()
    private let progressBar = UIProgressView(progressViewStyle: .bar)

    // MARK: - Tầng 2: Sliding Video Player Layer
    private let playerPanel = UIView()
    private var playerWebView: WKWebView!
    private let btnMinimizePlayer = UIButton(type: .system)
    private let playerDragArea = UIView()

    // Thanh MiniPlayer Bar khi thu nhỏ ở đáy màn hình
    private let miniPlayerBar = UIView()
    private let tvMiniPlayerTitle = UILabel()
    private let tvMiniPlayerChannel = UILabel()
    private let btnMiniPlayerPlayPause = UIButton(type: .system)
    private let btnMiniPlayerClose = UIButton(type: .system)

    private var compiledAdBlockRuleList: WKContentRuleList?

    // MARK: - Cầu nối tương thích `window.AndroidBridge` trên iOS WKWebView
    private static let iosBridgePolyfillJs: String = """
    (function() {
        if (window.AndroidBridge) return;
        function post(action, payload) {
            try {
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.iosBridge) {
                    window.webkit.messageHandlers.iosBridge.postMessage(Object.assign({ action: action }, payload || {}));
                }
            } catch (e) {}
        }
        window.AndroidBridge = {
            openWatchLayer: function(url) { post('openWatchLayer', { url: String(url || '') }); },
            openSettings: function() { post('openSettings', {}); },
            openSleepTimerDialog: function() { post('openSleepTimerDialog', {}); },
            onVideoEnded: function() { post('onVideoEnded', {}); },
            onShortsStarted: function() { post('onShortsStarted', {}); },
            onVideoPlaying: function(title, channel) {
                post('onVideoPlaying', { title: String(title || ''), channel: String(channel || '') });
            },
            onVideoPaused: function() { post('onVideoPaused', {}); },
            onMediaStateChanged: function(playing, title, channel, posMs, durMs) {
                post('onMediaStateWithId', {
                    playing: !!playing,
                    videoId: '',
                    title: String(title || ''),
                    channel: String(channel || ''),
                    posMs: Number(posMs || 0),
                    durMs: Number(durMs || 0)
                });
            },
            onMediaStateWithId: function(playing, videoId, title, channel, posMs, durMs) {
                post('onMediaStateWithId', {
                    playing: !!playing,
                    videoId: String(videoId || ''),
                    title: String(title || ''),
                    channel: String(channel || ''),
                    posMs: Number(posMs || 0),
                    durMs: Number(durMs || 0)
                });
            },
            onVideoSize: function(width, height) {
                post('onVideoSize', { width: Number(width || 16), height: Number(height || 9) });
            }
        };
    })();
    """

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.06, green: 0.06, blue: 0.06, alpha: 1.0)
        view.clipsToBounds = true

        setupWebViews()
        setupUI()
        setupGestures()
        setupRemoteTransportControls()
        setupAppLifecycleObservers()

        // Biên dịch quy tắc chặn quảng cáo Native của WebKit
        AdBlockRuleBuilder.compileContentRuleList { [weak self] ruleList in
            guard let self = self, let ruleList = ruleList else { return }
            self.compiledAdBlockRuleList = ruleList
            if AppSettings.shared.isAdBlockEnabled {
                self.browseWebView.configuration.userContentController.add(ruleList)
                self.playerWebView.configuration.userContentController.add(ruleList)
            }
        }

        if let url = URL(string: "https://m.youtube.com") {
            browseWebView.load(URLRequest(url: url))
            prewarmPlayerWebViewIfNeeded()
        }
    }

    // MARK: - Khởi tạo 2 WKWebView (Browse + Player)
    private func makeWebViewConfiguration(isBrowseMode: Bool) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.processPool = WKProcessPool()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let controller = WKUserContentController()
        controller.add(WeakScriptMessageHandler(delegate: self), name: "iosBridge")

        // 1. Tiêm cầu nối AndroidBridge -> iosBridge đầu tiên
        controller.addUserScript(WKUserScript(
            source: Self.iosBridgePolyfillJs,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))

        // 2. Tiêm CSS chống tràn màn hình ngang trên iPad / màn hình rộng
        controller.addUserScript(WKUserScript(
            source: Self.ipadResponsiveCssJs,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        // 3. Nếu là Browse WebView: tiêm interceptor chặn /watch và khóa phát tự động trên trang chủ
        if isBrowseMode {
            controller.addUserScript(WKUserScript(
                source: Self.browseWatchInterceptorJs,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        } else {
            controller.addUserScript(WKUserScript(
                source: Self.injectPlayerUiCssJs,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }

        // 4. Tiêm pip_controller.js và youtube_defuser.js từ Bundle Resources
        if let pipJs = loadBundledText(name: "pip_controller", ext: "js", subdir: "scriptlets") {
            controller.addUserScript(WKUserScript(
                source: pipJs,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }
        if let defuserJs = loadBundledText(name: "youtube_defuser", ext: "js", subdir: "scriptlets") {
            controller.addUserScript(WKUserScript(
                source: defuserJs,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }

        // 5. Tiêm Cosmetic CSS ẩn banner quảng cáo & nút "Mở bằng ứng dụng"
        if let cssText = loadBundledText(name: "cosmetic_rules", ext: "css", subdir: "filters") {
            let b64 = Data(cssText.utf8).base64EncodedString()
            let injectCss = """
            (function() {
                try {
                    var styleId = '__brave_cosmetic_style';
                    if (!document.getElementById(styleId)) {
                        var style = document.createElement('style');
                        style.id = styleId;
                        style.type = 'text/css';
                        var bin = window.atob('\(b64)');
                        var bytes = new Uint8Array(bin.length);
                        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        style.textContent = (window.TextDecoder ? new TextDecoder('utf-8').decode(bytes) : bin);
                        (document.head || document.documentElement).appendChild(style);
                    }
                } catch(e) {}
            })();
            """
            controller.addUserScript(WKUserScript(
                source: injectCss,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }

        // 6. Tiêm mục "Cài đặt LiteTube" vào trang select_site
        controller.addUserScript(WKUserScript(
            source: Self.selectSiteSettingsScriptletJs,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))

        config.userContentController = controller
        return config
    }

    private func loadBundledText(name: String, ext: String, subdir: String) -> String? {
        if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: subdir),
           let content = try? String(contentsOf: url, encoding: .utf8) {
            return content
        }
        if let url = Bundle.main.url(forResource: name, withExtension: ext),
           let content = try? String(contentsOf: url, encoding: .utf8) {
            return content
        }
        return nil
    }

    private func setupWebViews() {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let customUA = isPad
            ? "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
            : "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"

        browseWebView = WKWebView(frame: .zero, configuration: makeWebViewConfiguration(isBrowseMode: true))
        browseWebView.customUserAgent = customUA
        browseWebView.navigationDelegate = self
        browseWebView.allowsBackForwardNavigationGestures = true
        browseWebView.scrollView.backgroundColor = .black
        browseWebView.scrollView.contentInsetAdjustmentBehavior = .never
        browseWebView.scrollView.bounces = true
        browseWebView.clipsToBounds = true
        browseWebView.isOpaque = false

        playerWebView = WKWebView(frame: .zero, configuration: makeWebViewConfiguration(isBrowseMode: false))
        playerWebView.customUserAgent = customUA
        playerWebView.navigationDelegate = self
        playerWebView.scrollView.backgroundColor = .black
        playerWebView.scrollView.contentInsetAdjustmentBehavior = .never
        playerWebView.clipsToBounds = true
        playerWebView.isOpaque = false
    }

    // MARK: - Giao diện Native 2 Tầng
    private func setupUI() {
        // 1. Tầng dưới: Browse WebView
        view.addSubview(browseWebView)
        browseWebView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            browseWebView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            browseWebView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            browseWebView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            browseWebView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])

        refreshControl.tintColor = .red
        refreshControl.addTarget(self, action: #selector(handlePullToRefresh), for: .valueChanged)
        browseWebView.scrollView.refreshControl = refreshControl

        // 2. Tầng trên: Sliding Video Player Panel
        playerPanel.backgroundColor = .black
        playerPanel.clipsToBounds = true
        playerPanel.isHidden = true
        view.addSubview(playerPanel)

        playerPanel.addSubview(playerWebView)

        // Nút thu nhỏ ở góc trên bên trái video
        btnMinimizePlayer.setImage(UIImage(systemName: "chevron.down"), for: .normal)
        btnMinimizePlayer.tintColor = .white
        btnMinimizePlayer.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        btnMinimizePlayer.layer.cornerRadius = 18
        playerPanel.addSubview(btnMinimizePlayer)

        // Vùng kéo mép trên video để vuốt xuống thu nhỏ
        playerDragArea.backgroundColor = .clear
        playerPanel.addSubview(playerDragArea)

        // Thanh MiniPlayer Bar khi thu nhỏ ở đáy màn hình
        miniPlayerBar.backgroundColor = .clear
        miniPlayerBar.clipsToBounds = true
        miniPlayerBar.isHidden = true
        playerPanel.addSubview(miniPlayerBar)

        let rightInfoBg = UIView()
        rightInfoBg.backgroundColor = UIColor(red: 0.13, green: 0.13, blue: 0.13, alpha: 1.0)
        rightInfoBg.tag = 901
        miniPlayerBar.addSubview(rightInfoBg)

        tvMiniPlayerTitle.text = "LiteTube"
        tvMiniPlayerTitle.textColor = .white
        tvMiniPlayerTitle.font = UIFont.boldSystemFont(ofSize: 13)
        tvMiniPlayerTitle.lineBreakMode = .byTruncatingTail
        rightInfoBg.addSubview(tvMiniPlayerTitle)

        tvMiniPlayerChannel.text = ""
        tvMiniPlayerChannel.textColor = UIColor(white: 0.67, alpha: 1.0)
        tvMiniPlayerChannel.font = UIFont.systemFont(ofSize: 11)
        tvMiniPlayerChannel.lineBreakMode = .byTruncatingTail
        rightInfoBg.addSubview(tvMiniPlayerChannel)

        btnMiniPlayerPlayPause.setImage(UIImage(systemName: "pause.fill"), for: .normal)
        btnMiniPlayerPlayPause.tintColor = .white
        rightInfoBg.addSubview(btnMiniPlayerPlayPause)

        btnMiniPlayerClose.setImage(UIImage(systemName: "xmark"), for: .normal)
        btnMiniPlayerClose.tintColor = .white
        rightInfoBg.addSubview(btnMiniPlayerClose)

        // Thanh Progress Bar trên đỉnh
        progressBar.progressTintColor = .red
        progressBar.trackTintColor = .clear
        progressBar.isHidden = true
        view.addSubview(progressBar)
        progressBar.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            progressBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progressBar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            progressBar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            progressBar.heightAnchor.constraint(equalToConstant: 2.5)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutPlayerForCurrentBounds()
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: { [weak self] _ in
            self?.layoutPlayerForCurrentBounds()
        }) { [weak self] _ in
            guard let self = self else { return }
            self.layoutPlayerForCurrentBounds()
            let resizeJs = "try { window.dispatchEvent(new Event('resize')); } catch(e) {}"
            self.browseWebView.evaluateJavaScript(resizeJs, completionHandler: nil)
            self.playerWebView.evaluateJavaScript(resizeJs, completionHandler: nil)
        }
    }

    private func layoutPlayerForCurrentBounds() {
        let safeFrame = view.safeAreaLayoutGuide.layoutFrame
        guard safeFrame.width > 0, safeFrame.height > 0 else { return }

        if panelState == .expanded || panelState == .hidden {
            playerPanel.frame = safeFrame
            playerWebView.transform = .identity
            playerWebView.layer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
            playerWebView.frame = playerPanel.bounds
        } else if panelState == .collapsed {
            let fullW = safeFrame.width
            let fullH = safeFrame.height
            let targetY = safeFrame.minY + max(0, fullH - bottomNavHeight - miniPlayerHeight)
            playerPanel.frame = CGRect(x: safeFrame.minX, y: targetY, width: fullW, height: miniPlayerHeight)

            let vW = max(1, fullW)
            let vH = min(vW * 9.0 / 16.0, fullH * 0.62)
            let boxW: CGFloat = 104.0
            let boxH: CGFloat = 58.0
            let scale = min(boxW / vW, boxH / vH)
            let tx: CGFloat = 4.0 + (boxW - vW * scale) / 2.0
            let ty: CGFloat = (miniPlayerHeight - vH * scale) / 2.0

            playerWebView.transform = .identity
            playerWebView.layer.anchorPoint = CGPoint(x: 0, y: 0)
            playerWebView.layer.position = .zero
            playerWebView.bounds = CGRect(x: 0, y: 0, width: fullW, height: fullH)
            playerWebView.transform = CGAffineTransform(translationX: tx, y: ty).scaledBy(x: scale, y: scale)
        }

        btnMinimizePlayer.frame = CGRect(x: 8, y: 6, width: 36, height: 36)
        playerDragArea.frame = CGRect(x: 56, y: 0, width: max(40, safeFrame.width - 164), height: 44)

        miniPlayerBar.frame = CGRect(x: 0, y: 0, width: safeFrame.width, height: miniPlayerHeight)
        if let rightInfoBg = miniPlayerBar.viewWithTag(901) {
            let videoBoxW: CGFloat = 114
            rightInfoBg.frame = CGRect(x: videoBoxW, y: 0, width: max(0, safeFrame.width - videoBoxW), height: miniPlayerHeight)
            let rw = rightInfoBg.bounds.width
            btnMiniPlayerClose.frame = CGRect(x: rw - 44, y: 10, width: 40, height: 44)
            btnMiniPlayerPlayPause.frame = CGRect(x: rw - 88, y: 10, width: 40, height: 44)
            tvMiniPlayerTitle.frame = CGRect(x: 8, y: 14, width: max(40, rw - 98), height: 18)
            tvMiniPlayerChannel.frame = CGRect(x: 8, y: 34, width: max(40, rw - 98), height: 15)
        }
    }

    private func setupGestures() {
        btnMinimizePlayer.addTarget(self, action: #selector(onTapMinimize), for: .touchUpInside)
        btnMiniPlayerPlayPause.addTarget(self, action: #selector(onTapMiniPlayPause), for: .touchUpInside)
        btnMiniPlayerClose.addTarget(self, action: #selector(onTapMiniClose), for: .touchUpInside)

        let dragPan = UIPanGestureRecognizer(target: self, action: #selector(handleTopDragPan(_:)))
        playerDragArea.addGestureRecognizer(dragPan)

        let dragTap = UITapGestureRecognizer(target: self, action: #selector(onTapMinimize))
        playerDragArea.addGestureRecognizer(dragTap)

        let miniTap = UITapGestureRecognizer(target: self, action: #selector(onTapExpand))
        miniPlayerBar.addGestureRecognizer(miniTap)
    }

    @objc private func handlePullToRefresh() {
        browseWebView.reload()
    }

    @objc private func onTapMinimize() {
        collapsePlayer()
    }

    @objc private func onTapExpand() {
        expandPlayer()
    }

    @objc private func onTapMiniPlayPause() {
        runPipCommand("toggle")
    }

    @objc private func onTapMiniClose() {
        closePlayer()
    }

    @objc private func handleTopDragPan(_ gesture: UIPanGestureRecognizer) {
        guard panelState == .expanded else { return }
        let translation = gesture.translation(in: view)
        switch gesture.state {
        case .changed:
            if translation.y > 0 {
                playerPanel.transform = CGAffineTransform(translationX: 0, y: translation.y)
            }
        case .ended, .cancelled:
            if translation.y > 80 {
                playerPanel.transform = .identity
                collapsePlayer()
            } else {
                UIView.animate(withDuration: 0.2) {
                    self.playerPanel.transform = .identity
                }
            }
        default:
            break
        }
    }

    // MARK: - Điều phối mở / thu nhỏ / phóng to / đóng Video Player
    private func prewarmPlayerWebViewIfNeeded() {
        guard !isPlayerPrewarmed else { return }
        isPlayerPrewarmed = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self, self.panelState == .hidden, self.playerWebView.url == nil else { return }
            if let url = URL(string: "https://m.youtube.com/select_site") {
                self.playerWebView.load(URLRequest(url: url))
            }
        }
    }

    func openVideoPlayer(url: String) {
        guard !url.isEmpty else { return }
        isPlayerPrewarmed = true
        let fullUrl: String
        if url.hasPrefix("http://") || url.hasPrefix("https://") {
            fullUrl = url
        } else {
            fullUrl = "https://m.youtube.com" + (url.hasPrefix("/") ? "" : "/") + url
        }

        let newVid = extractVideoId(from: fullUrl)
        if panelState != .hidden && !newVid.isEmpty && newVid == currentVideoId {
            expandPlayer()
            return
        }

        browseWebView.evaluateJavaScript(
            "(function(){try{var vids=document.querySelectorAll('video');for(var i=0;i<vids.length;i++){vids[i].muted=true;(window.__braveNativePause||vids[i].pause).call(vids[i]);}}catch(e){}})()",
            completionHandler: nil
        )

        panelState = .expanded
        playerPanel.transform = .identity
        playerPanel.backgroundColor = .black
        playerPanel.isHidden = false
        layoutPlayerForCurrentBounds()

        currentVideoId = newVid
        currentTitle = "LiteTube"
        currentChannel = ""
        tvMiniPlayerTitle.text = currentTitle
        tvMiniPlayerChannel.text = currentChannel

        miniPlayerBar.isHidden = true
        btnMinimizePlayer.isHidden = false
        playerDragArea.isHidden = false

        let currentPlayerUrl = playerWebView.url?.absoluteString ?? ""
        if currentPlayerUrl.contains("youtube.com") {
            let escapedUrl = fullUrl.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
            let escapedVid = newVid.replacingOccurrences(of: "'", with: "\\'")
            playerWebView.evaluateJavaScript(
                "(function(){ return (window.__braveOpenWatchSpa && window.__braveOpenWatchSpa('\(escapedUrl)', '\(escapedVid)')) ? 'spa:ok' : 'spa:fallback'; })()"
            ) { [weak self] result, _ in
                guard let self = self else { return }
                let str = result as? String ?? ""
                if !str.contains("spa:ok"), let target = URL(string: fullUrl) {
                    self.playerWebView.load(URLRequest(url: target))
                }
            }
        } else if let target = URL(string: fullUrl) {
            playerWebView.load(URLRequest(url: target))
        }
    }

    func collapsePlayer() {
        guard panelState == .expanded else { return }
        panelState = .collapsed

        let safeFrame = view.safeAreaLayoutGuide.layoutFrame
        let fullW = safeFrame.width
        let fullH = safeFrame.height
        let targetY = safeFrame.minY + max(0, fullH - bottomNavHeight - miniPlayerHeight)

        miniPlayerBar.isHidden = false
        btnMinimizePlayer.isHidden = true
        playerDragArea.isHidden = true

        let vW = max(1, fullW)
        let vH = min(vW * 9.0 / 16.0, fullH * 0.62)
        let boxW: CGFloat = 104.0
        let boxH: CGFloat = 58.0
        let scale = min(boxW / vW, boxH / vH)
        let tx: CGFloat = 4.0 + (boxW - vW * scale) / 2.0
        let ty: CGFloat = (miniPlayerHeight - vH * scale) / 2.0

        playerWebView.layer.anchorPoint = CGPoint(x: 0, y: 0)
        playerWebView.layer.position = .zero
        playerWebView.bounds = CGRect(x: 0, y: 0, width: fullW, height: fullH)

        UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
            self.playerPanel.frame = CGRect(x: safeFrame.minX, y: targetY, width: fullW, height: self.miniPlayerHeight)
            self.playerPanel.backgroundColor = UIColor(red: 0.13, green: 0.13, blue: 0.13, alpha: 1.0)
            self.playerWebView.transform = CGAffineTransform(translationX: tx, y: ty).scaledBy(x: scale, y: scale)
        }
    }

    func expandPlayer() {
        guard panelState == .collapsed else { return }
        panelState = .expanded

        let safeFrame = view.safeAreaLayoutGuide.layoutFrame
        miniPlayerBar.isHidden = true
        btnMinimizePlayer.isHidden = false
        playerDragArea.isHidden = false

        UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
            self.playerPanel.frame = safeFrame
            self.playerPanel.backgroundColor = .black
            self.playerWebView.transform = .identity
        } completion: { [weak self] _ in
            guard let self = self, self.panelState == .expanded else { return }
            self.layoutPlayerForCurrentBounds()
            self.runPipCommand("resync")
        }
    }

    func closePlayer() {
        guard panelState != .hidden else { return }
        panelState = .hidden
        runPipCommand("pause")

        let safeFrame = view.safeAreaLayoutGuide.layoutFrame
        UIView.animate(withDuration: 0.18, animations: {
            self.playerPanel.frame.origin.y = safeFrame.maxY
        }) { [weak self] _ in
            guard let self = self, self.panelState == .hidden else { return }
            self.playerPanel.isHidden = true
            self.layoutPlayerForCurrentBounds()
            self.playerWebView.evaluateJavaScript(
                "(function(){try{if(window.__bravePip)window.__bravePip.pause();var v=document.querySelector('video');if(v){v.pause();v.removeAttribute('src');v.load();}}catch(e){}})()",
                completionHandler: nil
            )
            self.currentVideoId = ""
            self.isVideoPlaying = false
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        }
    }

    // MARK: - Hẹn giờ tắt video tự động (Giống Cốc Cốc: Không / Khi hết video / Sau 15-90 phút)

    func showSleepTimerPickerDialog(onUpdated: (() -> Void)? = nil) {
        let alert = UIAlertController(
            title: "Hẹn giờ tắt video",
            message: "Trạng thái hiện tại: \(AppSettings.shared.getSleepTimerLabel())",
            preferredStyle: .actionSheet
        )

        let options: [(String, Int)] = [
            ("Không", AppSettings.sleepTimerOff),
            ("Khi hết video", AppSettings.sleepTimerEndOfVideo),
            ("Sau 15 phút", 15),
            ("Sau 30 phút", 30),
            ("Sau 45 phút", 45),
            ("Sau 60 phút", 60),
            ("Sau 90 phút", 90)
        ]

        for (title, mode) in options {
            let isSelected = (AppSettings.shared.sleepTimerMode == mode)
            let displayTitle = isSelected ? "✓ \(title)" : title
            alert.addAction(UIAlertAction(title: displayTitle, style: .default) { [weak self] _ in
                self?.applySleepTimerMode(mode)
                onUpdated?()
            })
        }

        alert.addAction(UIAlertAction(title: "Đóng", style: .cancel))
        if let popover = alert.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(alert, animated: true)
    }

    private func applySleepTimerMode(_ mode: Int) {
        sleepTimer?.invalidate()
        sleepTimer = nil
        AppSettings.shared.sleepTimerMode = mode

        if mode > 0 {
            let interval = TimeInterval(mode * 60)
            AppSettings.shared.sleepTimerTargetDate = Date().addingTimeInterval(interval)
            sleepTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
                self?.triggerAutoStopVideo(reason: "Đã hết thời gian hẹn giờ — Tự động tắt video")
            }
            showToast("Đã hẹn giờ tắt video sau \(mode) phút")
        } else if mode == AppSettings.sleepTimerEndOfVideo {
            AppSettings.shared.sleepTimerTargetDate = nil
            showToast("Sẽ tự động tắt khi hết video hiện tại")
        } else {
            AppSettings.shared.sleepTimerTargetDate = nil
            showToast("Đã tắt hẹn giờ video")
        }

        syncSettingsToWeb()
    }

    private func triggerAutoStopVideo(reason: String) {
        sleepTimer?.invalidate()
        sleepTimer = nil
        AppSettings.shared.sleepTimerMode = AppSettings.sleepTimerOff
        AppSettings.shared.sleepTimerTargetDate = nil
        syncSettingsToWeb()

        isVideoPlaying = false
        btnMiniPlayerPlayPause.setImage(UIImage(systemName: "play.fill"), for: .normal)
        runPipCommand("pause")
        updateNowPlayingInfo()
        showToast(reason)
    }

    // MARK: - Hộp thoại Cài đặt LiteTube Native
    func showSettingsSheet() {
        let alert = UIAlertController(
            title: "Cài đặt LiteTube (iOS)",
            message: "Bộ nhớ đệm đã lưu: \(AppSettings.shared.formattedCacheSize())\nHẹn giờ tắt: \(AppSettings.shared.getSleepTimerLabel())",
            preferredStyle: .actionSheet
        )

        let adStatus = AppSettings.shared.isAdBlockEnabled ? "Đang BẬT" : "Đang TẮT"
        alert.addAction(UIAlertAction(title: "🛡️ Chặn quảng cáo & Tua 16x (\(adStatus))", style: .default) { [weak self] _ in
            AppSettings.shared.isAdBlockEnabled.toggle()
            self?.syncSettingsToWeb()
        })

        let bgStatus = AppSettings.shared.isBackgroundPlayEnabled ? "Đang BẬT" : "Đang TẮT"
        alert.addAction(UIAlertAction(title: "🎧 Phát nhạc trong nền (\(bgStatus))", style: .default) { [weak self] _ in
            AppSettings.shared.isBackgroundPlayEnabled.toggle()
            self?.syncSettingsToWeb()
        })

        alert.addAction(UIAlertAction(title: "⏱️ Hẹn giờ tắt video (\(AppSettings.shared.getSleepTimerLabel()))", style: .default) { [weak self] _ in
            self?.showSleepTimerPickerDialog()
        })

        alert.addAction(UIAlertAction(title: "🧹 Xóa bộ nhớ đệm", style: .destructive) { [weak self] _ in
            AppSettings.shared.clearWebCache {
                self?.showToast("Đã xóa sạch bộ nhớ đệm")
            }
        })

        alert.addAction(UIAlertAction(title: "Đóng", style: .cancel))
        if let popover = alert.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(alert, animated: true)
    }

    private func showToast(_ text: String) {
        let label = UILabel()
        label.text = "  \(text)  "
        label.textColor = .white
        label.backgroundColor = UIColor(white: 0.15, alpha: 0.92)
        label.font = UIFont.systemFont(ofSize: 13, weight: .medium)
        label.textAlignment = .center
        label.layer.cornerRadius = 16
        label.layer.masksToBounds = true
        label.sizeToFit()
        let w = min(view.bounds.width - 32, label.bounds.width + 24)
        label.frame = CGRect(x: (view.bounds.width - w) / 2, y: view.bounds.height - 120, width: w, height: 34)
        label.alpha = 0
        view.addSubview(label)
        UIView.animate(withDuration: 0.2, animations: { label.alpha = 1 }) { _ in
            UIView.animate(withDuration: 0.25, delay: 2.0, options: [], animations: { label.alpha = 0 }) { _ in
                label.removeFromSuperview()
            }
        }
    }

    private func syncSettingsToWeb() {
        let json = AppSettings.shared.toJsonString()
        let label = AppSettings.shared.getSleepTimerLabel().replacingOccurrences(of: "'", with: "\\'")
        let script = """
        window.__braveSleepTimerLabel = '\(label)';
        var topSvg = document.querySelector('#__brave_top_sleep_btn svg'); if (topSvg) topSvg.style.fill = (window.__braveSleepTimerLabel && window.__braveSleepTimerLabel !== 'Không') ? '#4caf50' : '#ffffff'; var subEl = document.getElementById('__brave_sleep_timer_menu_sub');
        if (subEl) subEl.textContent = '\(label) ›';
        if (window.__bravePip && window.__bravePip.applySettings) window.__bravePip.applySettings(\(json));
        else window.__braveSettings = \(json);
        """
        browseWebView.evaluateJavaScript(script, completionHandler: nil)
        playerWebView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func runPipCommand(_ method: String) {
        let target = (panelState != .hidden) ? playerWebView : browseWebView
        target?.evaluateJavaScript(
            "(function(){try{return window.__bravePip ? String(window.__bravePip.\(method)()) : 'pip:missing';}catch(e){return 'pip:error';}})()",
            completionHandler: nil
        )
    }

    // MARK: - Điều khiển từ Màn hình khóa, Control Center & Tai nghe AirPods
    private func setupRemoteTransportControls() {
        let commandCenter = MPRemoteCommandCenter.shared()

        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.runPipCommand("play")
            return .success
        }

        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.runPipCommand("pause")
            return .success
        }

        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.runPipCommand("toggle")
            return .success
        }

        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.runPipCommand("next")
            return .success
        }

        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.runPipCommand("previous")
            return .success
        }

        commandCenter.changePlaybackPositionCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let posEvent = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let targetMs = Int64(posEvent.positionTime * 1000.0)
            self?.runPipCommand("seekTo(\(targetMs))")
            return .success
        }
    }

    private func setupAppLifecycleObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onAppDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onAppWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    @objc private func onAppDidEnterBackground() {
        runPipCommand("setBackground(true)")
        if isVideoPlaying && AppSettings.shared.isBackgroundPlayEnabled {
            try? AVAudioSession.sharedInstance().setActive(true)
            runPipCommand("play")
        }
    }

    @objc private func onAppWillEnterForeground() {
        runPipCommand("setBackground(false)")
    }

    private func updateNowPlayingInfo() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: currentTitle,
            MPMediaItemPropertyArtist: currentChannel.isEmpty ? "LiteTube" : currentChannel,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: positionMs / 1000.0,
            MPNowPlayingInfoPropertyPlaybackRate: isVideoPlaying ? 1.0 : 0.0
        ]
        if durationMs > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000.0
        }
        if let artwork = currentArtwork, loadedArtworkVideoId == currentVideoId {
            info[MPMediaItemPropertyArtwork] = artwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func fetchThumbnailIfNeeded(videoId: String) {
        guard !videoId.isEmpty, videoId != loadedArtworkVideoId else { return }
        loadedArtworkVideoId = videoId
        guard let url = URL(string: "https://i.ytimg.com/vi/\(videoId)/hqdefault.jpg") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self, let data = data, let image = UIImage(data: data) else { return }
            let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                if self.currentVideoId == videoId {
                    self.currentArtwork = art
                    self.updateNowPlayingInfo()
                }
            }
        }.resume()
    }

    private func extractVideoId(from urlString: String) -> String {
        guard let comps = URLComponents(string: urlString) else { return "" }
        if let v = comps.queryItems?.first(where: { $0.name == "v" })?.value, !v.isEmpty {
            return v
        }
        let parts = comps.path.split(separator: "/").map(String.init)
        if let idx = parts.firstIndex(of: "shorts"), idx + 1 < parts.count {
            return parts[idx + 1]
        }
        return ""
    }
}

// MARK: - WKScriptMessageHandler & WKNavigationDelegate
extension MainViewController: WKScriptMessageHandler, WKNavigationDelegate {

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "iosBridge",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        let isFromPlayer = (message.webView === playerWebView)

        switch action {
        case "openWatchLayer":
            if let url = body["url"] as? String, !url.isEmpty {
                openVideoPlayer(url: url)
            }
        case "openSettings":
            showSettingsSheet()
        case "openSleepTimerDialog":
            showSleepTimerPickerDialog { [weak self] in
            }
        case "onVideoEnded":
            if AppSettings.shared.sleepTimerMode == AppSettings.sleepTimerEndOfVideo {
                triggerAutoStopVideo(reason: "Đã hết video — Tự động dừng phát")
            }
        case "onShortsStarted":
            if panelState != .hidden {
                closePlayer()
            } else {
                playerWebView.evaluateJavaScript(
                    "(function(){try{var v=document.querySelector('video');if(v&&!v.paused){(window.__braveNativePause||v.pause).call(v);}}catch(e){}})()",
                    completionHandler: nil
                )
            }
        case "onMediaStateWithId":
            let accept = (panelState != .hidden) ? isFromPlayer : !isFromPlayer
            guard accept else { return }
            let playing = body["playing"] as? Bool ?? false
            let vid = (body["videoId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let title = (body["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let channel = (body["channel"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let pos = body["posMs"] as? Double ?? 0
            let dur = body["durMs"] as? Double ?? 0

            isVideoPlaying = playing
            if !vid.isEmpty {
                currentVideoId = vid
                fetchThumbnailIfNeeded(videoId: vid)
            }
            if !title.isEmpty && title != "LiteTube" && title != "YouTube" {
                currentTitle = title
            }
            if !channel.isEmpty {
                currentChannel = channel
            }
            if pos >= 0 { positionMs = pos }
            if dur > 0 { durationMs = dur }

            tvMiniPlayerTitle.text = currentTitle
            tvMiniPlayerChannel.text = currentChannel
            let iconName = playing ? "pause.fill" : "play.fill"
            btnMiniPlayerPlayPause.setImage(UIImage(systemName: iconName), for: .normal)
            updateNowPlayingInfo()
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === browseWebView {
            refreshControl.endRefreshing()
        }
        syncSettingsToWeb()
    }
}

// MARK: - Embedded Scriptlets cho Browse, Player UI & iPad Landscape Fix
extension MainViewController {

    /// CSS chống tràn màn hình ngang trên iPad (Portrait & Landscape):
    /// - Khóa `overflow-x: hidden` và `max-width: 100vw` toàn trang.
    /// - Khi màn hình ngang trên iPad (`min-width: 700px`): giới hạn chiều cao khung video tối đa 62vh
    ///   và giữ tỉ lệ `object-fit: contain` để không bao giờ bị tràn khung hình ảnh hay mất tiêu đề bên dưới.
    /// - Thu gọn thẻ video trên Trang chủ iPad theo dạng lưới gọn gàng, không phóng đại vỡ hình.
    static let ipadResponsiveCssJs: String = """
    (function() {
        try {
            var styleId = '__brave_ipad_responsive_style';
            if (document.getElementById(styleId)) return;
            var css = [
                'html, body {',
                '  max-width: 100vw !important;',
                '  overflow-x: hidden !important;',
                '  box-sizing: border-box !important;',
                '}',
                'img, .video-thumbnail-img, .ytm-thumbnail-cover, ytm-thumbnail-cover {',
                '  max-width: 100% !important;',
                '  box-sizing: border-box !important;',
                '}',
                '@media (min-width: 700px) {',
                '  html:not([data-brave-pip-mode]) #player-container-id,',
                '  html:not([data-brave-pip-mode]) .player-container.sticky-player,',
                '  html:not([data-brave-pip-mode]) .player-size,',
                '  html:not([data-brave-pip-mode]) #movie_player,',
                '  html:not([data-brave-pip-mode]) .html5-video-player {',
                '    max-width: 100vw !important;',
                '    max-height: 62vh !important;',
                '    background: #000 !important;',
                '    overflow: hidden !important;',
                '  }',
                '  html:not([data-brave-pip-mode]) #movie_player video,',
                '  html:not([data-brave-pip-mode]) .html5-video-player video {',
                '    width: 100% !important;',
                '    height: 100% !important;',
                '    max-height: 62vh !important;',
                '    left: 0 !important;',
                '    top: 0 !important;',
                '    object-fit: contain !important;',
                '  }',
                '  ytm-rich-grid-renderer, ytm-section-list-renderer {',
                '    max-width: 100vw !important;',
                '    overflow-x: hidden !important;',
                '  }',
                '  ytm-rich-item-renderer .video-thumbnail-container-large,',
                '  ytm-video-with-context-renderer .video-thumbnail-container-large {',
                '    max-height: 46vh !important;',
                '    overflow: hidden !important;',
                '  }',
                '  ytm-rich-item-renderer .video-thumbnail-img,',
                '  ytm-video-with-context-renderer .video-thumbnail-img {',
                '    object-fit: cover !important;',
                '    width: 100% !important;',
                '    height: 100% !important;',
                '  }',
                '}'
            ].join('\\n');
            var style = document.createElement('style');
            style.id = styleId;
            style.type = 'text/css';
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        } catch(e) {}
    })();
    """

    static let injectPlayerUiCssJs: String = """
    (function() {
        try {
            var styleId = '__brave_player_ui_style';
            var style = document.getElementById(styleId);
            if (!style) {
                var css = [
                    'html:not([data-brave-pip-mode]) ytm-mobile-topbar-renderer,',
                    'html:not([data-brave-pip-mode]) ytm-header-bar,',
                    'html:not([data-brave-pip-mode]) #header-bar,',
                    'html:not([data-brave-pip-mode]) header.mobile-topbar-header,',
                    'html:not([data-brave-pip-mode]) .mobile-topbar-header,',
                    'html:not([data-brave-pip-mode]) .mobile-topbar-header-content {',
                    '  display:none!important; visibility:hidden!important;',
                    '  height:0!important; min-height:0!important; max-height:0!important;',
                    '  margin:0!important; padding:0!important; border:0!important;',
                    '  overflow:hidden!important; pointer-events:none!important;',
                    '}',
                    'html:not([data-brave-pip-mode]) #app,',
                    'html:not([data-brave-pip-mode]) ytm-app,',
                    'html:not([data-brave-pip-mode]) ytm-watch,',
                    'html:not([data-brave-pip-mode]) .page-container,',
                    'html:not([data-brave-pip-mode]) ytm-page-manager {',
                    '  padding-top:0!important; margin-top:0!important;',
                    '}',
                    'html:not([data-brave-pip-mode]) #player-container-id,',
                    'html:not([data-brave-pip-mode]) .player-container.sticky-player,',
                    'html:not([data-brave-pip-mode]) .player-size {',
                    '  top:0!important;',
                    '}'
                ].join('\\n');
                style = document.createElement('style');
                style.id = styleId;
                style.type = 'text/css';
                style.textContent = css;
            }
            var target = document.head || document.documentElement;
            if (target && style.parentNode !== target) {
                target.appendChild(style);
            }
        } catch (e) {}
    })();
    """

    static let browseWatchInterceptorJs: String = """
    (function() {
        if (window.__braveWatchInterceptorInstalled) return;
        window.__braveWatchInterceptorInstalled = true;
        window.__braveIsBrowseWebView = true;

        var lastDispatchedUrl = '';
        var lastDispatchedTime = 0;

        function isWatchUrl(url) {
            if (!url || typeof url !== 'string') return false;
            return url.indexOf('/watch') !== -1 && url.indexOf('/shorts/') === -1;
        }

        function isShortsActive() {
            var p = window.location.pathname || '';
            return p.indexOf('/shorts') !== -1;
        }

        function stopAllBrowseVideos() {
            try {
                var vids = document.querySelectorAll('video');
                for (var i = 0; i < vids.length; i++) {
                    var v = vids[i];
                    if (!v.paused) {
                        window.__braveAllowPauseUntil = Date.now() + 1000;
                        (window.__braveNativePause || v.pause).call(v);
                    }
                    v.muted = true;
                }
            } catch(e) {}
        }

        function dispatchWatchUrl(url) {
            if (!url || typeof url !== 'string') return false;
            var fullUrl = url;
            if (fullUrl.indexOf('http') !== 0) {
                var origin = window.location.origin || 'https://m.youtube.com';
                fullUrl = origin + (fullUrl.indexOf('/') === 0 ? '' : '/') + fullUrl;
            }
            if (isWatchUrl(fullUrl)) {
                stopAllBrowseVideos();
                var now = Date.now();
                if (fullUrl === lastDispatchedUrl && (now - lastDispatchedTime) < 600) {
                    return true;
                }
                lastDispatchedUrl = fullUrl;
                lastDispatchedTime = now;
                if (window.AndroidBridge && typeof window.AndroidBridge.openWatchLayer === 'function') {
                    window.AndroidBridge.openWatchLayer(fullUrl);
                    return true;
                }
            }
            return false;
        }

        document.addEventListener('play', function(e) {
            var v = e.target;
            if (!v || v.tagName !== 'VIDEO') return;
            if (!isShortsActive()) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    window.__braveAllowPauseUntil = Date.now() + 1000;
                    v.muted = true;
                    (window.__braveNativePause || v.pause).call(v);
                } catch(err) {}
            } else {
                if (window.AndroidBridge && typeof window.AndroidBridge.onShortsStarted === 'function') {
                    try { window.AndroidBridge.onShortsStarted(); } catch(err2) {}
                }
            }
        }, true);

        try {
            var origPushState = history.pushState;
            history.pushState = function(state, title, url) {
                if (url) {
                    var sUrl = String(url);
                    if (isWatchUrl(sUrl)) {
                        if (dispatchWatchUrl(sUrl)) return;
                    } else if (sUrl.indexOf('/shorts') !== -1) {
                        if (window.AndroidBridge && typeof window.AndroidBridge.onShortsStarted === 'function') {
                            try { window.AndroidBridge.onShortsStarted(); } catch(eS) {}
                        }
                    }
                }
                return origPushState.apply(history, arguments);
            };

            var origReplaceState = history.replaceState;
            history.replaceState = function(state, title, url) {
                if (url) {
                    var sUrl = String(url);
                    if (isWatchUrl(sUrl)) {
                        if (dispatchWatchUrl(sUrl)) return;
                    } else if (sUrl.indexOf('/shorts') !== -1) {
                        if (window.AndroidBridge && typeof window.AndroidBridge.onShortsStarted === 'function') {
                            try { window.AndroidBridge.onShortsStarted(); } catch(eS2) {}
                        }
                    }
                }
                return origReplaceState.apply(history, arguments);
            };
        } catch(e) {}

        function onDocClick(e) {
            try {
                var el = e.target;
                if (!el || !el.closest) return;
                if (el.closest('ytm-menu, .media-item-menu, button[aria-label*="Action" i], button[aria-label*="Thao tác" i], button[aria-label*="More" i], button[aria-label*="Thêm" i]')) {
                    return;
                }
                var pivotTab = el.closest('ytm-pivot-bar-item-renderer, [role="tab"]');
                if (pivotTab && pivotTab.textContent && pivotTab.textContent.toLowerCase().indexOf('shorts') !== -1) {
                    if (window.AndroidBridge && typeof window.AndroidBridge.onShortsStarted === 'function') {
                        try { window.AndroidBridge.onShortsStarted(); } catch(eTab) {}
                    }
                    return;
                }
                var anchor = el.closest('a');
                if (anchor && anchor.href && isWatchUrl(anchor.href)) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    dispatchWatchUrl(anchor.href);
                    return false;
                }
                var videoContainer = el.closest('ytm-compact-video-renderer, ytm-video-with-context-renderer, ytm-rich-item-renderer, ytm-media-item, ytm-playlist-panel-video-renderer');
                if (videoContainer) {
                    var innerA = videoContainer.querySelector('a[href*="/watch"]');
                    if (innerA && innerA.href && isWatchUrl(innerA.href)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        dispatchWatchUrl(innerA.href);
                        return false;
                    }
                }
            } catch(err) {}
        }

        document.addEventListener('click', onDocClick, true);
    })();
    """

    static let selectSiteSettingsScriptletJs: String = """
    (function() {
        function injectSelectSiteItem() {
            try {
                if (window.location.href.indexOf('select_site') === -1) return false;
                if (document.getElementById('ytlite-select-site-item')) return true;
                var container = document.querySelector('ytm-settings-options, ytm-item-section-renderer, #contents, .item-section-renderer-contents, div[role="navigation"]');
                if (!container) return false;
                var row = document.createElement('div');
                row.id = 'ytlite-select-site-item';
                row.setAttribute('role', 'button');
                row.style.cssText = 'display:flex;align-items:center;padding:14px 16px;cursor:pointer;color:#fff;border-bottom:1px solid rgba(255,255,255,0.08);';
                row.innerHTML = '<div style="flex:1"><div style="font-size:15px;font-weight:500;color:#fff">Cài đặt LiteTube (iOS)</div><div style="font-size:12px;color:#aaa;margin-top:2px">Hẹn giờ tắt video, chặn quảng cáo, phát nền...</div></div>';
                row.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.AndroidBridge && window.AndroidBridge.openSettings) window.AndroidBridge.openSettings();
                };
                container.insertBefore(row, container.firstChild);
                return true;
            } catch(e) { return false; }
        }
        window.addEventListener('yt-navigate-finish', injectSelectSiteItem);
        window.addEventListener('popstate', injectSelectSiteItem);
        injectSelectSiteItem();
    })();
    """
}

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}
