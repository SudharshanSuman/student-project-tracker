# IIC Platform — Android app

A [Capacitor](https://capacitorjs.com) shell that opens the existing IIC web app
(`apps/web`) inside an Android app and adds one native feature: scanning the
attendance QR code with the phone camera. All pages, logins and data still come
from the normal Next.js + Express + Postgres server; nothing is stored on the phone.

## Which server the app opens

The app loads the URL in `CAP_SERVER_URL`, which is baked in when the Android
project is synced (`capacitor.config.ts`).

| Use | `CAP_SERVER_URL` |
| --- | --- |
| Development (default) | `http://192.168.83.45:3000` — the dev machine's address on the local Wi-Fi |
| Production | the deployed HTTPS address, for example `https://iic.example.edu` |

For development the phone must be on the same Wi-Fi as the dev machine, and the
web app must be running there (`npm run dev`). If the dev machine's IP address
changes, rebuild with the new one. Plain `http://` is allowed only for this LAN
case; production must use `https://`.

## Get the APK from GitHub Actions (no Android tools needed)

1. On GitHub, open **Actions → Android APK → Run workflow**.
2. Enter the server URL (or keep the default), then run it.
3. When it finishes, download **iic-platform-debug-apk** from the run's
   *Artifacts* section, unzip it, and install `app-debug.apk` on the phone
   (allow "install unknown apps" when Android asks).

The workflow also runs on every push that changes the app or the check-in page.

## Build it yourself

Needs Node 20+, JDK 21 and the Android SDK (installing
[Android Studio](https://developer.android.com/studio) provides the SDK).

```bash
npm install                                   # from the repo root
CAP_SERVER_URL=http://192.168.83.45:3000 npm run sync -w @iic/mobile
npm run open -w @iic/mobile                   # opens Android Studio → Run ▶
# or, without the Android Studio UI:
cd apps/mobile/android && ./gradlew assembleDebug
# APK: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## QR check-in

On **Attendance → Check in**, the app shows a **Scan QR code** button. It opens
Google's code scanner, reads the token from the session QR
(`…/attendance/check-in?token=…`) and checks in straight away. The address
inside the QR does not matter, so a code shown from `localhost` still works. In
an ordinary browser the button is hidden and the page works as before.
