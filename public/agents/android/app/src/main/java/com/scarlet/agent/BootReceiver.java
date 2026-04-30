package com.scarlet.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.work.WorkManager;
import androidx.work.PeriodicWorkRequest;
import androidx.work.ExistingPeriodicWorkPolicy;
import java.util.concurrent.TimeUnit;

/**
 * Starts the agent polling service after device boot.
 * Also re-launches lock screen if device was locked before reboot.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "ScarletBootReceiver";
    private static final String PREFS_NAME = "ScarletAgentPrefs";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {

            Log.i(TAG, "Boot completed — starting Scarlet Agent");

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            // Only start if enrolled
            if (!prefs.contains("device_token")) {
                Log.i(TAG, "Device not enrolled — skipping");
                return;
            }

            // Schedule periodic polling
            PeriodicWorkRequest pollRequest = new PeriodicWorkRequest.Builder(
                    AgentPollService.class,
                    15, TimeUnit.MINUTES
                )
                .build();
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "scarlet_agent_poll",
                ExistingPeriodicWorkPolicy.REPLACE,
                pollRequest
            );
            Log.i(TAG, "Agent polling scheduled");

            // If device was locked before reboot, re-launch lock screen
            if (prefs.getBoolean("device_locked", false)) {
                Log.i(TAG, "Device was locked — re-launching lock screen");
                Intent lockIntent = new Intent(context, LockActivity.class);
                lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                context.startActivity(lockIntent);
            }
        }
    }
}
