package com.scarlet.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.work.WorkManager;
import androidx.work.PeriodicWorkRequest;
import androidx.work.ExistingPeriodicWorkPolicy;
import java.util.concurrent.TimeUnit;

public class BootReceiver extends BroadcastReceiver {
    private static final String PREFS_NAME = "ScarletAgentPrefs";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            // Only act if enrolled
            if (!prefs.contains("device_token")) return;

            // Re-schedule WorkManager polling (it persists across reboots but re-scheduling is safe)
            PeriodicWorkRequest pollRequest = new PeriodicWorkRequest.Builder(
                    AgentPollService.class,
                    15, TimeUnit.MINUTES
                )
                .build();

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "scarlet_agent_poll",
                ExistingPeriodicWorkPolicy.KEEP,  // KEEP existing if already running
                pollRequest
            );

            // If device was locked before reboot, show lock screen immediately
            if (prefs.getBoolean("device_locked", false)) {
                Intent lockIntent = new Intent(context, LockActivity.class);
                lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                context.startActivity(lockIntent);
            }
        }
    }
}
