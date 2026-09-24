import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { api } from "../lib/api";
import { showLocalDemoNotification } from "../lib/notifications";

export default function ChildScreen({ route }) {
  const prn = route.params?.prn;
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/api/parent/children/${encodeURIComponent(prn)}`);
        if (!cancelled) {
          setD(data);
          if (data.attendance != null && Number(data.attendance) < 75) {
            await showLocalDemoNotification({
              title: "Attendance alert",
              body: `${data.name || "Student"} attendance is ${data.attendance}% (below 75%).`,
              data: { prn: data.prn },
            });
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prn]);

  if (err) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{err}</Text>
      </View>
    );
  }
  if (!d) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0B1F3A" />
      </View>
    );
  }

  const pl = d.placement || {};

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.name}>{d.name || d.prn}</Text>
      <Text style={styles.meta}>
        PRN {d.prn}
        {d.yearLevel ? ` · ${d.yearLevel}` : ""}
        {d.batch ? ` · Batch ${d.batch}` : ""}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Attendance</Text>
        <Text style={styles.big}>{d.attendance != null ? `${d.attendance}%` : "—"}</Text>
        {d.attendance != null && Number(d.attendance) < 75 ? (
          <Text style={styles.warn}>Below 75% — parent alert shown</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Marks</Text>
        <Text style={styles.line}>
          Overall average: {d.averagePercentage != null ? `${d.averagePercentage}%` : "—"} · Status:{" "}
          {d.status || "—"}
        </Text>
        {(d.marks || []).map((m) => (
          <View key={m.subject} style={styles.markRow}>
            <Text style={styles.subject}>{m.subject}</Text>
            <Text style={styles.markVals}>
              UT1 {m.ut1 ?? "—"} · UT2 {m.ut2 ?? "—"} · UT3 {m.ut3 ?? "—"}
            </Text>
          </View>
        ))}
        {!(d.marks || []).length && <Text style={styles.muted}>No unit test marks yet.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Placement / career</Text>
        {!pl.available ? (
          <Text style={styles.muted}>{pl.message || "Not available yet."}</Text>
        ) : (
          <>
            <Text style={styles.line}>
              Mode: {pl.mode === "prediction" ? "Readiness (TY/LY)" : "Preparation (FY/SY)"}
            </Text>
            {pl.readinessBand ? (
              <Text style={styles.line}>
                Readiness: {pl.readinessBand}
                {pl.readinessScore != null ? ` (${Math.round(pl.readinessScore)})` : ""}
              </Text>
            ) : null}
            {pl.topDomain ? <Text style={styles.line}>Top domain: {pl.topDomain}</Text> : null}
            {(pl.domains || []).length > 0 ? (
              <Text style={styles.line}>Domains: {(pl.domains || []).join(", ")}</Text>
            ) : null}
            {(pl.actions || []).map((a, i) => (
              <Text key={i} style={styles.action}>
                • {a}
              </Text>
            ))}
          </>
        )}
      </View>

      <Pressable
        style={styles.shareBtn}
        onPress={() =>
          showLocalDemoNotification({
            title: d.name || "Student",
            body: `Attendance ${d.attendance ?? "—"}% · Avg ${d.averagePercentage ?? "—"}%`,
          })
        }
      >
        <Text style={styles.shareBtnText}>Notify me about this summary</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f1f5f9" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  err: { color: "#b91c1c" },
  name: { fontSize: 22, fontWeight: "800", color: "#0B1F3A" },
  meta: { color: "#64748b", marginTop: 4, marginBottom: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardTitle: { fontWeight: "800", color: "#0B1F3A", marginBottom: 8, fontSize: 15 },
  big: { fontSize: 32, fontWeight: "800", color: "#0B1F3A" },
  warn: { marginTop: 8, color: "#b45309", fontWeight: "600" },
  line: { color: "#0f172a", marginBottom: 6, lineHeight: 20 },
  markRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  subject: { fontWeight: "700", color: "#0B1F3A" },
  markVals: { color: "#475569", marginTop: 2, fontSize: 13 },
  muted: { color: "#64748b" },
  action: { color: "#0f172a", marginTop: 4 },
  shareBtn: {
    backgroundColor: "#0B1F3A",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  shareBtnText: { color: "#F5C542", fontWeight: "800" },
});
