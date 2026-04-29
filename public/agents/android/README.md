# Scarlet Technical Android Agent

Android Device Management Agent for Scarlet Technical device monitoring and control.

## Features

- **Device Admin Protection**: Prevents casual uninstallation
- **Remote Lock/Unlock**: Full-screen lock interface with custom messaging
- **Remote Wipe**: Factory reset capability
- **Automatic Enrollment**: Self-service device registration
- **Persistent Monitoring**: Polls server every 5 minutes
- **Offline Resilience**: Maintains lock state across restarts and connectivity loss

## Quick Start

1. See [BUILD.md](BUILD.md) for build instructions
2. Install APK on target device
3. Enable Device Admin when prompted
4. Enter server URL and enrollment token
5. Device is now enrolled and monitored

## Architecture

### Components

- **MainActivity**: Enrollment interface
- **ScarletDeviceAdminReceiver**: Device Admin handler
- **AgentPollService**: Background heartbeat service (WorkManager)
- **LockActivity**: Full-screen lock interface
- **ApiClient**: Server communication layer
- **BootReceiver**: Launch lock screen on boot if locked

### Data Flow

1. Device enrolls → receives device_token
2. Every 5 minutes: Send heartbeat with current status
3. Server responds with lock_status and optional command
4. Agent processes command and sends acknowledgment
5. Lock state persists in SharedPreferences

### State Persistence

All state stored in SharedPreferences (`ScarletAgentPrefs`):
- `server_url`: Server endpoint
- `device_uuid`: Unique device identifier
- `device_token`: Authentication token
- `device_locked`: Current lock state (boolean)
- `lock_message`: Custom lock message from server

## Server Integration

Requires three API endpoints:

1. `POST /api/agent/enroll` - Device registration
2. `POST /api/agent/heartbeat` - Status reporting + command polling
3. `POST /api/agent/command-ack` - Command result reporting

See [BUILD.md](BUILD.md) for detailed API specifications.

## Security Model

### Device Admin

Uses Android Device Admin API to:
- Prevent uninstallation without explicit deactivation
- Lock device instantly
- Perform factory reset

Users must go to Settings → Security → Device Admin Apps → Disable "Scarlet Agent" before uninstalling.

### Authentication

- Enrollment uses single-use enrollment_token
- All subsequent requests use persistent device_token
- Tokens transmitted over HTTPS only

### Lock Enforcement

Lock activity:
- Fullscreen with no navigation/status bars
- Blocks back button
- Launches automatically on boot if locked
- Cannot be dismissed except via server unlock command

## Supported Android Versions

- **Minimum**: Android 7.0 (API 24)
- **Target**: Android 13 (API 33)
- **Tested**: Android 8-13

## Building

See [BUILD.md](BUILD.md) for complete build instructions.

Quick build:
```bash
./gradlew assembleDebug
```

## License

Proprietary - © 2026 Scarlet Technical. All rights reserved.
