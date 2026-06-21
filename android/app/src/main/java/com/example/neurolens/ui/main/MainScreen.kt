package com.example.neurolens.ui.main

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
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
            override fun onPageFinished(view: WebView?, url: String?) {
              super.onPageFinished(view, url)
              isPageLoading = false
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
          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

            // Set browser user-agent to bypass any mobile browser restriction checks
            userAgentString = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

            // Allow JS to open windows automatically
            javaScriptCanOpenWindowsAutomatically = true
            loadsImagesAutomatically = true
          }

          loadUrl("https://udityamerit.github.io/NeuroLens-Knowledge-Retrieval-Engine/")
          webView = this
        }
      },
      update = {
        // Managed via factory/BackHandler
      }
    )

    if (isPageLoading) {
      CircularProgressIndicator(
        modifier = Modifier.align(Alignment.Center)
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
