import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, DeviceEventEmitter } from 'react-native';
import notifee, { AndroidImportance, EventType, AndroidCategory } from '@notifee/react-native';
import { createMMKV } from 'react-native-mmkv';
import { NativeModules } from 'react-native';

const storage = createMMKV();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayMidnightMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function loadSessions() {
  try {
    const raw = storage.getString('ytSessions');
    const sessions = raw ? JSON.parse(raw) : [];
    const midnight = todayMidnightMs();
    return sessions.filter(s => s.start >= midnight);
  } catch (e) {
    return [];
  }
}

function saveSessions(sessions) {
  storage.set('ytSessions', JSON.stringify(sessions));
}

// ─── Global tracking state ────────────────────────────────────────────────────

let secondsCounter = storage.getNumber('totalSeconds') || 0;
let startTime = null;
let lastState = null;

// ─── Notifee background handler ───────────────────────────────────────────────

notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    await notifee.cancelNotification(detail.notification.id);
  }
});

// ─── Foreground service ───────────────────────────────────────────────────────

notifee.registerForegroundService((notification) => {
  return new Promise((resolve) => {
    let subscription = DeviceEventEmitter.addListener('YT_STATUS', async (data) => {
      console.log('--- DEBUG: EVENT ARRIVED ---', data);

      const isWatchingYouTube = typeof data === 'boolean' ? data : data?.active;
      console.log('STATE CHANGE CHECK:', lastState, '→', isWatchingYouTube);

      if (lastState === isWatchingYouTube) return;
      lastState = isWatchingYouTube;

      if (isWatchingYouTube) {
        console.log('YouTube OPENED');
        startTime = Date.now();
        NativeModules.LiveUpdateModule.startLiveUpdate(startTime);
      } else {
        console.log('YouTube CLOSED');
        if (startTime) {
          const sessionEnd = Date.now();
          const elapsedSeconds = Math.floor((sessionEnd - startTime) / 1000);
          secondsCounter += elapsedSeconds;
          storage.set('totalSeconds', secondsCounter);

          // Save this session to the timeline
          const sessions = loadSessions();
          sessions.push({ start: startTime, end: sessionEnd });
          saveSessions(sessions);

          startTime = null;
        }
        NativeModules.LiveUpdateModule.stopLiveUpdate(secondsCounter);
      }
    });

    return () => { if (subscription) subscription.remove(); };
  });
});

// ─── DayTimeline component ────────────────────────────────────────────────────

function DayTimeline({ sessions, liveStart }) {
  const midnight = todayMidnightMs();
  const dayMs = 24 * 60 * 60 * 1000;

  const allSessions = [...sessions];
  if (liveStart) allSessions.push({ start: liveStart, end: Date.now() });

  const labels = ['12AM', '6AM', '12PM', '6PM', '12AM'];

  const fmt = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={tl.wrapper}>
      <Text style={tl.heading}>Today's YouTube Usage</Text>

      {/* 24-hour bar */}
      <View style={tl.barTrack}>
        {allSessions.map((s, i) => {
          const leftPct = ((s.start - midnight) / dayMs) * 100;
          const widthPct = ((s.end - s.start) / dayMs) * 100;
          const isLive = !!(liveStart && i === allSessions.length - 1);
          return (
            <View
              key={i}
              style={[
                tl.segment,
                { left: `${Math.max(0, leftPct)}%`, width: `${Math.max(0.4, Math.min(widthPct, 100 - Math.max(0, leftPct)))}%` },
                isLive && tl.segmentLive,
              ]}
            />
          );
        })}
      </View>

      {/* Hour labels */}
      <View style={tl.labelsRow}>
        {labels.map((label, i) => <Text key={i} style={tl.label}>{label}</Text>)}
      </View>

      {/* Session list */}
      {allSessions.length === 0 ? (
        <Text style={tl.noData}>No YouTube usage recorded today</Text>
      ) : (
        <View style={tl.sessionList}>
          {allSessions.map((s, i) => {
            const dur = Math.round((s.end - s.start) / 60000);
            const isLive = !!(liveStart && i === allSessions.length - 1);
            return (
              <View key={i} style={tl.sessionRow}>
                <View style={[tl.dot, isLive && tl.dotLive]} />
                <Text style={tl.sessionText}>
                  {fmt(s.start)} → {isLive ? 'now' : fmt(s.end)}
                  {'  '}
                  <Text style={tl.dur}>
                    ({isLive ? `${Math.round((Date.now() - s.start) / 60000)}m live` : `${dur}m`})
                  </Text>
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [displayTime, setDisplayTime] = useState(0);
  const [sessions, setSessions] = useState(loadSessions);
  const [liveStart, setLiveStart] = useState(null);

  useEffect(() => {
    const uiInterval = setInterval(() => {
      let currentTotal = storage.getNumber('totalSeconds') || 0;
      if (startTime) currentTotal += Math.floor((Date.now() - startTime) / 1000);
      setDisplayTime(currentTotal);
      setSessions(loadSessions());
      setLiveStart(startTime);
    }, 1000);
    return () => clearInterval(uiInterval);
  }, []);

  const startFocusMode = async () => {
    await notifee.requestPermission();

    const isAccessGranted = await NativeModules.OverlayModule.isAccessibilityServiceEnabled();
    if (!isAccessGranted) {
      NativeModules.OverlayModule.openAccessibilitySettings();
      alert("Please enable the 'Timer Digi' Accessibility Service and press Start again.");
      return;
    }

    const channelId = await notifee.createChannel({
      id: 'youtube-tracker',
      name: 'YouTube Tracker Service',
      importance: AndroidImportance.HIGH,
    });

    if (NativeModules.LiveUpdateModule?.checkAndRequestPromotedPermission) {
      NativeModules.LiveUpdateModule.checkAndRequestPromotedPermission();
    }

    await notifee.displayNotification({
      id: 'youtube-tracker-id',
      android: {
        channelId,
        asForegroundService: true,
        ongoing: true,
        category: AndroidCategory.PROGRESS,
        pressAction: { id: 'default' },
        onlyAlertOnce: true,
      },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>YouTube Tracker</Text>
      <Text style={styles.timer}>
        {Math.floor(displayTime / 60)}:{(displayTime % 60).toString().padStart(2, '0')}
      </Text>

      <DayTimeline sessions={sessions} liveStart={liveStart} />

      <TouchableOpacity style={styles.button} onPress={startFocusMode}>
        <Text style={styles.buttonText}>Start Focus Mode</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          storage.set('totalSeconds', 0);
          storage.set('ytSessions', '[]');
          secondsCounter = 0;
          setSessions([]);
          if (startTime) startTime = Date.now();
        }}
        style={{ marginTop: 20 }}
      >
        <Text style={{ color: '#555' }}>Reset Time</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  title: { color: '#888', fontSize: 18, marginBottom: 10 },
  timer: { color: '#fff', fontSize: 70, fontWeight: 'bold', marginBottom: 24 },
  button: { backgroundColor: '#FF0000', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 30, marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});

const tl = StyleSheet.create({
  wrapper: { width: '100%', marginBottom: 8 },
  heading: { color: '#aaa', fontSize: 13, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 },

  barTrack: {
    width: '100%',
    height: 16,
    backgroundColor: '#222',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 4,
  },
  segment: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#FF0000',
    borderRadius: 4,
  },
  segmentLive: {
    backgroundColor: '#ff4444',
  },

  labelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  label: { color: '#555', fontSize: 10 },

  noData: { color: '#444', fontSize: 13, marginBottom: 4 },

  sessionList: { gap: 6 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF0000' },
  dotLive: { backgroundColor: '#ff6666' },
  sessionText: { color: '#ccc', fontSize: 13 },
  dur: { color: '#666' },
});