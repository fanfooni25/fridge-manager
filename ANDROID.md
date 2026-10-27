# Android APK

The Android wrapper uses Capacitor and bundles the current web app for offline launch. A debug APK is built by the `Build Android APK` GitHub Actions workflow and uploaded as the `fridge-manager-debug-apk` artifact.

## Email login callback

For email sign-in and email binding in the APK, add this URL to Supabase Dashboard → Authentication → URL Configuration → Additional Redirect URLs:

`com.fanfooni.fridgemanager://auth-callback`

The app catches the callback and exchanges the PKCE code for the session. Keep the existing HTTPS site URL entry for browser use.

## Build locally

Install Node.js 22 or later, pnpm 11.25.0, and Android Studio with an Android SDK. Then run:

```sh
pnpm install --frozen-lockfile
pnpm android:debug
```

The installable debug APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`. It is suitable for device testing and sideloading, not Google Play release signing.
