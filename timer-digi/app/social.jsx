import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { auth, db, ensureAuthenticated } from '../firebaseConfig';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, arrayUnion, onSnapshot } from 'firebase/firestore';
import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV();

const getTodayTotal = () => {
  try {
    const sessionsRaw = storage.getString('ytSessions') || '[]';
    const sessions = JSON.parse(sessionsRaw);
    const m = new Date(); m.setHours(0,0,0,0);
    return Math.floor(sessions.filter(s => s.start >= m.getTime()).reduce((acc, s) => acc + (s.end - s.start)/1000, 0));
  } catch(e){
    return 0;
  }
};

export default function SocialScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [alias, setAlias] = useState('');
  const [user, setUser] = useState(auth.currentUser);
  
  const [groupId, setGroupId] = useState(''); // When typing to join
  const [activeGroup, setActiveGroup] = useState(null); // The group they are in
  const [leaderboard, setLeaderboard] = useState([]);

  // Load user session on mount
  useEffect(() => {
    const checkAuth = auth.onAuthStateChanged(async (u) => {
      if (u) {
        setUser(u);
        setAlias(u.displayName || '');
        await checkMembership(u.uid);
      } else {
        setLoading(false);
      }
    });
    return () => checkAuth();
  }, []);

  const checkMembership = async (uid) => {
    try {
      const userDoc = await getDoc(doc(db, "users", uid));
      
      // Auto-sync their current local score instantly
      await setDoc(doc(db, "users", uid), {
        dailyScoreSeconds: getTodayTotal(),
        lastUpdated: Date.now()
      }, { merge: true }).catch(()=>{});

      if (userDoc.exists() && userDoc.data().groupId) {
        loadGroup(userDoc.data().groupId);
      } else {
        setLoading(false);
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const loadGroup = async (gId) => {
    try {
      const groupDoc = await getDoc(doc(db, "groups", gId));
      if (groupDoc.exists()) {
        setActiveGroup({ id: gId, ...groupDoc.data() });
        // Set up real-time listener for leaderboard
        const q = query(collection(db, "users"), where("groupId", "==", gId));
        onSnapshot(q, (snapshot) => {
          const players = [];
          snapshot.forEach((d) => players.push({ id: d.id, ...d.data() }));
          // Sort by lowest time (best focus)
          players.sort((a, b) => (a.dailyScoreSeconds || 0) - (b.dailyScoreSeconds || 0));
          setLeaderboard(players);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleCreateAlias = async () => {
    if (alias.trim().length < 3) return alert("Alias must be at least 3 characters.");
    setLoading(true);
    const u = await ensureAuthenticated(alias.trim());
    if (u) {
      setUser(u);
      checkMembership(u.uid);
    } else {
      alert("Failed to initialize account");
    }
    setLoading(false);
  };

  const createGroup = async () => {
    setLoading(true);
    const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      await setDoc(doc(db, "groups", newId), {
        name: `${alias}'s Room`,
        createdAt: Date.now(),
        expiresAt: new Date(Date.now() + 86400000) // Expires in 24 hours
      });
      await setDoc(doc(db, "users", user.uid), { groupId: newId }, { merge: true });
      loadGroup(newId);
    } catch (error) {
      console.error(error);
      alert("Error creating group.");
      setLoading(false);
    }
  };

  const joinGroup = async () => {
    if (!groupId) return;
    setLoading(true);
    const gId = groupId.toUpperCase();
    try {
      const groupDoc = await getDoc(doc(db, "groups", gId));
      if (groupDoc.exists()) {
        const data = groupDoc.data();
        if (data.createdAt && (Date.now() - data.createdAt > 86400000)) {
          alert("This room code has expired (24h limit).");
          setLoading(false);
          return;
        }
        await setDoc(doc(db, "users", user.uid), { groupId: gId }, { merge: true });
        loadGroup(gId);
      } else {
        alert("Group not found!");
        setLoading(false);
      }
    } catch (e) {
      console.error(e);
      alert("Error joining group");
      setLoading(false);
    }
  };

  const leaveGroup = async () => {
    setLoading(true);
    try {
      await setDoc(doc(db, "users", user.uid), { groupId: null }, { merge: true });
      setActiveGroup(null);
      setLeaderboard([]);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const formatTime = (totalSeconds) => {
    if (!totalSeconds) return "0m";
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF0000" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60, flexGrow: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginLeft: 10 }}>Dashboard</Text>
        </TouchableOpacity>
      </View>

      {!user ? (
        <View style={styles.card}>
          <Text style={styles.title}>Welcome to Multiplayer</Text>
          <Text style={styles.subtitle}>Compete with friends to keep your YouTube screen time lowest.</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Enter a cool alias/username"
            placeholderTextColor="#666"
            value={alias}
            onChangeText={setAlias}
          />
          <TouchableOpacity style={styles.btnPrimary} onPress={handleCreateAlias}>
            <Text style={styles.btnText}>Join Ecosystem</Text>
          </TouchableOpacity>
        </View>
      ) : activeGroup ? (
        <View>
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={styles.title}>{activeGroup.name}</Text>
                <Text style={styles.subtitle}>Room Code: <Text style={{ color: '#fff', fontWeight: 'bold' }}>{activeGroup.id}</Text></Text>
              </View>
              <TouchableOpacity onPress={leaveGroup}>
                <Ionicons name="exit-outline" size={24} color="#FF0000" />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[styles.title, { marginTop: 30, marginBottom: 15, fontSize: 18 }]}>🏆 Live Leaderboard</Text>
          <Text style={[styles.subtitle, { marginBottom: 20 }]}>Ranked by Lowest Screen Time Today</Text>

          {leaderboard.map((player, idx) => (
            <View key={player.id} style={[styles.playerCard, player.id === user.uid && styles.playerMe]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : '#888', fontSize: 20, fontWeight: 'bold', width: 30 }}>
                  #{idx + 1}
                </Text>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>
                  {player.displayName} {player.id === user.uid && '(You)'}
                </Text>
              </View>
              <Text style={{ color: '#FF0000', fontSize: 16, fontWeight: 'bold' }}>
                {formatTime(player.dailyScoreSeconds)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.title}>No Active Room</Text>
          <Text style={styles.subtitle}>Create a room or join a friend's room.</Text>

          <TouchableOpacity style={styles.btnPrimary} onPress={createGroup}>
            <Text style={styles.btnText}>Create New Room</Text>
          </TouchableOpacity>

          <View style={{ height: 1, backgroundColor: '#333', marginVertical: 30 }} />

          <TextInput
            style={styles.input}
            placeholder="Enter 6-Digit Room Code"
            placeholderTextColor="#666"
            autoCapitalize="characters"
            maxLength={6}
            value={groupId}
            onChangeText={setGroupId}
          />
          <TouchableOpacity style={[styles.btnPrimary, { backgroundColor: '#333' }]} onPress={joinGroup}>
            <Text style={styles.btnText}>Join Room</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 24,
  },
  header: {
    marginTop: 50,
    marginBottom: 40,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 25,
    padding: 25,
    borderWidth: 1,
    borderColor: '#222',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 15,
    color: '#fff',
    padding: 16,
    fontSize: 16,
    marginBottom: 20,
  },
  btnPrimary: {
    backgroundColor: '#FF0000',
    borderRadius: 15,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#FF0000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  playerCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#222',
  },
  playerMe: {
    borderColor: '#FF0000',
    backgroundColor: 'rgba(255, 0, 0, 0.05)',
  }
});
