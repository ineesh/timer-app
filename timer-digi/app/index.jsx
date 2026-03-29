import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, DeviceEventEmitter } from 'react-native';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { createMMKV } from 'react-native-mmkv';
import { NativeModules } from 'react-native';
const storage = createMMKV();

// 1. GLOBAL TRACKING VARIABLES (outside the component for background persistence)
let secondsCounter = storage.getNumber('totalSeconds') || 0;
let trackingInterval = null;
let lastState = null;
// Background action handler

notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    await notifee.cancelNotification(detail.notification.id);
  }
});

// --- 2. THE REACTIVE FOREGROUND SERVICE ---
notifee.registerForegroundService((notification) => {
  return new Promise((resolve) => {
    
    // Listen for the Native Java Event we created
    let subscription = DeviceEventEmitter.addListener('YT_STATUS', async (data) => {
      console.log("--- DEBUG: EVENT ARRIVED ---", data); 
  
// const isWatchingYouTube = typeof data === 'boolean' ? data : data.active;

//     if (lastState === isWatchingYouTube) return;
//     lastState = isWatchingYouTube;

//       if (isWatchingYouTube) {
//         console.log("Native Event: YouTube Started");
//         // Start the counter if it's not already running
//         if (!trackingInterval) {
//           trackingInterval = setInterval(async () => {
//             secondsCounter++;
//             storage.set('totalSeconds', secondsCounter);
            
//             await notifee.displayNotification({
//               id: notification.id,
//               body: `Watching YouTube: ${Math.floor(secondsCounter / 60)}m ${secondsCounter % 60}s`,
//               android: { ...notification.android },
//             });
//           }, 1000);
//         }
//       } else {
//         console.log("Native Event: YouTube Closed");
//         // Stop counting but keep the service alive waiting for next time
//         if (trackingInterval) {
//           clearInterval(trackingInterval);
//           trackingInterval = null;
//         }
        
//         await notifee.displayNotification({
//           id: notification.id,
//           body: `Waiting for you to open YouTube...`,
//           android: { ...notification.android },
//         });
//       }
const isWatchingYouTube =
  typeof data === 'boolean' ? data : data?.active;

console.log("STATE CHANGE CHECK:", lastState, "→", isWatchingYouTube);

if (lastState === isWatchingYouTube) return;

lastState = isWatchingYouTube;

if (isWatchingYouTube) {
  console.log("YouTube OPENED");

try { //start the bubble 
  await NativeModules.OverlayModule.startOverlay(secondsCounter);
} catch (e) {
  console.log("Overlay start error", e);
}

  // ✅ START timer
  if (!trackingInterval) {
    trackingInterval = setInterval(async () => {
      secondsCounter++;
      storage.set('totalSeconds', secondsCounter);

      await notifee.displayNotification({
        id: notification.id,
        body: `Tracking...`,
        android: { ...notification.android },
      });
    }, 1000);
  }

} else {
  console.log("YouTube CLOSED");

  // ✅ STOP bubble
  await NativeModules.OverlayModule.stopOverlay();

  // ✅ STOP timer
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }

  await notifee.displayNotification({
    id: notification.id,
    body: `Waiting for you to open YouTube...`,
    android: { ...notification.android },
  });
}
    });
return () => {
  if (subscription) {
    subscription.remove();
  }
};
    // Note: We don't resolve() here because we want the service to stay alive 
    // until the user manually stops focus mode or the app is killed.
  });
});

export default function App() {
  const [displayTime, setDisplayTime] = useState(0);

  // Keep the UI in sync with the MMKV storage
  useEffect(() => {
    const uiInterval = setInterval(() => {
      setDisplayTime(storage.getNumber('totalSeconds') || 0);
    }, 500);
    return () => clearInterval(uiInterval);
  }, []);

 const startFocusMode = async () => {
  await notifee.requestPermission();

  // ✅ Check overlay permission
  const canDraw = await NativeModules.OverlayModule.canDrawOverlays();
  // await NativeModules.OverlayModule.startOverlay();

  if (!canDraw) {
    console.log("Overlay permission not granted");

    // Open overlay settings
    NativeModules.OverlayModule.openOverlaySettings();
    alert("Please enable overlay permission and press again");
    return; // ⛔ stop here
  }

  // ✅ Continue if permission granted
  const channelId = await notifee.createChannel({
    id: 'youtube-tracker',
    name: 'YouTube Tracker Service',
    importance: AndroidImportance.HIGH,
  });
 await notifee.displayNotification({
    title: 'YouTube Detector Active',
    body: 'Waiting for you to open YouTube...',
    android: {
      channelId,
      asForegroundService: true,
      ongoing: true,
      pressAction: { id: 'default' },
    },
  });

};
 
  return (
    <View style={styles.container}>
      <Text style={styles.title}>YouTube Tracker (Native Edition)</Text>
      <Text style={styles.timer}>
        {Math.floor(displayTime / 60)}:{(displayTime % 60).toString().padStart(2, '0')}
      </Text>

      <TouchableOpacity style={styles.button} onPress={startFocusMode}>
        <Text style={styles.buttonText}>Start Focus Mode</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        onPress={() => {
            storage.set('totalSeconds', 0);
            secondsCounter = 0;
        }} 
        style={{ marginTop: 20 }}
      >
        <Text style={{ color: '#555' }}>Reset Time</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#888', fontSize: 18, marginBottom: 10 },
  timer: { color: '#fff', fontSize: 70, fontWeight: 'bold', marginBottom: 40 },
  button: { backgroundColor: '#FF0000', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 30 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});