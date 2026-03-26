import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  AppState,
  Alert
} from "react-native";
import checkYouTube from "./app_open_old.jsx";

export default function App() {
  // 1. STATE: Short-term memory for your timer
  const [seconds, setSeconds] = useState(0);
  const [checkyt, setcheckyt] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);
  // checks the app in foreground or background
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      setAppState(nextAppState);
      if (nextAppState == "active") {
        
        // The user just came back from Settings!
        setcheckyt(false);
        console.log("App is back in focus - Refreshing permissions...");
      }
    });

    return () => subscription.remove();
  }, []);



  // 2. EFFECT: The "Engine" that runs in the background
  useEffect(() => {
    let interval = null;
    let detectint = null;
    const CheckYT = setInterval(async () => {
      let tmp = await checkYouTube();
      setcheckyt(tmp);
    }, 2000);

    if(appState !== "active"){
      detectint = setInterval(async () => {
      let tmp = await checkYouTube();
      setcheckyt(tmp);
      }, 2000);

    }
    if (checkyt) {
      interval = setInterval(() => {
        // console.log(checkyt)
        // This adds 1 to the current time every 1000ms (1 second)
        setSeconds((prevSeconds) => prevSeconds + 1);
      }, 1000);
    }
    return () => {
      clearInterval(CheckYT);
      if (interval) clearInterval(interval);
    }; // Cleanup: stops the timer if you close the app
  }, [checkyt, AppState]); // Only re-run this effect if 'checkyt' changes

  return (
    <View style={styles.container}>
      <Text style={styles.title}>YouTube Tracker</Text>

      {/* 3. LOGIC: Format seconds into MM:SS */}
      <Text style={styles.timer}>
        {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}
      </Text>
    </View>
  );
}

// 4. STYLING: Basically CSS for Mobile
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#888", fontSize: 20, marginBottom: 10 },
  timer: { color: "#fff", fontSize: 80, fontWeight: "bold", marginBottom: 40 },
  button: { paddingVertical: 15, paddingHorizontal: 40, borderRadius: 10 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});
