package com.example.neurolens.ui.main

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.view.View
import android.os.Handler
import android.os.Looper
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation3.runtime.NavKey

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MainScreen(
  onItemClick: (NavKey) -> Unit,
  modifier: Modifier = Modifier,
) {
  var webView: WebView? by remember { mutableStateOf(null) }
  var isPageLoading by remember { mutableStateOf(true) }
  var errorMessage by remember { mutableStateOf<String?>(null) }

  // Add Javascript Interface
  val jsBridge = remember {
    JSBridge { error ->
      errorMessage = error
    }
  }

  // React mount watchdog: check after 6 seconds if React has set window.__reactAppMounted = true
  LaunchedEffect(isPageLoading) {
    if (!isPageLoading) {
      kotlinx.coroutines.delay(6000)
      webView?.evaluateJavascript("window.__reactAppMounted") { value ->
        if (value == null || value == "null" || value == "false" || value == "undefined") {
          android.util.Log.w("NeuroLensWebView", "Watchdog triggered: React app failed to set window.__reactAppMounted")
          errorMessage = "Watchdog Timeout: The web app loaded but failed to initialize. Your device's WebView may not support modern ES module scripts."
        } else {
          android.util.Log.i("NeuroLensWebView", "Watchdog passed: React app mounted (value: $value)")
        }
      }
    }
  }

  // State to hold reference to upload file callback
  var uploadMessageCallback: ValueCallback<Array<Uri>>? by remember { mutableStateOf(null) }

  // File chooser activity launcher
  val fileChooserLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val resultCode = result.resultCode
    val data = result.data
    val results = if (resultCode == Activity.RESULT_OK && data != null) {
      WebChromeClient.FileChooserParams.parseResult(resultCode, data)
    } else {
      null
    }
    uploadMessageCallback?.onReceiveValue(results)
    uploadMessageCallback = null
  }

  // Request permissions launcher for camera and recording audio on startup
  val permissionsRequestLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.RequestMultiplePermissions()
  ) { permissions ->
    // Permissions are handled; user granted or denied. WebView request permissions will still trigger WebChromeClient.
  }

  // Request camera and microphone permissions when app starts
  LaunchedEffect(Unit) {
    permissionsRequestLauncher.launch(
      arrayOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO
      )
    )
  }

  // Handle back button presses to navigate back inside WebView history if possible
  BackHandler(enabled = webView?.canGoBack() == true) {
    webView?.goBack()
  }

  Box(modifier = modifier.fillMaxSize()) {
    AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { context ->
        WebView(context).apply {
          // Enable remote debugging of WebView via Chrome DevTools (chrome://inspect)
          if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true)
          }

          // Enable hardware acceleration
          setLayerType(View.LAYER_TYPE_HARDWARE, null)

          // Enable cookie acceptance
          CookieManager.getInstance().setAcceptCookie(true)
          if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
          }

          webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
              super.onPageStarted(view, url, favicon)
              injectErrorListener(view)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
              super.onPageFinished(view, url)
              isPageLoading = false
              injectErrorListener(view)
            }

            private fun injectErrorListener(view: WebView?) {
              val js = """
                (function() {
                  if (window.__errorListenerInjected) return;
                  window.__errorListenerInjected = true;
                  
                  // Catch unhandled runtime errors
                  window.onerror = function(message, source, lineno, colno, error) {
                    var errStr = message + '\nAt: ' + source + ':' + lineno + ':' + colno;
                    if (window.AndroidBridge) {
                      window.AndroidBridge.reportError(errStr);
                    }
                    return false;
                  };
                  
                  // Catch unhandled promise rejections
                  window.addEventListener('unhandledrejection', function(event) {
                    var reason = event.reason;
                    var errStr = 'Unhandled Rejection: ' + (reason && reason.stack ? reason.stack : reason);
                    if (window.AndroidBridge) {
                      window.AndroidBridge.reportError(errStr);
                    }
                  });
                  
                  console.log('JS error listeners injected successfully.');
                })();
              """.trimIndent()
              view?.evaluateJavascript(js, null)
            }

            override fun onReceivedError(
              view: WebView?,
              request: WebResourceRequest?,
              error: WebResourceError?
            ) {
              super.onReceivedError(view, request, error)
              android.util.Log.e("NeuroLensWebView", "WebView Error: ${error?.description} (Code: ${error?.errorCode}) on URL: ${request?.url}")
              if (request?.isForMainFrame == true) {
                errorMessage = "Failed to load NeuroLens: ${error?.description} (Code: ${error?.errorCode})"
                isPageLoading = false
              }
            }

            override fun onReceivedHttpError(
              view: WebView?,
              request: WebResourceRequest?,
              errorResponse: WebResourceResponse?
            ) {
              super.onReceivedHttpError(view, request, errorResponse)
              android.util.Log.e("NeuroLensWebView", "HTTP Error: ${errorResponse?.statusCode} ${errorResponse?.reasonPhrase} on URL: ${request?.url}")
              if (request?.isForMainFrame == true) {
                errorMessage = "HTTP Error: ${errorResponse?.statusCode} ${errorResponse?.reasonPhrase}"
                isPageLoading = false
              }
            }

            override fun onReceivedSslError(
              view: WebView?,
              handler: SslErrorHandler?,
              error: SslError?
            ) {
              android.util.Log.e("NeuroLensWebView", "SSL Error: ${error?.primaryError} on URL: ${error?.url}")
              // Proceed through SSL certificates if needed for debug loads
              handler?.proceed()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
              val url = request?.url?.toString() ?: return false
              // Force standard HTTP/HTTPS links to load inside WebView rather than opening external browser
              if (url.startsWith("http://") || url.startsWith("https://")) {
                return false
              }
              // Handle external protocols (tel, mailto, maps, market) using external activities
              try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                context.startActivity(intent)
              } catch (e: Exception) {
                android.util.Log.e("NeuroLensWebView", "Could not start activity for custom protocol: $url", e)
              }
              return true
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
              if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                return false
              }
              try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                context.startActivity(intent)
              } catch (e: Exception) {
                android.util.Log.e("NeuroLensWebView", "Could not start activity for custom protocol: $url", e)
              }
              return true
            }
          }

          webChromeClient = object : WebChromeClient() {
            // Support camera/microphone inside web app
            override fun onPermissionRequest(request: PermissionRequest?) {
              if (request != null) {
                // Grant all requested resources (camera, microphone)
                request.grant(request.resources)
              }
            }

            // Support JavaScript console messages redirection to Android Logcat
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
              if (consoleMessage != null) {
                android.util.Log.d(
                  "NeuroLensWebView",
                  "${consoleMessage.message()} -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}"
                )
              }
              return super.onConsoleMessage(consoleMessage)
            }

            // Support file upload input tags
            override fun onShowFileChooser(
              webView: WebView?,
              filePathCallback: ValueCallback<Array<Uri>>?,
              fileChooserParams: FileChooserParams?
            ): Boolean {
              // Cancel any existing callback
              uploadMessageCallback?.onReceiveValue(null)
              uploadMessageCallback = filePathCallback

              try {
                val intent = fileChooserParams?.createIntent()
                if (intent != null) {
                  fileChooserLauncher.launch(intent)
                } else {
                  uploadMessageCallback?.onReceiveValue(null)
                  uploadMessageCallback = null
                  return false
                }
              } catch (e: Exception) {
                uploadMessageCallback?.onReceiveValue(null)
                uploadMessageCallback = null
                return false
              }
              return true
            }
          }

          // Configure standard WebView settings for modern React applications
          // Clear cache on startup to prevent loading stale cached assets
          clearCache(true)

          // Configure standard WebView settings for modern React applications
          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

            // Force WebView to skip caching to ensure new legacy bundles are loaded
            cacheMode = WebSettings.LOAD_NO_CACHE

            // Set browser user-agent to bypass any mobile browser restriction checks
            userAgentString = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

            // Allow JS to open windows automatically
            javaScriptCanOpenWindowsAutomatically = true
            loadsImagesAutomatically = true
          }

          // Add Javascript interface
          addJavascriptInterface(jsBridge, "AndroidBridge")

          loadUrl("file:///android_asset/www/index.html")
          webView = this
        }
      },
      update = {
        // Managed via factory/BackHandler
      }
    )

    if (isPageLoading) {
      CircularProgressIndicator(
        modifier = Modifier.align(Alignment.Center),
        color = Color(0xFF00F5D4)
      )
    }

    if (errorMessage != null) {
      Column(
        modifier = Modifier
          .fillMaxSize()
          .background(Color(0xFF060814))
          .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
      ) {
        Text(
          text = "Connection Error",
          style = MaterialTheme.typography.titleLarge,
          color = Color.White
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
          text = errorMessage!!,
          style = MaterialTheme.typography.bodyMedium,
          color = Color.Gray,
          textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(
          onClick = {
            errorMessage = null
            isPageLoading = true
            webView?.reload()
          },
          colors = ButtonDefaults.buttonColors(
            containerColor = Color(0xFF00F5D4),
            contentColor = Color.Black
          )
        ) {
          Text("Retry")
        }
      }
    }
  }
}

class JSBridge(private val onError: (String) -> Unit) {
  private val handler = Handler(Looper.getMainLooper())

  @JavascriptInterface
  fun reportError(message: String) {
    handler.post {
      onError(message)
    }
  }
}
