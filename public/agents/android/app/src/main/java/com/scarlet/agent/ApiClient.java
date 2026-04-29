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
    
    public static class HeartbeatResponse {
        public String lockStatus;
        public String lockMessage;
        public Command command;
    }
    
    public static class Command {
        public String id;
        public String action;
        public String message;
    }
    
    public static boolean enrollDevice(Context context, String serverUrl, String enrollmentToken) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            
            // Generate or retrieve device UUID
            String deviceUuid = prefs.getString("device_uuid", null);
            if (deviceUuid == null) {
                deviceUuid = UUID.randomUUID().toString();
            }
            
            // Get device info
            String hostname = Build.MODEL;
            String osInfo = "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";
            
            // Build request
            JSONObject requestBody = new JSONObject();
            requestBody.put("enrollment_token", enrollmentToken);
            requestBody.put("device_uuid", deviceUuid);
            requestBody.put("hostname", hostname);
            requestBody.put("os_info", osInfo);
            requestBody.put("platform", "android");
            requestBody.put("agent_version", AGENT_VERSION);
            
            // Send request
            URL url = new URL(serverUrl + "/api/agent/enroll");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            
            OutputStream os = conn.getOutputStream();
            os.write(requestBody.toString().getBytes("UTF-8"));
            os.close();
            
            int responseCode = conn.getResponseCode();
            
            if (responseCode == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    response.append(line);
                }
                br.close();
                
                JSONObject responseJson = new JSONObject(response.toString());
                String deviceToken = responseJson.getString("device_token");
                
                // Save enrollment data
                prefs.edit()
                    .putString("server_url", serverUrl)
                    .putString("device_uuid", deviceUuid)
                    .putString("device_token", deviceToken)
                    .putBoolean("device_locked", false)
                    .apply();
                
                return true;
            }
            
            conn.disconnect();
            return false;
            
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }
    
    public static HeartbeatResponse sendHeartbeat(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            
            String serverUrl = prefs.getString("server_url", null);
            String deviceUuid = prefs.getString("device_uuid", null);
            String deviceToken = prefs.getString("device_token", null);
            boolean deviceLocked = prefs.getBoolean("device_locked", false);
            
            if (serverUrl == null || deviceUuid == null || deviceToken == null) {
                return null;
            }
            
            // Build request
            JSONObject requestBody = new JSONObject();
            requestBody.put("device_token", deviceToken);
            requestBody.put("device_uuid", deviceUuid);
            requestBody.put("current_status", deviceLocked ? "locked" : "unlocked");
            
            // Send request
            URL url = new URL(serverUrl + "/api/agent/heartbeat");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            
            OutputStream os = conn.getOutputStream();
            os.write(requestBody.toString().getBytes("UTF-8"));
            os.close();
            
            int responseCode = conn.getResponseCode();
            
            if (responseCode == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    response.append(line);
                }
                br.close();
                
                JSONObject responseJson = new JSONObject(response.toString());
                
                HeartbeatResponse result = new HeartbeatResponse();
                result.lockStatus = responseJson.optString("lock_status", "unlocked");
                result.lockMessage = responseJson.optString("lock_message", null);
                
                if (responseJson.has("command") && !responseJson.isNull("command")) {
                    JSONObject commandJson = responseJson.getJSONObject("command");
                    Command cmd = new Command();
                    cmd.id = commandJson.getString("id");
                    cmd.action = commandJson.getString("action");
                    cmd.message = commandJson.optString("message", null);
                    result.command = cmd;
                }
                
                conn.disconnect();
                return result;
            }
            
            conn.disconnect();
            return null;
            
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }
    
    public static boolean sendCommandAck(Context context, String commandId, String result, String newLockStatus) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            
            String serverUrl = prefs.getString("server_url", null);
            String deviceUuid = prefs.getString("device_uuid", null);
            String deviceToken = prefs.getString("device_token", null);
            
            if (serverUrl == null || deviceUuid == null || deviceToken == null) {
                return false;
            }
            
            // Build request
            JSONObject requestBody = new JSONObject();
            requestBody.put("device_token", deviceToken);
            requestBody.put("device_uuid", deviceUuid);
            requestBody.put("command_id", commandId);
            requestBody.put("result", result);
            requestBody.put("new_lock_status", newLockStatus);
            
            // Send request
            URL url = new URL(serverUrl + "/api/agent/command-ack");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            
            OutputStream os = conn.getOutputStream();
            os.write(requestBody.toString().getBytes("UTF-8"));
            os.close();
            
            int responseCode = conn.getResponseCode();
            conn.disconnect();
            
            return responseCode == 200;
            
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }
}
