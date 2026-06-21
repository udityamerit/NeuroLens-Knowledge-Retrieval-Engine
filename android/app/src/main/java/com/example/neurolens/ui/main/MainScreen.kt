package com.example.neurolens.ui.main

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.net.Uri
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
          webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
              super.onPageFinished(view, url)
              isPageLoading = false
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
            allowFileAccess = true
            allowContentAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
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
  }
}
