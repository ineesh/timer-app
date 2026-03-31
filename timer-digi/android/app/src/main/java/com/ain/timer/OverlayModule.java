package com.ain.timer;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class OverlayModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;

    public OverlayModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "OverlayModule";
    }

    // Only Accessibility methods remain in this module now.

    // ✅ Check accessibility permission
    @ReactMethod
    public void isAccessibilityServiceEnabled(Promise promise) {
        try {
            int accessibilityEnabled = 0;
            try {
                accessibilityEnabled = Settings.Secure.getInt(
                        reactContext.getContentResolver(),
                        android.provider.Settings.Secure.ACCESSIBILITY_ENABLED);
            } catch (Settings.SettingNotFoundException e) {
            }
            if (accessibilityEnabled == 1) {
                String settingValue = Settings.Secure.getString(
                        reactContext.getContentResolver(),
                        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
                if (settingValue != null) {
                    boolean enabled = settingValue.contains(reactContext.getPackageName() + "/" + YouTubeDetector.class.getName());
                    promise.resolve(enabled);
                    return;
                }
            }
            promise.resolve(false);
        } catch (Exception e) {
            promise.reject("ERROR", e);
        }
    }

    // ✅ Open accessibility settings
    @ReactMethod
    public void openAccessibilitySettings() {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        reactContext.startActivity(intent);
    }
}