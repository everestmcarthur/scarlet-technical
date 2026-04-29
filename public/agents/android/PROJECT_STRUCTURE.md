# Project Structure

```
android/
├── app/
│   ├── build.gradle                    # App-level build configuration
│   ├── proguard-rules.pro             # ProGuard rules for release builds
│   └── src/main/
│       ├── AndroidManifest.xml        # App manifest (permissions, components)
│       ├── java/com/scarlet/agent/    # Java source code
│       │   ├── MainActivity.java      # Enrollment interface
│       │   ├── ScarletDeviceAdminReceiver.java  # Device Admin handler
│       │   ├── AgentPollService.java  # Background heartbeat worker
│       │   ├── LockActivity.java      # Full-screen lock interface
│       │   ├── ApiClient.java         # HTTP client for server API
│       │   └── BootReceiver.java      # Boot broadcast receiver
│       └── res/                       # Resources
│           ├── layout/                # UI layouts
│           │   ├── activity_main.xml  # Enrollment screen layout
│           │   └── activity_lock.xml  # Lock screen layout
│           ├── values/                # Value resources
│           │   ├── strings.xml        # String constants
│           │   └── colors.xml         # Color definitions
│           ├── xml/
│           │   └── device_admin.xml   # Device Admin policy declarations
│           └── mipmap-*/              # App icons (multiple densities)
│               └── ic_launcher.png    # Launcher icon
├── gradle/wrapper/                    # Gradle wrapper
│   └── gradle-wrapper.properties
├── build.gradle                       # Project-level build config
├── settings.gradle                    # Project settings
├── gradle.properties                  # Gradle properties
├── .gitignore                        # Git ignore rules
├── BUILD.md                          # Build and deployment guide
├── README.md                         # Project overview
├── ICON_INSTRUCTIONS.md              # How to add app icons
└── PROJECT_STRUCTURE.md              # This file

```

## Key Files

### Java Source Files

**MainActivity.java** (300 lines)
- Enrollment UI
- Device Admin activation
- Server configuration
- Enrollment API call

**ScarletDeviceAdminReceiver.java** (40 lines)
- Extends DeviceAdminReceiver
- Handles Device Admin lifecycle events
- Shows warnings on disable attempts

**AgentPollService.java** (120 lines)
- Extends androidx.work.Worker
- Runs every 5 minutes
- Sends heartbeat to server
- Processes lock/unlock/wipe commands
- Sends command acknowledgments

**LockActivity.java** (100 lines)
- Full-screen lock interface
- Blocks back button and navigation
- Shows custom lock message
- Auto-checks for unlock every 10 seconds
- Launches on boot if device is locked

**ApiClient.java** (180 lines)
- HTTP client using HttpURLConnection
- Three methods: enrollDevice, sendHeartbeat, sendCommandAck
- JSON serialization/deserialization
- SharedPreferences integration

**BootReceiver.java** (25 lines)
- Receives BOOT_COMPLETED broadcast
- Launches LockActivity if device is locked

### Resource Files

**AndroidManifest.xml**
- Declares all activities, receivers, services
- Requests permissions
- Configures Device Admin metadata
- Sets launch activity (MainActivity)

**device_admin.xml**
- Declares Device Admin policies
- Required for Device Admin functionality

**activity_main.xml**
- Enrollment form layout
- Server URL input
- Enrollment token input
- Status display

**activity_lock.xml**
- Full-screen lock layout
- Lock icon and message
- Scarlet Technical branding
- Contact information

### Build Configuration

**app/build.gradle**
- Application ID: com.scarlet.agent
- minSdkVersion: 24 (Android 7.0)
- targetSdkVersion: 33 (Android 13)
- Dependencies: AndroidX, WorkManager

**build.gradle** (root)
- Gradle plugin version
- Repository configuration

**settings.gradle**
- Project name and modules

## Data Storage

All state stored in SharedPreferences (`ScarletAgentPrefs`):

```java
SharedPreferences prefs = context.getSharedPreferences("ScarletAgentPrefs", MODE_PRIVATE);
```

**Keys:**
- `server_url` (String) - Server endpoint
- `device_uuid` (String) - Unique device identifier
- `device_token` (String) - Authentication token
- `device_locked` (boolean) - Current lock state
- `lock_message` (String) - Custom message from server

## Build Outputs

**Debug APK:**
`app/build/outputs/apk/debug/app-debug.apk`

**Release APK:**
`app/build/outputs/apk/release/app-release-unsigned.apk`

**Signed Release APK:**
`app/build/outputs/apk/release/scarlet-agent-v1.0.0.apk`

## Dependencies

- **androidx.appcompat:appcompat:1.6.1** - Backward compatibility
- **androidx.work:work-runtime:2.8.1** - Background work scheduling
- **com.google.android.material:material:1.9.0** - Material design components

## Permissions

**Normal:**
- INTERNET
- ACCESS_NETWORK_STATE
- RECEIVE_BOOT_COMPLETED
- WAKE_LOCK

**Dangerous/Special:**
- SYSTEM_ALERT_WINDOW (show over other apps)
- DISABLE_KEYGUARD (override lock screen)

**Device Admin Policies:**
- limit-password
- watch-login
- reset-password
- force-lock
- wipe-data
