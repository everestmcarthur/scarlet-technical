# Scarlet Technical Android Agent - Technician Installation Guide

## What This App Does

The Scarlet Agent allows Scarlet Technical to remotely manage Android devices:
- Lock devices if payment is overdue or device needs to be returned
- Unlock devices when payment is received
- Remotely wipe devices if necessary
- Prevent unauthorized removal of the app

## Before You Start

**You will need:**
1. The Scarlet Agent APK file
2. The device to be enrolled
3. Internet connection
4. Enrollment token (get from Scarlet Technical portal)

**Device requirements:**
- Android 7.0 or newer
- Active internet connection (WiFi or cellular data)

## Installation Steps

### Step 1: Install the APK

**Method A: Via USB Cable**
1. Copy `scarlet-agent-v1.0.0.apk` to device (use USB file transfer)
2. On device, open Files app
3. Locate the APK file
4. Tap the APK file
5. If prompted, enable "Install from Unknown Sources"
6. Tap "Install"
7. Wait for installation to complete
8. Tap "Open"

**Method B: Via Download Link**
1. On device, open web browser
2. Navigate to download URL provided
3. Download the APK
4. Open the downloaded file
5. If prompted, enable "Install from Unknown Sources"
6. Tap "Install"
7. Tap "Open"

### Step 2: Enable Device Admin

1. App will show "Device Admin" activation screen
2. Tap "Activate" button
3. Review permissions (this is normal)
4. Tap "Activate this device admin app"

**Why Device Admin?**
Device Admin prevents customers from easily uninstalling the app. They would need to go into Settings → Security and manually disable it first, which creates a barrier.

### Step 3: Enroll the Device

1. In the enrollment screen, enter:
   - **Server URL**: `https://scarlet-technical.onrender.com`
   - **Enrollment Token**: [Get from portal - one per device]

2. Tap "Enroll Device"

3. Wait for confirmation (5-10 seconds)

4. You should see:
   - "Device enrolled successfully"
   - A Device UUID (unique identifier)
   - Server URL displayed

**If enrollment fails:**
- Check server URL is correct (no typo, no trailing slash)
- Verify enrollment token is valid and not already used
- Ensure device has internet connection
- Try again

### Step 4: Verify Installation

1. **Check enrollment status**:
   - Open Scarlet Agent app
   - Should show "Device enrolled successfully"
   - Should display Device UUID

2. **Check Device Admin**:
   - Go to Settings → Security → Device Admin Apps
   - "Scarlet Agent" should be listed and enabled
   - Try to uninstall the app - it should require disabling Device Admin first

3. **Check server portal**:
   - Log into Scarlet Technical portal
   - Find the device by UUID
   - Status should show "Online" or "Active"
   - Last heartbeat should be recent (within 5 minutes)

## Testing Lock/Unlock (Optional)

**Only do this if authorized:**

1. In Scarlet Technical portal, find the device
2. Click "Lock Device"
3. Enter a lock message (e.g., "Test lock - will unlock shortly")
4. Wait up to 5 minutes
5. Device should show full-screen lock
6. Click "Unlock Device" in portal
7. Wait up to 5 minutes
8. Device should return to normal

## Troubleshooting

### App won't install
**Problem**: "App not installed" error
**Solution**: 
- Enable "Unknown Sources" in Settings → Security
- Or Settings → Apps → Special Access → Install Unknown Apps
- Make sure APK file is not corrupted (re-download)

### Device Admin won't enable
**Problem**: Cannot activate Device Admin
**Solution**:
- Some devices restrict Device Admin for security
- Go to Settings → Security → Device Admin Apps
- Ensure no other similar apps are blocking it
- Try restarting device and trying again

### Enrollment fails
**Problem**: "Enrollment failed" message
**Solution**:
- Double-check server URL: `https://scarlet-technical.onrender.com`
- Make sure NO trailing slash
- Verify enrollment token is correct
- Check device has internet connection (try loading a webpage)
- Check enrollment token hasn't been used already

### Device doesn't appear in portal
**Problem**: Enrolled but not showing in portal
**Solution**:
- Wait 5 minutes (first heartbeat takes up to 5 minutes)
- Refresh portal page
- Check Device UUID matches between app and portal
- Verify device has internet connection

### Lock doesn't work
**Problem**: Lock command sent but device not locking
**Solution**:
- Wait up to 5 minutes (polling interval)
- Check device has internet connection
- Force close and reopen app
- Check app permissions are all granted
- Restart device

### Customer uninstalled the app
**Problem**: Customer removed the agent
**Solution**:
- If Device Admin was enabled, they had to manually disable it first
- Device will show as offline in portal after 5 minutes
- Reinstall the app using same steps
- May need new enrollment token

## Important Notes

### For Customers

**Tell customers:**
- This app is required for device monitoring
- It will not affect normal device use
- It does not access personal data
- It only activates if payment issues occur
- Attempting to remove it may lock the device

### Do Not

- **Don't** give enrollment tokens to customers
- **Don't** test lock on customer devices without reason
- **Don't** use wipe command unless absolutely necessary
- **Don't** share server credentials

### Battery and Data Usage

- App runs in background
- Minimal battery impact (checks server every 5 minutes)
- Minimal data usage (small JSON payloads)
- Will not drain battery or use significant data

## Support

**For technician support:**
- Phone: (765) 555-0100
- Portal: scarlet-technical.onrender.com
- Email: support@scarlet-technical.onrender.com

**For device issues:**
1. Check device has internet
2. Check app is installed and not force-stopped
3. Check Device Admin is enabled
4. Check portal shows device online
5. Contact support if still not working

## Quick Reference Card

```
┌─────────────────────────────────────────┐
│     SCARLET AGENT INSTALLATION          │
├─────────────────────────────────────────┤
│ 1. Install APK                          │
│ 2. Enable Device Admin                  │
│ 3. Enter server URL and token           │
│ 4. Verify in portal                     │
├─────────────────────────────────────────┤
│ Server: scarlet-technical.onrender.com    │
│ Support: (765) 555-0100                 │
└─────────────────────────────────────────┘
```

---

**Last Updated**: 2026-04-28  
**Version**: 1.0.0
