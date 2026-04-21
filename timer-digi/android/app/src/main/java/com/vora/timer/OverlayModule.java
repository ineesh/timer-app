package com.vora.timer;

import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
        
        // Deep link directly to our specific service (supported on Android 11+ and most OEM skins)
        String componentName = reactContext.getPackageName() + "/" + YouTubeDetector.class.getName();
        intent.putExtra(":settings:fragment_args_key", componentName);
        intent.putExtra(":settings:show_fragment_args", new android.os.Bundle());
        
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        reactContext.startActivity(intent);
    }

    // ✅ NEW: Check Overlay Permission
    @ReactMethod
    public void canDrawOverlays(Promise promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            promise.resolve(Settings.canDrawOverlays(reactContext));
        } else {
            promise.resolve(true);
        }
    }

    // ✅ NEW: Request Overlay Permission
    @ReactMethod
    public void openOverlaySettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + reactContext.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
        }
    }

    // ✅ NEW: Toggle Floating Timer
    @ReactMethod
    public void showFloatingTimer(double totalSeconds) {
        Intent intent = new Intent(reactContext, FloatingTimerService.class);
        intent.putExtra("initialSeconds", (int) totalSeconds);
        reactContext.startService(intent);
    }

    @ReactMethod
    public void hideFloatingTimer() {
        Intent intent = new Intent(reactContext, FloatingTimerService.class);
        reactContext.stopService(intent);
    }

    private android.view.View activeInterventionView = null;
    private android.view.WindowManager interventionWindowManager = null;
    private BroadcastReceiver ytCloseReceiver = null;

    // ✅ Auto-dismiss overlay when YouTube closes
    private void registerYtCloseReceiver() {
        if (ytCloseReceiver != null) return; // Already registered
        ytCloseReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                boolean active = intent.getBooleanExtra("active", true);
                if (!active) {
                    dismissIntervention();
                }
            }
        };
        IntentFilter filter = new IntentFilter("YT_STATUS");
        reactContext.registerReceiver(ytCloseReceiver, filter);
    }

    private void dismissIntervention() {
        reactContext.runOnUiQueueThread(() -> {
            if (activeInterventionView != null && interventionWindowManager != null) {
                try {
                    interventionWindowManager.removeView(activeInterventionView);
                } catch (Exception e) {}
                activeInterventionView = null;
            }
            if (ytCloseReceiver != null) {
                try { reactContext.unregisterReceiver(ytCloseReceiver); } catch (Exception e) {}
                ytCloseReceiver = null;
            }
        });
    }

    @ReactMethod
    public void showIntervention(String title, String message, String primaryBtn, String secondaryBtn, int delaySecondary, boolean isBlocking, Promise promise) {
        reactContext.runOnUiQueueThread(() -> {
            interventionWindowManager = (android.view.WindowManager) reactContext.getSystemService(ReactApplicationContext.WINDOW_SERVICE);

            // Dismiss any existing overlay first
            if (activeInterventionView != null) {
                try { interventionWindowManager.removeView(activeInterventionView); } catch (Exception e) {}
                activeInterventionView = null;
            }

            // Register listener to auto-dismiss if YouTube closes (home key / swipe up)
            registerYtCloseReceiver();

            // Create Full Screen Container
            android.widget.LinearLayout container = new android.widget.LinearLayout(reactContext);
            container.setOrientation(android.widget.LinearLayout.VERTICAL);
            container.setGravity(android.view.Gravity.CENTER);
            if (isBlocking) {
                container.setBackgroundColor(android.graphics.Color.parseColor("#E6000000")); // 90% black
            } else {
                container.setBackgroundColor(android.graphics.Color.parseColor("#80000000")); // 50% black
            }
            int cp = dpToPx(20);
            container.setPadding(cp, cp, cp, cp);

            // Inner Card
            android.widget.LinearLayout card = new android.widget.LinearLayout(reactContext);
            card.setOrientation(android.widget.LinearLayout.VERTICAL);
            card.setGravity(android.view.Gravity.CENTER);
            android.graphics.drawable.GradientDrawable shape = new android.graphics.drawable.GradientDrawable();
            shape.setColor(android.graphics.Color.parseColor("#111111"));
            shape.setCornerRadius(dpToPx(24));
            shape.setStroke(dpToPx(1), android.graphics.Color.parseColor("#333333"));
            card.setBackground(shape);
            int padding = dpToPx(30);
            card.setPadding(padding, padding + 10, padding, padding);

            // Title
            android.widget.TextView titleView = new android.widget.TextView(reactContext);
            titleView.setText(title);
            titleView.setTextColor(android.graphics.Color.WHITE);
            titleView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 22);
            titleView.setGravity(android.view.Gravity.CENTER);
            titleView.setPadding(0, 0, 0, dpToPx(12));
            card.addView(titleView);

            // Message
            android.widget.TextView msgView = new android.widget.TextView(reactContext);
            msgView.setText(message);
            msgView.setTextColor(android.graphics.Color.parseColor("#AAAAAA"));
            msgView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 16);
            msgView.setGravity(android.view.Gravity.CENTER);
            msgView.setPadding(0, 0, 0, dpToPx(24));
            card.addView(msgView);

            // Button Row
            android.widget.LinearLayout btnRow = new android.widget.LinearLayout(reactContext);
            btnRow.setOrientation(android.widget.LinearLayout.VERTICAL);
            btnRow.setLayoutParams(new android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));

            // Primary Button (Close YouTube / Take Break)
            android.widget.Button pBtn = new android.widget.Button(reactContext);
            pBtn.setText(primaryBtn); // Capitalized automatically by Android usually, but fine
            pBtn.setBackgroundColor(android.graphics.Color.parseColor("#FF0000"));
            pBtn.setTextColor(android.graphics.Color.WHITE);
            pBtn.setOnClickListener(v -> {
                // ✅ FIX 2: Kill YouTube process directly instead of home intent
                // This prevents PiP mode from triggering on Shorts
                try {
                    ActivityManager am = (ActivityManager) reactContext.getSystemService(Context.ACTIVITY_SERVICE);
                    am.killBackgroundProcesses("com.google.android.youtube");
                } catch (Exception e) {
                    // Fallback: send home intent if kill fails
                    Intent homeIntent = new Intent(Intent.ACTION_MAIN);
                    homeIntent.addCategory(Intent.CATEGORY_HOME);
                    homeIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    reactContext.startActivity(homeIntent);
                }
                dismissIntervention();
                promise.resolve("primary");
            });
            btnRow.addView(pBtn);

            // Secondary Button (Continue)
            if (secondaryBtn != null && !secondaryBtn.isEmpty()) {
                android.widget.Button sBtn = new android.widget.Button(reactContext);
                sBtn.setText(secondaryBtn + (delaySecondary > 0 ? " (" + delaySecondary + "s)" : ""));
                sBtn.setBackgroundColor(android.graphics.Color.parseColor("#333333"));
                sBtn.setTextColor(android.graphics.Color.WHITE);
                sBtn.setEnabled(delaySecondary == 0);
                sBtn.setOnClickListener(v -> {
                    dismissIntervention();
                    promise.resolve("secondary");
                });
                
                android.widget.LinearLayout.LayoutParams sParams = new android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
                sParams.setMargins(0, dpToPx(10), 0, 0);
                btnRow.addView(sBtn, sParams);

                if (delaySecondary > 0) {
                    android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
                    Runnable tick = new Runnable() {
                        int remaining = delaySecondary;
                        @Override
                        public void run() {
                            remaining--;
                            if (remaining > 0) {
                                sBtn.setText(secondaryBtn + " (" + remaining + "s)");
                                handler.postDelayed(this, 1000);
                            } else {
                                sBtn.setText(secondaryBtn);
                                sBtn.setEnabled(true);
                                sBtn.setBackgroundColor(android.graphics.Color.parseColor("#555555"));
                            }
                        }
                    };
                    handler.postDelayed(tick, 1000);
                }
            }

            card.addView(btnRow);
            container.addView(card);

            int layoutType;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                layoutType = android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
            } else {
                layoutType = android.view.WindowManager.LayoutParams.TYPE_PHONE;
            }

            android.view.WindowManager.LayoutParams wParams = new android.view.WindowManager.LayoutParams(
                    android.view.WindowManager.LayoutParams.MATCH_PARENT,
                    android.view.WindowManager.LayoutParams.MATCH_PARENT,
                    layoutType,
                    android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    android.graphics.PixelFormat.TRANSLUCENT
            );

            interventionWindowManager.addView(container, wParams);
            activeInterventionView = container;
        });
    }

    private int dpToPx(int dp) {
        return (int) android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_DIP, dp, reactContext.getResources().getDisplayMetrics());
    }
}