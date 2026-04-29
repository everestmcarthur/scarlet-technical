package com.scarlet.agent;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

public class LockActivity extends Activity {
    private static final String PREFS_NAME = "ScarletAgentPrefs";
    private SharedPreferences prefs;
    private BroadcastReceiver unlockReceiver;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Make fullscreen and show over lock screen
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );
        
        // Hide navigation and status bars
        View decorView = getWindow().getDecorView();
        int uiOptions = View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                      | View.SYSTEM_UI_FLAG_FULLSCREEN
                      | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        decorView.setSystemUiVisibility(uiOptions);
        
        setContentView(R.layout.activity_lock);
        
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        
        // Check if device is actually locked
        if (!prefs.getBoolean("device_locked", false)) {
            finish();
            return;
        }
        
        // Set lock message
        TextView lockMessageView = findViewById(R.id.lock_message);
        String lockMessage = prefs.getString("lock_message", "This device has been locked by Scarlet Technical");
        lockMessageView.setText(lockMessage);
        
        // Register receiver for unlock events
        unlockReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!prefs.getBoolean("device_locked", false)) {
                    finish();
                }
            }
        };
        
        IntentFilter filter = new IntentFilter("com.scarlet.agent.CHECK_UNLOCK");
        registerReceiver(unlockReceiver, filter);
        
        // Start polling service to check for unlock
        startUnlockChecker();
    }
    
    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (unlockReceiver != null) {
            unregisterReceiver(unlockReceiver);
        }
    }
    
    @Override
    public void onBackPressed() {
        // Block back button
    }
    
    @Override
    protected void onResume() {
        super.onResume();
        
        // Re-apply fullscreen flags
        View decorView = getWindow().getDecorView();
        int uiOptions = View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                      | View.SYSTEM_UI_FLAG_FULLSCREEN
                      | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        decorView.setSystemUiVisibility(uiOptions);
        
        // Check if device is still locked
        if (!prefs.getBoolean("device_locked", false)) {
            finish();
        }
    }
    
    private void startUnlockChecker() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                while (prefs.getBoolean("device_locked", false)) {
                    try {
                        Thread.sleep(10000); // Check every 10 seconds
                        
                        // Send broadcast to check unlock status
                        sendBroadcast(new Intent("com.scarlet.agent.CHECK_UNLOCK"));
                        
                        // If unlocked, finish activity
                        if (!prefs.getBoolean("device_locked", false)) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    finish();
                                }
                            });
                            break;
                        }
                    } catch (InterruptedException e) {
                        break;
                    }
                }
            }
        }).start();
    }
}
