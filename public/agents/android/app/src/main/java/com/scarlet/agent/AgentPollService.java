package com.scarlet.agent;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

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
        
        // Check if enrolled
        if (!prefs.contains("device_token")) {
            return Result.success();
        }
        
        // Send heartbeat and check for commands
        ApiClient.HeartbeatResponse response = ApiClient.sendHeartbeat(context);
        
        if (response == null) {
            return Result.retry();
        }
        
        // Process lock status
        String lockStatus = response.lockStatus;
        boolean wasLocked = prefs.getBoolean("device_locked", false);
        boolean shouldBeLocked = "locked".equals(lockStatus);
        
        if (shouldBeLocked && !wasLocked) {
            // Device should be locked
            prefs.edit()
                .putBoolean("device_locked", true)
                .putString("lock_message", response.lockMessage != null ? response.lockMessage : "This device has been locked by Scarlet Technical")
                .apply();
            
            // Launch lock activity
            Intent lockIntent = new Intent(context, LockActivity.class);
            lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(lockIntent);
            
        } else if (!shouldBeLocked && wasLocked) {
            // Device should be unlocked
            prefs.edit()
                .putBoolean("device_locked", false)
                .remove("lock_message")
                .apply();
        }
        
        // Process command if present
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
                prefs.edit()
                    .putBoolean("device_locked", true)
                    .putString("lock_message", command.message != null ? command.message : "This device has been locked by Scarlet Technical")
                    .apply();
                
                Intent lockIntent = new Intent(context, LockActivity.class);
                lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                context.startActivity(lockIntent);
                
                newLockStatus = "locked";
                
            } else if ("unlock".equals(action)) {
                prefs.edit()
                    .putBoolean("device_locked", false)
                    .remove("lock_message")
                    .apply();
                
                newLockStatus = "unlocked";
                
            } else if ("wipe".equals(action)) {
                // Wipe device (factory reset)
                android.app.admin.DevicePolicyManager dpm = 
                    (android.app.admin.DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
                android.content.ComponentName adminComponent = 
                    new android.content.ComponentName(context, ScarletDeviceAdminReceiver.class);
                
                if (dpm != null && dpm.isAdminActive(adminComponent)) {
                    dpm.wipeData(0);
                    result = "wiped";
                } else {
                    result = "error: device admin not active";
                }
            } else {
                result = "error: unknown action";
            }
            
        } catch (Exception e) {
            result = "error: " + e.getMessage();
        }
        
        // Send acknowledgment
        ApiClient.sendCommandAck(context, commandId, result, newLockStatus);
    }
}
