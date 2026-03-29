package com.ain.timer;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.accessibilityservice.AccessibilityServiceInfo;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import android.content.Intent;

public class YouTubeDetector extends AccessibilityService {

    private static final String TAG = "YT_DETECTOR";
    private static final String YT_PACKAGE = "com.google.android.youtube";

    // 🔥 Ignore noisy system packages
    private static final Set<String> IGNORED_PACKAGES = new HashSet<>(Arrays.asList(
            "com.android.systemui",
            "com.sec.android.app.launcher",
            "com.samsung.android.honeyboard",
            "com.samsung.android.app.aodservice",
            "com.samsung.android.incallui"
    ));

    private Handler handler = new Handler();
    private Runnable checkRunnable;

    private boolean lastState = false;

@Override
public void onAccessibilityEvent(AccessibilityEvent event) {

    if (event == null) return;

    Log.d("YT_SERVICE", "EVENT FIRED: " + event.getEventType());

    CharSequence pkgCS = event.getPackageName();
    if (pkgCS == null) return;

    String pkg = pkgCS.toString();

    Log.d("YT_SERVICE", "PACKAGE: " + pkg);

    // 🔥 Ignore system noise early
    if (isIgnored(pkg)) return;

    // 🔥 DO NOT trust this package blindly
    // Instead check actual visible app
    scheduleCheck();
}

    @Override
    public void onInterrupt() {}

@Override
protected void onServiceConnected() {
    super.onServiceConnected();

    AccessibilityServiceInfo info = new AccessibilityServiceInfo();

    info.eventTypes =
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED |
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED |
            AccessibilityEvent.TYPE_WINDOWS_CHANGED; // 🔥 IMPORTANT

    info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;

    info.flags =
            AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS |
            AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;

    info.notificationTimeout = 100;

    setServiceInfo(info);

    Log.d("YT_SERVICE", "SERVICE CONNECTED & CONFIG SET");
}

    // 🔥 Ignore system noise
    private boolean isIgnored(String pkg) {
        return IGNORED_PACKAGES.contains(pkg)
                || pkg.startsWith("com.google.android.inputmethod")
                || pkg.startsWith("com.samsung.android");
    }

    // 🔥 Debounce logic (anti-flicker)
    private void scheduleCheck() {
  if (checkRunnable != null) {
        handler.removeCallbacks(checkRunnable);
    }

    checkRunnable = () -> {
        boolean isYouTube = isYouTubeActive();

        if (isYouTube != lastState) {
            lastState = isYouTube;
            Log.d(TAG, "FINAL STATE: " + isYouTube);

            // 🔥 FIX: Actually send the broadcast
            Intent intent = new Intent("YT_STATUS");
            intent.putExtra("active", isYouTube);
            // setPackage ensures only YOUR app catches this (required for modern Android)
            intent.setPackage(getPackageName()); 
            sendBroadcast(intent);
        }
    };

    handler.postDelayed(checkRunnable, 500);
    }

    // 🔥 Core detection logic
    private boolean isYouTubeActive() {
        boolean found = false;

        // 🔹 1. Check main active window
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root != null) {
            try {
                CharSequence pkg = root.getPackageName();
                if (pkg != null && pkg.toString().equals(YT_PACKAGE)) {
                    return true;
                }
            } finally {
                root.recycle(); // 🔥 CRITICAL
            }
        }

        // 🔹 2. Check all windows (split screen / popup)
        List<AccessibilityWindowInfo> windows = getWindows();
        if (windows != null) {
            for (AccessibilityWindowInfo window : windows) {
                AccessibilityNodeInfo node = window.getRoot();
                if (node != null) {
                    try {
                        CharSequence pkg = node.getPackageName();
                        if (pkg != null && pkg.toString().equals(YT_PACKAGE)) {
                            found = true;
                            break;
                        }
                    } finally {
                        node.recycle(); // 🔥 CRITICAL
                    }
                }
            }
        }

        return found;
    }
}