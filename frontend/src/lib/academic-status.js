/**
 * SINGLE SOURCE OF TRUTH for academic status labels: At Risk | Average | Good.
 *
 * Two related concepts must never be mixed in the UI:
 *  1. Current Academic Status  — rule-based from attendance + UT marks (this module)
 *  2. Predicted Status (Early-Warning) — ML model output (ml-predict.js); uses early-term signals only
 *
 * Rules align with the Random Forest training philosophy (early-warning / continuous assessment):
 *  - UT pass mark defaults to 8/20
 *  - Attendance and fail-rate thresholds are admin-configurable via PortalConfig
 *
 * Default thresholds (overridable by admin settings):
 *  - At Risk: attendance < 65 OR avgPct < 50 OR failRate >= 0.40
 *  - Good:    attendance >= 75 AND avgPct >= 72 AND failRate <= 0.15
 *  - else Average
 */

export const DEFAULT_THRESHOLDS = {
  utPassMark: 8, // out of 20
  atRiskAttendance: 65,
  atRiskAvgPct: 50,
  atRiskFailRate: 0.4,
  goodAttendance: 75,
  goodAvgPct: 72,
  goodFailRate: 0.15,
  feedbackAttendanceGate: 75,
  tgBatchSize: 20, // used only for optional auto-distribution
};

/**
 * Compute Current Academic Status from attendance + continuous-assessment marks.
 * @param {number|null} attendance
 * @param {number|null} avgPct  overall average percentage (0–100)
 * @param {Array} marks  subject mark objects with assessments.UT-1 / UT-2 / UT-3 (only present UTs count)
 * @param {object} [thresholds] optional override of DEFAULT_THRESHOLDS
 */
export function computeAcademicStatus(attendance, avgPct, marks, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const passMark = t.utPassMark;

  let failCount = 0;
  let nAssess = 0;
  const pcts = [];

  for (const m of marks || []) {
    const a = m.assessments || {};
    for (const key of ["UT-1", "UT-2", "UT-3", "UT1", "UT2", "UT3", "RE-UT-20"]) {
      const raw = a[key];
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue; // skip AB/DEF text if stored as string without number
      nAssess++;
      if (n < passMark) failCount++;
    }
    if (m.percentage != null) pcts.push(Number(m.percentage));
    else if (a.Pct != null) pcts.push(Number(a.Pct));
  }

  const att = attendance != null && Number.isFinite(Number(attendance)) ? Number(attendance) : null;
  const hasMarks = nAssess > 0 || pcts.length > 0 || (avgPct != null && Number.isFinite(Number(avgPct)));
  const pct =
    avgPct != null && Number.isFinite(Number(avgPct))
      ? Number(avgPct)
      : pcts.length
        ? pcts.reduce((s, x) => s + x, 0) / pcts.length
        : null;
  const failRate = nAssess > 0 ? failCount / nAssess : 0;

  let academicStatus = "Average";
  // Attendance-only exports (e.g. VMedulife): do not invent a 50% average that forces Average/At Risk
  if (!hasMarks && att != null) {
    if (att < t.atRiskAttendance) academicStatus = "At Risk";
    else if (att >= t.goodAttendance) academicStatus = "Good";
    else academicStatus = "Average";
  } else {
    const attUse = att != null ? att : 50;
    const pctUse = pct != null ? pct : 50;
    if (attUse < t.atRiskAttendance || pctUse < t.atRiskAvgPct || failRate >= t.atRiskFailRate) {
      academicStatus = "At Risk";
    } else if (attUse >= t.goodAttendance && pctUse >= t.goodAvgPct && failRate <= t.goodFailRate) {
      academicStatus = "Good";
    }
  }

  const attForPred = att != null && Number.isFinite(att) ? att : 50;
  const pctForPred = pct != null && Number.isFinite(pct) ? pct : attForPred;
  const predictedAveragePct =
    Math.round(Math.min(100, Math.max(0, pctForPred * 0.7 + Math.min(attForPred, 100) * 0.3)) * 10) / 10;

  return {
    academicStatus,
    predictedAveragePct,
    failCount,
    failRate,
    thresholdsUsed: t,
  };
}

/**
 * Lightweight status used when only attendance + backlog count are available
 * (legacy roster path). Prefer computeAcademicStatus when marks exist.
 */
export function statusFromAttendanceAndBacklogs(attendance, backlogs, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const att = attendance != null ? Number(attendance) : null;
  const bl = Number(backlogs) || 0;
  if ((att != null && att < t.atRiskAttendance) || bl >= 2) return "At Risk";
  if ((att != null && att < t.goodAttendance) || bl === 1) return "Average";
  return "Good";
}

/** Human-readable label for UI badges */
export function statusLabel(status) {
  if (status === "At Risk") return "At Risk";
  if (status === "Good") return "Good";
  return "Average";
}
