import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import {
  parentLogin,
  getApiBase,
  getDefaultApiBase,
  setApiBase,
} from "../lib/api";
import { registerForPushAsync, showLocalDemoNotification } from "../lib/notifications";

export default function LoginScreen({ onLoggedIn }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("parent123");
  const [serverUrl, setServerUrl] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setServerUrl(await getApiBase());
    })();
  }, []);

  async function submit() {
    setErr("");
    setInfo("");
    setBusy(true);
    try {
      if (serverUrl && serverUrl.trim()) {
        await setApiBase(serverUrl.trim());
      }
      await parentLogin(phone.trim(), password);
      const push = await registerForPushAsync();
      if (push.ok && push.remotePush) {
        setInfo("Signed in · notifications enabled");
      } else if (push.expoGoLimited) {
        setInfo("Signed in · use APK for remote notifications");
      } else {
        setInfo(`Signed in · ${push.error || "use Register for HOD push on home"}`);
      }
      try {
        await showLocalDemoNotification({
          title: "Welcome to BVU Parent",
          body: "You are signed in.",
          showAlertFallback: false,
        });
      } catch (_) {}
      onLoggedIn?.();
    } catch (e) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>BVU Parent</Text>
        <Text style={styles.sub}>
          Attendance, marks, placement and notices. Works on any network when the college API is
          online.
        </Text>

        {!!err && <Text style={styles.err}>{err}</Text>}
        {!!info && <Text style={styles.info}>{info}</Text>}

        <Text style={styles.label}>Parent mobile</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="Registered mobile number"
          placeholderTextColor="#94a3b8"
          autoComplete="tel"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor="#94a3b8"
        />

        <Pressable onPress={() => setShowServer((v) => !v)}>
          <Text style={styles.link}>
            {showServer ? "Hide server settings" : "Server settings (college IT)"}
          </Text>
        </Pressable>

        {showServer && (
          <View style={styles.serverBox}>
            <Text style={styles.label}>API server URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://api.yourcollege.edu"
              placeholderTextColor="#94a3b8"
            />
            <Text style={styles.hintSmall}>
              Production example: https://api.yourcollege.edu{"\n"}
              Built-in default: {getDefaultApiBase()}
            </Text>
          </View>
        )}

        <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#0B1F3A" /> : <Text style={styles.btnText}>Sign in</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B1F3A" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  brand: { fontSize: 28, fontWeight: "800", color: "#F5C542", marginBottom: 8 },
  sub: { color: "#cbd5e1", marginBottom: 20, lineHeight: 20 },
  label: { color: "#e2e8f0", fontWeight: "600", marginBottom: 6 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    fontSize: 16,
    color: "#0f172a",
  },
  btn: {
    backgroundColor: "#F5C542",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#0B1F3A", fontWeight: "800", fontSize: 16 },
  err: {
    backgroundColor: "#fecaca",
    color: "#991b1b",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  info: {
    backgroundColor: "#dcfce7",
    color: "#166534",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  link: { color: "#F5C542", marginBottom: 12, fontWeight: "600" },
  serverBox: {
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  hintSmall: { color: "#94a3b8", fontSize: 11, lineHeight: 16, marginBottom: 8 },
});
