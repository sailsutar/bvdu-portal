/**
 * Model-backed explanations using SHAP values from the ML service only.
 * No rule-based fallback — callers must wait for the model or show an error.
 */

import { useQuery } from "@tanstack/react-query";
import { buildPredictPayload } from "@/lib/ml-predict";

const API_BASE = import.meta.env.VITE_API_URL || "";
const PASS_UT = 8;

/** Map FEATURE_COLS names → driver ids / labels used by the UI */
const FEATURE_META = {
  // Early-warning feature set only (matches serve.py FEATURE_COLS)
  attendance: { id: "attendance", label: "Attendance (to-date)" },
  mean_ut1: { id: "mean_ut1", label: "Mean Unit Test-1" },
  n_ut1_present: { id: "n_ut1_present", label: "UT-1 assessments present" },
  n_subjects: { id: "n_subjects", label: "Subjects counted" },
  ut1_fail_count: { id: "fails", label: "UT-1 failed assessments" },
  ut1_fail_rate: { id: "fail_rate", label: "UT-1 fail rate" },
  n_absent_markers: { id: "n_absent_markers", label: "Absent / defaulter markers" },
};

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mean(arr) {
  const a = arr.filter((x) => x != null);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

/**
 * Build a human-readable reason string for a SHAP feature contribution,
 * reusing the same phrasing style as explain-performance.js where possible.
 */
function reasonForFeature(feature, value, direction, student) {
  const attendance = num(student?.attendance);
  const marks = student?.marks || [];

  let failCount = 0;
  let assessCount = 0;
  const ut1 = [];
  const ut2 = [];
  for (const m of marks) {
    const a = m.assessments || {};
    const u1 = num(a["UT-1"] ?? a.UT1);
    const u2 = num(a["UT-2"] ?? a.UT2);
    const u3 = num(a["UT-3"] ?? a.UT3);
    if (u1 != null) {
      ut1.push(u1);
      assessCount++;
      if (u1 < PASS_UT) failCount++;
    }
    if (u2 != null) {
      ut2.push(u2);
      assessCount++;
      if (u2 < PASS_UT) failCount++;
    }
  }
  const meanUt1 = mean(ut1);

  switch (feature) {
    case "attendance": {
      const att = value != null ? Number(value) : attendance;
      if (att == null) return "Attendance was imputed; the model still weighed presence patterns.";
      if (att < 50)
        return `Attendance is critically low at ${att}% (well below 75%). This strongly increases end-of-term risk.`;
      if (att < 65)
        return `Attendance is ${att}% (below 65%). Regular absence is a primary risk driver.`;
      if (att < 75)
        return `Attendance is ${att}% — under the 75% eligibility line. This increases risk until presence improves.`;
      if (att < 85)
        return `Attendance is ${att}% (meets the 75% threshold). Supports a safer predicted status.`;
      return `Attendance is strong at ${att}%, well above the 75% threshold — a protective factor.`;
    }
    case "mean_ut1": {
      const m = meanUt1 != null ? meanUt1 : value != null ? Number(value) : null;
      if (m == null) return "Unit Test average was imputed; the model still weighed early marks.";
      if (m >= 14)
        return `Mean Unit Test score is strong at ${m.toFixed(1)}/20 — supports a safer predicted status.`;
      if (m >= 12)
        return `Mean Unit Test score is solid at ${m.toFixed(1)}/20. This early signal supports a safer status.`;
      if (m >= 8)
        return `Mean Unit Test score is moderate at ${m.toFixed(1)}/20 (around the pass band). Monitor for improvement.`;
      if (m >= 5)
        return `Mean Unit Test score is low at ${m.toFixed(1)}/20. This early signal increases risk.`;
      return `Mean Unit Test score is very low at ${m.toFixed(1)}/20. This strongly increases risk.`;
    }
    case "n_ut1_present": {
      const n = value != null ? Number(value) : null;
      if (n == null) return "Early assessment coverage was incomplete in the model input.";
      if (n >= 5)
        return `${n} early Unit Test score(s) present — good coverage supports a more reliable status.`;
      if (n >= 3)
        return `${n} early Unit Test score(s) present — coverage supports a safer status.`;
      if (n >= 1)
        return `Only ${n} early Unit Test score(s) present — limited coverage increases uncertainty and risk.`;
      return "No early Unit Test scores present — the model has little academic signal; risk of misclassification is higher.";
    }
    case "n_subjects": {
      const n = value != null ? Number(value) : null;
      if (n == null) return "Subject count was incomplete in the model input.";
      if (n >= 5)
        return `Model saw ${n} subjects — broad coverage supports a more reliable status.`;
      if (n >= 3)
        return `Model saw ${n} subjects — adequate breadth supports a safer status.`;
      return `Model saw only ${n} subject(s) — narrow coverage increases uncertainty.`;
    }
    case "ut1_fail_count":
    case "fail_count": {
      const n = value != null ? Number(value) : failCount;
      if (n == null || n === 0)
        return "No Unit Test fails detected — early pass rate is healthy (protective).";
      if (n === 1)
        return `1 Unit Test fail recorded. A single fail raises risk and needs subject-level follow-up.`;
      return `${n} Unit Test fails recorded. Repeated fails strongly increase end-of-term risk.`;
    }
    case "ut1_fail_rate":
    case "fail_rate": {
      const r = value != null ? Number(value) : null;
      if (r == null || r === 0)
        return "Unit Test fail rate is 0% — early assessment pass rate is healthy (protective).";
      const pct = r <= 1 ? Math.round(r * 100) : Math.round(r);
      if (pct < 15)
        return `Unit Test fail rate is about ${pct}% (low). Mild concern only.`;
      if (pct < 30)
        return `Unit Test fail rate is about ${pct}%. This increases risk and needs remedial focus.`;
      return `Unit Test fail rate is about ${pct}% (high). This strongly increases end-of-term risk.`;
    }
    case "n_absent_markers": {
      const n = value != null ? Number(value) : null;
      if (n == null || n === 0)
        return "No absent/defaulter markers — assessment presence is healthy (protective).";
      if (n === 1)
        return `1 absent/defaulter marker recorded. Missing assessments increase risk.`;
      return `${n} absent/defaulter markers recorded. Missing assessments strongly increase risk.`;
    }
    default: {
      const label = FEATURE_META[feature]?.label || feature;
      if (direction === "protective")
        return `${label} (value ${value}) supports a safer predicted status.`;
      return `${label} (value ${value}) increases predicted risk.`;
    }
  }
}


function formatValue(feature, value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (feature === "attendance" || feature === "mean_subject_pct") return `${Number(value).toFixed(0)}%`;
  if (feature === "fail_rate") {
    const pct = value <= 1 ? value * 100 : value;
    return `${pct.toFixed(0)}%`;
  }
  if (["mean_ut1", "mean_ut2", "mean_reut", "mean_subject_avg"].includes(feature))
    return Number(value).toFixed(1);
  return String(Math.round(value * 100) / 100);
}

function severityFromImpact(impact, direction) {
  // Protective factors: never "critical" / "high" — they are strengths
  if (direction === "protective") {
    if (impact >= 20) return "low"; // still low badge; UI may show as strength
    return "low";
  }
  if (impact >= 25) return "critical";
  if (impact >= 15) return "high";
  if (impact >= 8) return "medium";
  return "low";
}

/**
 * Overlay SHAP impacts onto the rule-based report structure so headline /
 * recommendations / strengths stay intact.
 */

/** Client-side direction: value semantics for every FEATURE_COLS field (matches serve.py). */
function teacherDirection(feature, value, apiDirection) {
  const v = value == null || Number.isNaN(Number(value)) ? null : Number(value);

  if (feature === "attendance") {
    if (v == null) return apiDirection === "protective" ? "protective" : "risk";
    return v >= 75 ? "protective" : "risk";
  }
  if (feature === "mean_ut1") {
    if (v == null) return apiDirection === "protective" ? "protective" : "risk";
    if (v >= 12) return "protective";
    if (v >= 8) return "protective";
    return "risk";
  }
  if (feature === "n_ut1_present") {
    if (v == null) return "risk";
    return v >= 3 ? "protective" : "risk";
  }
  if (feature === "n_subjects") {
    if (v == null) return "risk";
    return v >= 3 ? "protective" : "risk";
  }
  if (feature === "ut1_fail_count" || feature === "fail_count") {
    if (v == null) return "risk";
    return v > 0 ? "risk" : "protective";
  }
  if (feature === "ut1_fail_rate" || feature === "fail_rate") {
    if (v == null) return "risk";
    return v >= 0.15 ? "risk" : "protective";
  }
  if (feature === "n_absent_markers") {
    if (v == null) return "risk";
    return v > 0 ? "risk" : "protective";
  }
  return apiDirection === "protective" ? "protective" : "risk";
}

function mergeShapIntoReport(baseReport, shapPayload, student) {
  const contribs = shapPayload.feature_contributions || [];
  if (!contribs.length) return { ...baseReport, source: "model" };

  const maxAbs = Math.max(...contribs.map((c) => Math.abs(c.shap_value)), 1e-9);

  const drivers = contribs.map((c) => {
    const meta = FEATURE_META[c.feature] || { id: c.feature, label: c.feature };
    const impact = Math.round((Math.abs(c.shap_value) / maxAbs) * 100);
    const direction = teacherDirection(c.feature, c.value, c.direction || "risk");
    const positive = direction === "protective";
    return {
      id: meta.id,
      label: meta.label,
      impact,
      severity: severityFromImpact(impact, direction),
      value: formatValue(c.feature, c.value),
      reason: reasonForFeature(c.feature, c.value, direction, student),
      positive,
      shap_value: c.shap_value,
      direction,
    };
  });

  const ranked = [...drivers].sort((a, b) => b.impact - a.impact);
  const totalImpact = ranked.reduce((s, d) => s + d.impact, 0) || 1;
  const withShare = ranked.map((d) => ({
    ...d,
    share: Math.round((d.impact / totalImpact) * 100),
  }));

  // Rebuild whyDegraded from top negative SHAP drivers (keep narrative style)
  const topNegative = withShare.filter((d) => !d.positive && d.impact >= 5).slice(0, 4);
  const whyDegraded =
    topNegative.length === 0
      ? ["No strong degradation drivers detected from the model explanation."]
      : topNegative.map((d) => d.reason);

  return {
    ...baseReport,
    status: shapPayload.status || baseReport.status,
    drivers: withShare,
    whyDegraded,
    source: "model",
    shap_base_value: shapPayload.base_value,
    year: shapPayload.year,
  };
}


function buildModelOnlyBase(student, shapPayload) {
  const status = shapPayload?.status || "Average";
  const att = student?.attendance;
  const marks = student?.marks || [];
  const strengths = [];
  if (att != null && att >= 80) strengths.push(`Strong attendance (${att}%)`);
  const fails = [];
  for (const m of marks) {
    const a = m.assessments || {};
    for (const k of ["UT-1", "UT1", "UT-2", "UT2", "UT-3", "UT3"]) {
      const v = a[k];
      if (v != null && Number(v) < 8) fails.push(m.subject);
    }
  }
  if (!fails.length && marks.length) strengths.push("No failed Unit Test assessments");
  const protective = (shapPayload.feature_contributions || []).filter(
    (c) => c.direction === "protective"
  );
  const recommendations =
    status === "At Risk"
      ? [
          {
            priority: "high",
            title: "Early intervention",
            detail: "Review top risk factors from the model and schedule mentor follow-up.",
          },
        ]
      : status === "Average"
        ? [
            {
              priority: "medium",
              title: "Monitor",
              detail: "Re-check after the next Unit Test upload; encourage steady attendance and practice.",
            },
          ]
        : [
            {
              priority: "low",
              title: "Routine monitoring",
              detail: "No urgent intervention required. Re-check after the next assessment upload.",
            },
          ];
  return {
    status,
    headline:
      status === "At Risk"
        ? "Model flags elevated end-of-term risk from early signals."
        : status === "Good"
          ? "Performance is currently solid; no major degradation signals."
          : "Model forecasts an Average end-of-term band from early signals.",
    degraded: status === "At Risk",
    trend: "unknown",
    meanUt1: null,
    meanUt2: null,
    trendDelta: null,
    strengths,
    recommendations,
    failingSubjects: [...new Set(fails)],
    decliningSubjects: [],
    improvingSubjects: [],
    drivers: [],
    whyDegraded: [],
  };
}

/**
 * SHAP explanation from the ML service only. Throws if the model is unavailable.
 */
export async function explainWithModel(student) {
  if (!student) {
    throw new Error("No student provided for model explanation");
  }

  const payload = buildPredictPayload(student);
  if (student.n_absent_markers != null) {
    payload.n_absent_markers = student.n_absent_markers;
  }

  const res = await fetch(`${API_BASE}/api/ml/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`ML explain failed (HTTP ${res.status}). Is the machine learning service running?`);
    err.code = "ml_explain_http";
    throw err;
  }
  const data = await res.json();
  if (!data?.feature_contributions) {
    const err = new Error("ML explain returned no feature contributions");
    err.code = "ml_explain_empty";
    throw err;
  }
  const base = buildModelOnlyBase(student, data);
  return mergeShapIntoReport(base, data, student);
}

/**
 * Cached SHAP explanation for one student (model only — no rule fallback).
 */
export function useStudentExplanation(student) {
  const prn = student?.prn != null ? String(student.prn) : null;
  const query = useQuery({
    queryKey: ["explain", "ml-only", prn],
    queryFn: () => explainWithModel(student),
    enabled: Boolean(prn),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 1500,
  });
  return {
    report: query.data ?? null,
    isLoading: query.isLoading || query.isFetching,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
  };
}
