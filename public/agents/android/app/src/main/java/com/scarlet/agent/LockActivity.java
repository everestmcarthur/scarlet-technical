package com.scarlet.agent;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Full-screen lock overlay. When active the user can ONLY:
 *  1. Enter a one-time override PIN (given by tech)
 *  2. Request an unlock from support
 *  3. Open the payment portal to settle their balance
 *  4. Call support
 *
 * Everything else is blocked — back button, home, recents are all suppressed
 * as much as possible at the Activity level; Device Admin + kiosk mode handles
 * the rest.
 */
public class LockActivity extends Activity {
    private static final String PREFS_NAME = "ScarletAgentPrefs";
    private SharedPreferences prefs;
    private BroadcastReceiver unlockReceiver;
    private Handler mainHandler;
    private boolean isWorking = false;  // prevent double-taps

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Full-screen, over lock screen, topmost
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        applyImmersiveMode();
        setContentView(R.layout.activity_lock);

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        mainHandler = new Handler(Looper.getMainLooper());

        // If not locked, bail out immediately
        if (!prefs.getBoolean("device_locked", false)) { finish(); return; }

        // ── Populate UI ─────────────────────────────────────────────────────
        TextView lockMessageView = findViewById(R.id.lock_message);
        String lockMessage = prefs.getString("lock_message",
            "This device has been locked by Scarlet Technical. Resolve your balance to regain access.");
        lockMessageView.setText(lockMessage);

        // Support phone
        TextView phoneView = findViewById(R.id.support_phone);
        String phone = prefs.getString("support_phone", "(765) 555-0100");
        phoneView.setText(phone);

        // ── PIN entry ───────────────────────────────────────────────────────
        final EditText pinInput = findViewById(R.id.pin_input);
        Button pinSubmit = findViewById(R.id.btn_submit_pin);
        final TextView pinStatus = findViewById(R.id.pin_status);

        pinSubmit.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (isWorking) return;
                String pin = pinInput.getText().toString().trim();
                if (pin.isEmpty()) {
                    pinStatus.setText("Enter the 6-digit PIN from your technician.");
                    pinStatus.setTextColor(0xFFFF6666);
                    return;
                }
                isWorking = true;
                pinStatus.setText("Verifying...");
                pinStatus.setTextColor(0xFFCCCCCC);

                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        final ApiClient.PinResult result = ApiClient.verifyPin(LockActivity.this, pin);
                        mainHandler.post(new Runnable() {
                            @Override
                            public void run() {
                                isWorking = false;
                                if (result.success) {
                                    pinStatus.setText("✓ Device unlocked!");
                                    pinStatus.setTextColor(0xFF66FF66);
                                    prefs.edit()
                                        .putBoolean("device_locked", false)
                                        .remove("lock_message")
                                        .apply();
                                    Toast.makeText(LockActivity.this, "Device unlocked!", Toast.LENGTH_LONG).show();
                                    finish();
                                } else {
                                    pinInput.setText("");
                                    pinStatus.setText(result.message);
                                    pinStatus.setTextColor(0xFFFF6666);
                                }
                            }
                        });
                    }
                }).start();
            }
        });

        // ── Request Unlock Button ───────────────────────────────────────────
        Button btnRequestUnlock = findViewById(R.id.btn_request_unlock);
        btnRequestUnlock.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showUnlockRequestDialog();
            }
        });

        // ── Make Payment Button ─────────────────────────────────────────────
        Button btnMakePayment = findViewById(R.id.btn_make_payment);
        btnMakePayment.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String payUrl = prefs.getString("payment_url", null);
                if (payUrl != null && !payUrl.isEmpty()) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(payUrl));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(LockActivity.this, "Could not open payment page.", Toast.LENGTH_SHORT).show();
                    }
                } else {
                    Toast.makeText(LockActivity.this, "Payment URL not available. Call support.", Toast.LENGTH_SHORT).show();
                }
            }
        });

        // ── Call Support Button ─────────────────────────────────────────────
        Button btnCallSupport = findViewById(R.id.btn_call_support);
        btnCallSupport.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    String phoneNumber = prefs.getString("support_phone", "(765) 555-0100")
                        .replaceAll("[^0-9+]", "");
                    Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phoneNumber));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(LockActivity.this, "Could not open dialer.", Toast.LENGTH_SHORT).show();
                }
            }
        });

        // ── Unlock check receiver ───────────────────────────────────────────
        unlockReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!prefs.getBoolean("device_locked", false)) finish();
            }
        };
        IntentFilter filter = new IntentFilter("com.scarlet.agent.CHECK_UNLOCK");
        registerReceiver(unlockReceiver, filter);

        startUnlockChecker();
    }

    // ── Unlock request dialog ────────────────────────────────────────────────
    private void showUnlockRequestDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert);
        builder.setTitle("Request Unlock");

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(48, 32, 48, 16);

        final EditText reasonInput = new EditText(this);
        reasonInput.setHint("Reason for unlock request");
        reasonInput.setTextColor(0xFFFFFFFF);
        reasonInput.setHintTextColor(0xFF999999);
        layout.addView(reasonInput);

        final EditText contactInput = new EditText(this);
        contactInput.setHint("Your phone or email");
        contactInput.setTextColor(0xFFFFFFFF);
        contactInput.setHintTextColor(0xFF999999);
        layout.addView(contactInput);

        builder.setView(layout);
        builder.setPositiveButton("Submit Request", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                if (isWorking) return;
                isWorking = true;
                final String reason = reasonInput.getText().toString().trim();
                final String contact = contactInput.getText().toString().trim();

                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        final ApiClient.UnlockRequestResult result = ApiClient.requestUnlock(
                            LockActivity.this,
                            reason.isEmpty() ? "Unlock requested from device" : reason,
                            contact.isEmpty() ? null : contact
                        );
                        mainHandler.post(new Runnable() {
                            @Override
                            public void run() {
                                isWorking = false;
                                Toast.makeText(LockActivity.this, result.message, Toast.LENGTH_LONG).show();
                            }
                        });
                    }
                }).start();
            }
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    // ── Block all escape routes ──────────────────────────────────────────────
    @Override public void onBackPressed() { /* blocked */ }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
        if (!prefs.getBoolean("device_locked", false)) finish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // If still locked, re-launch immediately (prevent home button escape)
        if (prefs.getBoolean("device_locked", false)) {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (prefs.getBoolean("device_locked", false)) {
                        Intent relaunch = new Intent(LockActivity.this, LockActivity.class);
                        relaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                        startActivity(relaunch);
                    }
                }
            }, 500);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (unlockReceiver != null) {
            try { unregisterReceiver(unlockReceiver); } catch (Exception ignored) {}
        }
        // If still locked, restart
        if (prefs.getBoolean("device_locked", false)) {
            Intent relaunch = new Intent(this, LockActivity.class);
            relaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(relaunch);
        }
    }

    private void applyImmersiveMode() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );
    }

    private void startUnlockChecker() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                while (prefs.getBoolean("device_locked", false)) {
                    try {
                        Thread.sleep(10000);
                        if (!prefs.getBoolean("device_locked", false)) {
                            mainHandler.post(new Runnable() {
                                @Override public void run() { finish(); }
                            });
                            break;
                        }
                    } catch (InterruptedException e) { break; }
                }
            }
        }).start();
    }
}
