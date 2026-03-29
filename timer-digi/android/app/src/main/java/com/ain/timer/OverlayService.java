package com.ain.timer;

import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

public class OverlayService extends Service {

    private WindowManager windowManager;
    private View bubbleView;
    private TextView timerText;

    private Handler handler = new Handler();
    private int seconds = 0;

    private Runnable timerRunnable = new Runnable() {
        @Override
        public void run() {
            int mins = seconds / 60;
            int secs = seconds % 60;
            timerText.setText(mins + ":" + String.format("%02d", secs));
            seconds++;
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        timerText = new TextView(this);
        timerText.setText("0:00");
        timerText.setTextSize(18);
        timerText.setTextColor(0xFFFFFFFF);
        timerText.setBackgroundColor(0xAA000000);
        timerText.setPadding(30, 20, 30, 20);

        bubbleView = timerText;

        final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 100;
        params.y = 300;

        // Drag logic
        bubbleView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;

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
                        windowManager.updateViewLayout(bubbleView, params);
                        return true;
                }
                return false;
            }
        });

        windowManager.addView(bubbleView, params);

        // text will be set by timerRunnable
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            seconds = intent.getIntExtra("initialSeconds", 0);
        }
        handler.removeCallbacks(timerRunnable);
        handler.post(timerRunnable);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (bubbleView != null) windowManager.removeView(bubbleView);
        handler.removeCallbacks(timerRunnable);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}