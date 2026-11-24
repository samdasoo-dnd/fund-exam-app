package com.donsik.fundexam

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

/**
 * 펀드 모의고사(https://fund-exam-app.onrender.com) 를 감싸는 WebView 앱.
 *
 * - 앱을 켜면 곧바로(0.1초) assets/loading.html 의 미니멀 다크 로딩 화면(제목 + 슬림 프로그레스 바)을 띄운다.
 * - 그동안 백그라운드에서 /api/health 를 2초 간격·최대 90초 동안 두드려
 *   Render 무료 플랜의 콜드 스타트(502/503/타임아웃)를 기다린 뒤 메인 페이지를 연다.
 *   health 는 200 이면서 본문에 "ok":true 가 있어야 "깨어남"으로 판정한다.
 * - 메인 페이지가 503/타임아웃으로 실패해도 로딩 화면이 떠 있는 동안(총 90초 이내)에는
 *   오류 화면을 띄우지 않고 로딩 화면 그대로 둔 채 2초 뒤 다시 health 부터 확인한다.
 * - 메인 페이지가 그려지면 프로그레스 바를 100%로 채우고 오버레이를 부드럽게 걷는다.
 * - localStorage(domStorage), LC 음성 자동 재생, 쿠키/혼합 콘텐츠를 허용한다.
 * - 학습 기록은 localStorage + SharedPreferences(fund_exam_store)에 함께 저장한다.
 * - 학습 기록 JSON(blob) 내보내기는 파일 저장 화면으로 이어 준다.
 * - 뒤로가기는 웹 히스토리 우선, 히스토리가 없으면 앱 종료.
 */
class MainActivity : Activity() {

    companion object {
        private const val TAG = "FundExam"
        private const val START_URL = "https://fund-exam-app.onrender.com"
        private const val BASE_HOST = "fund-exam-app.onrender.com"
        private const val HEALTH_URL = "https://fund-exam-app.onrender.com/api/health"
        private const val USER_AGENT = "FundExamAndroid/1.0.0"
        private const val LOCAL_LOADING_URL = "file:///android_asset/loading.html"
        private const val REQ_SAVE_FILE = 1001
        private const val STORE_PREFS = "fund_exam_store"
        private const val STORE_KEY = "store_json"

        // 서버 깨우기: 2초 간격 · 최대 90초 (로딩 화면이 떠 있는 총 시간 기준)
        private const val WAKEUP_INTERVAL_MS = 2_000L
        private const val WAKEUP_MAX_MS = 90_000L
        private const val HEALTH_CONNECT_TIMEOUT_MS = 8_000
        private const val HEALTH_READ_TIMEOUT_MS = 8_000

        // 네트워크가 이만큼 연속으로 끊기면 그때만 오류 화면을 띄운다(약 12초)
        private const val NETWORK_FAIL_LIMIT = 6

        // 로딩 화면 최소 노출 시간과, 100%까지 차오르는 프로그레스 바를 보여 주는 시간
        private const val INTRO_MIN_MS = 1_500L
        private const val BAR_FINISH_MS = 420L

        // 메인 페이지가 실패(503·타임아웃)하면 로딩 화면을 유지한 채 이만큼 뒤 health 부터 다시 확인한다
        private const val MAIN_RETRY_DELAY_MS = 2_000L

        // probeHealth() 결과: 네트워크 자체가 끊긴 경우
        private const val HEALTH_NETWORK_ERROR = -1

        // probeHealth() 결과: 200 이지만 본문이 아직 준비되지 않은 경우
        private const val HEALTH_NOT_READY = -2
    }

    private lateinit var webView: WebView
    private lateinit var loadingWebView: WebView
    private lateinit var loadingFallback: View
    private lateinit var loadingOverlay: View
    private lateinit var loadingText: TextView
    private lateinit var errorView: View
    private lateinit var errorDetail: TextView

    private val uiHandler = Handler(Looper.getMainLooper())
    private var wakeThread: Thread? = null

    @Volatile
    private var destroyed = false

    /** 서버 깨우기 스레드 세대 번호 — 새로 시작하면 이전 스레드의 결과는 버린다. */
    private val wakeGeneration = AtomicInteger(0)

    private var mainFrameFailed = false
    private var contentShown = false
    private var introFinished = false
    private var retryWakeupScheduled = false

    /** 이번 페이지 로드 시도가 실패했는지 — onPageStarted 에서 false, 오류 콜백에서 true. */
    @Volatile
    private var attemptFailed = false

    /** 로딩 화면(첫 화면)을 띄운 시각 — 90초 총 경과 시간을 재는 기준점. 재시도해도 리셋하지 않는다. */
    private var introStartedAt = 0L
    private var loadingShownAt = 0L
    private var pendingSave: PendingSave? = null

    private data class PendingSave(val name: String, val mime: String, val bytes: ByteArray)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        runCatching {
            window.statusBarColor = 0xFF061124.toInt()
            window.navigationBarColor = 0xFF061124.toInt()
        }

        webView = findViewById(R.id.web_view)
        loadingWebView = findViewById(R.id.loading_web_view)
        loadingFallback = findViewById(R.id.loading_fallback)
        loadingOverlay = findViewById(R.id.loading_overlay)
        loadingText = findViewById(R.id.loading_text)
        errorView = findViewById(R.id.error_view)
        errorDetail = findViewById(R.id.error_detail)

        findViewById<Button>(R.id.retry_button).setOnClickListener { retry() }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        }

        configureWebView()
        configureLoadingWebView()

        val restored = savedInstanceState?.let { webView.restoreState(it) }
        if (restored == null) {
            loadStart()
        } else {
            hideLoading(immediately = true)
        }
    }

    // ---------------------------------------------------------------- WebView 설정

    private fun configureWebView() {
        webView.setBackgroundColor(0xFF061124.toInt())

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // localStorage — 학습 기록 저장에 필수
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false  // LC 음성 자동 재생
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            userAgentString = userAgentString + " " + USER_AGENT
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.addJavascriptInterface(SaveBridge(), "BadaToeicAndroid")
        webView.webViewClient = BadaWebViewClient()
        webView.webChromeClient = BadaChromeClient()

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            handleDownload(url, userAgent, contentDisposition, mimeType)
        }
    }

    /** 내장 로딩 화면(loading.html) 전용 WebView — 로컬 파일만 읽는다. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun configureLoadingWebView() {
        loadingWebView.setBackgroundColor(0xFF04121C.toInt())
        loadingWebView.settings.apply {
            javaScriptEnabled = true
            // 이 WebView 만 assets/loading.html 을 열 수 있게 파일 접근을 허용한다.
            allowFileAccess = true
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            domStorageEnabled = false
            databaseEnabled = false
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            userAgentString = userAgentString + " " + USER_AGENT
        }
        loadingWebView.isVerticalScrollBarEnabled = false
        loadingWebView.isHorizontalScrollBarEnabled = false
        loadingWebView.setOnLongClickListener { true }
        loadingWebView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // 로딩 화면이 정상적으로 그려졌으니 네이티브 대체 화면은 내린다
                loadingFallback.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true) return
                Log.w(TAG, "loading.html error: ${error?.errorCode} ${error?.description}")
                loadingFallback.visibility = View.VISIBLE
            }
        }
    }

    private fun loadLocalIntro() {
        loadingFallback.visibility = View.GONE
        runCatching { loadingWebView.loadUrl(LOCAL_LOADING_URL) }
            .onFailure { loadingFallback.visibility = View.VISIBLE }
    }

    private fun loadStart() {
        mainFrameFailed = false
        contentShown = false
        introFinished = false
        retryWakeupScheduled = false
        attemptFailed = false
        showLoading()
        startServerWakeup(resetTimer = true)
    }

    private fun retry() {
        errorView.visibility = View.GONE
        loadStart()
    }

    // ---------------------------------------------------------------- 로딩 / 오류 화면

    private fun showLoading() {
        loadingText.text = getString(R.string.loading_title)
        loadingOverlay.animate().cancel()
        loadingOverlay.alpha = 1f
        loadingOverlay.visibility = View.VISIBLE
        errorView.visibility = View.GONE
        loadingShownAt = System.currentTimeMillis()
        loadLocalIntro()
    }

    private fun hideLoading(immediately: Boolean = false) {
        if (loadingOverlay.visibility != View.VISIBLE) return
        if (immediately) {
            stopIntroAnimation()
            loadingOverlay.visibility = View.GONE
            return
        }
        loadingOverlay.animate()
            .alpha(0f)
            .setDuration(280)
            .withEndAction {
                loadingOverlay.visibility = View.GONE
                stopIntroAnimation()
            }
            .start()
    }

    /** 오버레이가 사라진 뒤 로딩 화면의 애니메이션 루프를 멈춰 배터리를 아낀다. */
    private fun stopIntroAnimation() {
        runCatching {
            loadingWebView.evaluateJavascript(
                "window.stopLoadingAnimation && window.stopLoadingAnimation()", null
            )
        }
    }

    // ---------------------------------------------------------------- 서버 깨우기

    /**
     * Render 무료 플랜은 15분 미사용 시 잠들어 첫 요청에 502/503 또는 타임아웃이 난다.
     * 메인 페이지를 곧바로 열면 그 오류를 그대로 맞으므로, /api/health 가 200(+ok:true) 을 줄 때까지
     * 2초 간격으로 최대 90초 동안 백그라운드에서 두드린다. 그동안 로딩 화면이 계속 떠 있다.
     *
     * resetTimer=false 는 메인 페이지가 503·타임아웃으로 실패한 뒤의 재확인이다.
     * 이때는 로딩 화면을 띄운 시각(introStartedAt)을 그대로 이어 받아 90초를 새로 주지 않는다.
     */
    private fun startServerWakeup(resetTimer: Boolean = true) {
        cancelServerWakeup()            // 이전 스레드 정리
        if (resetTimer || introStartedAt <= 0L) introStartedAt = System.currentTimeMillis()
        val gen = wakeGeneration.get()

        val startedAt = introStartedAt
        val thread = Thread {
            var networkFails = 0
            wakeup@ while (!destroyed && wakeGeneration.get() == gen) {
                val elapsed = System.currentTimeMillis() - startedAt
                if (elapsed >= WAKEUP_MAX_MS) {
                    Log.w(TAG, "wakeup timeout after ${elapsed}ms")
                    uiHandler.post {
                        if (!destroyed && wakeGeneration.get() == gen &&
                            !contentShown && !mainFrameFailed
                        ) {
                            showError(
                                "서버가 아직 깨어나지 않았어요. (90초 초과)\n" +
                                    "잠시 뒤 다시 시도해 주세요."
                            )
                        }
                    }
                    break@wakeup
                }

                val code = probeHealth()
                if (code == HttpURLConnection.HTTP_OK) {
                    Log.i(TAG, "server awake after ${System.currentTimeMillis() - startedAt}ms")
                    uiHandler.post {
                        if (!destroyed && wakeGeneration.get() == gen) beginMainLoad()
                    }
                    break@wakeup
                }

                if (code == HEALTH_NETWORK_ERROR) {
                    networkFails++
                    if (networkFails >= NETWORK_FAIL_LIMIT) {
                        Log.w(TAG, "network looks down ($networkFails consecutive failures)")
                        uiHandler.post {
                            if (!destroyed && wakeGeneration.get() == gen && !contentSeeded()) {
                                showError("인터넷 연결을 확인한 뒤 다시 시도해 주세요.")
                            }
                        }
                        break@wakeup
                    }
                } else {
                    // 502/503 등 Render 가 깨어나는 중 — 오류 화면 없이 계속 재시도
                    networkFails = 0
                }

                val remaining = (startedAt + WAKEUP_MAX_MS) - System.currentTimeMillis()
                if (remaining <= 0) continue@wakeup
                try {
                    Thread.sleep(minOf(WAKEUP_INTERVAL_MS, remaining))
                } catch (e: InterruptedException) {
                    break@wakeup
                }
            }
        }
        thread.isDaemon = true
        thread.name = "fund-exam-health-wakeup"
        wakeThread = thread
        thread.start()
    }

    private fun cancelServerWakeup() {
        wakeGeneration.incrementAndGet()
        wakeThread?.interrupt()
        wakeThread = null
    }

    private fun contentSeeded(): Boolean = contentShown || mainFrameFailed

    /**
     * 상태 확인. 200 이고 본문에 "ok":true 가 있어야만 깨어난 것(200)으로 본다.
     * 200 이어도 본문이 아직 준비되지 않았으면 -2, 네트워크 자체가 끊겼으면 -1.
     */
    private fun probeHealth(): Int {
        var opened: HttpURLConnection? = null
        return try {
            val conn = URL(HEALTH_URL).openConnection() as HttpURLConnection
            opened = conn
            conn.connectTimeout = HEALTH_CONNECT_TIMEOUT_MS
            conn.readTimeout = HEALTH_READ_TIMEOUT_MS
            conn.instanceFollowRedirects = true
            conn.requestMethod = "GET"
            conn.setRequestProperty("User-Agent", USER_AGENT)
            conn.setRequestProperty("Cache-Control", "no-cache")
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            val body = runCatching {
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                stream?.bufferedReader()?.use { it.readText() }
            }.getOrNull()
            Log.d(TAG, "health -> $code body=${body?.take(80)}")
            if (code == HttpURLConnection.HTTP_OK) {
                if (isHealthOk(body)) HttpURLConnection.HTTP_OK else HEALTH_NOT_READY
            } else {
                code
            }
        } catch (e: SocketTimeoutException) {
            Log.d(TAG, "health timeout: ${e.message}")
            HEALTH_NETWORK_ERROR
        } catch (e: IOException) {
            Log.d(TAG, "health io: ${e.message}")
            HEALTH_NETWORK_ERROR
        } catch (e: Exception) {
            Log.w(TAG, "health failed: ${e.message}")
            HEALTH_NETWORK_ERROR
        } finally {
            runCatching { opened?.disconnect() }
        }
    }

    /** health 응답 본문이 실제로 준비된 서버("ok":true)를 가리키는지. */
    private fun isHealthOk(body: String?): Boolean {
        val text = body ?: return false
        if (text.isBlank()) return false
        val parsed = runCatching { JSONObject(text).optBoolean("ok", false) }.getOrDefault(false)
        if (parsed) return true
        // JSON 이 아니거나 감싸진 형태여도 "ok" : true 가 있으면 깨어난 것으로 본다(공백 무시)
        return Regex("\"ok\"\\s*:\\s*true").containsMatchIn(text)
    }

    private fun beginMainLoad() {
        if (destroyed || mainFrameFailed || contentShown) return
        Log.i(TAG, "server awake -> load $START_URL")
        webView.loadUrl(START_URL)
    }

    /** 메인 페이지가 다 그려졌다: 로딩 화면을 최소 1.5초 보여 준 뒤 바를 100%로 채우고 걷는다. */
    private fun finishIntroWhenReady() {
        if (introFinished || errorView.visibility == View.VISIBLE) return
        introFinished = true
        cancelServerWakeup()

        val shownFor = System.currentTimeMillis() - loadingShownAt
        val wait = (INTRO_MIN_MS - shownFor).coerceAtLeast(0L)
        uiHandler.postDelayed({
            if (destroyed || errorView.visibility == View.VISIBLE) return@postDelayed
            runCatching {
                loadingWebView.evaluateJavascript(
                    "window.finishLoading && window.finishLoading()", null
                )
            }
            uiHandler.postDelayed({
                if (!destroyed) hideLoading()
            }, BAR_FINISH_MS)
        }, wait)
    }

    private fun showError(detail: String?) {
        if (mainFrameFailed) return
        mainFrameFailed = true
        cancelServerWakeup()
        stopIntroAnimation()
        loadingOverlay.animate().cancel()
        loadingOverlay.visibility = View.GONE
        errorDetail.text = detail?.takeIf { it.isNotBlank() }
            ?: getString(R.string.error_default_detail)
        errorView.alpha = 0f
        errorView.visibility = View.VISIBLE
        errorView.animate().alpha(1f).setDuration(220).start()
    }

    // ---------------------------------------------------------------- WebViewClient

    private inner class BadaWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean = handleUri(request.url)

        @Deprecated("Deprecated in Java")
        override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
            val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return false
            return handleUri(uri)
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
            super.onPageStarted(view, url, favicon)
            if (url != null && url.startsWith("http")) {
                mainFrameFailed = false
                // 새 시도 시작 — 이전 시도의 실패 표시를 지운다
                attemptFailed = false
            }
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            // 503/타임아웃 페이지도 onPageFinished 를 부르므로, 실패한 시도는
            // 절대 "다 그려졌다"로 처리하지 않는다(로딩 화면 유지 → 재시도).
            if (errorView.visibility != View.VISIBLE && !attemptFailed) {
                if (url != null && url.contains(BASE_HOST)) {
                    contentShown = true
                    finishIntroWhenReady()
                } else {
                    hideLoading()
                }
            }
            injectDownloadShim(view)
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
        ) {
            super.onReceivedError(view, request, error)
            if (request?.isForMainFrame != true) return
            val code = error?.errorCode ?: 0
            // 취소/중단(-1, ERROR_UNKNOWN=-1) 은 사용자가 이동한 경우가 많아 무시
            if (code == WebViewClient.ERROR_UNKNOWN || code == -1) return
            val desc = error?.description?.toString()
            Log.w(TAG, "main frame error code=$code desc=$desc url=${request.url}")
            attemptFailed = true
            val detail = describeError(code, desc)
            if (scheduleWakeupRetry()) return
            showError(detail)
        }

        override fun onReceivedHttpError(
            view: WebView?,
            request: WebResourceRequest?,
            errorResponse: WebResourceResponse?
        ) {
            super.onReceivedHttpError(view, request, errorResponse)
            if (request?.isForMainFrame != true) return
            val status = errorResponse?.statusCode ?: 0
            if (status >= 400) {
                // 이 시도는 실패했다 — onPageFinished 가 로딩 화면을 걷지 않게 한다
                attemptFailed = true
                Log.w(TAG, "main frame http error status=$status")
            }
            if (status >= 500) {
                // Render 콜드 스타트의 502/503: 로딩 화면·프로그레스 바 그대로 두고 2초 뒤 다시 확인
                if (scheduleWakeupRetry()) return
                showError("서버가 잠시 응답하지 않아요. (HTTP $status)\n잠시 뒤 다시 시도해 주세요.")
            } else if (status >= 400) {
                // 4xx 는 다시 기다린다고 풀리지 않으므로 바로 안내한다
                showError("페이지를 찾지 못했어요. (HTTP $status)\n잠시 뒤 다시 시도해 주세요.")
            }
        }

        override fun onRenderProcessGone(
            view: WebView?,
            detail: RenderProcessGoneDetail?
        ): Boolean {
            Log.w(TAG, "render process gone didCrash=${detail?.didCrash()}")
            showError("앱 화면을 다시 불러올게요. 아래 버튼을 눌러 주세요.")
            return true
        }

        private fun describeError(code: Int, desc: String?): String = when (code) {
            WebViewClient.ERROR_HOST_LOOKUP -> "서버 주소를 찾지 못했어요.\n인터넷 연결을 확인해 주세요."
            WebViewClient.ERROR_CONNECT -> "서버에 연결하지 못했어요.\n네트워크 상태를 확인해 주세요."
            WebViewClient.ERROR_TIMEOUT -> "연결 시간이 초과됐어요.\n잠시 뒤 다시 시도해 주세요."
            WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> "보안 연결에 실패했어요. 잠시 뒤 다시 시도해 주세요."
            WebViewClient.ERROR_IO -> "데이터를 받지 못했어요.\n잠시 뒤 다시 시도해 주세요."
            else -> desc?.takeIf { it.isNotBlank() }
                ?: getString(R.string.error_default_detail)
        }
    }

    // ---------------------------------------------------------------- 오류 / 재시도

    /**
     * 메인 페이지가 503·타임아웃으로 실패했을 때, 로딩 화면이 떠 있는 동안(총 90초 이내)에는
     * 오류 화면을 띄우지 않고 **로딩 오버레이·로딩 화면을 그대로 둔 채**
     * 2초 뒤 /api/health 부터 다시 확인한다. (프로그레스 바가 0%로 리셋되지 않는다)
     *
     * @return true = 재시도로 넘겼다(오류 화면을 띄우지 않는다), false = 90초를 넘겨 오류 화면으로 간다
     */
    private fun scheduleWakeupRetry(): Boolean {
        if (destroyed || contentShown) return false
        val elapsed = System.currentTimeMillis() - introStartedAt
        if (introStartedAt <= 0L || elapsed >= WAKEUP_MAX_MS) return false
        if (retryWakeupScheduled) return true
        retryWakeupScheduled = true
        Log.i(TAG, "main frame failed during intro (${elapsed}ms) -> health re-check in 2s")
        uiHandler.postDelayed({
            if (destroyed) return@postDelayed
            retryWakeupScheduled = false
            if (contentShown || errorView.visibility == View.VISIBLE) return@postDelayed
            startServerWakeup(resetTimer = false)
        }, MAIN_RETRY_DELAY_MS)
        return true
    }

    // ---------------------------------------------------------------- WebChromeClient

    private inner class BadaChromeClient : WebChromeClient() {

        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            super.onProgressChanged(view, newProgress)
            // 실패한 시도의 진행률(503 페이지 100% 등)은 표시하지 않는다
            if (loadingOverlay.visibility == View.VISIBLE && !attemptFailed) {
                loadingText.text = if (newProgress in 1..99) {
                    "펀드 모의고사 연결 중… $newProgress%"
                } else {
                    getString(R.string.loading_title)
                }
            }
        }

        override fun onJsAlert(
            view: WebView?,
            url: String?,
            message: String?,
            result: JsResult?
        ): Boolean {
            if (result == null) return false
            val dialog = AlertDialog.Builder(this@MainActivity)
                .setMessage(message ?: "")
                .setPositiveButton("확인") { _, _ -> result.confirm() }
                .setOnCancelListener { result.cancel() }
                .create()
            dialog.setCanceledOnTouchOutside(false)
            dialog.show()
            return true
        }

        override fun onJsConfirm(
            view: WebView?,
            url: String?,
            message: String?,
            result: JsResult?
        ): Boolean {
            if (result == null) return false
            val dialog = AlertDialog.Builder(this@MainActivity)
                .setMessage(message ?: "")
                .setPositiveButton("확인") { _, _ -> result.confirm() }
                .setNegativeButton("취소") { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }
                .create()
            dialog.setCanceledOnTouchOutside(false)
            dialog.show()
            return true
        }

        // 마이크·카메라 등 권한 요청은 쓰지 않으므로 거절
        override fun onPermissionRequest(request: PermissionRequest?) {
            request?.deny()
        }
    }

    // ---------------------------------------------------------------- URL / 링크 처리

    private fun handleUri(uri: Uri): Boolean {
        val scheme = (uri.scheme ?: "").lowercase()
        if (scheme == "http" || scheme == "https") {
            val host = (uri.host ?: "").lowercase()
            // 펀드 모의고사 자체 페이지는 앱 안에서
            if (host == BASE_HOST || host.endsWith(".onrender.com")) return false
            openExternally(uri)
            return true
        }
        // blob:, data:, about:, javascript: 등은 WebView 가 처리
        if (scheme == "blob" || scheme == "data" || scheme == "about" ||
            scheme == "javascript" || scheme.isEmpty()
        ) {
            return false
        }
        // mailto:, tel:, intent:, market:, 카카오톡/네이버 등 외부 앱 스킴
        openExternally(uri)
        return true
    }

    private fun openExternally(uri: Uri) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, uri)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "이 링크를 열 수 있는 앱이 없어요.", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.w(TAG, "open externally failed: ${e.message}")
            Toast.makeText(this, "링크를 열지 못했어요.", Toast.LENGTH_SHORT).show()
        }
    }

    // ---------------------------------------------------------------- 다운로드 / 학습기록 내보내기

    private fun handleDownload(
        url: String,
        userAgent: String,
        contentDisposition: String,
        mimeType: String
    ) {
        if (url.startsWith("blob:")) {
            // blob 은 JS 로 읽어서 파일 저장 화면으로 넘긴다
            val guessed = guessName(mimeType)
            fetchBlobToSave(url, guessed, mimeType)
            return
        }
        if (url.startsWith("data:")) {
            saveDataUri(url, mimeType)
            return
        }
        try {
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                addRequestHeader("User-Agent", userAgent)
                CookieManager.getInstance().getCookie(url)?.let {
                    addRequestHeader("Cookie", it)
                }
                setTitle(fileName)
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                )
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                request.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS, fileName
                )
            } else {
                request.setDestinationInExternalFilesDir(
                    this, Environment.DIRECTORY_DOWNLOADS, fileName
                )
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            Toast.makeText(this, "다운로드를 시작했어요.\n$fileName", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.w(TAG, "download failed: ${e.message}")
            Toast.makeText(this, "다운로드를 시작하지 못했어요.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun guessName(mimeType: String): String {
        val ext = when {
            mimeType.contains("json") -> "json"
            mimeType.contains("zip") -> "zip"
            mimeType.contains("pdf") -> "pdf"
            mimeType.contains("csv") -> "csv"
            mimeType.contains("text") -> "txt"
            else -> "json"
        }
        return "펀드모의고사_학습기록.${ext}"
    }

    /** blob: URL 을 JS 로 읽어 base64 로 받아 저장한다. */
    private fun fetchBlobToSave(blobUrl: String, fallbackName: String, mimeType: String) {
        val js = """
            (function(){
              try {
                fetch(${JSONObject.quote(blobUrl)}).then(function(r){return r.blob();}).then(function(b){
                  var fr = new FileReader();
                  fr.onloadend = function(){
                    var d = String(fr.result || '');
                    var i = d.indexOf(',');
                    BadaToeicAndroid.saveBase64(${JSONObject.quote(fallbackName)},
                        b.type || ${JSONObject.quote(mimeType.ifBlank { "application/json" })},
                        i >= 0 ? d.substring(i + 1) : '');
                  };
                  fr.onerror = function(){ BadaToeicAndroid.saveFailed('파일을 읽지 못했어요.'); };
                  fr.readAsDataURL(b);
                }).catch(function(e){ BadaToeicAndroid.saveFailed(String(e)); });
              } catch (e) { BadaToeicAndroid.saveFailed(String(e)); }
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun saveDataUri(dataUri: String, mimeType: String) {
        val comma = dataUri.indexOf(',')
        if (comma < 0) {
            Toast.makeText(this, "파일을 준비하지 못했어요.", Toast.LENGTH_SHORT).show()
            return
        }
        val payload = dataUri.substring(comma + 1)
        val bytes = runCatching { Base64.decode(payload, Base64.DEFAULT) }.getOrNull()
        if (bytes == null) {
            Toast.makeText(this, "파일을 준비하지 못했어요.", Toast.LENGTH_SHORT).show()
            return
        }
        startSaveFlow(guessName(mimeType), mimeType.ifBlank { "application/octet-stream" }, bytes)
    }

    /**
     * 페이지의 blob 내보내기(a.download + blob URL)를 가로채 파일 이름까지 살린다.
     * 페이지가 다시 그려져도 프로토타입 패치는 유지되므로 중복 주입은 무시한다.
     */
    private fun injectDownloadShim(view: WebView?) {
        val js = """
            (function(){
              if (window.__badaDownloadShim) return;
              window.__badaDownloadShim = true;
              try {
                var origClick = HTMLAnchorElement.prototype.click;
                HTMLAnchorElement.prototype.click = function(){
                  try {
                    var href = this.href || '';
                    if (href.indexOf('blob:') === 0 && this.download) {
                      var name = this.download;
                      fetch(href).then(function(r){return r.blob();}).then(function(b){
                        var fr = new FileReader();
                        fr.onloadend = function(){
                          var d = String(fr.result || '');
                          var i = d.indexOf(',');
                          BadaToeicAndroid.saveBase64(name, b.type || 'application/octet-stream',
                              i >= 0 ? d.substring(i + 1) : '');
                        };
                        fr.onerror = function(){ BadaToeicAndroid.saveFailed('파일을 읽지 못했어요.'); };
                        fr.readAsDataURL(b);
                      }).catch(function(e){ BadaToeicAndroid.saveFailed(String(e)); });
                      return;
                    }
                  } catch (e) {}
                  return origClick.apply(this, arguments);
                };
              } catch (e) {}
            })();
        """.trimIndent()
        view?.evaluateJavascript(js, null)
    }

    /** JS → 네이티브 파일 저장 브리지 · 학습 기록 영구 저장 */
    inner class SaveBridge {

        /** 학습 기록 JSON 을 앱 전용 SharedPreferences 에 동기(commit) 저장한다. */
        @JavascriptInterface
        fun saveStore(json: String?): Boolean {
            if (json.isNullOrEmpty()) return false
            return try {
                getSharedPreferences(STORE_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(STORE_KEY, json)
                    .commit()          // 비동기 apply 가 아니라 디스크 기록 완료까지 보장
            } catch (e: Exception) {
                Log.w(TAG, "saveStore failed: ${e.message}")
                false
            }
        }

        /** 앱 전용 SharedPreferences 에 저장된 학습 기록 JSON 을 돌려준다. 없으면 빈 문자열. */
        @JavascriptInterface
        fun loadStore(): String {
            return try {
                getSharedPreferences(STORE_PREFS, Context.MODE_PRIVATE)
                    .getString(STORE_KEY, "") ?: ""
            } catch (e: Exception) {
                Log.w(TAG, "loadStore failed: ${e.message}")
                ""
            }
        }

        @JavascriptInterface
        fun saveBase64(name: String?, mime: String?, base64: String?) {
            val safeName = sanitizeFileName(name)
            val bytes = runCatching { Base64.decode(base64 ?: "", Base64.DEFAULT) }
                .getOrNull()
            runOnUiThread {
                if (bytes == null || bytes.isEmpty()) {
                    Toast.makeText(
                        this@MainActivity,
                        "파일을 준비하지 못했어요.",
                        Toast.LENGTH_SHORT
                    ).show()
                    return@runOnUiThread
                }
                startSaveFlow(safeName, mime ?: "application/octet-stream", bytes)
            }
        }

        @JavascriptInterface
        fun saveFailed(message: String?) {
            Log.w(TAG, "js save failed: $message")
            runOnUiThread {
                Toast.makeText(
                    this@MainActivity,
                    "내보내기에 실패했어요. 잠시 뒤 다시 시도해 주세요.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun sanitizeFileName(name: String?): String {
        val base = (name ?: "").trim().ifEmpty { "펀드모의고사_학습기록.json" }
        val cleaned = base.replace(Regex("[\\\\/:*?\"<>|\\n\\r\\t]"), "_").take(120)
        return cleaned.ifEmpty { "펀드모의고사_학습기록.json" }
    }

    private fun startSaveFlow(name: String, mime: String, bytes: ByteArray) {
        pendingSave = PendingSave(name, mime, bytes)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
            putExtra(Intent.EXTRA_TITLE, name)
        }
        try {
            startActivityForResult(intent, REQ_SAVE_FILE)
        } catch (e: ActivityNotFoundException) {
            fallbackSave(name, bytes)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_SAVE_FILE) return
        val save = pendingSave ?: return
        pendingSave = null
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(save.bytes) }
            Toast.makeText(this, "저장했어요.\n${save.name}", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.w(TAG, "save failed: ${e.message}")
            fallbackSave(save.name, save.bytes)
        }
    }

    /** 파일 선택 화면을 쓸 수 없을 때 앱 전용 다운로드 폴더에 저장 */
    private fun fallbackSave(name: String, bytes: ByteArray) {
        try {
            val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
            dir.mkdirs()
            val file = File(dir, name)
            FileOutputStream(file).use { it.write(bytes) }
            Toast.makeText(this, "저장했어요.\n${file.absolutePath}", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.w(TAG, "fallback save failed: ${e.message}")
            Toast.makeText(this, "저장하지 못했어요.", Toast.LENGTH_SHORT).show()
        }
    }

    // ---------------------------------------------------------------- 생명주기 / 뒤로가기

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (errorView.visibility == View.VISIBLE) {
            retry()
            return
        }
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
    override fun onPause() {
        super.onPause()
        webView.onPause()
        runCatching { loadingWebView.onPause() }
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        runCatching { loadingWebView.onResume() }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        destroyed = true
        cancelServerWakeup()
        uiHandler.removeCallbacksAndMessages(null)
        try {
            (loadingWebView.parent as? android.view.ViewGroup)?.removeView(loadingWebView)
            loadingWebView.stopLoading()
            loadingWebView.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "loading webview destroy: ${e.message}")
        }
        try {
            // loadUrl("about:blank") 는 종료 직전 페이지가 저장을 다시 시도하면서
            // WebView 스토리지 flush 와 충돌하므로 호출하지 않는다.
            webView.removeJavascriptInterface("BadaToeicAndroid")
            webView.stopLoading()
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "webview destroy: ${e.message}")
        }
        super.onDestroy()
    }
}
