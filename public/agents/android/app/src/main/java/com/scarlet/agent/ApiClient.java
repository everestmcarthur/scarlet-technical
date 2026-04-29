package com.scarlet.agent;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;

public class ApiClient {
    private static final String PREFS_NAME = "ScarletAgentPrefs";
    private static final String AGENT_VERSION = "1.0.0";

    // ─── Response classes ────────────────────────────────────────────────────

    public static class HeartbeatResponse {
        public String lockStatus;
        public String lockMessage;
        public String paymentUrl;
        public String supportPhone;
        public String supportUrl;
        public Command command;
    }

    public static class Command {
        public String id;
        public String action;
        public String message;
    }

    public static class PinResult {
        public boolean success;
        public String message;
        public int attemptsRemaining;
    }

    public static class UnlockRequestResult {
        public boolean success;
        public String message;
        public int requestId;
    }

    // ─── Helper: POST JSON, return JSONObject ────────────────────────────────

    private static JSONObject postJson(String urlStr, JSONObject body) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setDoOutput(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);

        OutputStream os = conn.getOutputStream();
        os.write(body.toString().getBytes("UTF-8"));
        os.close();

        int code = conn.getResponseCode();
        BufferedReader br;
        if (code >= 200 && code < 400) {
            br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
        } else {
            br = new BufferedReader(new InputStreamReader(conn.getErrorStream(), "UTF-8"));
        }
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();
        conn.disconnect();

        JSONObject resp = new JSONObject(sb.toString());
        resp.put("_http_code", code);
        return resp;
    }

    // ─── Get auth fields from prefs ──────────────────────────────────────────

    private static String serverUrl(SharedPreferences p) { return p.getString("server_url", null); }
    private static String deviceUuid(SharedPreferences p) { return p.getString("device_uuid", null); }
    private static String deviceToken(SharedPreferences p) { return p.getString("device_token", null); }

    // ─── Enroll ──────────────────────────────────────────────────────────────

    public static boolean enrollDevice(Context context, String serverUrl, String enrollmentToken) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            String deviceUuid = prefs.getString("device_uuid", null);
            if (deviceUuid == null) {
                deviceUuid = UUID.randomUUID().toString();
            }

            String hostname = Build.MANUFACTURER + " " + Build.MODEL;
            String osInfo = "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";

            JSONObject body = new JSONObject();
            body.put("enrollment_token", enrollmentToken);
            body.put("device_uuid", deviceUuid);
            body.put("hostname", hostname);
            body.put("os_info", osInfo);
            body.put("platform", "android");
            body.put("agent_version", AGENT_VERSION);

            JSONObject resp = postJson(serverUrl + "/api/agent/enroll", body);

            if (resp.getInt("_http_code") == 200 && resp.has("device_token")) {
                prefs.edit()
                    .putString("server_url", serverUrl)
                    .putString("device_uuid", deviceUuid)
                    .putString("device_token", resp.getString("device_token"))
                    .putBoolean("device_locked", false)
                    .apply();
                return true;
            }
            return false;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    // ─── Heartbeat ───────────────────────────────────────────────────────────

    public static HeartbeatResponse sendHeartbeat(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String sUrl = serverUrl(prefs), uuid = deviceUuid(prefs), token = deviceToken(prefs);
            if (sUrl == null || uuid == null || token == null) return null;

            boolean locked = prefs.getBoolean("device_locked", false);

            JSONObject body = new JSONObject();
            body.put("device_token", token);
            body.put("device_uuid", uuid);
            body.put("current_status", locked ? "locked" : "unlocked");
            body.put("hostname", Build.MANUFACTURER + " " + Build.MODEL);
            body.put("os_info", "Android " + Build.VERSION.RELEASE);
            body.put("agent_version", AGENT_VERSION);

            JSONObject resp = postJson(sUrl + "/api/agent/heartbeat", body);
            if (resp.getInt("_http_code") != 200) return null;

            HeartbeatResponse result = new HeartbeatResponse();
            result.lockStatus = resp.optString("lock_status", "unlocked");
            result.lockMessage = resp.optString("lock_message", null);
            result.paymentUrl = resp.optString("payment_url", null);
            result.supportPhone = resp.optString("support_phone", "(765) 555-0100");
            result.supportUrl = resp.optString("support_url", null);

            if (resp.has("command") && !resp.isNull("command")) {
                JSONObject cmdJson = resp.getJSONObject("command");
                Command cmd = new Command();
                cmd.id = cmdJson.getString("id");
                cmd.action = cmdJson.getString("action");
                cmd.message = cmdJson.optString("message", null);
                result.command = cmd;
            }

            // Save payment URL and support info for lock screen
            SharedPreferences.Editor edit = prefs.edit();
            if (result.paymentUrl != null) edit.putString("payment_url", result.paymentUrl);
            if (result.supportPhone != null) edit.putString("support_phone", result.supportPhone);
            if (result.supportUrl != null) edit.putString("support_url", result.supportUrl);
            edit.apply();

            return result;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    // ─── Command Acknowledgement ─────────────────────────────────────────────

    public static boolean sendCommandAck(Context context, String commandId, String result, String newLockStatus) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String sUrl = serverUrl(prefs), uuid = deviceUuid(prefs), token = deviceToken(prefs);
            if (sUrl == null || uuid == null || token == null) return false;

            JSONObject body = new JSONObject();
            body.put("device_token", token);
            body.put("device_uuid", uuid);
            body.put("command_id", commandId);
            body.put("result", result);
            body.put("new_lock_status", newLockStatus);

            JSONObject resp = postJson(sUrl + "/api/agent/command-ack", body);
            return resp.getInt("_http_code") == 200;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    // ─── Verify Override PIN ─────────────────────────────────────────────────

    public static PinResult verifyPin(Context context, String pin) {
        PinResult result = new PinResult();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String sUrl = serverUrl(prefs), uuid = deviceUuid(prefs), token = deviceToken(prefs);
            if (sUrl == null || uuid == null || token == null) {
                result.success = false;
                result.message = "Device not enrolled";
                return result;
            }

            JSONObject body = new JSONObject();
            body.put("device_token", token);
            body.put("device_uuid", uuid);
            body.put("pin", pin);

            JSONObject resp = postJson(sUrl + "/api/agent/verify-pin", body);
            int code = resp.getInt("_http_code");

            if (code == 200) {
                result.success = true;
                result.message = resp.optString("message", "Device unlocked!");
            } else {
                result.success = false;
                result.message = resp.optString("error", "Invalid PIN");
                result.attemptsRemaining = resp.optInt("attempts_remaining", -1);
            }
        } catch (Exception e) {
            result.success = false;
            result.message = "Network error. Check your connection.";
        }
        return result;
    }

    // ─── Request Unlock ──────────────────────────────────────────────────────

    public static UnlockRequestResult requestUnlock(Context context, String reason, String contactInfo) {
        UnlockRequestResult result = new UnlockRequestResult();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String sUrl = serverUrl(prefs), uuid = deviceUuid(prefs), token = deviceToken(prefs);
            if (sUrl == null || uuid == null || token == null) {
                result.success = false;
                result.message = "Device not enrolled";
                return result;
            }

            JSONObject body = new JSONObject();
            body.put("device_token", token);
            body.put("device_uuid", uuid);
            body.put("reason", reason != null ? reason : "Unlock requested from device");
            if (contactInfo != null) body.put("contact_info", contactInfo);

            JSONObject resp = postJson(sUrl + "/api/agent/unlock-request", body);
            int code = resp.getInt("_http_code");

            if (code == 200) {
                result.success = true;
                result.message = resp.optString("message", "Request submitted.");
                result.requestId = resp.optInt("request_id", 0);
            } else {
                result.success = false;
                result.message = resp.optString("error", "Could not submit request.");
            }
        } catch (Exception e) {
            result.success = false;
            result.message = "Network error. Check your connection.";
        }
        return result;
    }
}
