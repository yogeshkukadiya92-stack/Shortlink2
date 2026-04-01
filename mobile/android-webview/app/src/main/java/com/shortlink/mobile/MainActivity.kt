package com.shortlink.mobile

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebViewClient.ERROR_HOST_LOOKUP
import android.webkit.WebViewClient.ERROR_TIMEOUT
import android.webkit.WebViewClient.ERROR_TOO_MANY_REQUESTS
import androidx.appcompat.app.AppCompatActivity
import com.shortlink.mobile.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var hasLoadedFallback = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.swipeRefresh.setOnRefreshListener {
            binding.webView.reload()
        }

        binding.webView.apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadsImagesAutomatically = true
            overScrollMode = View.OVER_SCROLL_NEVER
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    return false
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    binding.progressBar.visibility = View.VISIBLE
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    binding.progressBar.visibility = View.GONE
                    binding.swipeRefresh.isRefreshing = false
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) {
                        tryFallback(error?.errorCode ?: ERROR_TIMEOUT)
                    }
                }
            }
            loadUrl(PRIMARY_APP_URL)
        }
    }

    override fun onBackPressed() {
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
            return
        }
        super.onBackPressed()
    }

    private fun tryFallback(errorCode: Int) {
        if (hasLoadedFallback) {
            binding.progressBar.visibility = View.GONE
            binding.swipeRefresh.isRefreshing = false
            return
        }

        if (errorCode == ERROR_HOST_LOOKUP || errorCode == ERROR_TIMEOUT || errorCode == ERROR_TOO_MANY_REQUESTS) {
            hasLoadedFallback = true
            binding.webView.loadUrl(FALLBACK_APP_URL)
        }
    }

    companion object {
        private const val PRIMARY_APP_URL = "https://go.shortlinks.in"
        private const val FALLBACK_APP_URL = "https://shortlink2-production.up.railway.app/home"
    }
}
