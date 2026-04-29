# Scarlet Technical Android Agent - Deployment Checklist

## Pre-Build Checklist

- [ ] Android Studio installed (or Android SDK + JDK)
- [ ] `local.properties` created with SDK path
- [ ] Custom launcher icons added (see ICON_INSTRUCTIONS.md)
- [ ] Server URL configured correctly
- [ ] Enrollment token system ready

## Build Checklist

- [ ] Project syncs without errors in Android Studio
- [ ] Dependencies download successfully
- [ ] Debug APK builds successfully: `./gradlew assembleDebug`
- [ ] Release keystore created and backed up securely
- [ ] Release APK signed with production keystore
- [ ] APK file size is reasonable (< 10 MB expected)

## Testing Checklist

### Installation Testing
- [ ] APK installs on Android 7.0 device
- [ ] APK installs on Android 10+ device
- [ ] App icon displays correctly
- [ ] App appears in launcher

### Device Admin Testing
- [ ] Device Admin activation prompt appears
- [ ] Device Admin can be enabled
- [ ] Device Admin shows in Settings → Security → Device Admin Apps
- [ ] Warning appears when trying to disable Device Admin
- [ ] Cannot uninstall app without disabling Device Admin first

### Enrollment Testing
- [ ] Server URL input accepts valid URL
- [ ] Enrollment token input accepts token
- [ ] Enrollment succeeds with valid credentials
- [ ] Enrollment fails gracefully with invalid credentials
- [ ] Device UUID is generated and displayed
- [ ] Enrollment status persists after app restart

### Heartbeat Testing
- [ ] Heartbeat sent within 5 minutes of enrollment
- [ ] Heartbeat continues every 5 minutes
- [ ] Heartbeat includes correct device_token and device_uuid
- [ ] Heartbeat sends current lock status correctly
- [ ] Server receives heartbeat (check server logs)

### Lock Command Testing
- [ ] Lock command locks device immediately
- [ ] Lock screen appears full-screen
- [ ] Lock screen shows custom message from server
- [ ] Lock screen shows Scarlet Technical branding
- [ ] Lock screen shows contact information
- [ ] Back button is blocked on lock screen
- [ ] Lock screen cannot be dismissed by user
- [ ] Lock persists after closing and reopening app
- [ ] Lock persists after device restart
- [ ] Lock screen launches automatically after restart

### Unlock Command Testing
- [ ] Unlock command unlocks device
- [ ] Lock screen disappears after unlock
- [ ] Device returns to normal operation
- [ ] Unlock persists after app restart

### Wipe Command Testing (Use Test Device Only\!)
- [ ] Wipe command triggers factory reset dialog
- [ ] Factory reset completes successfully
- [ ] All data is erased
- [ ] Device returns to setup screen

### Edge Cases
- [ ] App handles no internet connection gracefully
- [ ] Lock state persists when offline
- [ ] Heartbeat resumes when connection restored
- [ ] App handles server errors gracefully (500, timeout)
- [ ] App handles malformed server responses
- [ ] Lock screen cannot be bypassed by force-stopping app
- [ ] Device Admin cannot be disabled while app is locked

## Security Checklist

- [ ] Keystore file backed up securely (offline storage)
- [ ] Keystore password documented securely
- [ ] Server URL uses HTTPS (not HTTP)
- [ ] No hardcoded credentials in code
- [ ] No debug logging in release build
- [ ] ProGuard enabled for release build
- [ ] APK signed with production certificate

## Documentation Checklist

- [ ] BUILD.md reviewed and accurate
- [ ] README.md reviewed and accurate
- [ ] Server API endpoints documented
- [ ] Enrollment process documented
- [ ] Support contact information correct
- [ ] Troubleshooting guide complete

## Deployment Checklist

### Internal Distribution
- [ ] Signed release APK generated
- [ ] APK uploaded to distribution server
- [ ] Download link tested
- [ ] Enrollment tokens generated for test devices
- [ ] Installation guide sent to technicians

### Production Rollout
- [ ] Pilot test with 5-10 devices
- [ ] Monitor server logs for errors
- [ ] Verify heartbeats received for all pilot devices
- [ ] Test lock/unlock on pilot devices
- [ ] Collect feedback from technicians
- [ ] Address any issues found
- [ ] Approve full rollout

### Post-Deployment
- [ ] Monitor server logs for enrollment errors
- [ ] Monitor heartbeat success rate
- [ ] Track device lock/unlock success rate
- [ ] Document any issues encountered
- [ ] Create support tickets for issues
- [ ] Plan update releases as needed

## Rollback Plan

If critical issues found:

1. **Stop new enrollments**: Disable enrollment token generation
2. **Assess severity**: 
   - Minor bug: Schedule update release
   - Critical bug: Prepare hotfix
3. **Communicate**: Notify technicians of issue
4. **Fix and rebuild**: Apply fix, test, rebuild APK
5. **Redeploy**: Test hotfix on pilot devices, then full rollout
6. **Update documentation**: Document issue and resolution

## Support Contacts

**Technical Issues:**
- Engineering: [contact info]
- Server/API: [contact info]

**Device Issues:**
- Field Support: (765) 555-0100
- Portal: scarlet-technical.onrender.com

## Version History

### v1.0.0 (Initial Release)
- Device Admin protection
- Remote lock/unlock
- Remote wipe
- Automatic enrollment
- 5-minute heartbeat polling
- Boot persistence

---

**Deployment Date**: _______________

**Deployed By**: _______________

**Sign-off**: _______________
