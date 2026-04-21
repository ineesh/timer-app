import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, signInAnonymously, onAuthStateChanged, updateProfile } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyCy0ctueNwLgeaWIffTw6gBlP6OUv-5ekY",
  authDomain: "timer-digi.firebaseapp.com",
  projectId: "timer-digi",
  storageBucket: "timer-digi.firebasestorage.app",
  messagingSenderId: "375666272505",
  appId: "1:375666272505:web:a0efc79efe78d97fe0da28",
  measurementId: "G-J0M3MNY932"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});
const db = getFirestore(app);

// Helper function to sign in anonymously and optionally set an alias
export const ensureAuthenticated = async (alias = null) => {
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    
    // If user provided an alias, update their profile
    if (alias && auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: alias });
      // Create user document in Firestore to hold score
      await setDoc(doc(db, "users", auth.currentUser.uid), {
        displayName: alias,
        dailyScoreSeconds: 0,
        lastUpdated: Date.now()
      }, { merge: true });
    }
    
    return auth.currentUser;
  } catch (error) {
    console.error("Firebase Auth Error:", error);
    return null;
  }
};

export { app, auth, db };
