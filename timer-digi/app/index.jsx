import { Ionicons } from '@expo/vector-icons';
import notifee, { AndroidCategory, AndroidImportance, EventType } from '@notifee/react-native';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { doc, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Alert, AppState, ScrollView as CustomScroll, DeviceEventEmitter, Modal, NativeModules, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { auth, db } from '../firebaseConfig';
import AlertEngine from './alertEngine';
import BehaviorEngine from './behaviorEngine';

SplashScreen.preventAutoHideAsync();

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
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function getSessionsForPeriod(sessions, period) {
  const now = Date.now();
  let startTime = 0;

  if (period === 'day') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    startTime = d.getTime();
  } else if (period === 'week') {
    // Last 7 rolling days
    startTime = now - (7 * 24 * 60 * 60 * 1000);
  } else if (period === 'month') {
    // Last 30 rolling days (simpler for Monthly than calendar month)
    startTime = now - (30 * 24 * 60 * 60 * 1000);
  }

  return sessions.filter(s => s.start >= startTime);
}

function formatTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hDisplay = hours > 0 ? `${hours}:` : '';
  const mDisplay = minutes.toString().padStart(2, '0');
  const sDisplay = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${mDisplay}:${sDisplay}`;
  }
  return `${minutes}:${sDisplay}`;
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
        const floatOn = storage.getBoolean('floatingEnabled') || false;
        NativeModules.LiveUpdateModule.startLiveUpdate(startTime, !floatOn);

        const todayTotalSeconds = () => {
          const m = new Date(); m.setHours(0, 0, 0, 0);
          return Math.floor(loadSessions().filter(s => s.start >= m.getTime()).reduce((acc, s) => acc + (s.end - s.start) / 1000, 0));
        };

        if (floatOn) {
          console.log('--- DEBUG: FIRING NATIVE FLOATING TIMER ---');
          NativeModules.OverlayModule.showFloatingTimer(todayTotalSeconds());
        } else {
          console.log('--- DEBUG: FLOATING TIMER IS DISABLED IN UI ---');
        }

        // --- MULTI-LAYER INTERVENTION SYSTEM ---
        const sessions = loadSessions();
        const limitSeconds = storage.getNumber('dailyGoalSeconds') || 3600;
        const alertConfig = AlertEngine.evaluate(sessions, limitSeconds, todayTotalSeconds());

        if (alertConfig) {
          NativeModules.OverlayModule.showIntervention(
            alertConfig.title,
            alertConfig.message,
            alertConfig.primaryBtn,
            alertConfig.secondaryBtn,
            alertConfig.delaySecondary,
            alertConfig.isBlocking
          ).then(choice => {
            console.log("User chose:", choice);
          }).catch(console.error);
        }

      } else {
        console.log('YouTube CLOSED');

        if (startTime) {
          const sessionEnd = Date.now();
          const sessions = loadSessions();
          sessions.push({ start: startTime, end: sessionEnd });
          saveSessions(sessions);
          startTime = null;
        }

        const todayTotalSeconds = () => {
          const m = new Date(); m.setHours(0, 0, 0, 0);
          return Math.floor(loadSessions().filter(s => s.start >= m.getTime()).reduce((acc, s) => acc + (s.end - s.start) / 1000, 0));
        };

        const sumToday = todayTotalSeconds();
        NativeModules.LiveUpdateModule.stopLiveUpdate(sumToday);
        DeviceEventEmitter.emit('YT_TRACKING_STOPPED');
        NativeModules.OverlayModule.hideFloatingTimer();

        // Push update to Firebase if authenticated
        if (auth?.currentUser) {
          setDoc(doc(db, "users", auth.currentUser.uid), {
            dailyScoreSeconds: sumToday,
            lastUpdated: Date.now()
          }, { merge: true }).catch(() => { });
        }
      }

    });

    return () => { if (subscription) subscription.remove(); };
  });
});

// ─── Shared Components ────────────────────────────────────────────────────────

function formatTotalTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function PatternAlertCard({ type, message }) {
  if (!message) return null;
  const isBurst = type === 'burst';
  const color = isBurst ? '#FFA500' : '#8A2BE2';
  const title = isBurst ? "Dopamine Burst Detected" : "Habitual Pattern";

  return (
    <View style={{ backgroundColor: '#111', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#222' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 8 }} />
        <Text style={{ color: '#ccc', fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</Text>
      </View>
      <Text style={{ color: '#888', fontSize: 13, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

function DailySummaryCard({ metrics }) {
  if (!metrics) return null;
  const h12 = metrics.peakHour !== null ? (metrics.peakHour % 12 || 12) : '--';
  const ampm = metrics.peakHour !== null ? (metrics.peakHour >= 12 ? 'PM' : 'AM') : '';

  return (
    <View style={{ backgroundColor: '#0a0a0a', borderRadius: 16, padding: 16, marginBottom: 30, borderWidth: 1, borderColor: '#111', flexDirection: 'row', justifyContent: 'space-around' }}>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', fontWeight: 'bold' }}>Total Opens</Text>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>{metrics.totalOpens}</Text>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', fontWeight: 'bold' }}>Peak Time</Text>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>{metrics.peakHour !== null ? `${h12}:${metrics.peakMinutes} ${ampm}` : '--'}</Text>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: '#444', fontSize: 10, textTransform: 'uppercase', fontWeight: 'bold' }}>Burst Level</Text>
        <Text style={{ color: metrics.burstIntensity === 'High' ? '#FF5555' : '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>{metrics.burstIntensity}</Text>
      </View>
    </View>
  );
}

function ActivityRing({ percent, color, size = 120, thickness = 15 }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent * circumference);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          {/* Background Circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#1a1a1a"
            strokeWidth={thickness}
            fill="transparent"
          />
          {/* Progress Circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={thickness}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={{ position: 'absolute' }}>
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>{Math.round(percent * 100)}%</Text>
      </View>
    </View>
  );
}

function InsightCard({ title, totalSeconds, goalSeconds, color, onPress }) {
  const percent = Math.min(totalSeconds / goalSeconds, 1);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={ds.card}>
      <View style={ds.cardContent}>
        <View style={ds.cardText}>
          <Text style={ds.cardTitle}>{title}</Text>
          <Text style={ds.cardTime}>{formatTotalTime(totalSeconds)}</Text>
          <Text style={ds.cardGoal}>Goal: {formatTotalTime(goalSeconds)}</Text>
        </View>
        <ActivityRing percent={percent} color={color} size={80} thickness={10} />
      </View>
    </TouchableOpacity>
  );
}

function ClockMap({ sessions, size = 280 }) {
  const radius = size / 2 - 20;
  const center = size / 2;

  // Helper to convert time to angle (Midnight = -90deg)
  const timeToAngle = (ms) => {
    const d = new Date(ms);
    const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    return (hours / 24) * 360 - 90;
  };

  const describeArc = (startAngle, endAngle) => {
    const start = polarToCartesian(center, center, radius, endAngle);
    const end = polarToCartesian(center, center, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
    ].join(" ");
  };

  const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
    };
  };

  return (
    <View style={{ alignItems: 'center', marginVertical: 20 }}>
      <Svg width={size} height={size}>
        {/* Clock Face Background */}
        <Circle cx={center} cy={center} r={radius + 10} stroke="#333" strokeWidth="1" fill="#050505" />

        {/* Tick Marks */}
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i / 24) * 360 - 90;
          const isMajor = i % 6 === 0;
          const tickLen = isMajor ? 12 : 6;
          const p1 = polarToCartesian(center, center, radius - 10, angle);
          const p2 = polarToCartesian(center, center, radius - 10 - tickLen, angle);
          return (
            <Line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={isMajor ? "#888" : "#444"}
              strokeWidth={isMajor ? 2 : 1}
            />
          );
        })}

        {/* Outer Ring Usage Track */}
        <Circle cx={center} cy={center} r={radius} stroke="#1a1a1a" strokeWidth="20" fill="transparent" />

        {/* Hour Labels */}
        {[0, 6, 12, 18].map((h) => {
          const angle = (h / 24) * 360 - 90;
          const pos = polarToCartesian(center, center, radius + 30, angle);
          return (
            <SvgText key={h} x={pos.x} y={pos.y} fill={h === 12 || h === 0 ? "#fff" : "#666"} fontSize="11" fontWeight="bold" textAnchor="middle" alignmentBaseline="middle">
              {h === 0 ? "12AM" : h === 12 ? "12PM" : `${h > 12 ? h - 12 : h}${h >= 12 ? 'PM' : 'AM'}`}
            </SvgText>
          );
        })}

        {/* Usage Arcs */}
        {sessions.map((s, i) => {
          const startAngle = timeToAngle(s.start);
          let endAngle = timeToAngle(s.end);
          if (endAngle <= startAngle) endAngle += 360;

          return (
            <Path
              key={i}
              d={describeArc(startAngle, endAngle)}
              stroke="#FF0000"
              strokeWidth="20"
              fill="transparent"
              strokeLinecap="round"
            />
          );
        })}

        {/* Center Text */}
        <SvgText x={center} y={center} fill="#444" fontSize="12" fontWeight="900" textAnchor="middle" letterSpacing="1">
          DAILY MAP
        </SvgText>
      </Svg>
    </View>
  );
}

function InsightsModal({ visible, onClose, period, sessions }) {
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 = today, 1 = yesterday...

  const getDaySessions = (offset) => {
    const target = new Date();
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() - offset);
    const start = target.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return sessions.filter(s => s.start >= start && s.start < end);
  };

  const daySessions = getDaySessions(selectedDayOffset);
  const dayName = new Date(Date.now() - selectedDayOffset * 86400000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={[ds.container, { paddingTop: 60 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Text style={ds.title}>{period === 'week' ? 'Weekly' : 'Monthly'} Insights</Text>
          <TouchableOpacity onPress={onClose} style={{ backgroundColor: '#222', padding: 10, borderRadius: 20 }}>
            <Text style={{ color: '#fff' }}>Close</Text>
          </TouchableOpacity>
        </View>

        <CustomScroll horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20, maxHeight: 50 }}>
          {[0, 1, 2, 3, 4, 5, 6].map(i => {
            const date = new Date(Date.now() - i * 86400000);
            const label = i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short' });
            return (
              <TouchableOpacity
                key={i}
                onPress={() => setSelectedDayOffset(i)}
                style={{ backgroundColor: selectedDayOffset === i ? '#FF0000' : '#111', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 15, marginRight: 10 }}
              >
                <Text style={{ color: selectedDayOffset === i ? '#fff' : '#666', fontWeight: 'bold' }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </CustomScroll>

        <View style={ds.mainCard}>
          <Text style={ds.mainSubtitle}>{dayName}</Text>
          <ClockMap sessions={daySessions} />

          <View style={{ marginTop: 20 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>
              Total: {formatTotalTime(daySessions.reduce((acc, s) => acc + Math.floor((s.end - s.start) / 1000), 0))}
            </Text>
            <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
              {daySessions.length} sessions recorded
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Helper to bundle sessions close together (default 5 min gap)
function clusterSessions(sessions, gapMs = 5 * 60 * 1000) {
  if (!sessions || sessions.length === 0) return [];
  // Sort ascending
  const sorted = [...sessions].sort((a, b) => a.start - b.start);
  const clustered = [];

  let currentGroup = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    // If start is within 'gapMs' of current group's end, merge them
    if (s.start - currentGroup.end <= gapMs) {
      currentGroup.end = Math.max(currentGroup.end, s.end);
    } else {
      clustered.push(currentGroup);
      currentGroup = { ...s };
    }
  }
  clustered.push(currentGroup);
  return clustered;
}

function SessionDetailsModal({ visible, onClose, sessions, liveStart }) {
  const allSessions = [...sessions];
  if (liveStart) allSessions.push({ start: liveStart, end: Date.now() });

  const clustered = clusterSessions(allSessions);
  const fmt = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#111', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, paddingTop: 30, maxHeight: '80%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold' }}>Session Timeline</Text>
            <TouchableOpacity onPress={onClose} style={{ backgroundColor: '#333', padding: 8, paddingHorizontal: 16, borderRadius: 20 }}>
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12 }}>X</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {clustered.length === 0 ? (
              <Text style={{ color: '#666', textAlign: 'center', marginTop: 20 }}>No sessions today.</Text>
            ) : (
              clustered.reverse().map((s, i) => {
                const durMs = s.end - s.start;
                const hrs = Math.floor(durMs / 3600000);
                const mins = Math.floor((durMs % 3600000) / 60000);
                const durStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                const isLive = liveStart && i === 0; // Reversed so live is first

                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 }}>
                    <View style={{ alignItems: 'center', marginRight: 15, width: 20 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: isLive ? '#FF0000' : '#444', marginTop: 4, elevation: isLive ? 10 : 0, shadowColor: '#FF0000', shadowOpacity: isLive ? 0.8 : 0, shadowRadius: 5 }} />
                      {i !== clustered.length - 1 && (
                        <View style={{ width: 2, height: 40, backgroundColor: '#222', marginTop: 5 }} />
                      )}
                    </View>
                    <View style={{ flex: 1, backgroundColor: '#1A1A1A', padding: 15, borderRadius: 15 }}>
                      <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                        {fmt(s.start)} - {isLive ? 'Now' : fmt(s.end)}
                      </Text>
                      <Text style={{ color: isLive ? '#FF0000' : '#888', fontSize: 13, marginTop: 4, fontWeight: 'bold' }}>
                        {isLive ? 'Active Session' : `${durStr} bucket`}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── DayTimeline component ────────────────────────────────────────────────────

function DayTimeline({ sessions, liveStart }) {
  const midnight = todayMidnightMs();
  const dayMs = 24 * 60 * 60 * 1000;

  const allSessions = [...sessions];
  if (liveStart) allSessions.push({ start: liveStart, end: Date.now() });

  const labels = ['12AM', '6AM', '12PM', '6PM', '12AM'];
  const fmt = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const [modalVisible, setModalVisible] = useState(false);

  return (
    <View style={tl.wrapper}>
      <Text style={tl.heading}>Today's YouTube Usage</Text>

      {/* 24-hour bar */}
      <TouchableOpacity activeOpacity={0.8} onPress={() => setModalVisible(true)}>
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
        <Text style={{ color: '#666', fontSize: 10, textAlign: 'center', marginTop: 10 }}>Tap timeline for details</Text>
      </TouchableOpacity>

      {/* Hour labels */}
      <View style={tl.labelsRow}>
        {labels.map((label, i) => <Text key={i} style={tl.label}>{label}</Text>)}
      </View>

      <SessionDetailsModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        sessions={sessions}
        liveStart={liveStart}
      />
    </View>
  );
}

function PermissionBanner({ hasAccessibility, hasOverlay, setShowAccessDisclosure }) {
  if (hasAccessibility && hasOverlay) return null;
  return (
    <View style={{ backgroundColor: '#220000', padding: 15, borderBottomWidth: 1, borderColor: '#550000', paddingTop: 50 }}>
      <Text style={{ color: '#ffaaaa', fontSize: 13, fontWeight: 'bold', marginBottom: 10, textAlign: 'center', textTransform: 'uppercase' }}>
        Missing Required Permissions
      </Text>
      {!hasAccessibility && (
        <TouchableOpacity
          style={{ backgroundColor: '#ff4444', padding: 10, borderRadius: 8, marginBottom: 8 }}
          onPress={() => setShowAccessDisclosure(true)}
        >
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold', fontSize: 13 }}>Enable Accessibility Service</Text>
        </TouchableOpacity>
      )}
      {!hasOverlay && (
        <TouchableOpacity
          style={{ backgroundColor: '#ff8800', padding: 10, borderRadius: 8 }}
          onPress={() => NativeModules.OverlayModule.openOverlaySettings()}
        >
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold', fontSize: 13 }}>Enable Draw Over Apps</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Tutorial Overlay ─────────────────────────────────────────────────────────
// Renders the dim backdrop + tooltip card only.
// Highlighting is done inline on each component via the hl() helper in App.

const TUTORIAL_STEPS = [
  { key: 'leaderboard', text: "Tap the people icon to connect with friends and see the Global Leaderboard!" },
  { key: 'goal', text: "Tap EDIT GOAL to set your daily YouTube limit in hours, minutes and seconds." },
  { key: 'timer', text: "Tap Focus Now to start tracking. Toggle the floating bubble to see your time inside YouTube!" },
  { key: 'timeline', text: "This circular timeline shows every session from the last 24 hours. Tap it to see details." },
  { key: 'insights', text: "Your Behavioral Engine tracks burst patterns and habitual windows using the last 14 days of data." },
];

function TutorialOverlay({ step, onNext, onComplete }) {
  const current = TUTORIAL_STEPS[step];
  if (!current) return null;
  const isLast = step === TUTORIAL_STEPS.length - 1;

  return (
    // Sits above the ScrollView but below the highlighted elements (zIndex on elements is higher)
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0)',
      zIndex: 50,
      justifyContent: 'flex-end',
      paddingBottom: 60,
      paddingHorizontal: 24,
    }} pointerEvents="box-none">
      <View style={{
        backgroundColor: '#111',
        borderRadius: 24,
        padding: 24,
        borderWidth: 1,
        borderColor: '#333',
      }} pointerEvents="auto">
        {/* Step indicator dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 16, gap: 6 }}>
          {TUTORIAL_STEPS.map((_, i) => (
            <View key={i} style={{
              width: i === step ? 20 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === step ? '#FF0000' : '#333',
            }} />
          ))}
        </View>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center', lineHeight: 24, marginBottom: 20 }}>
          {current.text}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            onPress={onComplete}
            style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#333', alignItems: 'center' }}
          >
            <Text style={{ color: '#666', fontWeight: 'bold' }}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={isLast ? onComplete : onNext}
            style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: '#FF0000', alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
              {isLast ? 'Got it!' : 'Next →'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [dailyGoalSeconds, setDailyGoalSeconds] = useState(storage.getNumber('dailyGoalSeconds') || 3600);
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [hasAccessibility, setHasAccessibility] = useState(true);
  const [hasOverlay, setHasOverlay] = useState(true);
  const [isTrackingActive, setIsTrackingActive] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [insightModal, setInsightModal] = useState({ visible: false, period: 'week' });

  // HMS state for the editor
  const currentH = Math.floor(dailyGoalSeconds / 3600);
  const currentM = Math.floor((dailyGoalSeconds % 3600) / 60);
  const currentS = dailyGoalSeconds % 60;

  const [h, setH] = useState(String(currentH));
  const [m, setM] = useState(String(currentM));
  const [s, setS] = useState(String(currentS));

  const [displayTime, setDisplayTime] = useState({ day: 0, week: 0, month: 0 });
  const [staticTotals, setStaticTotals] = useState({ day: 0, week: 0, month: 0 });
  const [allSessions, setAllSessions] = useState(loadSessions());
  const [liveStart, setLiveStart] = useState(null);
  const [floatingEnabled, setFloatingEnabled] = useState(storage.getBoolean('floatingEnabled') || false);
  const [showAccessDisclosure, setShowAccessDisclosure] = useState(false);

  const aiPatterns = useMemo(() => BehaviorEngine.process(allSessions), [allSessions]);

  const checkPermissions = () => {
    NativeModules.OverlayModule.isAccessibilityServiceEnabled().then(setHasAccessibility).catch(() => { });
    NativeModules.OverlayModule.canDrawOverlays().then(setHasOverlay).catch(() => { });
  };

  useEffect(() => {
    checkPermissions(); // Check on mount
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkPermissions();
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const triggerTutorialAlert = () => {
    Alert.alert(
      "Timer Digi Dashboard",
      "Would you like an interactive tour of the app features?",
      [
        { text: "Skip", onPress: () => storage.set('hasSeenOnboarding', true), style: 'cancel' },
        { text: "Take Tour", onPress: () => setShowTutorial(true) }
      ]
    );
  };

  useEffect(() => {
    if (!storage.getBoolean('hasSeenOnboarding') && hasAccessibility && hasOverlay) {
      setTimeout(triggerTutorialAlert, 800);
    }
  }, [hasAccessibility, hasOverlay]);

  useEffect(() => {
    return notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.ACTION_PRESS && detail.pressAction.id) {
        if (detail.pressAction.id === 'skip_today') {
          storage.set('didUserOpenAfterAlert', false);
        } else if (detail.pressAction.id === 'open_anyway') {
          storage.set('didUserOpenAfterAlert', true);
        }
      }
    });
  }, []);

  // Recalculate static totals from memory
  const refreshTotals = (sessions) => {
    const dayTotal = Math.floor(getSessionsForPeriod(sessions, 'day').reduce((acc, s) => acc + (s.end - s.start) / 1000, 0));
    const weekTotal = Math.floor(getSessionsForPeriod(sessions, 'week').reduce((acc, s) => acc + (s.end - s.start) / 1000, 0));
    const monthTotal = Math.floor(getSessionsForPeriod(sessions, 'month').reduce((acc, s) => acc + (s.end - s.start) / 1000, 0));
    setStaticTotals({ day: dayTotal, week: weekTotal, month: monthTotal });
  };

  const saveGoal = () => {
    const valH = parseInt(h) || 0;
    const valM = parseInt(m) || 0;
    const valS = parseInt(s) || 0;
    const total = valH * 3600 + valM * 60 + valS;

    if (total === 0) {
      alert("Invalid Goal: Please set a time greater than 0:0:0.");
      return;
    }

    setDailyGoalSeconds(total);
    storage.set('dailyGoalSeconds', total);
    setIsEditingGoal(false);
    // Sync strings for next edit
    setH(String(valH));
    setM(String(valM));
    setS(String(valS));
  };

  // One-time initialization and backfill
  useEffect(() => {
    async function init() {
      try {
        const sessions = loadSessions();
        const totalStored = storage.getNumber('totalSeconds') || 0;
        const loggedSeconds = Math.floor(sessions.reduce((acc, s) => acc + (s.end - s.start) / 1000, 0));

        if (totalStored > loggedSeconds + 60 && sessions.length > 0) {
          const diff = totalStored - loggedSeconds;
          sessions.unshift({
            start: sessions[0].start - (diff * 1000) - 1000,
            end: sessions[0].start - 1000
          });
          saveSessions(sessions);
        }
        setAllSessions(sessions);
        refreshTotals(sessions);
      } catch (e) {
        console.error("Initialization error:", e);
      } finally {
        // Ensure splash screen hides even if there's an error
        await SplashScreen.hideAsync().catch(() => { });
      }
    }
    init();
  }, []);

  // Live Timer Loop (Lightweight)
  useEffect(() => {
    const uiInterval = setInterval(() => {
      let liveDiff = 0;
      if (startTime) {
        liveDiff = Math.floor((Date.now() - startTime) / 1000);
      }

      setDisplayTime({
        day: staticTotals.day + liveDiff,
        week: staticTotals.week + liveDiff,
        month: staticTotals.month + liveDiff
      });

      setLiveStart(startTime);

      // Conditional sync for floating timer
      if (floatingEnabled && startTime) {
        const total = staticTotals.day + liveDiff;
        NativeModules.OverlayModule.showFloatingTimer(total);
      }
    }, 1000);
    return () => clearInterval(uiInterval);
  }, [staticTotals]);

  // Auto-start tracker silently in the background
  useEffect(() => {
    NativeModules.OverlayModule.isAccessibilityServiceEnabled().then(granted => {
      if (granted) startFocusMode();
    }).catch(() => { });
  }, []);

  // Handle YouTube Events efficiently
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('YT_TRACKING_STOPPED', () => {
      const sessions = loadSessions();
      setAllSessions(sessions);
      refreshTotals(sessions);
    });
    return () => sub.remove();
  }, []);

  const toggleFloating = async () => {
    if (!floatingEnabled) {
      const canDraw = await NativeModules.OverlayModule.canDrawOverlays();
      if (!canDraw) {
        alert("Please enable 'Draw over other apps' to use the floating timer.");
        NativeModules.OverlayModule.openOverlaySettings();
        return;
      }
    } else {
      NativeModules.OverlayModule.hideFloatingTimer();
    }
    const next = !floatingEnabled;
    setFloatingEnabled(next);
    storage.set('floatingEnabled', next);
  };

  const startFocusMode = async () => {
    await notifee.requestPermission();

    const isAccessGranted = await NativeModules.OverlayModule.isAccessibilityServiceEnabled();
    if (!isAccessGranted) {
      setShowAccessDisclosure(true);
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
        foregroundServiceTypes: [notifee.AndroidForegroundServiceType ? notifee.AndroidForegroundServiceType.SPECIAL_USE : 1073741824],
        ongoing: true,
        category: AndroidCategory.PROGRESS,
        pressAction: { id: 'default' },
        onlyAlertOnce: true,
      },
    });

    if (NativeModules.LiveUpdateModule?.stopLiveUpdate) {
      NativeModules.LiveUpdateModule.stopLiveUpdate(staticTotals.day);
    }

    setIsTrackingActive(true);
  };

  // ─── Tutorial Highlight Helper ───
  // Finds the step index for a given key and returns a highlight style when tutorial is active on that step.
  const hl = (key) => {
    const idx = TUTORIAL_STEPS.findIndex(s => s.key === key);
    if (!showTutorial || tutorialStep !== idx) return {};
    return {
      borderWidth: 3,
      borderColor: '#FF0000',
      borderRadius: 16,
      zIndex: 60,        // above the dim overlay (zIndex 50)
      elevation: 10,     // Android shadow lift so it visually pops above the dim
    };
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <PermissionBanner hasAccessibility={hasAccessibility} hasOverlay={hasOverlay} setShowAccessDisclosure={setShowAccessDisclosure} />
      <View pointerEvents={(hasAccessibility && hasOverlay) ? "auto" : "none"} style={{ flex: 1, opacity: (hasAccessibility && hasOverlay) ? 1 : 0.2 }}>
        <ScrollView style={ds.container} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <View style={[ds.header, hl('leaderboard')]}>
            <YouTubeHeader onTourPress={triggerTutorialAlert} />
          </View>

          {/* Main Today View */}
          <View style={ds.mainCard}>
            <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 4 }, hl('goal')]}>
              <Text style={ds.mainSubtitle}>Today's Focus</Text>
              {isEditingGoal ? (
                <TouchableOpacity onPress={saveGoal}>
                  <Text style={{ color: '#FF0000', fontWeight: 'bold' }}>SAVE</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => setIsEditingGoal(true)}>
                  <Text style={{ color: '#444', fontSize: 12 }}>EDIT GOAL</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={ds.mainTimerRow}>
              <View style={ds.timerCol}>
                <Text style={ds.mainTimer}>{formatTime(displayTime.day)}</Text>
                {isEditingGoal ? (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
                    <View style={ds.hmsBox}>
                      <TextInput style={ds.hmsInput} value={h} onChangeText={setH} keyboardType="number-pad" placeholder="0" placeholderTextColor="#444" selectTextOnFocus />
                      <Text style={ds.hmsLabel}>H</Text>
                    </View>
                    <View style={ds.hmsBox}>
                      <TextInput style={ds.hmsInput} value={m} onChangeText={setM} keyboardType="number-pad" placeholder="0" placeholderTextColor="#444" selectTextOnFocus />
                      <Text style={ds.hmsLabel}>M</Text>
                    </View>
                    <View style={ds.hmsBox}>
                      <TextInput style={ds.hmsInput} value={s} onChangeText={setS} keyboardType="number-pad" placeholder="0" placeholderTextColor="#444" selectTextOnFocus />
                      <Text style={ds.hmsLabel}>S</Text>
                    </View>
                  </View>
                ) : (
                  <View style={hl('timer')}>
                    <TouchableOpacity
                      onPress={startFocusMode}
                      style={[styles.button, isTrackingActive && { backgroundColor: '#111', borderWidth: 1, borderColor: '#33ff33' }]}
                    >
                      <Text style={[styles.buttonText, isTrackingActive && { color: '#33ff33' }]}>
                        {isTrackingActive ? "Tracking Active in Background" : "Focus Now"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={toggleFloating}
                      style={{ marginTop: 15, flexDirection: 'row', alignItems: 'center', opacity: floatingEnabled ? 1 : 0.6 }}
                    >
                      <Ionicons name={floatingEnabled ? "browsers" : "browsers-outline"} size={16} color={floatingEnabled ? "#FF0000" : "#666"} />
                      <Text style={{ color: floatingEnabled ? '#FF0000' : '#666', fontSize: 13, fontWeight: 'bold', marginLeft: 6 }}>
                        {floatingEnabled ? "Floating Timer ON" : "Floating Timer OFF"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              <ActivityRing percent={Math.min(displayTime.day / (dailyGoalSeconds || 1), 1)} color="#FF0000" size={130} thickness={18} />
            </View>
            <View style={hl('timeline')}>
              <DayTimeline sessions={getSessionsForPeriod(allSessions, 'day')} liveStart={liveStart} />
            </View>
          </View>

          <Text style={ds.sectionTitle}>Behavioral Overview</Text>

          <View style={hl('insights')}>
            <DailySummaryCard metrics={aiPatterns} />
          </View>

          <Text style={ds.sectionTitle}>Insights</Text>

          <PatternAlertCard
            type="burst"
            message={
              aiPatterns.burstIntensity === 'High'
                ? "High frequency of short sessions detected. Consider taking a 5-minute break."
                : aiPatterns.burstIntensity === 'Medium'
                  ? "Noticeable burst pattern. Doing something else might be refreshing."
                  : null
            }
          />
          <PatternAlertCard
            type="habit"
            message={
              aiPatterns.habitualLevel === 'Strong habit'
                ? `You often open YouTube around ${aiPatterns.peakHour !== null ? (aiPatterns.peakHour % 12 || 12) : '--'}:${aiPatterns.peakMinutes} ${aiPatterns.peakHour >= 12 ? 'PM' : 'AM'}. This seems like a regular habit.`
                : aiPatterns.habitualLevel === 'Emerging pattern'
                  ? `An emerging pattern detected around ${aiPatterns.peakHour !== null ? (aiPatterns.peakHour % 12 || 12) : '--'}:${aiPatterns.peakMinutes} ${aiPatterns.peakHour >= 12 ? 'PM' : 'AM'}.`
                  : null
            }
          />

          <InsightCard
            title="Last 7 Days"
            totalSeconds={displayTime.week}
            goalSeconds={dailyGoalSeconds * 7}
            color="#32CD32"
            onPress={() => setInsightModal({ visible: true, period: 'week' })}
          />

          <InsightCard
            title="Last 30 Days"
            totalSeconds={displayTime.month}
            goalSeconds={dailyGoalSeconds * 30}
            color="#00FFFF"
            onPress={() => setInsightModal({ visible: true, period: 'month' })}
          />

          <InsightsModal
            visible={insightModal.visible}
            period={insightModal.period}
            sessions={allSessions}
            onClose={() => setInsightModal({ ...insightModal, visible: false })}
          />

          <TouchableOpacity
            onPress={() => {
              storage.set('totalSeconds', 0);
              storage.set('ytSessions', '[]');
              setAllSessions([]);
              refreshTotals([]);
              setDisplayTime({ day: 0, week: 0, month: 0 });
              if (startTime) startTime = Date.now();
            }}
            style={ds.resetBtn}
          >
            <Text style={{ color: '#444', fontSize: 12 }}>Reset Tracking Data</Text>
          </TouchableOpacity>

          {/* Prominent Disclosure Modal for Accessibility */}
          <Modal animationType="slide" transparent={true} visible={showAccessDisclosure} onRequestClose={() => setShowAccessDisclosure(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 24 }}>
              <View style={{ backgroundColor: '#111', padding: 24, borderRadius: 24, borderWidth: 1, borderColor: '#333' }}>
                <Ionicons name="shield-checkmark" size={48} color="#FF0000" style={{ marginBottom: 16 }} />
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 12 }}>Accessibility Service Required</Text>
                <Text style={{ color: '#aaa', fontSize: 16, lineHeight: 24, marginBottom: 24 }}>
                  Timer Digi needs your permission to use the Android Accessibility Service. We use this service strictly to detect when YouTube is opened and closed on your screen so we can calculate your focus time and sync your daily scores to the leaderboard. We do not read your screen content, passwords, or track any other apps.
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                  <TouchableOpacity onPress={() => setShowAccessDisclosure(false)} style={{ padding: 12 }}>
                    <Text style={{ color: '#888', fontSize: 16, fontWeight: 'bold' }}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setShowAccessDisclosure(false);
                      NativeModules.OverlayModule.openAccessibilitySettings();
                      alert("Please enable the 'Timer Digi' Accessibility Service and press Start again.");
                    }}
                    style={{ backgroundColor: '#FF0000', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>I Agree</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

        </ScrollView>

        {showTutorial && (
          <TutorialOverlay
            step={tutorialStep}
            onNext={() => setTutorialStep(s => s + 1)}
            onComplete={() => {
              setShowTutorial(false);
              setTutorialStep(0);
              storage.set('hasSeenOnboarding', true);
            }}
          />
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────


const styles = StyleSheet.create({
  button: { backgroundColor: '#FF0000', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});

const ds = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  header: { marginTop: 60, marginBottom: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -1 },

  mainCard: { backgroundColor: '#0a0a0a', borderRadius: 32, padding: 24, marginBottom: 32, borderWidth: 1, borderColor: '#111' },
  mainSubtitle: { color: '#666', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  mainTimerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  timerCol: { flex: 1 },
  mainTimer: { color: '#fff', fontSize: 48, fontWeight: 'bold' },

  sectionTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 16, marginLeft: 4 },

  card: { backgroundColor: '#0a0a0a', borderRadius: 24, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#111' },
  cardContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardText: { flex: 1 },
  cardTitle: { color: '#666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  cardTime: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 2 },
  cardGoal: { color: '#444', fontSize: 12 },

  hmsBox: { backgroundColor: '#111', borderRadius: 8, padding: 6, alignItems: 'center', width: 45 },
  hmsInput: { color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center', padding: 0 },
  hmsLabel: { color: '#555', fontSize: 10, fontWeight: 'bold' },

  resetBtn: { marginTop: 40, alignItems: 'center', padding: 20 },

  // Header Styles
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 15 },
  logoGroup: { flexDirection: 'row', alignItems: 'center' },
  playBox: { backgroundColor: '#FF0000', width: 28, height: 20, borderRadius: 5, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  logoText: { color: '#fff', fontSize: 20, fontWeight: 'bold', letterSpacing: -1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: { marginLeft: 20 },
});

function YouTubeHeader({ onTourPress }) {
  const router = useRouter();
  return (
    <View style={ds.headerRow}>
      <View style={ds.logoGroup}>
        <View style={ds.playBox}>
          <Ionicons name="play" size={14} color="#fff" style={{ marginLeft: 2 }} />
        </View>
        <Text style={ds.logoText}>TimerDigi</Text>
      </View>
      <View style={ds.headerIcons}>
        <TouchableOpacity onPress={onTourPress}>
          <Ionicons name="help-circle" size={26} color="#aaa" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/social')}>
          <Ionicons name="people" size={26} color="#FF0000" style={ds.headerIcon} />
        </TouchableOpacity>
        <Ionicons name="notifications-outline" size={24} color="#fff" style={ds.headerIcon} />
      </View>
    </View>
  );
}

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