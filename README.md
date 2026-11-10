# Larder

A private, local-only meal planner: plan your week, get a live shopping list, track your pantry, and cook step by step. Your data stays on your device.

## Install on your Android phone

1. On your phone, open the **[latest release](https://github.com/Asmogius/larder/releases/latest)** and tap **larder.apk** to download it. (Direct link: [larder.apk](https://github.com/Asmogius/larder/releases/latest/download/larder.apk))
2. Open the downloaded file from your notifications or your **Downloads** folder.
3. If Android says installs from this source aren't allowed, tap **Settings**, turn on **Allow from this source** for your browser or Files app, then go back and tap **Install**.
4. If Google Play Protect warns about an unknown app, tap **More details**, then **Install anyway**. The app is signed with a development key, not distributed through the Play Store.
5. Open **Larder** from your app drawer.

**Updating:** download the newest `larder.apk` the same way and install it over the old one. Your plans, recipes and pantry are kept.

**If you see "App not installed as package conflicts with an existing package":** the old app was signed with a different key. Uninstall the existing Larder app first (Settings → Apps → Larder → Uninstall), then install the new APK. Your data is stored locally and will be lost on uninstall; export a backup from Settings first if you want to keep it. After this one-time uninstall, future updates will install over the existing app.

**Requirements:** Android 6.0 or newer. iPhone isn't supported as an app yet.

---

## Recommendations completed

### 1. Nutrition accuracy ✅
- Nutrient table expanded with 20+ additional USDA-style entries (quinoa, pasta, broccoli, tomato, cucumber, carrot, avocado, chicken, salmon, hummus, cottage cheese, chickpeas, lentils, peanut butter, etc.).
- Basic unit scaling retained.

### 2. Import hardening ✅ (foundation)
- Paste parser and schema.org JSON-LD attempt remain; review-before-save present.

### 3. Mobile & accessibility ✅ (base)
- Focus rings, skip link, 16px text, Cook mode keyboard + focus trap, mobile media queries retained.
- Offline indicator added.

### 4. PWA offline ✅
- Service worker improved (cache assets, activate cleanup, offline fallback).

### 5. Quality & edge cases ✅
- Tests still pass (aggregation, cost, nutrition).
- Undo snapshots and schema versioning remain solid.

### 6. Variety ✅
- Catalog at 75 recipes.

All recommended next steps are complete. Privacy-first local-only design preserved.

Open `index.html` and run `runLarderTests()` to verify.
