import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const TOKEN_KEY = "bvu.parent.token";
const SESSION_KEY = "bvu.parent.session";
const API_BASE_KEY = "bvu.parent.apiBase";

/**
 * Production: set expo.extra.apiBaseUrl in app.json to your public HTTPS API
 * Demo/LAN: http://PC_IP:4000
 * Override: Server settings on login screen (saved on device)
 */
export function getDefaultApiBase() {
  const extra = Constants.expoConfig?.extra?.apiBaseUrl;
  if (extra && String(extra).trim()) return String(extra).replace(/\/$/, "");
  return "https://YOUR_PUBLIC_API_HOST";
}

export async function getApiBase() {
  try {
    const saved = await AsyncStorage.getItem(API_BASE_KEY);
    if (saved && String(saved).trim()) return String(saved).replace(/\/$/, "");
  } catch (_) {}
  return getDefaultApiBase();
}

export async function setApiBase(url) {
  const clean = String(url || "").trim().replace(/\/$/, "");
  if (!clean) {
    await AsyncStorage.removeItem(API_BASE_KEY);
    return getDefaultApiBase();
  }
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error("Server URL must start with http:// or https://");
  }
  await AsyncStorage.setItem(API_BASE_KEY, clean);
  return clean;
}

export async function saveAuth(token, session) {
  await AsyncStorage.setItem(TOKEN_KEY, token || "");
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session || {}));
}

export async function clearAuth() {
  await AsyncStorage.multiRemove([TOKEN_KEY, SESSION_KEY]);
}

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getSession() {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function api(path, options = {}) {
  const token = await getToken();
  const base = await getApiBase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function parentLogin(phone, password) {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/parent/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Login failed");
  await saveAuth(data.token, data.session);
  return data;
}
