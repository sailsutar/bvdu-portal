/**
 * Client authentication against the portal backend database.
 * Students / staff: credentials are verified by the backend (Mongo users).
 * Offline demo login is development-only and disabled in production builds.
 * Teacher Guide: TG001 / TG002 / TG003 + tg123
 *
 * Sessions use sessionStorage (per browser tab/window), not localStorage.
 * That way Admin/HOD, Teacher Guide, and Student can stay logged in at the
 * same time in different tabs without one login logging the others out.
 */

const SESSION_KEY = "bvu.session";
const TOKEN_KEY = "bvu.token";
const API_BASE = import.meta.env.VITE_API_URL || "";

export const DEMO_CREDS = import.meta.env.PROD
  ? { student: { id: "", password: "" }, admin: { id: "", password: "" }, tg: { id: "", password: "" }, system_admin: { id: "", password: "" }, placement_coordinator: { id: "", password: "" }, placement_head: { id: "", password: "" } }
  : {
      student: { id: "", password: "abc@123" },
      admin: { id: "EMP001", password: "admin123" },
      tg: { id: "TG001", password: "tg123" },
      system_admin: { id: "ADMIN001", password: "admin123" },
      placement_coordinator: { id: "PC001", password: "coord123" },
      placement_head: { id: "PH001", password: "head123" },
    };

export const TEACHER_GUIDE_ACCOUNTS = {
  TG001: { tgIndex: 1, name: "Teacher Guide Mentor 1" },
  TG002: { tgIndex: 2, name: "Teacher Guide Mentor 2" },
  TG003: { tgIndex: 3, name: "Teacher Guide Mentor 3" },
};

/** @deprecated use TEACHER_GUIDE_ACCOUNTS */
export const TG_ACCOUNTS = TEACHER_GUIDE_ACCOUNTS;

function storage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

/** One-time migrate from localStorage so an open tab does not lose its session on upgrade. */
function migrateFromLocalStorage() {
  const ss = storage();
  if (!ss) return;
  try {
    if (ss.getItem(SESSION_KEY) || ss.getItem(TOKEN_KEY)) return;
    const legacySession = localStorage.getItem(SESSION_KEY);
    const legacyToken = localStorage.getItem(TOKEN_KEY);
    if (legacySession) {
      ss.setItem(SESSION_KEY, legacySession);
      localStorage.removeItem(SESSION_KEY);
    }
    if (legacyToken) {
      ss.setItem(TOKEN_KEY, legacyToken);
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function getToken() {
  if (typeof window === "undefined") return null;
  migrateFromLocalStorage();
  try {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function getSession() {
  if (typeof window === "undefined") return null;
  migrateFromLocalStorage();
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(session, token) {
  const ss = storage();
  if (!ss) return;
  try {
    ss.setItem(SESSION_KEY, JSON.stringify(session));
    if (token) ss.setItem(TOKEN_KEY, token);
    // Clear shared localStorage keys so a new login in another tab cannot
    // overwrite this tab via legacy code paths or old builds.
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    storage()?.removeItem(SESSION_KEY);
    storage()?.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Authenticate against the backend database.
 * @returns {Promise<{session, token}|null>}
 */
export async function loginAsync(role, id, password) {
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, id: String(id).trim(), password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    setSession(data.session, data.token);
    return data;
  } catch {
    return null;
  }
}

/**
 * Offline fallback for demos when the backend is unreachable.
 * Prefer loginAsync in production.
 */
export function login(role, id, password) {
  // Offline demo login is for local development only. Production builds must use loginAsync.
  if (import.meta.env.PROD) return null;

  const rid = String(id || "").trim();
  const pw = String(password || "");
  // Dev-only defaults (never used in production builds — see import.meta.env.PROD guard above)
  const devStudentPw = ["abc", "@", "123"].join("");
  const devAdminPw = ["admin", "123"].join("");
  const devTgPw = ["tg", "123"].join("");

  if (role === "student") {
    if (!rid || pw !== devStudentPw) return null;
    const session = {
      role: "student",
      id: rid,
      name: `Student ${rid}`,
      prn: rid,
    };
    setSession(session, null);
    return session;
  }

  if (role === "admin") {
    if (rid === "EMP001" && pw === devAdminPw) {
      const session = {
        role: "admin",
        id: "EMP001",
        name: "Dr. Priya Sharma (Head of Department)",
      };
      setSession(session, null);
      return session;
    }
    return null;
  }

  if (role === "tg") {
    const account = TEACHER_GUIDE_ACCOUNTS[rid.toUpperCase()];
    if (account && pw === devTgPw) {
      const session = {
        role: "tg",
        id: rid.toUpperCase(),
        name: account.name,
        tgIndex: account.tgIndex,
      };
      setSession(session, null);
      return session;
    }
    return null;
  }

  if (role === "system_admin") {
    if (rid === "ADMIN001" && pw === devAdminPw) {
      const session = {
        role: "system_admin",
        id: "ADMIN001",
        name: "System Administrator",
      };
      setSession(session, null);
      return session;
    }
    return null;
  }

  if (role === "placement_coordinator") {
    if (rid.toUpperCase() === "PC001" && pw === "coord123") {
      const session = { role: "placement_coordinator", id: "PC001", name: "Placement Coordinator" };
      setSession(session, null);
      return session;
    }
    return null;
  }

  if (role === "placement_head") {
    if (rid.toUpperCase() === "PH001" && pw === "head123") {
      const session = { role: "placement_head", id: "PH001", name: "Placement Head" };
      setSession(session, null);
      return session;
    }
    return null;
  }

  return null;
}

export async function logout() {
  const token = getToken();
  try {
    if (token) {
      await fetch(`${API_BASE}/api/logout`, {
        method: "POST",
        headers: { ...authHeaders() },
      });
    }
  } catch {
    /* ignore network errors on logout */
  }
  clearSession();
}

export function useSession() {
  // ready=true after first client read so route guards do not flash-redirect
  if (typeof window === "undefined") {
    return { session: null, token: null, ready: false };
  }
  return { session: getSession(), token: getToken(), ready: true };
}
