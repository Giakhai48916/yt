package com.brave.youtubelite

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.app.UiModeManager
import android.view.KeyEvent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Rational
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.JavascriptInterface
import android.speech.RecognizerIntent
import android.webkit.PermissionRequest
import androidx.activity.result.contract.ActivityResultContracts
import java.net.URLEncoder
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.brave.youtubelite.network.AdBlockEngine
import com.brave.youtubelite.network.AppWebViewClient
import com.brave.youtubelite.network.WebResourceCacheManager
import com.brave.youtubelite.service.MediaService
import com.brave.youtubelite.settings.AppSettings
import com.brave.youtubelite.view.KeepAliveWebView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.switchmaterial.SwitchMaterial
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val ACTION_PIP_PLAY = "com.brave.youtubelite.PIP_PLAY"
        private const val ACTION_PIP_PAUSE = "com.brave.youtubelite.PIP_PAUSE"
        private const val ACTION_PIP_HEADPHONES = "com.brave.youtubelite.PIP_HEADPHONES"
        private const val TAG = "MainActivity"
        private const val REQ_RECORD_AUDIO = 102
        private const val TV_USER_AGENT = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36"
    }

    enum class PanelState {
        HIDDEN, EXPANDED, COLLAPSED
    }

    private var pipControllerJs: String = ""

    // TẦNG DƯỚI: Browse WebView (Trang chủ, Kênh, Tìm kiếm, Đăng ký, Shorts...)
    private lateinit var mainContainer: FrameLayout
    private lateinit var webView: KeepAliveWebView
    private lateinit var swipeRefreshLayout: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar
    private lateinit var customViewContainer: FrameLayout

    // TẦNG TRÊN: Lớp phát Video trượt đè lên (Sliding Video Player Layer)
    private lateinit var playerPanel: FrameLayout
    private lateinit var playerWebView: KeepAliveWebView
    private lateinit var playerDragArea: View
    private lateinit var btnMinimizePlayer: ImageButton
    private lateinit var miniPlayerBar: LinearLayout
    private lateinit var miniPlayerInfoContainer: LinearLayout
    private lateinit var tvMiniPlayerTitle: TextView
    private lateinit var tvMiniPlayerChannel: TextView
    private lateinit var btnMiniPlayerPlayPause: ImageButton
    private lateinit var btnMiniPlayerClose: ImageButton

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var isFullscreen = false

    private var panelState = PanelState.HIDDEN
    private var wasCollapsedBeforePip = false
    private val bottomNavHeightDp = 48f
    private var lastMiniIconPlaying: Boolean? = null
    private var isVideoPlaying = false
    private var currentVideoId = ""
    private var currentTitle = "LiteTube"
    private var currentChannel = ""
    private var positionMs: Long = 0L
    private var durationMs: Long = -1L
    private var isMediaServiceActive = false
    private var lastMediaServiceUpdateElapsedMs = 0L
    private var lastMediaServicePlayingState: Boolean? = null
    private var lastMediaServiceTitle: String = ""
    private var lastMediaServiceVideoId: String = ""

    private var isPlayerPrewarmed = false
    private var isTvDevice = false
    private var lastTvBackPressMs = 0L
    private var tvBackPressCount = 0

    // Bộ thu âm tìm kiếm bằng giọng nói Tiếng Việt (hoạt động trực tiếp bên trong LiteTube, không bị nhảy sang YouTube gốc)
    private val voiceSearchLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val matches = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val spokenText = matches?.firstOrNull()?.trim()
            if (!spokenText.isNullOrEmpty()) {
                executeVoiceSearchQuery(spokenText)
            }
        }
    }
    private var wasInPipMode = false
    private var isInPipLayout = false
    private var isHidingPipToAudio = false
    private var hidingPipToAudioAtMs = 0L
    private val pipHandler = Handler(Looper.getMainLooper())
    private val pendingPipEnterRunnables = mutableListOf<Runnable>()
    private val pendingCollapseRunnable = Runnable {
        if (panelState == PanelState.EXPANDED && !isInPipModeCompat() && !isFullscreen) {
            collapsePlayer()
        }
    }

    // Runnable hẹn giờ tắt video tự động theo số phút
    private val sleepTimerCountdownRunnable = Runnable {
        triggerAutoStopVideo(reason = "Đã hết thời gian hẹn giờ — Tự động tắt video")
    }

    private var videoAspectRatio = Rational(16, 9)

    private val mediaActionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_PIP_HEADPHONES -> handlePipHeadphones()
                ACTION_PIP_PLAY, MediaService.ACTION_MEDIA_PLAY -> handlePipPlay()
                ACTION_PIP_PAUSE, MediaService.ACTION_MEDIA_PAUSE -> handlePipPause()
                MediaService.ACTION_MEDIA_NEXT -> runPipCommand("next")
                MediaService.ACTION_MEDIA_PREV -> runPipCommand("previous")
                MediaService.ACTION_MEDIA_SEEK -> {
                    val pos = intent.getLongExtra(MediaService.EXTRA_SEEK_POS_MS, 0L)
                    runPipCommand("seekTo($pos)")
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // BẢO MẬT TÀI KHOẢN: Tắt gỡ lỗi từ xa WebView để ngăn đọc trộm cookie đăng nhập Google qua USB/ADB
        WebView.setWebContentsDebuggingEnabled(false)

        AdBlockEngine.isEnabled = AppSettings.isAdBlockEnabled(this)
        WebResourceCacheManager.isEnabled = AppSettings.isPreloadCacheEnabled(this)

        val filter = IntentFilter().apply {
            addAction(ACTION_PIP_HEADPHONES)
            addAction(ACTION_PIP_PLAY)
            addAction(ACTION_PIP_PAUSE)
            addAction(MediaService.ACTION_MEDIA_PLAY)
            addAction(MediaService.ACTION_MEDIA_PAUSE)
            addAction(MediaService.ACTION_MEDIA_NEXT)
            addAction(MediaService.ACTION_MEDIA_PREV)
            addAction(MediaService.ACTION_MEDIA_SEEK)
        }
        ContextCompat.registerReceiver(
            this,
            mediaActionReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED
        )

        requestNotificationPermission()

        AdBlockEngine.init(applicationContext)

        pipControllerJs = try {
            assets.open("scriptlets/pip_controller.js").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            Log.e(TAG, "Không đọc được pip_controller.js: ${e.message}")
            ""
        }

        isTvDevice = detectAndroidTv()
        initViews()
        setupBackPressedHandler()

        if (isTvDevice) {
            setupTvMode()
        } else {
            setupBrowseWebView()
            setupPlayerWebView()
            setupPlayerGestures()

            val targetUrl = intent?.dataString ?: "https://m.youtube.com"
            if (targetUrl.contains("/watch") && !targetUrl.contains("/shorts/")) {
                webView.loadUrl("https://m.youtube.com")
                openVideoPlayer(targetUrl)
            } else {
                webView.loadUrl(targetUrl)
                prewarmPlayerWebViewIfNeeded()
            }
        }
    }

    /**
     * Mở trình nhận diện giọng nói Tiếng Việt (dùng micro của Remote TV TCL/Sony hoặc điện thoại).
     * Kết quả tìm kiếm sẽ mở thẳng bên trong LiteTube, tuyệt đối không bị kéo sang ứng dụng YouTube gốc!
     */
    fun startVoiceSearch() {
        runOnUiThread {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.RECORD_AUDIO),
                    REQ_RECORD_AUDIO
                )
                return@runOnUiThread
            }

            try {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "vi-VN")
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "vi-VN")
                    putExtra(RecognizerIntent.EXTRA_PROMPT, "Nói tên bài hát hoặc video muốn tìm...")
                }
                voiceSearchLauncher.launch(intent)
            } catch (_: Exception) {
                Toast.makeText(
                    this,
                    "Thiết bị chưa bật dịch vụ nhận diện giọng nói Google",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun executeVoiceSearchQuery(query: String) {
        val encoded = try {
            URLEncoder.encode(query, "UTF-8")
        } catch (_: Exception) {
            Uri.encode(query)
        }
        Toast.makeText(this, "Đang tìm: $query", Toast.LENGTH_SHORT).show()
        if (isTvDevice) {
            webView.loadUrl("https://www.youtube.com/tv#/results?search_query=$encoded")
        } else {
            if (panelState == PanelState.EXPANDED) {
                collapsePlayer()
            }
            webView.loadUrl("https://m.youtube.com/results?search_query=$encoded")
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_RECORD_AUDIO &&
            grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        ) {
            startVoiceSearch()
        }
    }

    private fun handleWebAudioPermission(request: PermissionRequest?) {
        request ?: return
        val wantsAudio = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
        if (wantsAudio && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED
        ) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else if (wantsAudio) {
            request.deny()
            startVoiceSearch()
        } else {
            request.deny()
        }
    }

    private fun detectAndroidTv(): Boolean {
        val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        val isTvUiMode = uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
        val hasLeanback = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        val noTouchscreen = !packageManager.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)
        return isTvUiMode || hasLeanback || noTouchscreen
    }

    /**
     * CHẾ ĐỘ ANDROID TV SIÊU NHẸ (Tương thích mọi TV TCL, Sony, Xiaomi, Android Box):
     * - Chỉ chạy DUY NHẤT 1 WebView (tắt hoàn toàn playerWebView thứ 2 để tiết kiệm ~50% RAM cho TV 1.5-2GB RAM).
     * - Tải giao diện chuẩn YouTube TV (https://www.youtube.com/tv) hỗ trợ điều khiển Remote Lên/Xuống/Trái/Phải/OK mượt mà.
     * - Khóa toàn màn hình ngang, giữ màn hình sáng khi xem video và vẫn chạy đầy đủ chặn quảng cáo + hẹn giờ tắt video.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun setupTvMode() {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        swipeRefreshLayout.isEnabled = false
        playerPanel.visibility = View.GONE
        playerWebView.onPause()

        configureWebSettings(webView)
        webView.settings.userAgentString = TV_USER_AGENT
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true
        webView.addJavascriptInterface(MediaBridge(fromPlayer = false), "AndroidBridge")

        val tvClient = AppWebViewClient(applicationContext, isBrowseMode = false)
        tvClient.installDocumentStartScripts(webView)
        webView.webViewClient = tvClient

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread { handleWebAudioPermission(request) }
            }
        }

        webView.requestFocus()
        val incoming = intent?.dataString
        val tvUrl = if (!incoming.isNullOrBlank() && incoming.contains("youtube.com")) {
            val vid = extractVideoIdFromUrl(incoming)
            if (vid.isNotEmpty()) "https://www.youtube.com/tv#/watch?v=$vid" else "https://www.youtube.com/tv"
        } else {
            "https://www.youtube.com/tv"
        }
        webView.loadUrl(tvUrl)
    }

    /**
     * Menu nhanh dành cho Remote TV (nhấn nút Menu / Settings / Info trên điều khiển TCL / Sony):
     * Hoàn toàn điều khiển được bằng phím mũi tên Lên/Xuống và nút OK trên Remote.
     */
    private fun showTvQuickMenu() {
        val adLabel = if (AppSettings.isAdBlockEnabled(this)) "Đang BẬT" else "Đang TẮT"
        val sleepLabel = AppSettings.getSleepTimerLabel()
        val items = arrayOf(
            "🎤 Tìm kiếm bằng giọng nói (Tiếng Việt)",
            "⏱️ Hẹn giờ tắt video ($sleepLabel)",
            "🛡️ Chặn quảng cáo & Tua 16x ($adLabel)",
            "🔄 Tải lại ứng dụng",
            "🧹 Xóa bộ nhớ đệm (tăng tốc TV)",
            "🔒 Đăng xuất & Xóa sạch phiên Google"
        )
        AlertDialog.Builder(this)
            .setTitle("LiteTube TV")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> startVoiceSearch()
                    1 -> showSleepTimerPickerDialog()
                    2 -> {
                        val next = !AppSettings.isAdBlockEnabled(this)
                        AppSettings.setAdBlockEnabled(this, next)
                        AdBlockEngine.isEnabled = next
                        syncSettingsToWeb()
                        Toast.makeText(this, if (next) "Đã BẬT chặn quảng cáo" else "Đã TẮT chặn quảng cáo", Toast.LENGTH_SHORT).show()
                    }
                    3 -> webView.reload()
                    4 -> {
                        WebResourceCacheManager.clearCache(this)
                        AppSettings.clearAppCache(this)
                        webView.clearCache(true)
                        Toast.makeText(this, "Đã xóa sạch bộ nhớ đệm", Toast.LENGTH_SHORT).show()
                    }
                    5 -> {
                        CookieManager.getInstance().removeAllCookies {
                            CookieManager.getInstance().flush()
                        }
                        WebStorage.getInstance().deleteAllData()
                        webView.clearCache(true)
                        webView.loadUrl("https://www.youtube.com/tv")
                        Toast.makeText(this, "Đã đăng xuất & xóa sạch cookie tài khoản", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Đóng", null)
            .show()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!isTvDevice) return super.dispatchKeyEvent(event)

        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_SEARCH,
                KeyEvent.KEYCODE_VOICE_ASSIST,
                KeyEvent.KEYCODE_ASSIST,
                KeyEvent.KEYCODE_PROG_RED -> {
                    startVoiceSearch()
                    return true
                }
                KeyEvent.KEYCODE_MENU,
                KeyEvent.KEYCODE_SETTINGS,
                KeyEvent.KEYCODE_INFO,
                KeyEvent.KEYCODE_BOOKMARK -> {
                    showTvQuickMenu()
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                    runPipCommand("toggle")
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PLAY -> {
                    runPipCommand("play")
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                    runPipCommand("pause")
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                    webView.evaluateJavascript("window.__braveTvSeekBy && window.__braveTvSeekBy(10);", null)
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_REWIND -> {
                    webView.evaluateJavascript("window.__braveTvSeekBy && window.__braveTvSeekBy(-10);", null)
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_NEXT -> {
                    runPipCommand("next")
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                    runPipCommand("previous")
                    return true
                }
            }
        }

        // Chuyển phím OK (DPAD_CENTER) trên điều khiển TV TCL/Sony thành ENTER để YouTube TV nhận 100%
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
            val enterEvent = KeyEvent(
                event.downTime,
                event.eventTime,
                event.action,
                KeyEvent.KEYCODE_ENTER,
                event.repeatCount,
                event.metaState,
                event.deviceId,
                event.scanCode,
                event.flags,
                event.source
            )
            return super.dispatchKeyEvent(enterEvent)
        }

        return super.dispatchKeyEvent(event)
    }

    private fun initViews() {
        mainContainer = findViewById(R.id.mainContainer)
        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        customViewContainer = findViewById(R.id.customViewContainer)
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)

        playerPanel = findViewById(R.id.playerPanel)
        playerWebView = findViewById(R.id.playerWebView)
        playerDragArea = findViewById(R.id.playerDragArea)
        btnMinimizePlayer = findViewById(R.id.btnMinimizePlayer)
        miniPlayerBar = findViewById(R.id.miniPlayerBar)
        miniPlayerInfoContainer = findViewById(R.id.miniPlayerInfoContainer)
        tvMiniPlayerTitle = findViewById(R.id.tvMiniPlayerTitle)
        tvMiniPlayerChannel = findViewById(R.id.tvMiniPlayerChannel)
        btnMiniPlayerPlayPause = findViewById(R.id.btnMiniPlayerPlayPause)
        btnMiniPlayerClose = findViewById(R.id.btnMiniPlayerClose)

        swipeRefreshLayout.setProgressBackgroundColorSchemeColor(Color.parseColor("#212121"))
        swipeRefreshLayout.setColorSchemeColors(Color.parseColor("#FF0000"), Color.parseColor("#FF5722"))
        swipeRefreshLayout.setOnRefreshListener {
            webView.reload()
        }
        swipeRefreshLayout.setOnChildScrollUpCallback { _, _ ->
            // Khi đang ở tab Shorts (/shorts/), khóa SwipeRefreshLayout để thao tác vuốt dọc chuyển video Shorts mượt 100%
            val currentBrowseUrl = webView.url ?: ""
            if (currentBrowseUrl.contains("/shorts")) {
                true
            } else {
                webView.scrollY > 0
            }
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    101
                )
            }
        }
    }

    private fun configureWebSettings(view: WebView) {
        val settings = view.settings
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            saveFormData = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }

            setCacheMode(WebSettings.LOAD_DEFAULT)
            mediaPlaybackRequiresUserGesture = false
            offscreenPreRaster = false

            userAgentString = settings.userAgentString.replace("; wv", "")
        }
        view.setLayerType(View.LAYER_TYPE_NONE, null)
        view.isFocusable = true
        view.isFocusableInTouchMode = true
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun setupBrowseWebView() {
        configureWebSettings(webView)

        webView.addJavascriptInterface(MediaBridge(fromPlayer = false), "AndroidBridge")
        val browseClient = AppWebViewClient(applicationContext, isBrowseMode = true).apply {
            onInterceptWatchUrl = { url ->
                if (url.contains("/watch") && !url.contains("/shorts/")) {
                    openVideoPlayer(url)
                    true
                } else {
                    false
                }
            }
            onPageFinishedCallback = {
                runOnUiThread {
                    swipeRefreshLayout.isRefreshing = false
                }
            }
        }
        browseClient.installDocumentStartScripts(webView)
        webView.webViewClient = browseClient

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                    swipeRefreshLayout.isRefreshing = false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread { handleWebAudioPermission(request) }
            }
        }
    }

    /**
     * Khởi động sẵn V8 & Polymer framework của YouTube trong playerWebView bằng trang tĩnh `select_site`
     * (tuyệt đối không có video feed nên không bao giờ tự phát nhạc ngầm hay tốn băng thông).
     */
    private fun prewarmPlayerWebViewIfNeeded() {
        if (isPlayerPrewarmed) return
        isPlayerPrewarmed = true
        pipHandler.postDelayed({
            if (panelState == PanelState.HIDDEN && playerWebView.url.isNullOrBlank()) {
                playerWebView.onResume()
                playerWebView.loadUrl("https://m.youtube.com/select_site")
                pipHandler.postDelayed({
                    if (panelState == PanelState.HIDDEN) {
                        playerWebView.onPause()
                    }
                }, 3500)
            }
        }, 500)
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun setupPlayerWebView() {
        configureWebSettings(playerWebView)

        playerWebView.addJavascriptInterface(MediaBridge(fromPlayer = true), "AndroidBridge")
        val playerClient = AppWebViewClient(applicationContext, isBrowseMode = false)
        playerClient.installDocumentStartScripts(playerWebView)
        playerWebView.webViewClient = playerClient

        playerWebView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (panelState != PanelState.EXPANDED) return
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                return true
            }

            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                enterFullscreen(view, callback)
            }

            override fun onHideCustomView() {
                exitFullscreen()
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupPlayerGestures() {
        btnMinimizePlayer.setOnClickListener {
            collapsePlayer()
        }

        var startY = 0f
        var isDragging = false
        playerDragArea.setOnTouchListener { _, event ->
            if (panelState != PanelState.EXPANDED) return@setOnTouchListener false
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    startY = event.rawY
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaY = event.rawY - startY
                    if (deltaY > dpToPx(12f) || isDragging) {
                        isDragging = true
                        if (deltaY > 0) {
                            playerPanel.translationY = deltaY
                        }
                    }
                    isDragging
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (isDragging) {
                        val deltaY = event.rawY - startY
                        if (deltaY > dpToPx(80f)) {
                            collapsePlayer()
                        } else {
                            expandPlayer()
                        }
                        isDragging = false
                        true
                    } else {
                        collapsePlayer()
                        true
                    }
                }
                else -> false
            }
        }

        var miniStartY = 0f
        miniPlayerBar.setOnTouchListener { _, event ->
            if (panelState != PanelState.COLLAPSED) return@setOnTouchListener false
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    miniStartY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaY = event.rawY - miniStartY
                    if (deltaY < -dpToPx(20f)) {
                        expandPlayer()
                        true
                    } else false
                }
                MotionEvent.ACTION_UP -> {
                    expandPlayer()
                    true
                }
                else -> false
            }
        }

        miniPlayerInfoContainer.setOnClickListener {
            expandPlayer()
        }

        btnMiniPlayerPlayPause.setOnClickListener {
            runPipCommand("toggle")
        }

        btnMiniPlayerClose.setOnClickListener {
            closePlayer()
        }
    }

    /**
     * Mở một video mới đè lên trang hiện tại:
     * Ngắt mọi video/âm thanh trên Browse WebView trước để tuyệt đối không xảy ra hiện tượng 2 âm thanh chồng nhau.
     */
    fun openVideoPlayer(url: String) {
        if (url.isEmpty()) return
        runOnUiThread {
            isPlayerPrewarmed = true
            val fullUrl = if (url.startsWith("http://") || url.startsWith("https://")) {
                url
            } else {
                "https://m.youtube.com" + (if (url.startsWith("/")) "" else "/") + url
            }
            val newVid = extractVideoIdFromUrl(fullUrl)

            if (panelState != PanelState.HIDDEN && newVid.isNotEmpty() && newVid == currentVideoId) {
                expandPlayer()
                return@runOnUiThread
            }

            panelState = PanelState.EXPANDED
            pipHandler.removeCallbacks(pendingCollapseRunnable)

            // Tắt ngay mọi video trên Browse WebView (nếu có) trước khi tạm nghỉ Browse WebView
            webView.evaluateJavascript(
                "(function(){try{var vids=document.querySelectorAll('video');for(var i=0;i<vids.length;i++){vids[i].muted=true;(window.__braveNativePause||vids[i].pause).call(vids[i]);}}catch(e){}})()",
                null
            )
            playerWebView.onResume()
            webView.onPause()

            playerPanel.animate().cancel()
            playerWebView.animate().cancel()

            val params = playerPanel.layoutParams as FrameLayout.LayoutParams
            params.height = ViewGroup.LayoutParams.MATCH_PARENT
            params.gravity = Gravity.TOP
            params.bottomMargin = 0
            playerPanel.layoutParams = params
            playerPanel.setBackgroundColor(Color.BLACK)
            playerPanel.visibility = View.VISIBLE
            playerPanel.translationY = 0f

            resetPlayerWebViewTransform()
            unlockPlayerWebViewSize()

            currentVideoId = newVid
            currentTitle = "LiteTube"
            currentChannel = ""
            positionMs = 0L
            durationMs = -1L
            tvMiniPlayerTitle.text = currentTitle
            tvMiniPlayerChannel.text = currentChannel

            miniPlayerBar.visibility = View.GONE
            btnMinimizePlayer.visibility = View.VISIBLE
            playerDragArea.visibility = View.VISIBLE

            val currentPlayerUrl = playerWebView.url ?: ""
            if (currentPlayerUrl.contains("youtube.com")) {
                val safeUrl = JSONObject.quote(fullUrl)
                val safeVid = JSONObject.quote(newVid)
                playerWebView.evaluateJavascript(
                    "(function(){ return (window.__braveOpenWatchSpa && window.__braveOpenWatchSpa($safeUrl, $safeVid)) ? 'spa:ok' : 'spa:fallback'; })()"
                ) { result ->
                    if (result == null || !result.contains("spa:ok")) {
                        playerWebView.loadUrl(fullUrl)
                    }
                }
            } else {
                playerWebView.loadUrl(fullUrl)
            }
        }
    }

    /**
     * Thu nhỏ lớp xem video xuống thanh MiniPlayer ở đáy màn hình (COLLAPSED)
     */
    fun collapsePlayer() {
        if (panelState == PanelState.COLLAPSED || panelState == PanelState.HIDDEN) return
        panelState = PanelState.COLLAPSED

        webView.onResume()

        val fullW = mainContainer.width
        val fullH = mainContainer.height

        lockPlayerWebViewSize(fullW, fullH)

        miniPlayerBar.visibility = View.VISIBLE
        miniPlayerBar.alpha = 1f
        btnMinimizePlayer.visibility = View.GONE
        playerDragArea.visibility = View.GONE

        animateToMiniImmediate(fullW, fullH)
    }

    private fun animateToMiniImmediate(fullW: Int, fullH: Int) {
        val bottomNavH = dpToPx(bottomNavHeightDp)
        val miniH = dpToPx(64f)
        val boxW = dpToPx(104f)
        val boxH = dpToPx(58f)
        val boxLeft = dpToPx(4f)
        val targetY = (fullH - bottomNavH - miniH).coerceAtLeast(0f)

        val vW = fullW.toFloat().coerceAtLeast(1f)
        val vH = vW * 9f / 16f

        val scale = minOf(boxW / vW, boxH / vH)
        val tx = boxLeft + (boxW - vW * scale) / 2f
        val ty = (miniH - vH * scale) / 2f

        playerPanel.animate().cancel()
        playerWebView.animate().cancel()

        playerPanel.animate()
            .translationY(targetY)
            .setDuration(200)
            .setInterpolator(DecelerateInterpolator())
            .withEndAction {
                if (panelState != PanelState.COLLAPSED) return@withEndAction
                val params = playerPanel.layoutParams as FrameLayout.LayoutParams
                params.height = miniH.toInt()
                params.gravity = Gravity.BOTTOM
                params.bottomMargin = bottomNavH.toInt()
                playerPanel.layoutParams = params
                playerPanel.translationY = 0f
                playerPanel.setBackgroundColor(Color.parseColor("#212121"))
            }
            .start()

        playerWebView.pivotX = 0f
        playerWebView.pivotY = 0f
        playerWebView.animate()
            .scaleX(scale)
            .scaleY(scale)
            .translationX(tx)
            .translationY(ty)
            .setDuration(200)
            .setInterpolator(DecelerateInterpolator())
            .start()
    }

    private fun lockPlayerWebViewSize(w: Int, h: Int) {
        if (w <= 0 || h <= 0) return
        val lp = playerWebView.layoutParams as FrameLayout.LayoutParams
        if (lp.width != w || lp.height != h) {
            lp.width = w
            lp.height = h
            playerWebView.layoutParams = lp
        }
    }

    private fun unlockPlayerWebViewSize() {
        val lp = playerWebView.layoutParams as FrameLayout.LayoutParams
        if (lp.width != ViewGroup.LayoutParams.MATCH_PARENT || lp.height != ViewGroup.LayoutParams.MATCH_PARENT) {
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT
            lp.height = ViewGroup.LayoutParams.MATCH_PARENT
            playerWebView.layoutParams = lp
        }
    }

    private fun resetPlayerWebViewTransform() {
        playerWebView.animate().cancel()
        playerWebView.pivotX = 0f
        playerWebView.pivotY = 0f
        playerWebView.scaleX = 1f
        playerWebView.scaleY = 1f
        playerWebView.translationX = 0f
        playerWebView.translationY = 0f
    }

    fun expandPlayer() {
        if (panelState == PanelState.EXPANDED || panelState == PanelState.HIDDEN) return
        panelState = PanelState.EXPANDED

        playerWebView.onResume()
        webView.onPause()

        val fullW = mainContainer.width
        val fullH = mainContainer.height
        val bottomNavH = dpToPx(bottomNavHeightDp)
        val miniH = dpToPx(64f)
        val targetY = (fullH - bottomNavH - miniH).coerceAtLeast(0f)

        lockPlayerWebViewSize(fullW, fullH)

        playerPanel.animate().cancel()
        playerWebView.animate().cancel()

        val params = playerPanel.layoutParams as FrameLayout.LayoutParams
        params.height = ViewGroup.LayoutParams.MATCH_PARENT
        params.gravity = Gravity.TOP
        params.bottomMargin = 0
        playerPanel.layoutParams = params
        playerPanel.translationY = targetY
        playerPanel.setBackgroundColor(Color.BLACK)

        miniPlayerBar.visibility = View.GONE
        btnMinimizePlayer.visibility = View.VISIBLE
        playerDragArea.visibility = View.VISIBLE

        playerPanel.animate()
            .translationY(0f)
            .setDuration(200)
            .setInterpolator(DecelerateInterpolator())
            .withEndAction {
                if (panelState != PanelState.EXPANDED) return@withEndAction
                unlockPlayerWebViewSize()
                runPipCommand("resync")
            }
            .start()

        playerWebView.pivotX = 0f
        playerWebView.pivotY = 0f
        playerWebView.animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationX(0f)
            .translationY(0f)
            .setDuration(200)
            .setInterpolator(DecelerateInterpolator())
            .start()
    }

    fun closePlayer() {
        if (panelState == PanelState.HIDDEN) return
        panelState = PanelState.HIDDEN

        webView.onResume()
        runPipCommand("pause")

        val targetY = mainContainer.height.toFloat()
        playerPanel.animate().cancel()
        playerWebView.animate().cancel()
        playerPanel.animate()
            .translationY(targetY)
            .setDuration(180)
            .withEndAction {
                if (panelState != PanelState.HIDDEN) return@withEndAction
                playerPanel.visibility = View.GONE
                val params = playerPanel.layoutParams as FrameLayout.LayoutParams
                params.height = ViewGroup.LayoutParams.MATCH_PARENT
                params.gravity = Gravity.TOP
                params.bottomMargin = 0
                playerPanel.layoutParams = params
                playerPanel.translationY = 0f
                playerPanel.setBackgroundColor(Color.BLACK)

                resetPlayerWebViewTransform()
                unlockPlayerWebViewSize()

                playerWebView.evaluateJavascript(
                    "(function(){try{if(window.__bravePip)window.__bravePip.pause();var v=document.querySelector('video');if(v){v.pause();v.removeAttribute('src');v.load();}}catch(e){}})()",
                    null
                )
                playerWebView.onPause()

                currentVideoId = ""
                positionMs = 0L
                durationMs = -1L
                isVideoPlaying = false
                lastMiniIconPlaying = null
                cancelPendingPipEnterCallbacks()
                pipHandler.removeCallbacks(pendingCollapseRunnable)
                stopMediaService()
                updatePipParams()
            }
            .start()
    }

    private fun dpToPx(dp: Float): Float {
        return dp * resources.displayMetrics.density
    }

    private fun enterFullscreen(view: View?, callback: WebChromeClient.CustomViewCallback?) {
        if (customView != null) {
            exitFullscreen()
            return
        }

        customView = view
        customViewCallback = callback
        isFullscreen = true
        swipeRefreshLayout.isEnabled = false

        webView.visibility = View.GONE
        playerPanel.visibility = View.GONE
        customViewContainer.visibility = View.VISIBLE
        customViewContainer.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        updatePipParams()
    }

    private fun exitFullscreen() {
        if (customView == null) return

        isFullscreen = false
        customViewContainer.removeView(customView)
        customView = null
        customViewCallback?.onCustomViewHidden()

        customViewContainer.visibility = View.GONE
        webView.visibility = View.VISIBLE
        if (panelState != PanelState.HIDDEN) {
            playerPanel.visibility = View.VISIBLE
        }
        if (!isInPipModeCompat()) {
            swipeRefreshLayout.isEnabled = true
        }

        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        updatePipParams()
    }

    private fun setupBackPressedHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (isFullscreen) {
                    exitFullscreen()
                    return
                }

                if (panelState == PanelState.EXPANDED) {
                    collapsePlayer()
                    return
                }

                if (panelState == PanelState.COLLAPSED) {
                    closePlayer()
                    return
                }

                if (isTvDevice) {
                    val now = SystemClock.elapsedRealtime()
                    if (now - lastTvBackPressMs <= 1600L) {
                        tvBackPressCount++
                    } else {
                        tvBackPressCount = 1
                    }
                    lastTvBackPressMs = now

                    if (tvBackPressCount >= 3) {
                        tvBackPressCount = 0
                        finish()
                    } else {
                        // Lần 1 (ẩn thanh điều khiển) & Lần 2 (thoát khỏi video về danh sách) đều gửi Escape vào YouTube TV
                        webView.evaluateJavascript("window.__braveTvSendBack && window.__braveTvSendBack();", null)
                        if (tvBackPressCount == 2) {
                            Toast.makeText(this@MainActivity, "Bấm Back thêm 1 lần nữa để thoát LiteTube", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return
                }

                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    // ==============================================================
    // CHẾ ĐỘ HẸN GIỜ TẮT VIDEO TỰ ĐỘNG (GIỐNG CỐC CỐC: TỰ TẮT KHI HẾT VIDEO / THEO PHÚT)
    // ==============================================================
    fun showSleepTimerPickerDialog(onUpdated: (() -> Unit)? = null) {
        val options = arrayOf(
            "Không",
            "Khi hết video",
            "Sau 15 phút",
            "Sau 30 phút",
            "Sau 45 phút",
            "Sau 60 phút",
            "Sau 90 phút"
        )
        val modes = intArrayOf(
            AppSettings.SLEEP_TIMER_OFF,
            AppSettings.SLEEP_TIMER_END_OF_VIDEO,
            15,
            30,
            45,
            60,
            90
        )
        val currentIdx = modes.indexOf(AppSettings.sleepTimerMode).coerceAtLeast(0)

        AlertDialog.Builder(this)
            .setTitle("Hẹn giờ tắt video")
            .setSingleChoiceItems(options, currentIdx) { dialog, which ->
                val selectedMode = modes[which]
                applySleepTimerMode(selectedMode)
                onUpdated?.invoke()
                dialog.dismiss()
            }
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun applySleepTimerMode(mode: Int) {
        pipHandler.removeCallbacks(sleepTimerCountdownRunnable)
        AppSettings.sleepTimerMode = mode
        if (mode > 0) {
            val durationMs = mode * 60_000L
            AppSettings.sleepTimerTargetElapsedMs = SystemClock.elapsedRealtime() + durationMs
            pipHandler.postDelayed(sleepTimerCountdownRunnable, durationMs)
            Toast.makeText(this, "Đã hẹn giờ tắt video sau $mode phút", Toast.LENGTH_SHORT).show()
        } else if (mode == AppSettings.SLEEP_TIMER_END_OF_VIDEO) {
            AppSettings.sleepTimerTargetElapsedMs = 0L
            Toast.makeText(this, "Sẽ tự động tắt khi hết video hiện tại", Toast.LENGTH_SHORT).show()
        } else {
            AppSettings.sleepTimerTargetElapsedMs = 0L
            Toast.makeText(this, "Đã tắt hẹn giờ video", Toast.LENGTH_SHORT).show()
        }
        syncSettingsToWeb()
    }

    private fun triggerAutoStopVideo(reason: String) {
        pipHandler.removeCallbacks(sleepTimerCountdownRunnable)
        AppSettings.sleepTimerMode = AppSettings.SLEEP_TIMER_OFF
        AppSettings.sleepTimerTargetElapsedMs = 0L
        syncSettingsToWeb()

        isVideoPlaying = false
        lastMiniIconPlaying = false
        btnMiniPlayerPlayPause.setImageResource(android.R.drawable.ic_media_play)

        runPipCommand("pause")
        stopMediaService()
        updatePipParams()

        if (isFullscreen) {
            exitFullscreen()
        }
        Toast.makeText(this, reason, Toast.LENGTH_SHORT).show()
    }

    /**
     * Hiển thị BottomSheet Cài đặt ứng dụng
     */
    fun showSettingsDialog() {
        val dialog = BottomSheetDialog(this)
        val dialogView = layoutInflater.inflate(R.layout.dialog_settings, null)
        dialog.setContentView(dialogView)

        val switchAdBlock = dialogView.findViewById<SwitchMaterial>(R.id.switchAdBlock)
        val switchBackgroundPlay = dialogView.findViewById<SwitchMaterial>(R.id.switchBackgroundPlay)
        val switchAutoPip = dialogView.findViewById<SwitchMaterial>(R.id.switchAutoPip)
        val switchPreloadCache = dialogView.findViewById<SwitchMaterial>(R.id.switchPreloadCache)
        val rowSleepTimer = dialogView.findViewById<LinearLayout>(R.id.rowSleepTimer)
        val tvSleepTimerStatus = dialogView.findViewById<TextView>(R.id.tvSleepTimerStatus)
        val tvCacheSize = dialogView.findViewById<TextView>(R.id.tvCacheSize)
        val btnClearCache = dialogView.findViewById<MaterialButton>(R.id.btnClearCache)
        val btnReloadInSettings = dialogView.findViewById<MaterialButton>(R.id.btnReloadInSettings)
        val btnCloseSettings = dialogView.findViewById<MaterialButton>(R.id.btnCloseSettings)

        switchAdBlock.isChecked = AppSettings.isAdBlockEnabled(this)
        switchBackgroundPlay.isChecked = AppSettings.isBackgroundPlayEnabled(this)
        switchAutoPip.isChecked = AppSettings.isAutoPipEnabled(this)
        switchPreloadCache.isChecked = AppSettings.isPreloadCacheEnabled(this)

        fun updateSleepTimerLabel() {
            val remSec = if (AppSettings.sleepTimerMode > 0 && AppSettings.sleepTimerTargetElapsedMs > 0) {
                ((AppSettings.sleepTimerTargetElapsedMs - SystemClock.elapsedRealtime()) / 1000L).coerceAtLeast(0L)
            } else 0L
            tvSleepTimerStatus.text = AppSettings.getSleepTimerLabel(remSec)
        }

        fun updateCacheDisplay() {
            Thread {
                val totalBytes = WebResourceCacheManager.getCacheSizeBytes(this) + AppSettings.getCacheSizeBytes(this)
                val mb = totalBytes.toDouble() / (1024.0 * 1024.0)
                runOnUiThread {
                    if (dialog.isShowing) {
                        tvCacheSize.text = getString(R.string.setting_cache_size_format, mb)
                    }
                }
            }.start()
        }

        updateSleepTimerLabel()
        updateCacheDisplay()

        rowSleepTimer.setOnClickListener {
            showSleepTimerPickerDialog {
                updateSleepTimerLabel()
            }
        }

        switchAdBlock.setOnCheckedChangeListener { _, isChecked ->
            AppSettings.setAdBlockEnabled(this, isChecked)
            AdBlockEngine.isEnabled = isChecked
            syncSettingsToWeb()
        }

        switchBackgroundPlay.setOnCheckedChangeListener { _, isChecked ->
            AppSettings.setBackgroundPlayEnabled(this, isChecked)
            syncSettingsToWeb()
        }

        switchAutoPip.setOnCheckedChangeListener { _, isChecked ->
            AppSettings.setAutoPipEnabled(this, isChecked)
            syncSettingsToWeb()
            updatePipParams()
        }

        switchPreloadCache.setOnCheckedChangeListener { _, isChecked ->
            AppSettings.setPreloadCacheEnabled(this, isChecked)
            WebResourceCacheManager.isEnabled = isChecked
            syncSettingsToWeb()
        }

        btnClearCache.setOnClickListener {
            WebResourceCacheManager.clearCache(this)
            AppSettings.clearAppCache(this)
            webView.clearCache(true)
            playerWebView.clearCache(true)
            updateCacheDisplay()
        }

        btnReloadInSettings.setOnClickListener {
            dialog.dismiss()
            if (panelState != PanelState.HIDDEN) {
                playerWebView.reload()
            } else {
                webView.reload()
            }
        }

        btnCloseSettings.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun syncSettingsToWeb() {
        val settingsJson = AppSettings.toJson(this)
        val remSec = if (AppSettings.sleepTimerMode > 0 && AppSettings.sleepTimerTargetElapsedMs > 0) {
            ((AppSettings.sleepTimerTargetElapsedMs - SystemClock.elapsedRealtime()) / 1000L).coerceAtLeast(0L)
        } else 0L
        val sleepLabel = JSONObject.quote(AppSettings.getSleepTimerLabel(remSec))
        val script = buildString {
            append("window.__braveSleepTimerLabel = $sleepLabel;")
            append("var topSvg = document.querySelector('#__brave_top_sleep_btn svg'); if (topSvg) topSvg.style.fill = (window.__braveSleepTimerLabel && window.__braveSleepTimerLabel !== 'Không') ? '#4caf50' : '#ffffff'; var subEl = document.getElementById('__brave_sleep_timer_menu_sub'); if (subEl) subEl.textContent = $sleepLabel + ' ›';")
            append("if (window.__bravePip && window.__bravePip.applySettings) window.__bravePip.applySettings($settingsJson); else window.__braveSettings = $settingsJson;")
        }
        webView.evaluateJavascript(script, null)
        playerWebView.evaluateJavascript(script, null)
    }

    private fun clampedPipAspectRatio(): Rational {
        val ratio = videoAspectRatio.toFloat()
        if (ratio.isNaN() || ratio <= 0f) return Rational(16, 9)
        val maxRatio = 2.39f
        val minRatio = 1f / 2.39f
        return when {
            ratio > maxRatio -> Rational(239, 100)
            ratio < minRatio -> Rational(100, 239)
            else -> videoAspectRatio
        }
    }

    private fun extractVideoIdFromUrl(url: String?): String {
        if (url.isNullOrBlank()) return ""
        return try {
            val uri = Uri.parse(url)
            val v = uri.getQueryParameter("v")
            if (!v.isNullOrBlank()) return v
            val segments = uri.pathSegments
            val shortsIdx = segments.indexOf("shorts")
            if (shortsIdx >= 0 && shortsIdx + 1 < segments.size) {
                return segments[shortsIdx + 1]
            }
            if (uri.host?.contains("youtu.be") == true && segments.isNotEmpty()) {
                return segments[0]
            }
            ""
        } catch (_: Exception) {
            ""
        }
    }

    private fun cancelPendingPipEnterCallbacks() {
        pendingPipEnterRunnables.forEach { pipHandler.removeCallbacks(it) }
        pendingPipEnterRunnables.clear()
    }

    private fun buildPipParams(): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        val builder = PictureInPictureParams.Builder()

        try {
            builder.setAspectRatio(clampedPipAspectRatio())
        } catch (_: Exception) {}

        val headphonesIntent = Intent(ACTION_PIP_HEADPHONES).setPackage(packageName)
        val headphonesPendingIntent = PendingIntent.getBroadcast(
            this,
            1003,
            headphonesIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val headphonesAction = RemoteAction(
            Icon.createWithResource(this, R.drawable.ic_pip_headphones),
            "Nghe nền",
            "Ẩn popup video, chỉ nghe âm thanh",
            headphonesPendingIntent
        )

        val iconRes = if (isVideoPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val actionTitle = if (isVideoPlaying) "Tạm dừng" else "Phát"
        val actionIntent = Intent(if (isVideoPlaying) ACTION_PIP_PAUSE else ACTION_PIP_PLAY)
        actionIntent.setPackage(packageName)
        val requestCode = if (isVideoPlaying) 1002 else 1001
        val playPausePendingIntent = PendingIntent.getBroadcast(
            this,
            requestCode,
            actionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPauseAction = RemoteAction(
            Icon.createWithResource(this, iconRes),
            actionTitle,
            actionTitle,
            playPausePendingIntent
        )

        val nextIntent = Intent(MediaService.ACTION_MEDIA_NEXT).setPackage(packageName)
        val nextPendingIntent = PendingIntent.getBroadcast(
            this,
            1004,
            nextIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nextAction = RemoteAction(
            Icon.createWithResource(this, android.R.drawable.ic_media_next),
            "Tiếp theo",
            "Phát video tiếp theo",
            nextPendingIntent
        )

        val maxActions = maxNumPictureInPictureActions
        val actions = when {
            maxActions >= 3 -> listOf(headphonesAction, playPauseAction, nextAction)
            maxActions == 2 -> listOf(headphonesAction, playPauseAction)
            else -> listOf(playPauseAction)
        }
        builder.setActions(actions)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val autoPip = AppSettings.isAutoPipEnabled(this)
            builder.setAutoEnterEnabled((isVideoPlaying || isFullscreen) && autoPip)
            builder.setSeamlessResizeEnabled(false)
        }
        return builder.build()
    }

    private fun updatePipParams() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                buildPipParams()?.let { setPictureInPictureParams(it) }
            } catch (_: Exception) {}
        }
    }

    private fun runPipCommand(method: String, onResult: ((String?) -> Unit)? = null) {
        val target = if (panelState != PanelState.HIDDEN) playerWebView else webView
        val fastScript = "(function(){try{return window.__bravePip ? String(window.__bravePip.$method()) : 'pip:missing';}catch(e){return 'pip:error:' + e;}})();"
        target.evaluateJavascript(fastScript) { result ->
            if (result != null && result.contains("pip:missing") && pipControllerJs.isNotEmpty()) {
                val fallbackScript = buildString {
                    append(pipControllerJs)
                    append("\n;")
                    append(fastScript)
                }
                target.evaluateJavascript(fallbackScript) { retryRes ->
                    onResult?.invoke(retryRes)
                }
            } else {
                onResult?.invoke(result)
            }
        }
    }

    private fun enterPipLayout() {
        isInPipLayout = true
        isHidingPipToAudio = false
        pipHandler.removeCallbacks(pendingCollapseRunnable)
        progressBar.visibility = View.GONE
        swipeRefreshLayout.isEnabled = false

        if (panelState == PanelState.COLLAPSED) {
            wasCollapsedBeforePip = true
            swipeRefreshLayout.visibility = View.GONE

            val params = playerPanel.layoutParams as FrameLayout.LayoutParams
            params.height = ViewGroup.LayoutParams.MATCH_PARENT
            params.gravity = Gravity.TOP
            params.bottomMargin = 0
            playerPanel.animate().cancel()
            playerPanel.layoutParams = params
            playerPanel.translationY = 0f
            playerPanel.setBackgroundColor(Color.BLACK)

            miniPlayerBar.visibility = View.GONE
            btnMinimizePlayer.visibility = View.GONE
            playerDragArea.visibility = View.GONE

            resetPlayerWebViewTransform()
            unlockPlayerWebViewSize()
        } else if (panelState == PanelState.EXPANDED) {
            btnMinimizePlayer.visibility = View.GONE
            playerDragArea.visibility = View.GONE
        }

        val target = if (panelState != PanelState.HIDDEN) playerWebView else webView
        target.evaluateJavascript(
            "window.__braveEnteringPip = true; window.__braveProtectPlayUntil = Date.now() + 3500;",
            null
        )
        runPipCommand("enter")

        if (!isMediaServiceActive && (isVideoPlaying || panelState != PanelState.HIDDEN)) {
            startMediaService()
        } else if (isMediaServiceActive) {
            updateMediaService(force = true)
        }
    }

    private fun exitPipLayout(restoreMiniIfCollapsed: Boolean = true) {
        isInPipLayout = false
        swipeRefreshLayout.visibility = View.VISIBLE
        if (!isFullscreen) {
            swipeRefreshLayout.isEnabled = true
        }
        runPipCommand("exit")

        if (wasCollapsedBeforePip) {
            wasCollapsedBeforePip = false
            panelState = PanelState.EXPANDED
            btnMinimizePlayer.visibility = View.VISIBLE
            playerDragArea.visibility = View.VISIBLE
            if (restoreMiniIfCollapsed) {
                pipHandler.removeCallbacks(pendingCollapseRunnable)
                pipHandler.postDelayed(pendingCollapseRunnable, 450)
            }
        } else if (panelState == PanelState.EXPANDED) {
            btnMinimizePlayer.visibility = View.VISIBLE
            playerDragArea.visibility = View.VISIBLE
        }
    }

    private fun handlePipHeadphones() {
        isHidingPipToAudio = true
        hidingPipToAudioAtMs = SystemClock.elapsedRealtime()
        cancelPendingPipEnterCallbacks()
        pipHandler.removeCallbacks(pendingCollapseRunnable)
        wasCollapsedBeforePip = false

        val target = if (panelState != PanelState.HIDDEN) playerWebView else webView
        target.evaluateJavascript(
            """
            (function(){
                try {
                    window.__braveUserPaused = false;
                    window.__braveAppInBackground = true;
                    window.__braveProtectPlayUntil = Date.now() + 4500;
                    if (window.__bravePip) {
                        window.__bravePip.setBackground(true);
                        var mv = window.__bravePip.mainVideo && window.__bravePip.mainVideo();
                        if (mv && mv.paused) window.__bravePip.play();
                    }
                } catch(e) {}
            })();
            """.trimIndent(),
            null
        )
        isVideoPlaying = true
        startMediaService()

        try {
            moveTaskToBack(true)
        } catch (_: Exception) {}
    }

    private fun dismissPipAndStopMedia() {
        cancelPendingPipEnterCallbacks()
        pipHandler.removeCallbacks(pendingCollapseRunnable)
        isInPipLayout = false
        swipeRefreshLayout.visibility = View.VISIBLE
        if (!isFullscreen) {
            swipeRefreshLayout.isEnabled = true
        }
        if (wasCollapsedBeforePip) {
            wasCollapsedBeforePip = false
            panelState = PanelState.EXPANDED
        }
        if (panelState == PanelState.EXPANDED) {
            btnMinimizePlayer.visibility = View.VISIBLE
            playerDragArea.visibility = View.VISIBLE
        }

        isVideoPlaying = false
        lastMiniIconPlaying = false
        btnMiniPlayerPlayPause.setImageResource(android.R.drawable.ic_media_play)

        val target = if (panelState != PanelState.HIDDEN) playerWebView else webView
        target.evaluateJavascript(
            """
            (function(){
                try {
                    if (window.__bravePip) {
                        window.__bravePip.pause();
                        window.__bravePip.exit();
                    } else {
                        window.__braveUserPaused = true;
                        window.__braveProtectPlayUntil = 0;
                        window.__braveAllowPauseUntil = Date.now() + 1200;
                        document.querySelectorAll('video').forEach(function(v){
                            try { (window.__braveNativePause || v.pause).call(v); } catch(e1) {}
                        });
                    }
                } catch(e) {}
            })();
            """.trimIndent(),
            null
        )
        stopMediaService()
        updatePipParams()
    }

    private fun handlePipPlay() {
        isVideoPlaying = true
        updatePipParams()
        runPipCommand("play")
        updateMediaService(isPlaying = true, force = true)
    }

    private fun handlePipPause() {
        isVideoPlaying = false
        updatePipParams()
        runPipCommand("pause")
        updateMediaService(isPlaying = false, force = true)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val autoPip = AppSettings.isAutoPipEnabled(this)
        if ((isVideoPlaying || isFullscreen) && autoPip) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                enterPipLayout()
                try {
                    if (!isInPictureInPictureMode) {
                        buildPipParams()?.let { enterPictureInPictureMode(it) }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "enterPictureInPictureMode lỗi: ${e.message}")
                }
            }
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) {
            wasInPipMode = true
            isHidingPipToAudio = false
            swipeRefreshLayout.isEnabled = false
            cancelPendingPipEnterCallbacks()
            enterPipLayout()

            val r1 = Runnable { if (isInPipModeCompat()) enterPipLayout() }
            val r2 = Runnable { if (isInPipModeCompat()) enterPipLayout() }
            pendingPipEnterRunnables.add(r1)
            pendingPipEnterRunnables.add(r2)
            pipHandler.postDelayed(r1, 150)
            pipHandler.postDelayed(r2, 450)
            updatePipParams()
        } else {
            cancelPendingPipEnterCallbacks()
            if (isHidingPipToAudio && (SystemClock.elapsedRealtime() - hidingPipToAudioAtMs) < 8000L) {
                exitPipLayout(restoreMiniIfCollapsed = false)
            } else if (lifecycle.currentState == Lifecycle.State.CREATED) {
                wasInPipMode = false
                dismissPipAndStopMedia()
            } else {
                exitPipLayout(restoreMiniIfCollapsed = true)
                if (!isFullscreen) {
                    swipeRefreshLayout.isEnabled = true
                }
            }
        }
    }

    private fun isInPipModeCompat(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode

    override fun onResume() {
        super.onResume()
        if (!isInPipModeCompat()) {
            wasInPipMode = false
            isHidingPipToAudio = false
            cancelPendingPipEnterCallbacks()
            if (isInPipLayout) {
                exitPipLayout(restoreMiniIfCollapsed = true)
            }
            if (!isFullscreen) {
                swipeRefreshLayout.isEnabled = true
            }
            if (panelState == PanelState.EXPANDED) {
                playerWebView.onResume()
                webView.onPause()
            } else {
                webView.onResume()
                if (panelState == PanelState.COLLAPSED) {
                    playerWebView.onResume()
                }
            }
            runPipCommand("setBackground(false)")
            stopMediaService()
        }
    }

    override fun onStart() {
        super.onStart()
        if (!isInPipModeCompat() && !wasInPipMode && !isHidingPipToAudio) {
            runPipCommand("setBackground(false)")
            stopMediaService()
        }
    }

    override fun onPause() {
        super.onPause()
    }

    override fun onStop() {
        super.onStop()
        if (isInPipModeCompat()) {
            runPipCommand("setBackground(true)")
            if (isVideoPlaying && AppSettings.isBackgroundPlayEnabled(this)) {
                startMediaService()
            }
            return
        }

        if (wasInPipMode) {
            wasInPipMode = false
            if (isHidingPipToAudio && (SystemClock.elapsedRealtime() - hidingPipToAudioAtMs) < 8000L) {
                isHidingPipToAudio = false
                runPipCommand("setBackground(true)")
                startMediaService()
            } else {
                isHidingPipToAudio = false
                dismissPipAndStopMedia()
            }
            return
        }

        runPipCommand("setBackground(true)")
        val bgPlay = AppSettings.isAutoPipEnabled(this) || AppSettings.isBackgroundPlayEnabled(this)
        if (isVideoPlaying && AppSettings.isBackgroundPlayEnabled(this)) {
            startMediaService()
        } else if (!bgPlay) {
            webView.onPause()
            playerWebView.onPause()
        }
    }

    private fun resolvedVideoId(): String {
        if (currentVideoId.isNotEmpty()) return currentVideoId
        return extractVideoIdFromUrl(playerWebView.url)
    }

    private fun startMediaService() {
        try {
            val vid = resolvedVideoId()
            if (vid.isNotEmpty()) currentVideoId = vid
            val intent = Intent(this, MediaService::class.java).apply {
                action = MediaService.ACTION_START
                putExtra(MediaService.EXTRA_TITLE, currentTitle)
                putExtra(MediaService.EXTRA_CHANNEL, currentChannel)
                putExtra(MediaService.EXTRA_IS_PLAYING, isVideoPlaying)
                putExtra(MediaService.EXTRA_POSITION_MS, positionMs)
                putExtra(MediaService.EXTRA_DURATION_MS, durationMs)
                putExtra(MediaService.EXTRA_VIDEO_ID, vid)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            isMediaServiceActive = true
            lastMediaServiceUpdateElapsedMs = SystemClock.elapsedRealtime()
            lastMediaServicePlayingState = isVideoPlaying
            lastMediaServiceTitle = currentTitle
            lastMediaServiceVideoId = vid
        } catch (_: Exception) {}
    }

    private fun updateMediaService(isPlaying: Boolean? = null, force: Boolean = false) {
        if (!isMediaServiceActive) return
        val targetPlaying = isPlaying ?: isVideoPlaying
        val vid = resolvedVideoId()
        val now = SystemClock.elapsedRealtime()

        val stateChanged = targetPlaying != lastMediaServicePlayingState ||
            currentTitle != lastMediaServiceTitle ||
            vid != lastMediaServiceVideoId
        if (!force && !stateChanged && (now - lastMediaServiceUpdateElapsedMs) < 5000L) {
            return
        }

        try {
            if (vid.isNotEmpty()) currentVideoId = vid
            val intent = Intent(this, MediaService::class.java).apply {
                action = MediaService.ACTION_UPDATE
                putExtra(MediaService.EXTRA_TITLE, currentTitle)
                putExtra(MediaService.EXTRA_CHANNEL, currentChannel)
                putExtra(MediaService.EXTRA_IS_PLAYING, targetPlaying)
                putExtra(MediaService.EXTRA_POSITION_MS, positionMs)
                putExtra(MediaService.EXTRA_DURATION_MS, durationMs)
                putExtra(MediaService.EXTRA_VIDEO_ID, vid)
            }
            startService(intent)
            lastMediaServiceUpdateElapsedMs = now
            lastMediaServicePlayingState = targetPlaying
            lastMediaServiceTitle = currentTitle
            lastMediaServiceVideoId = vid
        } catch (_: Exception) {}
    }

    private fun stopMediaService() {
        if (!isMediaServiceActive) return
        try {
            val intent = Intent(this, MediaService::class.java).apply {
                action = MediaService.ACTION_STOP
            }
            startService(intent)
            isMediaServiceActive = false
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        cancelPendingPipEnterCallbacks()
        pipHandler.removeCallbacksAndMessages(null)
        try {
            unregisterReceiver(mediaActionReceiver)
        } catch (_: Exception) {}
        stopMediaService()
        webView.destroy()
        playerWebView.destroy()
        super.onDestroy()
    }

    private fun applyMediaState(
        playing: Boolean,
        title: String,
        channel: String,
        posMs: Long,
        durMs: Long,
        videoId: String = ""
    ) {
        val playingChanged = playing != isVideoPlaying
        isVideoPlaying = playing

        val cleanVid = videoId.trim()
        if (cleanVid.isNotEmpty() && cleanVid != currentVideoId) {
            currentVideoId = cleanVid
        }

        val cleanTitle = title.trim()
        if (cleanTitle.isNotEmpty() && cleanTitle != "LiteTube" && cleanTitle != "YouTube") {
            currentTitle = cleanTitle
        }
        if (channel.isNotBlank()) currentChannel = channel.trim()
        if (posMs >= 0) positionMs = posMs
        if (durMs > 0) durationMs = durMs

        if (tvMiniPlayerTitle.text.toString() != currentTitle) tvMiniPlayerTitle.text = currentTitle
        if (tvMiniPlayerChannel.text.toString() != currentChannel) tvMiniPlayerChannel.text = currentChannel
        if (playingChanged || lastMiniIconPlaying != playing) {
            lastMiniIconPlaying = playing
            btnMiniPlayerPlayPause.setImageResource(
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
            )
        }
        if (playingChanged) updatePipParams()
        if (!isMediaServiceActive && isInPipModeCompat() && (playing || panelState != PanelState.HIDDEN)) {
            startMediaService()
        } else if (isMediaServiceActive) {
            updateMediaService(force = playingChanged)
        }
    }

    inner class MediaBridge(private val fromPlayer: Boolean) {
        @JavascriptInterface
        fun openWatchLayer(url: String) {
            if (url.isNotEmpty()) {
                runOnUiThread {
                    openVideoPlayer(url)
                }
            }
        }

        @JavascriptInterface
        fun openSettings() {
            runOnUiThread {
                showSettingsDialog()
            }
        }

        @JavascriptInterface
        fun startVoiceSearch() {
            this@MainActivity.startVoiceSearch()
        }

        @JavascriptInterface
        fun openSleepTimerDialog() {
            runOnUiThread {
                showSleepTimerPickerDialog {
                }
            }
        }

        @JavascriptInterface
        fun onVideoEnded() {
            runOnUiThread {
                if (AppSettings.sleepTimerMode == AppSettings.SLEEP_TIMER_END_OF_VIDEO) {
                    triggerAutoStopVideo(reason = "Đã hết video — Tự động dừng phát")
                }
            }
        }

        /**
         * Khi người dùng chuyển sang tab Shorts trên Browse WebView:
         * Tự động đóng hoặc tạm dừng ngay Player Layer (MiniPlayer) để giải phóng 100% bộ giải mã phần cứng
         * cho Shorts phát mượt ngay lập tức và không bị chồng 2 âm thanh!
         */
        @JavascriptInterface
        fun onShortsStarted() {
            runOnUiThread {
                if (panelState != PanelState.HIDDEN) {
                    closePlayer()
                } else {
                    playerWebView.evaluateJavascript(
                        "(function(){try{var v=document.querySelector('video');if(v&&!v.paused){(window.__braveNativePause||v.pause).call(v);}}catch(e){}})()",
                        null
                    )
                    playerWebView.onPause()
                }
            }
        }

        private fun acceptMedia(): Boolean =
            if (panelState != PanelState.HIDDEN) fromPlayer else !fromPlayer

        @JavascriptInterface
        fun onVideoPlaying(title: String, channel: String) {
            runOnUiThread {
                if (!acceptMedia()) return@runOnUiThread
                applyMediaState(true, title, channel, -1L, -1L)
            }
        }

        @JavascriptInterface
        fun onVideoPaused() {
            runOnUiThread {
                if (!acceptMedia()) return@runOnUiThread
                applyMediaState(false, "", "", -1L, -1L)
            }
        }

        @JavascriptInterface
        fun onMediaStateChanged(playing: Boolean, title: String, channel: String, posMs: Long, durMs: Long) {
            runOnUiThread {
                if (!acceptMedia()) return@runOnUiThread
                applyMediaState(playing, title, channel, posMs, durMs)
            }
        }

        @JavascriptInterface
        fun onMediaStateWithId(
            playing: Boolean,
            videoId: String,
            title: String,
            channel: String,
            posMs: Long,
            durMs: Long
        ) {
            runOnUiThread {
                if (!acceptMedia()) return@runOnUiThread
                applyMediaState(playing, title, channel, posMs, durMs, videoId)
            }
        }

        @JavascriptInterface
        fun onVideoSize(width: Int, height: Int) {
            if (width <= 0 || height <= 0) return
            runOnUiThread {
                if (!acceptMedia()) return@runOnUiThread
                val newRatio = Rational(width, height)
                if (newRatio != videoAspectRatio) {
                    videoAspectRatio = newRatio
                    updatePipParams()
                }
            }
        }
    }
}
