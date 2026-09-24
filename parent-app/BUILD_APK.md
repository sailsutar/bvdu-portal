# Build installable APK (BVU Parent)

You need an APK on **your PC** (this project does not ship a pre-built binary).

## Method 1 — Expo EAS (recommended, free tier)

### 1. Account
- Create free account: https://expo.dev/signup

### 2. On your PC
```bash
cd starter/parent-app
npm install
npm install -g eas-cli
eas login
```

### 3. Link project (first time)
```bash
eas build:configure
```

### 4. Set API URL for the college network
Edit `app.json` → `expo.extra.apiBaseUrl` to your **deployed backend** URL, e.g.:
```json
"apiBaseUrl": "https://your-server.com"
```
For LAN-only demo, use your PC IP (parents on same Wi‑Fi):
```json
"apiBaseUrl": "http://192.168.1.12:4000"
```
(Android blocks cleartext HTTP unless configured; for production use HTTPS.)

### 5. Build APK
```bash
eas build -p android --profile preview
```

- Wait 10–20 minutes on Expo servers  
- Open the build page → **Download**  
- Transfer the `.apk` to the phone → open → Install (allow unknown sources if asked)

### 6. Install on phone
1. Copy APK to phone  
2. Open file → Install  
3. Open **BVU Parent** → login with parent mobile + `parent123`

---

## Method 2 — Android Studio (local)

Requires Android Studio + SDK.

```bash
cd starter/parent-app
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

APK path (typical):
`android/app/build/outputs/apk/release/app-release.apk`

(You may need a release keystore for a signed APK.)

---

## Profiles (eas.json)

| Profile   | Output        | Use                |
|-----------|---------------|--------------------|
| preview   | **APK**       | Direct phone install / demo |
| production| AAB (Play)    | Google Play Store  |

---

## Notes

- Expo Go is for development; **APK** is for install without Expo Go  
- Backend must be reachable from the phone at `apiBaseUrl`  
- First EAS build may ask to create Android credentials — accept defaults for demo  
