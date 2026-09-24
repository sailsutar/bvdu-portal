import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api, clearAuth, getSession } from "../lib/api";
import { showLocalDemoNotification, isExpoGo, registerForPushAsync } from "../lib/notifications";

export default function HomeScreen({ navigation }) {
  const [children, setChildren] = useState([]);
  const [session, setSession] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [demoMsg, setDemoMsg] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      setSession(await getSession());
      const r = await api("/api/parent/children");
      setChildren(r.children || []);
    } catch (e) {
      setErr(e.message);
      if (e.status === 401) {
        await clearAuth();
        navigation.replace("Login");
      }
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function logout() {
    await clearAuth();
    navigation.replace("Login");
  }

  async function demoAlert() {
    setDemoMsg("");
    const first = children[0];
    const result = await showLocalDemoNotification({
      title: first ? `${first.name || "Student"} update` : "BVU Parent demo",
      body: first
        ? `Attendance ${first.attendance != null ? first.attendance + "%" : "—"} · Status ${first.status || "—"}`
        : "Open a child card for full academic and placement details.",
      data: { screen: "Home" },
    });
    setDemoMsg(
      result.scheduled
        ? "Local system notification scheduled + in-app popup."
        : `In-app popup shown (${result.scheduleError || "OS banner limited in Expo Go"}).`
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0B1F3A" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>My children</Text>
          <Text style={styles.sub}>{session?.name || "Parent"}</Text>
        </View>
        <Pressable onPress={logout}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Notifications</Text>
        <Text style={styles.bannerText}>
          Local demo works on device. Remote (from HOD website) needs a push token registered once.
        </Text>
        <Pressable
          style={styles.demoBtn}
          onPress={async () => {
            setDemoMsg("Registering…");
            const r = await registerForPushAsync();
            if (r.ok && r.remotePush) {
              setDemoMsg("Remote push registered. Now send from HOD Parent bot.");
            } else {
              setDemoMsg(r.error || r.message || "Registration failed");
            }
          }}
        >
          <Text style={styles.demoBtnText}>Register for HOD push</Text>
        </Pressable>
        <Pressable style={[styles.demoBtn, { marginTop: 8, backgroundColor: "#334155" }]} onPress={demoAlert}>
          <Text style={styles.demoBtnText}>Show local demo notification</Text>
        </Pressable>
        {!!demoMsg && <Text style={styles.demoMsg}>{demoMsg}</Text>}
      </View>

      {!!err && <Text style={styles.err}>{err}</Text>}

      <FlatList
        data={children}
        keyExtractor={(item) => String(item.prn)}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No students linked. Save this mobile under System Admin → Contact details for a PRN.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate("Child", { prn: item.prn, name: item.name })}
          >
            <Text style={styles.cardName}>{item.name || item.prn}</Text>
            <Text style={styles.cardMeta}>PRN {item.prn}</Text>
            <Text style={styles.cardMeta}>
              {[item.yearLevel, item.batch ? `Batch ${item.batch}` : null].filter(Boolean).join(" · ") ||
                "—"}
            </Text>
            <Text style={styles.cardStats}>
              Attendance: {item.attendance != null ? `${item.attendance}%` : "—"} · Status:{" "}
              {item.status || "—"}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f1f5f9" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: "#0B1F3A",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  sub: { color: "#94a3b8", marginTop: 4, fontSize: 13 },
  logout: { color: "#F5C542", fontWeight: "700" },
  banner: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  bannerTitle: { fontWeight: "800", color: "#0B1F3A", marginBottom: 6 },
  bannerText: { color: "#475569", fontSize: 13, lineHeight: 18 },
  demoBtn: {
    marginTop: 12,
    backgroundColor: "#0B1F3A",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  demoBtnText: { color: "#F5C542", fontWeight: "700" },
  demoMsg: { marginTop: 10, color: "#166534", fontSize: 12 },
  err: { margin: 16, color: "#b91c1c", backgroundColor: "#fee2e2", padding: 10, borderRadius: 8 },
  empty: {
    textAlign: "center",
    color: "#64748b",
    marginTop: 40,
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardName: { fontSize: 17, fontWeight: "700", color: "#0B1F3A" },
  cardMeta: { color: "#64748b", marginTop: 4, fontSize: 13 },
  cardStats: { marginTop: 10, color: "#0f172a", fontWeight: "600", fontSize: 13 },
});
