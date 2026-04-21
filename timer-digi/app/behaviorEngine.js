// behaviorEngine.js

export default class BehaviorEngine {
  
  /**
   * Main analytical entrypoint.
   * Processes the raw session array into behavioral metrics.
   */
  static process(sessions) {
    if (!sessions || sessions.length === 0) {
      return { habitualLevel: 'None', burstScore: 0, burstIntensity: 'Low', peakHour: null };
    }

    const now = Date.now();

    // 1. Habitual Time Detection (Sliding Window & Weighted Decay)
    const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter(s => s.start >= fourteenDaysAgo);

    // 30-Minute Bucketing (0 to 47)
    // 0 = 12:00AM - 12:30AM, 1 = 12:30AM - 1:00AM
    const timeBuckets = {}; 
    const uniqueDaysInBucket = {};

    recentSessions.forEach(s => {
      const d = new Date(s.start);
      const hour = d.getHours();
      const minutes = d.getMinutes();
      const bucketIdx = (hour * 2) + (minutes >= 30 ? 1 : 0);
      const dateStr = d.toDateString();

      // Decay Weighting: Recent 7 days = 1.0 weight. Older = 0.5 weight.
      const weight = (s.start >= sevenDaysAgo) ? 1.0 : 0.5;

      if (!timeBuckets[bucketIdx]) timeBuckets[bucketIdx] = 0;
      if (!uniqueDaysInBucket[bucketIdx]) uniqueDaysInBucket[bucketIdx] = new Set();
      
      timeBuckets[bucketIdx] += weight;
      uniqueDaysInBucket[bucketIdx].add(dateStr);
    });

    let peakBucketIdx = -1;
    let maxWeight = 0;
    for (let b = 0; b < 48; b++) {
      if (timeBuckets[b] && timeBuckets[b] > maxWeight) {
        maxWeight = timeBuckets[b];
        peakBucketIdx = b;
      }
    }

    // Determine Confidence Levels
    let habitualLevel = 'None';
    let peakHour = null;
    let peakMinutes = null;

    if (peakBucketIdx !== -1) {
      const daysFired = uniqueDaysInBucket[peakBucketIdx].size;
      const totalActiveDays = new Set(recentSessions.map(s => new Date(s.start).toDateString())).size;
      const hitRatio = totalActiveDays > 0 ? (daysFired / totalActiveDays) : 0;
      
      if (hitRatio >= 0.7 && maxWeight >= 4.0) {
        habitualLevel = 'Strong habit';
      } else if (hitRatio >= 0.5 && maxWeight >= 2.0) {
        habitualLevel = 'Emerging pattern';
      }

      if (habitualLevel !== 'None') {
        peakHour = Math.floor(peakBucketIdx / 2);
        peakMinutes = (peakBucketIdx % 2 === 0) ? "00" : "30";
      }
    }

    // 2. Dopamine Burst Intensity Detection
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let todaySessions = sessions.filter(s => s.start >= todayStart.getTime()).sort((a, b) => a.start - b.start);

    let burstTotalCount = 0;
    let burstWindowStart = -1;

    for (let i = 0; i < todaySessions.length; i++) {
      const s = todaySessions[i];
      const durationMin = (s.end - s.start) / 60000;

      if (durationMin < 7) {
        if (i === 0) {
          burstTotalCount++;
          burstWindowStart = s.start;
        } else {
          const prev = todaySessions[i - 1];
          const inactiveMin = (s.start - prev.end) / 60000;
          if (inactiveMin < 15) {
             burstTotalCount++;
          } else {
             // Reset window if break was too long, but keep count if tracking cumulative
             burstWindowStart = s.start;
          }
        }
      }
    }

    let burstIntensity = 'Low';
    if (burstTotalCount >= 6) burstIntensity = 'High';
    else if (burstTotalCount >= 3) burstIntensity = 'Medium';

    return {
      habitualLevel,
      peakHour,
      peakMinutes,
      burstScore: burstTotalCount,
      burstIntensity,
      totalOpens: todaySessions.length
    };
  }

  /**
   * Real-time checker to see if the current exact time matches the user's Peak habitual window.
   */
  static isCurrentlyInPeakWindow(peakHour, peakMinutes) {
    if (peakHour === null) return false;
    
    const d = new Date();
    const currentHour = d.getHours();
    const currentMins = d.getMinutes();
    
    // Convert current time to bucket
    const currentBucket = (currentHour * 2) + (currentMins >= 30 ? 1 : 0);
    const peakBucket = (peakHour * 2) + (peakMinutes === "30" ? 1 : 0);

    // We allow intercepting literally inside the 30 min bucket or exactly 10 mins before it
    const msToPeakStart = new Date();
    msToPeakStart.setHours(peakHour, parseInt(peakMinutes), 0, 0);
    const diffMins = (msToPeakStart.getTime() - d.getTime()) / 60000;

    return (currentBucket === peakBucket) || (diffMins > 0 && diffMins <= 10);
  }

}
