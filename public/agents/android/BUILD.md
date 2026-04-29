# Scarlet Technical Android Agent - Build Instructions

## Overview

The Scarlet Agent provides remote device management capabilities:
- Device lock/unlock
- Remote wipe
- Tamper prevention via Device Admin API
- Automatic enrollment and heartbeat reporting
- Full-screen lock interface

## Prerequisites

1. **Android Studio** (latest stable) - https://developer.android.com/studio
2. **JDK 8+** - Verify: `java -version`
3. **Android SDK** - API 24+ (Android 7.0+)

## Build Process

### Option 1: Android Studio (Recommended)

1. Open Android Studio → Open Existing Project → Select this directory
2. Create `local.properties`: `sdk.dir=/path/to/Android/sdk`
3. Sync Gradle (click "Sync Now")
4. Build → Build Bundle(s) / APK(s) → Build APK(s)
5. Output: `app/build/outputs/apk/debug/app-debug.apk`

### Option 2: Command Line

```bash
# Setup
echo "sdk.dir=/path/to/Android/sdk" > local.properties
chmod +x gradlew

# Build debug
./gradlew assembleDebug

# Build release (unsigned)
./gradlew assembleRelease

# Sign release APK
keytool -genkey -v -keystore scarlet-release.keystore \
  -alias scarlet-agent -keyalg RSA -keysize 2048 -validity 10000

jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore scarlet-release.keystore \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  scarlet-agent

zipalign -v 4 \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  app/build/outputs/apk/release/scarlet-agent-v1.0.0.apk
```

## Installation

### Via ADB

```bash
# Enable USB Debugging: Settings → About Phone → Tap "Build Number" 7x
# Then: Settings → Developer Options → Enable USB Debugging

adb install app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.scarlet.agent/.MainActivity
```

### Via Direct Transfer

1. Copy APK to device
2. Enable: Settings → Security → Unknown Sources
3. Open APK file to install

## Device Enrollment

1. **Enable Device Admin** (prevents uninstallation)
   - Tap "Activate" when prompted
   - Review permissions → Activate

2. **Enter Server Details**
   - Server URL: `https://scarlet-technical.onrender.com` (no trailing slash)
   - Enrollment Token: From management portal
   - Tap "Enroll Device"

3. **Verify**
   - Status shows "enrolled successfully"
   - Device UUID displayed
   - Agent polls every 5 minutes

## Server API Endpoints

### POST /api/agent/enroll
```json
Request:
{
  "enrollment_token": "token",
  "device_uuid": "uuid",
  "hostname": "Device Model",
  "os_info": "Android 12 (API 31)",
  "platform": "android",
  "agent_version": "1.0.0"
}

Response:
{ "device_token": "auth-token", "device_uuid": "uuid" }
```

### POST /api/agent/heartbeat
```json
Request:
{ "device_token": "token", "device_uuid": "uuid", "current_status": "unlocked" }

Response:
{
  "lock_status": "locked",
  "lock_message": "Custom message",
  "command": { "id": "cmd-123", "action": "lock", "message": "msg" }
}
```

### POST /api/agent/command-ack
```json
Request:
{
  "device_token": "token",
  "device_uuid": "uuid",
  "command_id": "cmd-123",
  "result": "success",
  "new_lock_status": "locked"
}
```

## Remote Commands

- **Lock**: Full-screen lock with custom message, blocks back button, survives restarts
- **Unlock**: Removes lock
- **Wipe**: Factory reset (requires Device Admin)

## Troubleshooting

**SDK not found**: Create `local.properties` with SDK path
**Gradle errors**: Delete `.gradle`, run `./gradlew clean`
**Install fails**: `adb uninstall com.scarlet.agent`
**Can't enable Device Admin**: Check Settings → Security → Device Admin Apps
**Enrollment fails**: Verify URL (no slash), token, internet connection

## Security

**Keystore**: Keep secure\! Without it, cannot publish updates.

**Permissions**: INTERNET, ACCESS_NETWORK_STATE, RECEIVE_BOOT_COMPLETED, WAKE_LOCK, SYSTEM_ALERT_WINDOW, DISABLE_KEYGUARD

**Device Admin Policies**: limit-password, watch-login, reset-password, force-lock, wipe-data

## Testing Checklist

- [ ] Build succeeds
- [ ] Installs on device
- [ ] Device Admin enables
- [ ] Enrollment works with valid token
- [ ] Heartbeat every 5 minutes
- [ ] Lock command locks device
- [ ] Lock shows custom message
- [ ] Lock blocks back button
- [ ] Unlock command unlocks
- [ ] Cannot uninstall without disabling Device Admin

## Support

**Scarlet Technical**
- Phone: (765) 555-0100
- Web: scarlet-technical.onrender.com

© 2026 Scarlet Technical. Proprietary software for authorized use only.
