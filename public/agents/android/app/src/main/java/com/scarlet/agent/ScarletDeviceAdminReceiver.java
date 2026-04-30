package com.scarlet.agent;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * Device Admin Receiver — handles admin enable/disable and password attempts.
 * Required for remote lock, wipe, and kiosk-mode enforcement.
 */
public class ScarletDeviceAdminReceiver extends DeviceAdminReceiver {
    private static final String TAG = "ScarletAdmin";
    private static final String PREFS_NAME = "ScarletAgentPrefs";

    @Override
    public void onEnabled(Context context, Intent intent) {
        Log.i(TAG, "Device Admin enabled");
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        Log.w(TAG, "Device Admin disabled — this should not happen on managed devices");
    }

    @Override
    public void onPasswordFailed(Context context, Intent intent, android.os.UserHandle user) {
        Log.w(TAG, "Failed password attempt detected");
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (prefs.getBoolean("device_locked", false)) {
            Intent lockIntent = new Intent(context, LockActivity.class);
            lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(lockIntent);
        }
    }
}
