import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../lib/api";

export default function NoticesScreen() {
  const [notices, setNotices] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await api("/api/parent/notices");
      setNotices(r.notices || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0B1F3A" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!!err && <Text style={styles.err}>{err}</Text>}
      <FlatList
        data={notices}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No notices yet. From HOD/admin portal you can post announcements; staff can also call
            POST /api/parent/demo-notify to push a demo notice.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
            {item.createdAt ? (
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f1f5f9" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  err: { margin: 16, color: "#b91c1c" },
  empty: { textAlign: "center", color: "#64748b", marginTop: 40, paddingHorizontal: 20, lineHeight: 20 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  title: { fontWeight: "800", color: "#0B1F3A", marginBottom: 8 },
  body: { color: "#0f172a", lineHeight: 20 },
  date: { marginTop: 10, color: "#94a3b8", fontSize: 12 },
});
