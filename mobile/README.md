# ShortLink Mobile Wrappers

This folder contains a ready-to-open Android WebView wrapper project for the live ShortLink app.

## Android

Project path:

- `mobile/android-webview`

Open it in Android Studio and build:

1. Open Android Studio
2. `Open` -> `E:\short link\mobile\android-webview`
3. Let Gradle sync
4. Build APK:
   - `Build` -> `Build Bundle(s) / APK(s)` -> `Build APK(s)`

The app loads:

- `https://go.shortlinks.in`

## iPhone / iOS

For iPhone, the fastest no-code route is the PWA already included in the web app:

1. Open `https://go.shortlinks.in` in Safari
2. Tap `Share`
3. Tap `Add to Home Screen`

If you want a true App Store iOS app later, the same web app can be wrapped in a WKWebView Xcode project.
