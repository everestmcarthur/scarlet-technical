package com.scarlet.agent;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;
import androidx.work.WorkManager;
import androidx.work.PeriodicWorkRequest;
import androidx.work.ExistingPeriodicWorkPolicy;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
    private static final int REQUEST_CODE_ENABLE_ADMIN = 1;
    public static final String PREFS_NAME = "ScarletAgentPrefs";
    public static final String DEFAULT_SERVER_URL = "https://scarlet-technical.onrender.com";

    private DevicePolicyManager devicePolicyManager;
    private ComponentName adminComponent;
    private SharedPreferences prefs;

    private EditText serverUrlInput;
    private EditText enrollmentTokenInput;
    private Button enrollButton;
    private TextView statusText;
    private View enrollmentCard;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        devicePolicyManager = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        adminComponent = new ComponentName(this, ScarletDeviceAdminReceiver.class);
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        serverUrlInput = findViewById(R.id.server_url_input);
        enrollmentTokenInput = findViewById(R.id.enrollment_token_input);
        enrollButton = findViewById(R.id.enroll_button);
        statusText = findViewById(R.id.status_text);
        enrollmentCard = findViewById(R.id.enrollment_card);

        // Pre-fill server URL with production server
        serverUrlInput.setText(DEFAULT_SERVER_URL);

        // Check if already enrolled
        if (isEnrolled()) {
            showEnrolledStatus();
        } else {
            showEnrollmentForm();
        }

        enrollButton.setOnClickListener(v -> startEnrollment());

        // If device was locked, show lock screen
        if (prefs.getBoolean("device_locked", false)) {
            Intent lockIntent = new Intent(MainActivity.this, LockActivity.class);
            lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(lockIntent);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Check lock state on resume (in case agent ran while app was backgrounded)
        if (prefs.getBoolean("device_locked", false) && isEnrolled()) {
            Intent lockIntent = new Intent(MainActivity.this, LockActivity.class);
            lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(lockIntent);
        }
    }

    private boolean isEnrolled() {
        return prefs.contains("device_token") && prefs.contains("server_url");
    }

    private void showEnrolledStatus() {
        if (enrollmentCard != null) enrollmentCard.setVisibility(View.GONE);
        enrollButton.setEnabled(false);

        String serverUrl = prefs.getString("server_url", DEFAULT_SERVER_URL);
        String deviceUuid = prefs.getString("device_uuid", "N/A");
        String lockStatus = prefs.getBoolean("device_locked", false) ? "LOCKED" : "Unlocked";

        statusText.setText(
            "✓ Device enrolled successfully\n\n" +
            "Agent is active and running in the background.\n\n" +
            "Server: " + serverUrl + "\n" +
            "Device UUID: " + deviceUuid + "\n" +
            "Lock Status: " + lockStatus + "\n\n" +
            "The agent checks in every 5 minutes.\n" +
            "Do not uninstall this app without authorization."
        );
    }

    private void showEnrollmentForm() {
        if (enrollmentCard != null) enrollmentCard.setVisibility(View.VISIBLE);
        enrollButton.setEnabled(true);
        statusText.setText("Enter your enrollment token to register this device.");
    }

    private void startEnrollment() {
        // Check Device Admin first
        if (!devicePolicyManager.isAdminActive(adminComponent)) {
            requestDeviceAdmin();
            return;
        }
        performEnrollment();
    }

    private void performEnrollment() {
        String serverUrl = serverUrlInput.getText().toString().trim();
        String enrollmentToken = enrollmentTokenInput.getText().toString().trim();

        if (serverUrl.isEmpty()) serverUrl = DEFAULT_SERVER_URL;
        if (serverUrl.endsWith("/")) serverUrl = serverUrl.substring(0, serverUrl.length() - 1);

        if (enrollmentToken.isEmpty()) {
            Toast.makeText(this, "Please enter an enrollment token", Toast.LENGTH_SHORT).show();
            return;
        }

        enrollButton.setEnabled(false);
        statusText.setText("Enrolling device, please wait…");

        final String finalServerUrl = serverUrl;
        final String finalEnrollmentToken = enrollmentToken;

        new Thread(() -> {
            boolean success = ApiClient.enrollDevice(
                MainActivity.this,
                finalServerUrl,
                finalEnrollmentToken
            );

            runOnUiThread(() -> {
                if (success) {
                    Toast.makeText(MainActivity.this, "Enrollment successful!", Toast.LENGTH_LONG).show();
                    schedulePolling();
                    showEnrolledStatus();
                } else {
                    enrollButton.setEnabled(true);
                    statusText.setText("Enrollment failed.\n\nPlease check:\n• The token is correct and unused\n• You have internet access\n\nContact your technician if the problem persists.");
                    Toast.makeText(MainActivity.this, "Enrollment failed. Check your token and internet connection.", Toast.LENGTH_LONG).show();
                }
            });
        }).start();
    }

    private void requestDeviceAdmin() {
        Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
        intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent);
        intent.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION,
            "Scarlet Technical requires Device Administrator access to manage this device " +
            "as part of your repair agreement. This allows locking the device if payments lapse.");
        startActivityForResult(intent, REQUEST_CODE_ENABLE_ADMIN);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_ENABLE_ADMIN) {
            if (resultCode == RESULT_OK) {
                Toast.makeText(this, "Device Admin enabled. Completing enrollment…", Toast.LENGTH_SHORT).show();
                performEnrollment();
            } else {
                Toast.makeText(this, "Device Admin is required to complete enrollment.", Toast.LENGTH_LONG).show();
                statusText.setText("Device Admin permission is required.\nPlease accept the permission and try again.");
            }
        }
    }

    private void schedulePolling() {
        PeriodicWorkRequest pollRequest = new PeriodicWorkRequest.Builder(
                AgentPollService.class,
                15, TimeUnit.MINUTES  // minimum on Android (system enforces 15-min floor)
            )
            .build();

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "scarlet_agent_poll",
            ExistingPeriodicWorkPolicy.REPLACE,
            pollRequest
        );
    }
}
