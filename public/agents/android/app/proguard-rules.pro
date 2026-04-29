# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in ${sdk.dir}/tools/proguard/proguard-android.txt

# Keep Scarlet Agent classes
-keep class com.scarlet.agent.** { *; }

# Keep Device Admin Receiver
-keep public class * extends android.app.admin.DeviceAdminReceiver

# Keep WorkManager
-keep class * extends androidx.work.Worker
-keep class * extends androidx.work.WorkerParameters

# Keep JSON parsing
-keepattributes Signature
-keepattributes *Annotation*

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep enum classes
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
