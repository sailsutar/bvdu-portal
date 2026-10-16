import { authHeaders } from "@/lib/auth";

const API_BASE = "";

/** Default fetch timeout — mobile hotspots need more than a few seconds. */
const DEFAULT_TIMEOUT_MS = 45000;

/**
 * API helper: returns parsed JSON (not a raw Response).
 * Used across placement, admin, student routes as `api(path).then(data => ...)`.
 */
export async function api(path, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { timeoutMs: _drop, ...rest } = options;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
        ...(rest.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("Request timed out — weak network or database still connecting. Try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Same as api — kept for callers that use the name apiJson */
export async function apiJson(path, options = {}) {
  return api(path, options);
}

/** Download a text/blob file in the browser */
export function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Convert array of objects to CSV string */
export function toCsv(rows, columns) {
  const cols =
    Array.isArray(columns) && columns.length
      ? columns
      : rows.length
        ? Object.keys(rows[0])
        : [];
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = cols.map(esc).join(",");
  const body = (rows || [])
    .map((row) => cols.map((c) => esc(typeof row === "object" ? row[c] : "")).join(","))
    .join("\n");
  return header + (body ? "\n" + body : "");
}
