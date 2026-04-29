package com.scarlet.agent;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Background worker that runs every 5 minutes:
 * 1. Sends heartbeat to server
 * 2. Syncs lock_status — launches or dismisses lock screen
 * 3. Processes pending commands (lock / unlock / wipe)
 * 4. Caches payment URL and support info for offline lock screen
 */
public class AgentPollService extends Worker {
    private static final String PREFS_NAME = "ScarletAgentPrefs";

    public AgentPollService(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        // Not enrolled yet — nothing to do
        if (!prefs.contains("device_token")) {
            return Result.success();
        }

        // Send heartbeat
        ApiClient.HeartbeatResponse response = ApiClient.sendHeartbeat(context);

        if (response == null) {
            // Server unreachable — re-enforce lock if we were locked
            if (prefs.getBoolean("device_locked", false)) {
                ensureLockScreenRunning(context);
            }
            return Result.retry();
        }

        // ── Sync lock status ────────────────────────────────────────────────
        boolean wasLocked = prefs.getBoolean("device_locked", false);
        boolean shouldBeLocked = "locked".equals(response.lockStatus);

        if (shouldBeLocked && !wasLocked) {
            // Lock the device
            String msg = response.lockMessage != null ? response.lockMessage
                : "This device has been locked by Scarlet Technical. Resolve your balance to regain access.";
            prefs.edit()
                .putBoolean("device_locked", true)
                .putString("lock_message", msg)
                .apply();
            launchLockScreen(context);

        } else if (!shouldBeLocked && wasLocked) {
            // Unlock the device
            prefs.edit()
                .putBoolean("device_locked", false)
                .remove("lock_message")
                .apply();
            // LockActivity will notice on its 10-second check and finish()

        } else if (shouldBeLocked && wasLocked) {
            // Still locked — re-enforce overlay if it was somehow killed
            ensureLockScreenRunning(context);
        }

        // ── Process command (if any) ────────────────────────────────────────
        if (response.command != null) {
            processCommand(context, prefs, response.command);
        }

        return Result.success();
    }

    private void processCommand(Context context, SharedPreferences prefs, ApiClient.Command command) {
        String action = command.action;
        String commandId = command.id;
        String result = "success";
        String newLockStatus = prefs.getBoolean("device_locked", false) ? "locked" : "unlocked";

        try {
            if ("lock".equals(action)) {
                String msg = command.message != null ? command.message
                    : "This device has been locked by Scarlet Technical.";
                prefs.edit()
                    .putBoolean("device_locked", true)
                    .putString("lock_message", msg)
                    .apply();
                launchLockScreen(context);
                newLockStatus = "locked";

            } else if ("unlock".equals(action)) {
                prefs.edit()
                    .putBoolean("device_locked", false)
                    .remove("lock_message")
                    .apply();
                newLockStatus = "unlocked";

            } else if ("wipe".equals(action)) {
                android.app.admin.DevicePolicyManager dpm =
                    (android.app.admin.DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
                android.content.ComponentName adminComponent =
                    new android.content.ComponentName(context, ScarletDeviceAdminReceiver.class);

                if (dpm != null && dpm.isAdminActive(adminComponent)) {
                    newLockStatus = "wiped";
                    // Ack before wipe — after factory reset we won't be able to
                    ApiClient.sendCommandAck(context, commandId, "success", "wiped");
                    dpm.wipeData(0);
                    return; // device is gone
                } else {
                    result = "error: device admin not active — cannot wipe";
                    newLockStatus = "locked";
                }
            } else {
                result = "error: unknown command '" + action + "'";
            }
        } catch (Exception e) {
            result = "error: " + e.getMessage();
        }

        // Acknowledge
        ApiClient.sendCommandAck(context, commandId, result, newLockStatus);
    }

    private void launchLockScreen(Context context) {
        Intent lockIntent = new Intent(context, LockActivity.class);
        lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(lockIntent);
    }

    private void ensureLockScreenRunning(Context context) {
        // Re-launch lock screen — it's idempotent (checks device_locked in onCreate)
        launchLockScreen(context);
    }
}
