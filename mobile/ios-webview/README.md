# ShortLink iOS Wrapper

This folder contains an iOS WKWebView wrapper scaffold for the live ShortLink app.

## What it loads

- `https://go.shortlinks.in`

## Recommended setup

Generate the Xcode project on a Mac using [XcodeGen](https://github.com/yonaskolb/XcodeGen):

1. Install XcodeGen
2. Open Terminal on macOS
3. Run:

```bash
cd mobile/ios-webview
xcodegen generate
open ShortLinkIOS.xcodeproj
```

## Build in Xcode

1. Select a simulator or connected iPhone
2. Press `Run`
3. For App Store / archive:
   - `Product` -> `Archive`
