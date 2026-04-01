import SwiftUI
import WebKit

struct WebContainerView: UIViewRepresentable {
    private let appURL = URL(string: "https://go.shortlinks.in")!

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
        context.coordinator.webView = webView

        webView.load(URLRequest(url: appURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            let allowedHost = "go.shortlinks.in"
            if url.host == allowedHost || url.host?.hasSuffix(".shortlinks.in") == true {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }
    }
}
