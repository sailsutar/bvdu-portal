/**
 * Academic Intelligence spine:
 * 1. Uplift-ranked interventions (who benefits from action)
 * 2. Closed-loop outcomes (action → later result)
 * 3. Predictive Outcome-Based Education (CO attainment mid-term)
 * 4. Cross-upload drift / model-health signals
 * 5. Workload-capped queues + batch fairness + audit log
 *
 * Persistence: MongoDB via /api/intelligence/:key (local mirror for sync reads).
 */

import { learnerSignals, batchSortKey, learnerBand } from "@/lib/tg-assign";
export { learnerSignals } from "@/lib/tg-assign";
import { currentStatusOf } from "@/lib/ml-predict";
import { readLocalMirror, saveRemoteState, loadRemoteState } from "@/lib/remote-state";

const KEY_INTERVENTIONS = "bvu.ai.interventions";
const KEY_OUTCOMES = "bvu.ai.outcomes";
const KEY_AUDIT = "bvu.ai.audit";
const KEY_DRIFT = "bvu.ai.driftSnapshots";
const KEY_OBE = "bvu.ai.obeMap";
const KEY_SETTINGS = "bvu.ai.settings";

const DEFAULT_SETTINGS = {
  tgWeeklyCapacity: 8, // max new priority interventions per TG per week
  flagRateCap: 0.15, // workload-aware: only top 15% by urgency
  upliftMin: 0.05,
};

function load(key, fallback) {
  // Sync path: local mirror (kept in sync by saveRemoteState / hydrateIntelligence)
  return readLocalMirror(key, fallback);
}

function notifyIntelligenceConflict() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("bvu:intelligence-conflict", {
      detail: { message: "Intelligence state refreshed from server." },
    }));
  } catch { /* ignore */ }
}

function save(key, val) {
  // Async MongoDB + local mirror; surface concurrent-edit conflicts
  void saveRemoteState(key, val).then((result) => {
    if (result?.conflict) {
      notifyIntelligenceConflict();
      // Server value already written to local mirror by remote-state; notify UI to re-read
      try {
        window.dispatchEvent(new Event("bvu:intelligence-reload"));
      } catch { /* ignore */ }
    }
  });
}

/** Call once after login to pull shared intelligence from MongoDB */
export async function hydrateIntelligence() {
  const keys = [
    "bvu.ai.interventions",
    "bvu.ai.outcomes",
    "bvu.ai.audit",
    "bvu.ai.driftSnapshots",
    "bvu.ai.obeMap",
    "bvu.ai.settings",
    "bvu.adv.agentDrafts",
    "bvu.adv.peerPairs",
  ];
  for (const k of keys) {
    await loadRemoteState(k, readLocalMirror(k, null));
  }
}

export function getAiSettings() {
  return { ...DEFAULT_SETTINGS, ...load(KEY_SETTINGS, {}) };
}
export function setAiSettings(patch) {
  const next = { ...getAiSettings(), ...patch };
  save(KEY_SETTINGS, next);
  audit("settings.update", { patch });
  return next;
}

/* -------------------- Audit -------------------- */
export function getAuditLog() {
  return load(KEY_AUDIT, []);
}
export function audit(type, payload = {}) {
  const entry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString(),
    type,
    ...payload,
  };
  const log = getAuditLog();
  log.unshift(entry);
  save(KEY_AUDIT, log.slice(0, 500));
  return entry;
}

/* -------------------- Interventions + outcomes (closed loop) -------------------- */
export const INTERVENTION_TYPES = [
  { id: "mentor_meeting", label: "Mentor meeting" },
  { id: "remedial", label: "Remedial / extra class" },
  { id: "parent_mail", label: "Parent communication" },
  { id: "attendance_plan", label: "Attendance recovery plan" },
  { id: "peer_tutoring", label: "Peer tutoring" },
];

export function listInterventions() {
  return load(KEY_INTERVENTIONS, []);
}

export function createIntervention({
  prn,
  studentName,
  type,
  ownerTgId,
  ownerName,
  reason,
  drivers = [],
  upliftScore = null,
  dueAt = null,
}) {
  const item = {
    id: `int_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    prn: String(prn),
    studentName: studentName || "",
    type,
    ownerTgId: ownerTgId || null,
    ownerName: ownerName || null,
    reason: reason || "",
    drivers,
    upliftScore,
    status: "open", // open | done | cancelled
    createdAt: new Date().toISOString(),
    dueAt,
    completedAt: null,
  };
  const all = listInterventions();
  all.unshift(item);
  save(KEY_INTERVENTIONS, all);
  audit("intervention.create", { interventionId: item.id, prn: item.prn, type });
  return item;
}

export function updateIntervention(id, patch) {
  const all = listInterventions();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  if (patch.status === "done" && !all[i].completedAt) {
    all[i].completedAt = new Date().toISOString();
  }
  save(KEY_INTERVENTIONS, all);
  audit("intervention.update", { interventionId: id, patch });
  return all[i];
}

export function listOutcomes() {
  return load(KEY_OUTCOMES, []);
}

/** Record post-intervention outcome (closed loop evidence) */
export function recordOutcome({
  interventionId,
  prn,
  beforeStatus,
  afterStatus,
  beforeMeanUt,
  afterMeanUt,
  beforeAttendance,
  afterAttendance,
  notes = "",
}) {
  const improved =
    statusRank(afterStatus) > statusRank(beforeStatus) ||
    (afterMeanUt != null &&
      beforeMeanUt != null &&
      afterMeanUt > beforeMeanUt + 0.5) ||
    (afterAttendance != null &&
      beforeAttendance != null &&
      afterAttendance > beforeAttendance + 2);

  const row = {
    id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    interventionId,
    prn: String(prn),
    beforeStatus,
    afterStatus,
    beforeMeanUt,
    afterMeanUt,
    beforeAttendance,
    afterAttendance,
    improved: Boolean(improved),
    notes,
    ts: new Date().toISOString(),
  };
  const all = listOutcomes();
  all.unshift(row);
  save(KEY_OUTCOMES, all);
  if (interventionId) updateIntervention(interventionId, { status: "done" });
  audit("outcome.record", { outcomeId: row.id, prn, improved: row.improved });
  return row;
}

function statusRank(s) {
  if (s === "Good") return 2;
  if (s === "Average") return 1;
  if (s === "At Risk") return 0;
  return 1;
}

export function interventionEffectiveness() {
  const outs = listOutcomes();
  const byType = {};
  for (const o of outs) {
    const int = listInterventions().find((i) => i.id === o.interventionId);
    const t = int?.type || "unknown";
    byType[t] ??= { n: 0, improved: 0 };
    byType[t].n += 1;
    if (o.improved) byType[t].improved += 1;
  }
  return Object.entries(byType).map(([type, v]) => ({
    type,
    n: v.n,
    improved: v.improved,
    rate: v.n ? v.improved / v.n : null,
  }));
}

/* -------------------- Uplift scoring -------------------- */
/**
 * Estimated uplift = expected benefit if intervened now.
 * Uses risk severity + driver fixability + historical outcome rates when available.
 * Not a full causal model until enough treatment data exists — then blends in empirical rates.
 */
export function estimateUplift(student, empiricalByType = null) {
  const sig = learnerSignals(student);
  const status = currentStatusOf(student);
  const band = learnerBand(student);

  let base = 0;
  if (status === "At Risk") base += 0.35;
  else if (status === "Average") base += 0.15;
  if (band === "slow") base += 0.2;

  // Fixable drivers boost uplift (intervention can move these)
  if (sig.attendance != null && sig.attendance < 75) base += 0.15;
  if (sig.meanUt != null && sig.meanUt < 10) base += 0.15;
  if (sig.utFailRate != null && sig.utFailRate >= 0.3) base += 0.1;

  // Already strong → low uplift from generic intervention
  if (status === "Good" && band === "fast") base = Math.min(base, 0.05);

  // Blend empirical success rate if we have outcomes for mentor_meeting as default prior
  if (empiricalByType && empiricalByType.mentor_meeting?.rate != null) {
    base = 0.6 * base + 0.4 * empiricalByType.mentor_meeting.rate;
  }

  return Math.max(0, Math.min(0.95, Math.round(base * 1000) / 1000));
}

export function rankStudentsByUplift(students) {
  const empirical = {};
  for (const e of interventionEffectiveness()) empirical[e.type] = e;
  return [...(students || [])]
    .map((s) => ({
      student: s,
      uplift: estimateUplift(s, empirical),
      status: currentStatusOf(s),
      band: learnerBand(s),
      signals: learnerSignals(s),
    }))
    .sort((a, b) => b.uplift - a.uplift);
}

/** Workload-aware: keep top flagRateCap fraction, then enforce per-Teacher Guide weekly capacity */
export function buildPriorityQueue(students, { tgId = null } = {}) {
  const settings = getAiSettings();
  const ranked = rankStudentsByUplift(students);
  const capN = Math.max(1, Math.ceil(ranked.length * settings.flagRateCap));
  let queue = ranked.slice(0, capN);

  if (tgId) {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const opened = listInterventions().filter(
      (i) =>
        i.ownerTgId === tgId &&
        new Date(i.createdAt).getTime() >= weekAgo &&
        i.status !== "cancelled"
    ).length;
    const remaining = Math.max(0, settings.tgWeeklyCapacity - opened);
    queue = queue.slice(0, remaining);
  }
  return { queue, capacity: settings.tgWeeklyCapacity, flagRateCap: settings.flagRateCap };
}

/* -------------------- Fairness -------------------- */
export function fairnessReport(students) {
  const groups = {};
  for (const s of students || []) {
    const b = batchSortKey(s).batch || "ZZ";
    groups[b] ??= { n: 0, atRisk: 0, slow: 0, highUplift: 0 };
    groups[b].n += 1;
    if (currentStatusOf(s) === "At Risk") groups[b].atRisk += 1;
    if (learnerBand(s) === "slow") groups[b].slow += 1;
    if (estimateUplift(s) >= 0.35) groups[b].highUplift += 1;
  }
  return Object.entries(groups)
    .map(([batch, g]) => ({
      batch,
      n: g.n,
      atRiskRate: g.n ? g.atRisk / g.n : 0,
      slowRate: g.n ? g.slow / g.n : 0,
      highUpliftRate: g.n ? g.highUplift / g.n : 0,
    }))
    .sort((a, b) => a.batch.localeCompare(b.batch));
}

/* -------------------- Drift / model health -------------------- */
export function snapshotCohort(students, label = "") {
  const n = students?.length || 0;
  let att = [],
    meanUt = [],
    atRisk = 0;
  for (const s of students || []) {
    const sig = learnerSignals(s);
    if (sig.attendance != null) att.push(sig.attendance);
    if (sig.meanUt != null) meanUt.push(sig.meanUt);
    if (currentStatusOf(s) === "At Risk") atRisk += 1;
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const snap = {
    id: `dr_${Date.now()}`,
    ts: new Date().toISOString(),
    label: label || `cohort_${n}`,
    n,
    meanAttendance: mean(att),
    meanUt: mean(meanUt),
    atRiskRate: n ? atRisk / n : 0,
  };
  const all = load(KEY_DRIFT, []);
  all.unshift(snap);
  save(KEY_DRIFT, all.slice(0, 50));
  audit("drift.snapshot", { snapshotId: snap.id, n });
  return snap;
}

export function listDriftSnapshots() {
  return load(KEY_DRIFT, []);
}

export function driftDelta() {
  const snaps = listDriftSnapshots();
  if (snaps.length < 2) return null;
  const [a, b] = snaps; // newest, previous
  return {
    newer: a,
    older: b,
    dAttendance:
      a.meanAttendance != null && b.meanAttendance != null
        ? a.meanAttendance - b.meanAttendance
        : null,
    dMeanUt: a.meanUt != null && b.meanUt != null ? a.meanUt - b.meanUt : null,
    dAtRiskRate: a.atRiskRate - b.atRiskRate,
    alert:
      Math.abs((a.atRiskRate || 0) - (b.atRiskRate || 0)) >= 0.08 ||
      (a.meanUt != null && b.meanUt != null && Math.abs(a.meanUt - b.meanUt) >= 1.5),
  };
}

/* -------------------- Predictive Outcome-Based Education -------------------- */
/** Default CO map: generic engineering course outcomes linked to UT proxies */
export function getObeMap() {
  const stored = load(KEY_OBE, null);
  if (stored?.courses?.length) return stored;
  return {
    program: "Engineering Program",
    courses: [
      {
        code: "GEN",
        name: "Uploaded subjects (aggregated)",
        cos: [
          {
            id: "CO1",
            label: "Course Outcome 1",
            title: "Recall and fundamentals",
            utWeight: 0.5,
            attendanceWeight: 0.2,
            failPenalty: 0.3,
            targetPct: 60,
          },
          {
            id: "CO2",
            label: "Course Outcome 2",
            title: "Application of concepts",
            utWeight: 0.6,
            attendanceWeight: 0.15,
            failPenalty: 0.25,
            targetPct: 60,
          },
          {
            id: "CO3",
            label: "Course Outcome 3",
            title: "Analysis and problem solving",
            utWeight: 0.55,
            attendanceWeight: 0.1,
            failPenalty: 0.35,
            targetPct: 55,
          },
        ],
        poLinks: {
          CO1: ["Program Outcome 1", "Program Outcome 2"],
          CO2: ["Program Outcome 2", "Program Outcome 3"],
          CO3: ["Program Outcome 2", "Program Outcome 4"],
        },
      },
    ],
  };
}

export function setObeMap(map) {
  save(KEY_OBE, map);
  audit("obe.map.update", {});
}

/**
 * Predict mid-term CO attainment % for one student from UT + attendance signals.
 */
export function predictStudentCOAttainment(student) {
  const sig = learnerSignals(student);
  const map = getObeMap();
  const course = map.courses[0];
  const utPct = sig.meanUtPct != null ? sig.meanUtPct : 50;
  const att = sig.attendance != null ? sig.attendance : 75;
  const fail = sig.utFailRate != null ? sig.utFailRate : 0.2;

  return course.cos.map((co) => {
    let score =
      co.utWeight * utPct +
      co.attendanceWeight * att +
      co.failPenalty * (1 - fail) * 100 * 0.3;
    // normalize roughly to 0-100
    score = Math.max(0, Math.min(100, score));
    return {
      coId: co.id,
      label: co.label || String(co.id).replace(/^CO(\d+)$/i, "Course Outcome $1"),
      title: co.title,
      predictedPct: Math.round(score * 10) / 10,
      targetPct: co.targetPct,
      onTrack: score >= co.targetPct,
      poLinks: course.poLinks[co.id] || [],
    };
  });
}

export function cohortCOSummary(students) {
  const map = getObeMap();
  const course = map.courses[0];
  const acc = {};
  for (const co of course.cos) acc[co.id] = { sum: 0, n: 0, below: 0, title: co.title, target: co.targetPct, label: co.label || co.id };

  for (const s of students || []) {
    for (const row of predictStudentCOAttainment(s)) {
      const a = acc[row.coId];
      a.sum += row.predictedPct;
      a.n += 1;
      if (!row.onTrack) a.below += 1;
    }
  }
  return Object.entries(acc).map(([coId, v]) => ({
    coId,
    label: v.label || String(coId).replace(/^CO(\d+)$/i, "Course Outcome $1"),
    title: v.title,
    targetPct: v.target,
    meanPredicted: v.n ? Math.round((v.sum / v.n) * 10) / 10 : null,
    pctStudentsBelow: v.n ? Math.round((v.below / v.n) * 1000) / 10 : null,
    n: v.n,
  }));
}


/** Reload all intelligence keys from Mongo when a concurrent-edit conflict is detected */
if (typeof window !== "undefined" && !window.__bvuIntelReloadBound) {
  window.__bvuIntelReloadBound = true;
  window.addEventListener("bvu:intelligence-reload", () => {
    void hydrateIntelligence();
  });
}
