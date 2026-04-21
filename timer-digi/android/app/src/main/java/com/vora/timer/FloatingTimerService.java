package com.vora.timer;

import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.graphics.Color;
import android.util.TypedValue;
import android.graphics.drawable.GradientDrawable;
import android.util.Log;

public class FloatingTimerService extends Service {

    private WindowManager windowManager;
    private View floatingView;
    private WindowManager.LayoutParams params;
    private TextView timerText;

    private String formatTime(int totalSeconds) {
        int h = totalSeconds / 3600;
        int m = (totalSeconds % 3600) / 60;
        int s = totalSeconds % 60;
        if (h > 0) {
            return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
        } else {
            return m + ":" + (s < 10 ? "0" : "") + s;
        }
    }

    private int currentSeconds = 0;
    private android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private Runnable timerRunnable = new Runnable() {
        @Override
        public void run() {
            currentSeconds++;
            if (timerText != null) {
                timerText.setText(formatTime(currentSeconds));
            }
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d("FloatingTimerService", "onCreate called");

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        // Create the view programmatically
        floatingView = createFloatingView();

        int layoutType;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            layoutType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            layoutType = WindowManager.LayoutParams.TYPE_PHONE;
        }

        params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.START;
        
        // Start at a visible position (top center)
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getMetrics(metrics);
        params.x = (metrics.widthPixels / 2) - dpToPx(50);
        params.y = dpToPx(100);

        try {
            windowManager.addView(floatingView, params);
            Log.d("FloatingTimerService", "View added to WindowManager");
        } catch (Exception e) {
            Log.e("FloatingTimerService", "Failed to add view", e);
        }

        setupDragAndSnap();
    }

    private View createFloatingView() {
        TextView tv = new TextView(this);
        tv.setText("00:00");
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        tv.setPadding(dpToPx(14), dpToPx(8), dpToPx(14), dpToPx(8));
        tv.setGravity(Gravity.CENTER);
        
        GradientDrawable shape = new GradientDrawable();
        shape.setShape(GradientDrawable.RECTANGLE);
        shape.setColor(Color.parseColor("#E6000000")); // Solid black with 90% opacity
        shape.setCornerRadius(dpToPx(25));
        shape.setStroke(dpToPx(1), Color.parseColor("#4DFFFFFF")); // Subtle border
        
        tv.setBackground(shape);
        timerText = tv;
        return tv;
    }

    private void setupDragAndSnap() {
        floatingView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        windowManager.updateViewLayout(floatingView, params);
                        return true;

                    case MotionEvent.ACTION_UP:
                        snapToEdge();
                        return true;
                }
                return false;
            }
        });
    }

    private void snapToEdge() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getMetrics(metrics);
        int screenWidth = metrics.widthPixels;
        int viewWidth = floatingView.getWidth();
        
        if (params.x + (viewWidth / 2) < screenWidth / 2) {
            params.x = 0; // Snap to left
        } else {
            params.x = screenWidth - viewWidth; // Snap to right
        }
        windowManager.updateViewLayout(floatingView, params);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.hasExtra("initialSeconds")) {
            currentSeconds = intent.getIntExtra("initialSeconds", 0);
            handler.removeCallbacks(timerRunnable);
            // Immediately set visual sync
            if (timerText != null) {
                timerText.setText(formatTime(currentSeconds));
            }
            handler.postDelayed(timerRunnable, 1000);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d("FloatingTimerService", "onDestroy called");
        handler.removeCallbacks(timerRunnable);
        if (floatingView != null) {
            windowManager.removeView(floatingView);
        }
    }

    private int dpToPx(int dp) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, getResources().getDisplayMetrics());
    }
}
