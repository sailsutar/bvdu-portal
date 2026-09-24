import { authHeaders, getToken } from "@/lib/auth";

const API_BASE = import.meta.env.VITE_API_URL || "";

function versionKey(key) {
  return `bvu.remote.ver.${key}`;
}

/** Load shared state; falls back to localStorage if API unavailable */
export async function loadRemoteState(key, fallback = null) {
  if (typeof window === "undefined") return fallback;
  const localKey = `bvu.remote.${key}`;
  try {
    if (getToken()) {
      const res = await fetch(`${API_BASE}/api/intelligence/${encodeURIComponent(key)}`, {
        headers: { ...authHeaders() },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.value != null) {
          localStorage.setItem(localKey, JSON.stringify(data.value));
          if (data.version != null) localStorage.setItem(versionKey(key), String(data.version));
          return data.value;
        }
      }
    }
  } catch {
    /* offline */
  }
  try {
    const raw = localStorage.getItem(localKey);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Save shared state (Mongo-first). Sends expectedVersion when known.
 * On 409 conflict, overwrites local mirror with server value and returns { conflict: true }.
 */
export async function saveRemoteState(key, value) {
  if (typeof window === "undefined") return { ok: false };
  const localKey = `bvu.remote.${key}`;
  localStorage.setItem(localKey, JSON.stringify(value));
  try {
    if (getToken()) {
      const expectedRaw = localStorage.getItem(versionKey(key));
      const expectedVersion = expectedRaw != null ? Number(expectedRaw) : undefined;
      const body = { value };
      if (Number.isFinite(expectedVersion) && expectedVersion > 0) {
        body.expectedVersion = expectedVersion;
      }
      const res = await fetch(`${API_BASE}/api/intelligence/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data.value != null) {
          localStorage.setItem(localKey, JSON.stringify(data.value));
          if (data.version != null) localStorage.setItem(versionKey(key), String(data.version));
        }
        return { ok: false, conflict: true, value: data.value, version: data.version };
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.version != null) localStorage.setItem(versionKey(key), String(data.version));
        return { ok: true, version: data.version };
      }
    }
  } catch {
    /* kept in localStorage */
  }
  return { ok: true, offline: true };
}

/** Sync read for existing sync call sites — uses local cache only */
export function readLocalMirror(key, fallback = null) {
  try {
    const raw = localStorage.getItem(`bvu.remote.${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
