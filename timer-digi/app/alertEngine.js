import { createMMKV } from 'react-native-mmkv';
import BehaviorEngine from './behaviorEngine';

const storage = createMMKV();

export default {
    evaluate: (sessions, limitSeconds, todaySeconds) => {
        const now = Date.now();
        const lastAlertTime = storage.getNumber('lastAlertTime') || 0;
        const lastAlertType = storage.getString('lastAlertType') || '';
        
        // 1. LIMIT EXCEEDED (100%) - Bypasses Cooldown
        if (todaySeconds >= limitSeconds) {
            storage.set('lastAlertTime', now);
            storage.set('lastAlertType', 'LIMIT_EXCEEDED');
            return {
                type: 'LIMIT_EXCEEDED',
                title: "You've reached your limit",
                message: "You've spent " + Math.floor(todaySeconds/60) + " minutes on YouTube today. Time to log off.",
                primaryBtn: "Close YouTube", // Exits app
                secondaryBtn: "Continue after 10s",
                delaySecondary: 10,
                isBlocking: true
            };
        }

        // 1.5 LIMIT WARNING (80% - 90%) -> Bypass standard cooldown if previous wasn't also Limit
        if (todaySeconds >= limitSeconds * 0.8 && lastAlertType !== 'LIMIT_WARNING') {
            storage.set('lastAlertTime', now);
            storage.set('lastAlertType', 'LIMIT_WARNING');
            return {
                type: 'LIMIT_WARNING',
                title: "You're close to your daily limit",
                message: `You've used over 80% of your requested focus time today.`,
                primaryBtn: "Take a break",
                secondaryBtn: "Continue",
                delaySecondary: 5,
                isBlocking: true
            };
        }

        // --- ENFORCE GLOBAL COOLDOWN (12 mins) FOR REMAINING ALERTS ---
        // Avoids spamming the user across rapid open/closes
        if (now - lastAlertTime < 12 * 60 * 1000) {
            return null; // Return nothing, suppress all soft alerts
        }

        // 2. BURST ALERT
        const metrics = BehaviorEngine.process(sessions);
        
        // Ensure the burst is happening *right now* (within last 15 mins) and the score matches the dashboard.
        const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
        const isActiveBurst = lastSession && (now - lastSession.end) < 15 * 60 * 1000;

        if (isActiveBurst && (metrics.burstIntensity === 'High' || metrics.burstIntensity === 'Medium')) { 
            storage.set('lastAlertTime', now);
            storage.set('lastAlertType', 'BURST');
            return {
                type: 'BURST',
                title: "You've been opening frequently",
                message: `Your behavior engine shows a ${metrics.burstIntensity} burst pattern today. Take a break to reset.`,
                primaryBtn: "Take a break",
                secondaryBtn: "Continue",
                delaySecondary: 5,
                isBlocking: true
            };
        }

        // 3. HABIT ALERT
        if (metrics.habitualLevel !== 'None' && BehaviorEngine.isCurrentlyInPeakWindow(metrics.peakHour, metrics.peakMinutes)) {
             storage.set('lastAlertTime', now);
             storage.set('lastAlertType', 'HABIT');
             return {
                 type: 'HABIT',
                 title: "You usually open around this time",
                 message: "This is your usual usage window. Consider substituting this habit with a walk or water break.",
                 primaryBtn: "Take a break",
                 secondaryBtn: "Continue",
                 delaySecondary: 2,
                 isBlocking: false // Soft alert format
             };
        }

        // 4. ENTRY ALERT (Default) - CURRENTLY DISABLED PER USER REQUEST
        /*
        storage.set('lastAlertTime', now);
        storage.set('lastAlertType', 'ENTRY');
        return {
             type: 'ENTRY',
             title: "You just opened YouTube",
             message: "Focus mode is tracking your activity.",
             primaryBtn: "Close App",
             secondaryBtn: "Continue",
             delaySecondary: 2,
             isBlocking: false // Soft alert format
        };
        */
        
        return null;
    }
}
