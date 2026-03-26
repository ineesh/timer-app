package com.ain.timer;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

public class YouTubeModule extends ReactContextBaseJavaModule {
    private BroadcastReceiver receiver;
    public YouTubeModule(ReactApplicationContext reactContext) {
        super(reactContext);
        
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                boolean active = intent.getBooleanExtra("active", false);
                getReactApplicationContext()
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("YT_STATUS", active);
            }
        };

        IntentFilter filter = new IntentFilter("YT_STATUS");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            reactContext.registerReceiver(receiver, filter);
        }
    }

    @Override
    public String getName() {
        return "YouTubeModule";
    }
    @Override
public void invalidate() {
    super.invalidate();
    try {
        getReactApplicationContext().unregisterReceiver(receiver);
    } catch (Exception e) {
        // ignore
    }
}
}