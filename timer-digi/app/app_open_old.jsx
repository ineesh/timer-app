import {
  getUsageByApps,
  getUsageStats,
  hasUsageAccess,
  openUsageAccessSettings,
  ToastAndroid,
} from "react-native-app-usage-stats";
// import * as UsageStats from 'react-native-app-usage-stats';
// console.log("UsageStats Library Keys:", Object.keys(UsageStats));

// const checkYouTube = async () => {
//   // 1. Check if we even have permission
//   const granted = await hasUsageAccess();
//   if (!granted) {
//     openUsageAccessSettings(); // Send them to settings
//     return false;
//   }else{
//     console.log(granted);
//   }

//   // 2. Query the system for YouTube's usage in the last 2 seconds
//   const now = Date.now();
//   const stats = await getUsageByApps(['com.google.android.youtube'], 0.01);
// //   const stats = await getUsageByApps(
// //     ['com.google.android.youtube'],
// //     now - 30000, // Start time (2 seconds ago)
// //     now        // End time (now)
// //   );
// //   console.log("YouTube Stats Package:", stats[0]?.packageName);
// //   console.log("Usage Time (ms):", stats[0]?.usage);
// console.log("Full Stats Object:", JSON.stringify(stats));

//   // 3. If "usage" is greater than 0, YouTube is the active app!
//   if (stats && stats.length > 0 && stats[0].usage > 0) {

//     return true;
//   }
//   return false;
const checkYouTube = async () => {
  try {
    const granted = await hasUsageAccess();
    if (!granted) {
      // Don't just return false; let the user know WHY it's not working
      console.log("permisiion req");
      openUsageAccessSettings();
      return false;
    }
    const now = Date.now();
    
    // 1. Look back at the last 30 seconds of activity
    // const stats = await getUsageStats({
    //   startTime: now - 30000, 
    //   endTime: now,
    // });
    // const ytApp = stats.find(s => s.packageName === 'com.google.android.youtube');
    const ytApp = await getUsageByApps(["com.google.android.youtube"], 1);
    console.log("working");

    // if (stats?.length > 0) {
    //   const now = Date.now();
    //   const lastUsed = stats[0].lastTimeUsed;
    //   if (now - lastUsed < 4000) {
    //     ToastAndroid.show("Timer Started: YouTube Active", ToastAndroid.SHORT);
    //     console.log(now - lastUsed);
    //     return true;
    //   }
    // }
    if (ytApp) {
      // 3. LOGIC FIX: Check if YouTube was used in the last 10 seconds.
      // This accounts for the Android OS delay in updating the stats.
      const isRecentlyUsed = (now - ytApp.lastTimeUsed) < 10000;
      
      console.log(`YT Last Used: ${ytApp.lastTimeUsed}, Diff: ${now - ytApp.lastTimeUsed}ms`);
      
      return isRecentlyUsed;
    }
    return false;
  } catch (e) {
    console.error("Native Bridge Error:", e);
  }
  return false;
};
// };
export default checkYouTube;
