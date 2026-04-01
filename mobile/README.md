# ShortLink Mobile Wrappers

This folder contains ready-to-open mobile wrapper scaffolds for the live ShortLink app.

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

Two options are ready:

### Fastest option: install the PWA

1. Open `https://go.shortlinks.in` in Safari
2. Tap `Share`
3. Tap `Add to Home Screen`

### Native wrapper scaffold

A WKWebView iOS scaffold is included here:

- `mobile/ios-webview`

Open `mobile/ios-webview/README.md` on a Mac and generate the Xcode project with XcodeGen.
