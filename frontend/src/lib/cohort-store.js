/**
 * Server-backed academic cohort (marks + attendance + class).
 * Any size (100, 400, 2000+) is uploaded in chunks until every row is on Atlas.
 * localStorage is offline cache only — source of truth is MongoDB Atlas.
 *
 * Cross-device: always use VITE_API_URL (same as login). Never hardcode "".
 * HTTP cache is disabled so phone/desktop always see the latest Atlas rows.
 */
import { getSession, authHeaders } from "@/lib/auth";

const EVENT = "bvu.cohort.updated";
const LS_KEY = "bvu.cohort.cache.v1";
/** Must match auth.js — production web + API are often on different hosts */
const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";
/** Rows per request — small enough for Atlas + weak networks; loop covers unlimited size */
const SYNC_CHUNK = 60;
const FETCH_PAGE = 2000;

let cache = { students: [], loaded: false, source: null, fetchedAt: 0 };
/** Short memory TTL only; every login uses force:true and bypasses this */
const COHORT_TTL_MS = 2 * 60 * 1000;
let inflightFetch = null;

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: cache }));
  } catch {
    /* ignore */
  }
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalCache(students, source) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        students: students || [],
        source: source || "local",
        savedAt: Date.now(),
      })
    );
  } catch {
    /* quota — ignore */
  }
}

export function getCachedCohort() {
  return cache.students?.length ? cache : readLocalCache() || cache;
}

export function hydrateCohortFromLocal() {
  const local = readLocalCache();
  if (local?.students?.length) {
    cache = { students: local.students, loaded: true, source: local.source || "local-cache", fetchedAt: 0 };
    emit();
  }
}

export function subscribeCohort(fn) {
  const handler = () => fn(cache);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/**
 * Load entire cohort from Atlas (pages until all rows received).
 * Cached in memory for COHORT_TTL_MS so section changes do not re-download.
 * Pass { force: true } after upload/sync/clear to refresh.
 */
export async function fetchCohortFromServer(opts = {}) {
  const force = Boolean(opts?.force);

  if (!getSession()) {
    cache = { students: [], loaded: true, source: "unauthenticated", fetchedAt: Date.now() };
    emit();
    return cache;
  }

  // force (login / after upload): drop memory + localStorage so every device starts clean
  if (force) {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    cache = { students: [], loaded: false, source: null, fetchedAt: 0 };
  } else if (!cache.loaded || !cache.students?.length) {
    hydrateCohortFromLocal();
  }

  const fresh =
    !force &&
    cache.loaded &&
    Array.isArray(cache.students) &&
    cache.students.length > 0 &&
    cache.fetchedAt &&
    Date.now() - cache.fetchedAt < COHORT_TTL_MS;

  if (fresh) {
    return cache;
  }

  // Soft path: show local quickly, then refresh from Atlas in background
  if (!force && cache.loaded && cache.students?.length && !cache.fetchedAt) {
    if (!inflightFetch) {
      inflightFetch = doFetchCohort({ force: false }).finally(() => {
        inflightFetch = null;
      });
    }
    return cache;
  }

  if (inflightFetch && !force) {
    return inflightFetch;
  }

  inflightFetch = doFetchCohort({ force }).finally(() => {
    inflightFetch = null;
  });
  return inflightFetch;
}

async function doFetchCohort({ force = false } = {}) {
  try {
    const all = [];
    let skip = 0;
    let total = Infinity;
    const bust = force ? `&_t=${Date.now()}` : "";
    while (skip < total) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120000);
      try {
        const res = await fetch(
          `${API_BASE}/api/cohort?limit=${FETCH_PAGE}&skip=${skip}${bust}`,
          {
            headers: {
              ...authHeaders(),
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
            cache: "no-store",
            signal: ctrl.signal,
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load cohort");
        const batch = data.students || [];
        total = Number(data.total);
        if (!Number.isFinite(total)) total = skip + batch.length;
        all.push(...batch);
        skip += batch.length;
        if (!batch.length) break;
        if (batch.length < FETCH_PAGE && skip >= total) break;
        if (batch.length >= FETCH_PAGE && skip >= total) break;
        if (skip > 200000) break;
      } finally {
        clearTimeout(timer);
      }
    }

    cache = {
      students: all,
      loaded: true,
      source: "mongodb",
      fetchedAt: Date.now(),
    };
    writeLocalCache(cache.students, cache.source);
    emit();
    return cache;
  } catch (e) {
    // Only fall back to local cache if this is NOT a forced login/upload refresh
    if (!force) {
      const local = readLocalCache();
      if (local?.students?.length) {
        cache = {
          students: local.students,
          loaded: true,
          source: "local-cache-offline",
          fetchedAt: Date.now(),
        };
        emit();
        return cache;
      }
    }
    if (!cache.loaded) {
      cache = { students: [], loaded: true, source: "error", fetchedAt: Date.now() };
      emit();
    }
    throw e;
  }
}

/**
 * Sync ALL students to Atlas — no max count.
 * Splits into chunks of SYNC_CHUNK and retries a chunk once on failure.
 * onProgress?: ({ done, total, chunkIndex, chunkTotal }) => void
 */
export async function syncCohortToServer(students, onProgress) {
  const list = Array.isArray(students) ? students : [];
  if (!list.length) throw new Error("No students to sync");

  const chunkTotal = Math.ceil(list.length / SYNC_CHUNK) || 1;
  let upserted = 0;
  let createdAccounts = 0;

  for (let i = 0; i < list.length; i += SYNC_CHUNK) {
    const chunk = list.slice(i, i + SYNC_CHUNK);
    const chunkIndex = Math.floor(i / SYNC_CHUNK);
    let attempt = 0;
    let lastErr = null;
    while (attempt < 3) {
      attempt += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180000);
      try {
        const res = await fetch(`${API_BASE}/api/cohort/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            students: chunk,
            chunkIndex,
            chunkTotal,
          }),
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            data.error || `Cohort sync failed on chunk ${chunkIndex + 1}/${chunkTotal}`
          );
        }
        upserted += Number(data.upserted) || chunk.length;
        createdAccounts += Number(data.createdAccounts) || 0;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastErr) {
      throw new Error(
        `Stopped at chunk ${chunkIndex + 1}/${chunkTotal} after retries: ${lastErr.message || lastErr}. ` +
          `${i} of ${list.length} rows may already be on Atlas — commit again to finish the rest.`
      );
    }
    if (typeof onProgress === "function") {
      onProgress({
        done: Math.min(i + chunk.length, list.length),
        total: list.length,
        chunkIndex: chunkIndex + 1,
        chunkTotal,
      });
    }
  }

  await fetchCohortFromServer({ force: true });
  return {
    ok: true,
    upserted,
    createdAccounts,
    total: list.length,
    chunks: chunkTotal,
    source: "mongodb",
  };
}

export async function clearCohortOnServer() {
  const res = await fetch(`${API_BASE}/api/cohort`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Clear failed");
  cache = { students: [], loaded: true, source: "mongodb", fetchedAt: 0 };
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  emit();
  return data;
}

export async function resetStudentAccounts() {
  const res = await fetch(`${API_BASE}/api/admin/reset-students`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Reset failed");
  cache = { students: [], loaded: true, source: "mongodb", fetchedAt: 0 };
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  emit();
  return data;
}
