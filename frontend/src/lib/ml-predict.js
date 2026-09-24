/**
 * Student academic status prediction.
 *
 * Current Academic Status  = from uploaded marks + attendance (rules via academic-status.js).
 * Predicted Status (Early-Warning) = ML ensemble using attendance + available Unit Tests:
 *   - Pre-UT / attendance-only: attendance drives defaulter screening
 *   - After UT-1 (before UT-2): attendance + UT-1
 *   - After UT-2: attendance + UT-1 + UT-2 (adaptive pool)
 * RE-UT / subject averages / overall % are NEVER model inputs (label leakage).
 */

import { useQuery } from "@tanstack/react-query";
import { computeOverallAveragePct } from "@/lib/upload-stats";
import {
  computeAcademicStatus,
  DEFAULT_THRESHOLDS,
  statusFromAttendanceAndBacklogs,
} from "@/lib/academic-status";

const PASS_UT = DEFAULT_THRESHOLDS.utPassMark;
const API_BASE = import.meta.env.VITE_API_URL || "";

function mean(arr) {
  const nums = arr.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Build early-warning payload for every term stage:
 *   pre-UT → attendance only
 *   post-UT-1 → attendance + UT-1
 *   post-UT-2 → attendance + UT-1 + UT-2
 * RE-UT / averages are excluded (full-term; would leak into prediction).
 */
export function buildPredictPayload(student) {
  const marks = {};
  let nAbsent = 0;
  const ABSENT_MARKERS = new Set(["defaulter", "df", "def", "ab", "absent", "na", "n/a"]);

  for (const m of student?.marks || []) {
    const src = m.assessments || {};
    const assessments = {};

    for (const key of ["UT-1", "UT1", "UT-2", "UT2", "UT-3", "UT3"]) {
      const raw = src[key];
      if (raw == null) continue;
      const canon = key.replace("UT1", "UT-1").replace("UT2", "UT-2").replace("UT3", "UT-3");
      if (typeof raw === "string" && ABSENT_MARKERS.has(String(raw).trim().toLowerCase())) {
        // Count only UT-1 / UT-2 absences (known at early-warning time)
        nAbsent += 1;
        continue;
      }
      const num = Number(raw);
      if (Number.isFinite(num)) assessments[canon] = num;
    }

    marks[m.subject] = assessments;
  }

  // Fallback: combined Excel / VMedulife rows often keep UT scores only on `raw`
  // (e.g. DBMS_UT-1). Without this, the Students list batch sees empty marks
  // while the detail page may still compute from a richer local object.
  const raw = student?.raw && typeof student.raw === "object" ? student.raw : {};
  if (Object.keys(marks).length === 0 || Object.values(marks).every((a) => !a || !Object.keys(a).length)) {
    for (const [key, val] of Object.entries(raw)) {
      const m = String(key).match(/^(.+?)[_\s-]*(ut[_\s-]*1|ut1|ut[_\s-]*2|ut2)$/i);
      if (!m) continue;
      const subj = m[1].replace(/_/g, " ").trim();
      if (!subj) continue;
      const which = /3/.test(m[2]) ? "UT-3" : /2/.test(m[2]) ? "UT-2" : "UT-1";
      if (typeof val === "string" && ABSENT_MARKERS.has(String(val).trim().toLowerCase())) {
        nAbsent += 1;
        continue;
      }
      const num = Number(val);
      if (!Number.isFinite(num)) continue;
      if (!marks[subj]) marks[subj] = {};
      marks[subj][which] = num;
    }
  }

  const section = student?.cls || student?.section || student?.className || student?.yearLevel || "";
  let year = student?.year || student?.yearLevel || null;
  if (!year && section) {
    const s = String(section).toUpperCase();
    if (/\b(SY|SE|SECOND)\b/.test(s) || s.startsWith("SY")) year = "sy";
    else if (/\b(TY|TE|THIRD)\b/.test(s) || s.startsWith("TY")) year = "ty";
    else if (/\b(LY|BE|FINAL|LAST)\b/.test(s) || s.includes("FINAL") || s.includes("VIII")) year = "final";
    else if (/\b(FY|FE|FIRST)\b/.test(s) || s.startsWith("FY")) year = "sy"; // first-year uses sy pipeline if no fy model
  }

  let averagePercentage = student?.averagePercentage ?? null;
  if (averagePercentage == null && student?.marks?.length) {
    averagePercentage = computeOverallAveragePct(student.marks);
  }

  const clientAbsent =
    student?.n_absent_markers != null && Number.isFinite(Number(student.n_absent_markers))
      ? Number(student.n_absent_markers)
      : nAbsent;

  let attendance =
    student?.attendanceKnown || student?.attendance != null ? Number(student.attendance) : null;
  const labA = student?.labAttendance != null ? Number(student.labAttendance) : null;
  if (attendance != null && labA != null && Number.isFinite(labA)) {
    attendance = Math.round((attendance * 0.85 + labA * 0.15) * 10) / 10;
  } else if ((attendance == null || !Number.isFinite(attendance)) && labA != null && Number.isFinite(labA)) {
    attendance = labA;
  }

  return {
    prn: student?.prn,
    name: student?.name,
    attendance: Number.isFinite(attendance) ? attendance : null,
    lab_attendance: labA != null && Number.isFinite(labA) ? labA : null,
    // Display / current-status only — early-warning model does not use this as a feature
    average_percentage: averagePercentage,
    marks,
    year: year || "ty",
    section: section || null,
    n_absent_markers: clientAbsent,
  };
}

/** Current-status helper from live marks only (NOT used for ML predicted status). */
export function statusFromMetrics(avgPct, attendance) {
  return computeAcademicStatus(attendance, avgPct, []).academicStatus;
}

/** Current Academic Status from live marks (shared source of truth) */
export function currentStatusOf(student) {
  if (student?.academicStatus) return student.academicStatus;
  const result = computeAcademicStatus(
    student?.attendance,
    student?.averagePercentage,
    student?.marks || []
  );
  return result.academicStatus;
}

/**
 * @deprecated Rule-based predicted status removed. Always wait for the ML service.
 * Kept as a stub so old imports do not crash; returns null status.
 */
export function ruleBasedStatus(_student) {
  return {
    status: null,
    predicted_average_pct: null,
    probabilities: null,
    source: "loading",
  };
}

export async function predictWithML(student) {
  const payload = buildPredictPayload(student);
  const res = await fetch(`${API_BASE}/api/ml/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`ML predict failed (HTTP ${res.status})`);
    err.code = "ml_http";
    throw err;
  }
  const data = await res.json();
  if (!data?.status) {
    const err = new Error("Invalid ML response");
    err.code = "ml_invalid";
    throw err;
  }
  return {
    status: data.status,
    predicted_average_pct: data.predicted_average_pct,
    probabilities: data.probabilities || null,
    confidence: data.confidence ?? null,
    calibrated: data.calibrated ?? false,
    utBasis: data.ut_basis ?? null,
    driftFlags: data.drift_flags || [],
    policyStatus: data.policy_status || data.status,
    predictionSet: data.prediction_set || null,
    upliftScore: data.uplift_score ?? null,
    notifyRecommended: data.notify_recommended ?? false,
    conformal: data.conformal || null,
    source: "ml",
  };
}

/** Batch predict — tries ML batch endpoint, falls back per-student rules */
export async function predictBatch(students) {
  const list = students || [];
  if (!list.length) return new Map();

  const map = new Map();
  const CHUNK = 80;

  for (let offset = 0; offset < list.length; offset += CHUNK) {
    const chunk = list.slice(offset, offset + CHUNK);
    const payload = chunk.map(buildPredictPayload);
    const res = await fetch(`${API_BASE}/api/ml/predict/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = new Error(`ML batch failed (HTTP ${res.status}). Is the machine learning service running on port 8001?`);
      err.code = "ml_batch_http";
      throw err;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      const err = new Error("Invalid ML batch response");
      err.code = "ml_batch_invalid";
      throw err;
    }
    data.forEach((row, i) => {
      const prn = row?.prn || chunk[i]?.prn;
      if (!prn) return;
      map.set(String(prn), {
        status: row.status || row.policy_status || row.model_status,
        predicted_average_pct: row.predicted_average_pct,
        probabilities: row.probabilities || null,
        confidence: row.confidence ?? null,
        source: "ml",
      });
    });
  }
  return map;
}

export async function predictStudentStatus(student) {
  return predictWithML(student);
}

/** Sync helper removed for predictions — always use async predictStudentStatus (ML only). */
export function predictStudentStatusSync(_student) {
  return { status: null, predicted_average_pct: null, source: "loading", probabilities: null };
}

export function statusColor(status) {
  if (status === "Good") return "text-success";
  if (status === "At Risk") return "text-danger";
  return "text-warning";
}

export function statusBadgeClass(status) {
  if (status === "Good") return "bg-success/15 text-success";
  if (status === "At Risk") return "bg-danger/15 text-danger";
  return "bg-warning/15 text-warning";
}


/** Stable key fragment from a student list (PRN order-independent). */
function studentsKey(students) {
  if (!students?.length) return "";
  return students
    .map((s) => String(s?.prn ?? ""))
    .filter(Boolean)
    .sort()
    .join(",");
}

/**
 * Cached batch predictions for a student list.
 * Survives route unmount (Students ↔ Marks) via React Query cache.
 */
export function useStudentPredictions(students) {
  const list = students || [];
  const key = studentsKey(list);
  const query = useQuery({
    queryKey: ["predictions", "ml-only-v3", key],
    queryFn: () => predictBatch(list),
    enabled: list.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const predictions = query.data instanceof Map ? query.data : new Map();
  const first = predictions.size ? predictions.values().next().value : null;
  const stillLoading = query.isLoading || (query.isFetching && !predictions.size);
  let predSource = "loading";
  if (query.isError) predSource = "error";
  else if (first?.source === "ml" || (predictions.size && !stillLoading)) predSource = "ml";
  else if (stillLoading) predSource = "loading";
  return {
    predictions,
    predSource,
    isLoading: stillLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Cached single-student prediction (admin detail / student AI insights).
 */
export function useStudentPrediction(student) {
  const prn = student?.prn != null ? String(student.prn) : null;
  const query = useQuery({
    queryKey: ["prediction", prn],
    queryFn: () => predictStudentStatus(student),
    enabled: Boolean(prn),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const prediction = query.data || {
    status: null,
    predicted_average_pct: null,
    source: query.isLoading ? "loading" : query.isError ? "error" : "loading",
    probabilities: null,
  };
  return {
    prediction,
    isLoading: query.isLoading || (!query.data && !query.isError),
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
