# File Manifest - Scarlet Technical Android Agent

Complete list of all files in this Android project.

## Documentation Files

- `README.md` - Project overview and features
- `BUILD.md` - Complete build and deployment instructions
- `TECHNICIAN_GUIDE.md` - Installation guide for field technicians
- `DEPLOYMENT_CHECKLIST.md` - Pre-deployment testing checklist
- `ICON_INSTRUCTIONS.md` - How to create and add app icons
- `PROJECT_STRUCTURE.md` - Detailed project structure documentation
- `FILE_MANIFEST.md` - This file

## Build Configuration

- `build.gradle` - Root project build configuration
- `settings.gradle` - Gradle project settings
- `gradle.properties` - Gradle JVM and AndroidX settings
- `local.properties.template` - Template for local SDK configuration
- `.gitignore` - Git ignore rules for Android projects

## App Configuration

- `app/build.gradle` - App module build configuration
- `app/proguard-rules.pro` - ProGuard rules for release builds
- `app/src/main/AndroidManifest.xml` - App manifest (permissions, components)

## Java Source Files (6 classes)

### Main Package: com.scarlet.agent

**Location**: `app/src/main/java/com/scarlet/agent/`

1. **MainActivity.java** (~150 lines)
   - Enrollment interface and UI logic
   - Device Admin activation flow
   - Server configuration inputs
   - Enrollment API integration

2. **ScarletDeviceAdminReceiver.java** (~40 lines)
   - Device Admin receiver implementation
   - Handles enable/disable events
   - Shows warnings on deactivation attempts

3. **AgentPollService.java** (~120 lines)
   - Background worker (WorkManager)
   - Sends heartbeat every 5 minutes
   - Processes server commands (lock/unlock/wipe)
   - Sends command acknowledgments

4. **LockActivity.java** (~100 lines)
   - Full-screen lock interface
   - Blocks back button and navigation
   - Shows custom lock message
   - Auto-checks for unlock status
   - Launches on boot if locked

5. **ApiClient.java** (~200 lines)
   - HTTP client implementation
   - Three API methods: enroll, heartbeat, command-ack
   - JSON serialization/parsing
   - SharedPreferences integration

6. **BootReceiver.java** (~25 lines)
   - Receives BOOT_COMPLETED broadcast
   - Launches LockActivity if device is locked
   - Ensures lock persists across restarts

## Resource Files

### Layouts

- `app/src/main/res/layout/activity_main.xml` - Enrollment screen layout
- `app/src/main/res/layout/activity_lock.xml` - Lock screen layout

### Values

- `app/src/main/res/values/strings.xml` - String resources
- `app/src/main/res/values/colors.xml` - Color definitions

### XML Configuration

- `app/src/main/res/xml/device_admin.xml` - Device Admin policy declarations

### Icons (Directories Created)

- `app/src/main/res/mipmap-mdpi/` - 48x48 density icons
- `app/src/main/res/mipmap-hdpi/` - 72x72 density icons
- `app/src/main/res/mipmap-xhdpi/` - 96x96 density icons
- `app/src/main/res/mipmap-xxhdpi/` - 144x144 density icons
- `app/src/main/res/mipmap-xxxhdpi/` - 192x192 density icons

**Note**: Icon files (ic_launcher.png) must be added manually. See ICON_INSTRUCTIONS.md.

## Gradle Wrapper

- `gradle/wrapper/gradle-wrapper.properties` - Gradle wrapper configuration

## File Statistics

- **Total Documentation**: 7 markdown files
- **Total Java Classes**: 6 classes (~635 lines total)
- **Total XML Files**: 5 files
- **Total Gradle Files**: 3 files
- **Total Directories**: ~15 directories

## Not Included (Must Add)

These files must be added by the builder:

1. **local.properties** - Create from template with your SDK path
2. **App icons** - ic_launcher.png in all mipmap-* directories
3. **Release keystore** - Create for signing release APKs
4. **Gradle wrapper JAR** - Download via `gradle wrapper` command

## Build Outputs (Generated)

These are created during build and not checked into git:

- `.gradle/` - Gradle cache
- `app/build/` - Compiled classes and outputs
- `build/` - Root build directory
- `app/build/outputs/apk/debug/app-debug.apk` - Debug APK
- `app/build/outputs/apk/release/app-release-unsigned.apk` - Unsigned release

## File Size Summary

Estimated sizes:

- Complete source: ~50 KB
- Documentation: ~45 KB
- Total project (no build): ~100 KB
- Built debug APK: ~2-3 MB
- Built release APK: ~1-2 MB (with ProGuard)

## Checksum Verification

To verify file integrity after transfer:

```bash
find . -type f -name "*.java" -o -name "*.xml" -o -name "*.gradle" | sort | xargs sha256sum
```

## Next Steps

1. Review all documentation files
2. Add app icons (see ICON_INSTRUCTIONS.md)
3. Create local.properties with SDK path
4. Build debug APK: `./gradlew assembleDebug`
5. Test on physical Android device
6. Follow DEPLOYMENT_CHECKLIST.md before production

---

**Project**: Scarlet Technical Android Agent  
**Version**: 1.0.0  
**Created**: 2026-04-28  
**Platform**: Android 7.0+ (API 24+)
