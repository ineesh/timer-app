import {
  getUsageByApps,
  hasUsageAccess,
  openUsageAccessSettings,
} from "react-native-app-usage-stats";

// We store this OUTSIDE the function so it persists between 1-second ticks
let previousUsageSeconds = 0;

const checkYouTube = async () => {
  try {
    // 1. Permission Check
    const granted = await hasUsageAccess();
    if (!granted) {
      console.log("Permission required: Redirecting...");
      openUsageAccessSettings();
      return false;
    }

    // 2. Fetch YouTube usage for "1" day (today)
    // getUsageByApps returns an ARRAY of objects
    const statsArray = await getUsageByApps(["com.google.android.youtube"], 1);

    if (statsArray && statsArray.length > 0) {
      const ytData = statsArray[0]; // Get the first (and only) item
      const currentUsage = ytData.usage; // Total seconds YouTube was open today

      // 3. LOGIC: If 'usage' is higher than it was 1 second ago, 
      // it means the user is currently looking at YouTube.
      const isIncreasing = currentUsage > previousUsageSeconds;

      // Debugging: See the seconds tick up in your terminal
      if (isIncreasing) {
        console.log(`YouTube Active. Total today: ${currentUsage}s`);
      }

      // Update the global variable for the next tick
      previousUsageSeconds = currentUsage;

      return isIncreasing;
    }

    return false;
  } catch (e) {
    console.error("Native Bridge Error in checkYouTube:", e);
    return false;
  }
};

export default checkYouTube;