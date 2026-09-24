/**
 * Agentic workflows for BVU Portal.
 * Agents draft + queue; humans Approve / Edit / Skip.
 * Persistence via remote-state / local mirror (same as intelligence modules).
 */

import { saveRemoteState, readLocalMirror } from "@/lib/remote-state";
import { buildParentMessage } from "@/lib/parent-message-templates";
import { currentStatusOf } from "@/lib/ml-predict";
import { learnerSignals, studentsForTg, classifyLearner, partitionLearners } from "@/lib/tg-assign";
import {
  createIntervention,
  listInterventions,
  listOutcomes,
  interventionEffectiveness,
  getAiSettings,
  estimateUplift,
} from "@/lib/academic-intelligence";
import { analyzeUploadMapping, resolveColumnMap } from "@/lib/upload-stats";
import {
  draftTeacherCoachingNotes,
  clusterFeedbackThemes,
  listCoachingNotes,
  detectMarksAnomalies,
  getNextExamDate,
  daysUntilExam,
} from "@/lib/advanced-intelligence";

const KEY = {
  actionDrafts: "bvu.agent.actionDrafts",
  parentDrafts: "bvu.agent.parentDrafts",
  followUps: "bvu.agent.followUps",
  coachingReview: "bvu.agent.coachingReview",
  dataQuality: "bvu.agent.dataQuality",
  attendanceBatch: "bvu.agent.attendanceBatch",
  marksFollowUp: "bvu.agent.marksFollowUp",
  interventionReminders: "bvu.agent.interventionReminders",
  weeklyDigest: "bvu.agent.weeklyDigest",
  oddMarks: "bvu.agent.oddMarks",
  slowLearnerList: "bvu.agent.slowLearnerList",
  examWindow: "bvu.agent.examWindow",
  uploadGateOverride: "bvu.agent.uploadGateOverride",
  statusNotify: "bvu.agent.statusNotify",
};

function load(k, fb) {
  return readLocalMirror(k, fb);
}
function save(k, v) {
  void saveRemoteState(k, v);
}
function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ------------------------------------------------------------------ */
/* 1. Teacher Guide action agent                                      */
/* ------------------------------------------------------------------ */

function pickActionType(student, eff) {
  const sig = learnerSignals(student);
  const rates = Object.fromEntries((eff || []).map((e) => [e.type, e.rate ?? 0]));
  if (sig.attendance != null && sig.attendance < 75) {
    if ((rates.parent_mail ?? 0) >= (rates.mentor_meeting ?? 0)) return "parent_mail";
    return "attendance_plan";
  }
  if (sig.meanUt != null && sig.meanUt < 10) return "remedial";
  if (classifyLearner(student) === "slow") return "remedial";
  return "mentor_meeting";
}

/** Prefer real risk signals over flat urgency */
function scoreNeed(student) {
  const status = currentStatusOf(student);
  const sig = learnerSignals(student);
  const uplift = estimateUplift(student);
  let score = 0;
  if (status === "At Risk") score += 50;
  else if (status === "Average") score += 20;
  if (sig.attendance != null && sig.attendance < 75) score += 25;
  if (sig.attendance != null && sig.attendance < 65) score += 15;
  if (sig.meanUt != null && sig.meanUt < 8) score += 20;
  score += Math.round(uplift * 30);
  return { score, status, sig, uplift };
}

/**
 * Run TG action agent: at-risk / high-need students → draft actions + parent letter → pending queue.
 */
export function runTgActionAgent(students, { tgId, tgName, tgIndex } = {}) {
  const pool = tgIndex != null ? studentsForTg(students, tgIndex) : students || [];
  const eff = interventionEffectiveness();
  const settings = getAiSettings();
  const cap = Math.max(3, Math.ceil(pool.length * (settings.flagRateCap || 0.15)));

  const ranked = pool
    .map((s) => ({ student: s, ...scoreNeed(s) }))
    .filter((r) => r.status === "At Risk" || r.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap);

  const drafts = ranked.map((row) => {
    const type = pickActionType(row.student, eff);
    const mode =
      type === "attendance_plan" ? "attendance" : type === "remedial" ? "marks" : "full";
    const tpl = buildParentMessage(row.student, mode);
    const { sig, uplift, status, score } = row;
    return {
      id: id("agd"),
      ts: new Date().toISOString(),
      prn: String(row.student.prn),
      studentName: row.student.name,
      cls: row.student.cls || row.student.className || "",
      tgId: tgId || null,
      tgName: tgName || null,
      status: "pending", // pending | approved | edited | skipped
      actionType: type,
      needScore: score,
      uplift,
      riskStatus: status,
      drivers: [
        sig.attendance != null ? `Attendance ${sig.attendance}%` : null,
        sig.meanUt != null ? `Mean Unit Test ${Number(sig.meanUt).toFixed(1)}/20` : null,
        row.student.averagePercentage != null
          ? `Average ${row.student.averagePercentage}%`
          : null,
      ].filter(Boolean),
      rationale: `Need score ${score}. Status ${status}. Recommended “${type}” from drivers and past intervention effectiveness.`,
      draftSubject: tpl.subject,
      draftBody: tpl.body,
      channelHint: type === "parent_mail" ? "whatsapp" : "email",
      agent: "tg_action",
    };
  });

  const all = load(KEY.actionDrafts, []);
  const kept = all.filter(
    (d) => d.status !== "pending" || (tgId && d.tgId && d.tgId !== tgId)
  );
  const next = [...drafts, ...kept].slice(0, 250);
  save(KEY.actionDrafts, next);
  // Keep advanced-intelligence key in sync for older TG UI
  save("bvu.adv.agentDrafts", next);
  return drafts;
}

export function listActionDrafts(filter = {}) {
  let all = load(KEY.actionDrafts, load("bvu.adv.agentDrafts", []));
  if (filter.tgId) all = all.filter((d) => d.tgId === filter.tgId);
  if (filter.status) all = all.filter((d) => d.status === filter.status);
  return all;
}

export function resolveActionDraft(draftId, decision, edits = {}) {
  const all = load(KEY.actionDrafts, load("bvu.adv.agentDrafts", []));
  const i = all.findIndex((d) => d.id === draftId);
  if (i < 0) return null;
  const d = {
    ...all[i],
    ...edits,
    status: decision,
    resolvedAt: new Date().toISOString(),
  };
  all[i] = d;
  save(KEY.actionDrafts, all);
  save("bvu.adv.agentDrafts", all);
  if (decision === "approved" || decision === "edited") {
    createIntervention({
      prn: d.prn,
      studentName: d.studentName,
      type: d.actionType,
      ownerTgId: d.tgId,
      ownerName: d.tgName,
      reason: d.rationale,
      drivers: d.drivers,
      upliftScore: d.uplift,
      status: "open",
      agentDraftId: d.id,
    });
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* 2. Parent communication agent                                      */
/* ------------------------------------------------------------------ */

/**
 * Draft letter for one student (Mail / SMS / WhatsApp body).
 * channel: email | sms | whatsapp — SMS uses shorter body.
 */
export function runParentCommunicationAgent(student, { mode = "full", channel = "email" } = {}) {
  const tpl = buildParentMessage(student, mode);
  let body = tpl.body;
  if (channel === "sms") {
    body = [
      `BVU: Update for ${student?.name || "ward"} (PRN ${student?.prn || "—"}).`,
      `Attendance: ${student?.attendance != null ? student.attendance + "%" : "N/A"}.`,
      `Average: ${student?.averagePercentage != null ? student.averagePercentage + "%" : "N/A"}.`,
      `Status: ${currentStatusOf(student)}. Please contact the class teacher if needed.`,
    ].join(" ");
  }
  const draft = {
    id: id("pcd"),
    ts: new Date().toISOString(),
    prn: String(student?.prn || ""),
    studentName: student?.name,
    mode,
    channel,
    subject: tpl.subject,
    body,
    status: "pending",
    agent: "parent_comm",
  };
  const all = load(KEY.parentDrafts, []);
  all.unshift(draft);
  save(KEY.parentDrafts, all.slice(0, 100));
  return draft;
}

export function listParentDrafts() {
  return load(KEY.parentDrafts, []);
}

export function resolveParentDraft(draftId, decision, edits = {}) {
  const all = load(KEY.parentDrafts, []);
  const i = all.findIndex((d) => d.id === draftId);
  if (i < 0) return null;
  all[i] = { ...all[i], ...edits, status: decision, resolvedAt: new Date().toISOString() };
  save(KEY.parentDrafts, all);
  return all[i];
}

/* ------------------------------------------------------------------ */
/* 3. Intervention follow-up agent                                    */
/* ------------------------------------------------------------------ */

/**
 * For completed interventions without outcome, or open ones older than N days,
 * suggest improved / not improved from latest attendance & marks vs snapshot.
 */
export function runInterventionFollowUpAgent(students, { olderThanDays = 7 } = {}) {
  const byPrn = new Map((students || []).map((s) => [String(s.prn), s]));
  const ints = listInterventions();
  const outcomes = listOutcomes();
  const outcomeIds = new Set(outcomes.map((o) => o.interventionId).filter(Boolean));
  const now = Date.now();
  const suggestions = [];

  for (const item of ints) {
    const ageDays =
      (now - new Date(item.createdAt || item.ts || now).getTime()) / 86400000;
    const hasOutcome = outcomeIds.has(item.id);
    if (hasOutcome) continue;
    if (item.status === "open" && ageDays < olderThanDays) continue;

    const student = byPrn.get(String(item.prn));
    if (!student) {
      suggestions.push({
        id: id("ifu"),
        interventionId: item.id,
        prn: item.prn,
        studentName: item.studentName,
        type: item.type,
        status: "pending",
        suggestion: "unknown",
        reason: "Student no longer in cohort — log outcome manually.",
        agent: "follow_up",
      });
      continue;
    }

    const att = student.attendance;
    const avg = student.averagePercentage;
    let suggestion = "not_improved";
    let reason = "No clear improvement signal in current attendance / average.";
    if (att != null && att >= 75 && (avg == null || avg >= 60)) {
      suggestion = "improved";
      reason = `Current attendance ${att}%${avg != null ? `, average ${avg}%` : ""} suggests recovery.`;
    } else if (att != null && att < 65) {
      suggestion = "not_improved";
      reason = `Attendance still low (${att}%).`;
    }

    suggestions.push({
      id: id("ifu"),
      interventionId: item.id,
      prn: item.prn,
      studentName: item.studentName || student.name,
      type: item.type,
      interventionStatus: item.status,
      ageDays: Math.round(ageDays),
      status: "pending",
      suggestion,
      reason,
      agent: "follow_up",
      ts: new Date().toISOString(),
    });
  }

  save(KEY.followUps, suggestions.slice(0, 100));
  return suggestions;
}

export function listFollowUpSuggestions() {
  return load(KEY.followUps, []);
}

export function resolveFollowUp(id, decision) {
  const all = load(KEY.followUps, []);
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], status: decision, resolvedAt: new Date().toISOString() };
  save(KEY.followUps, all);
  return all[i];
}

/* ------------------------------------------------------------------ */
/* 4. Feedback coaching agent (HOD review)                            */
/* ------------------------------------------------------------------ */

/**
 * Cluster negative feedback → coaching notes with reviewStatus: pending_hod.
 */
export function runFeedbackCoachingAgent(feedbacks) {
  const notes = draftTeacherCoachingNotes(feedbacks || []);
  const reviewed = notes.map((n) => ({
    ...n,
    reviewStatus: "pending_hod", // pending_hod | approved | rejected
    agent: "feedback_coaching",
  }));
  save(KEY.coachingReview, reviewed);
  return reviewed;
}

export function listCoachingForReview() {
  const dedicated = load(KEY.coachingReview, []);
  if (dedicated.length) return dedicated;
  return (listCoachingNotes() || []).map((n) => ({
    ...n,
    reviewStatus: n.reviewStatus || "pending_hod",
  }));
}

export function resolveCoachingNote(noteId, decision) {
  const all = listCoachingForReview();
  const i = all.findIndex((n) => n.id === noteId);
  if (i < 0) return null;
  all[i] = {
    ...all[i],
    reviewStatus: decision,
    reviewedAt: new Date().toISOString(),
  };
  save(KEY.coachingReview, all);
  return all[i];
}

export { clusterFeedbackThemes };

/* ------------------------------------------------------------------ */
/* 5. Upload / data quality agent                                     */
/* ------------------------------------------------------------------ */

/**
 * Rich quality report before Mongo commit.
 */
export function runDataQualityAgent({ headers, rows, fileName } = {}) {
  const mapping = analyzeUploadMapping(headers || [], rows || []);
  const col = resolveColumnMap(headers || []);
  const issues = [...(mapping.warnings || [])];
  const findings = [];

  const idKey = col.prn || col.roll;
  const sectionKey = col.section;
  const attKey = col.attendance;
  const prns = new Set();
  const dupPrns = new Set();
  const sections = {};
  let missingId = 0;
  let lowAtt = 0;
  let oddAtt = 0;

  for (const row of rows || []) {
    const id = idKey ? String(row[idKey] ?? "").trim() : "";
    if (!id) missingId++;
    else if (prns.has(id)) dupPrns.add(id);
    else prns.add(id);

    if (sectionKey) {
      const sec = String(row[sectionKey] ?? "").trim() || "(blank)";
      sections[sec] = (sections[sec] || 0) + 1;
    }
    if (attKey) {
      const raw = String(row[attKey] ?? "").trim();
      const n = parseFloat(raw);
      if (Number.isFinite(n)) {
        if (n < 0 || n > 100) oddAtt++;
        if (n < 75 && n >= 0) lowAtt++;
      }
    }
  }

  if (missingId > 0) {
    // Rows without PRN are dropped on preprocess; warn instead of hard-blocking the whole file
    findings.push({
      level: "warn",
      code: "missing_id",
      message: `${missingId} row(s) missing Permanent Registration Number / Roll (will be skipped on commit).`,
    });
  }
  if (dupPrns.size > 0) {
    findings.push({
      level: "error",
      code: "duplicate_prn",
      message: `${dupPrns.size} duplicate ID(s) in file (e.g. ${[...dupPrns].slice(0, 3).join(", ")}).`,
    });
  }
  if (!col.prn && col.roll) {
    findings.push({
      level: "warn",
      code: "roll_only",
      message:
        "Only Roll No detected. Roll numbers restart per batch (TY-A / TY-B) and can merge students — prefer PRN Number.",
    });
  }
  const sectionNames = Object.keys(sections);
  if (sectionNames.length >= 2) {
    findings.push({
      level: "info",
      code: "multi_section",
      message: `Sections found: ${sectionNames.map((s) => `${s} (${sections[s]})`).join(", ")}.`,
    });
  } else if (sectionNames.length === 1) {
    findings.push({
      level: "warn",
      code: "single_section",
      message: `Only one section value seen (“${sectionNames[0]}”). If the file should include TY-A and TY-B, check the Section column.`,
    });
  }
  if (lowAtt > 0) {
    findings.push({
      level: "info",
      code: "below_75",
      message: `${lowAtt} row(s) with attendance below 75%.`,
    });
  }
  if (oddAtt > 0) {
    findings.push({
      level: "warn",
      code: "odd_attendance",
      message: `${oddAtt} attendance value(s) outside 0–100.`,
    });
  }

  const report = {
    id: id("dqa"),
    ts: new Date().toISOString(),
    fileName: fileName || null,
    rowCount: (rows || []).length,
    uniqueIds: prns.size,
    mapping,
    findings: [...findings, ...issues.map((w) => ({ level: w.level || "warn", message: w.message }))],
    sections,
    canCommit: !findings.some((f) => f.level === "error") && !issues.some((w) => w.level === "error"),
    agent: "data_quality",
  };
  save(KEY.dataQuality, report);
  return report;
}

export function getLastDataQualityReport() {
  return load(KEY.dataQuality, null);
}


/* ================================================================== */
/* HIGH-VALUE AUTOMATIONS (approve list → then act)                     */
/* ================================================================== */

/** 1. Attendance alert batch — below threshold → approval queue */
export function runAttendanceAlertBatch(students, { threshold = 75 } = {}) {
  const items = [];
  for (const s of students || []) {
    if (s.attendance == null || !Number.isFinite(Number(s.attendance))) continue;
    if (Number(s.attendance) >= threshold) continue;
    const tpl = buildParentMessage(s, "attendance");
    items.push({
      id: id("att"),
      prn: String(s.prn),
      studentName: s.name,
      cls: s.cls || s.className || "",
      attendance: Number(s.attendance),
      threshold,
      status: "pending", // pending | approved | skipped | sent
      draftSubject: tpl.subject,
      draftBody: tpl.body,
      channel: "email",
      agent: "attendance_batch",
      ts: new Date().toISOString(),
    });
  }
  items.sort((a, b) => a.attendance - b.attendance);
  save(KEY.attendanceBatch, items);
  return items;
}

export function listAttendanceBatch(filter = {}) {
  let all = load(KEY.attendanceBatch, []);
  if (filter.status) all = all.filter((x) => x.status === filter.status);
  return all;
}

export function resolveAttendanceBatchItem(itemId, decision, edits = {}) {
  const all = load(KEY.attendanceBatch, []);
  const i = all.findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  all[i] = { ...all[i], ...edits, status: decision, resolvedAt: new Date().toISOString() };
  save(KEY.attendanceBatch, all);
  return all[i];
}

export function approveAllAttendanceBatch() {
  const all = load(KEY.attendanceBatch, []);
  const next = all.map((x) =>
    x.status === "pending"
      ? { ...x, status: "approved", resolvedAt: new Date().toISOString() }
      : x
  );
  save(KEY.attendanceBatch, next);
  return next.filter((x) => x.status === "approved");
}

/** Mark approved attendance items as sent (after messaging API success). */
export function markAttendanceBatchSent(ids = null) {
  const all = load(KEY.attendanceBatch, []);
  const set = ids ? new Set(ids.map(String)) : null;
  const next = all.map((x) => {
    if (x.status !== "approved") return x;
    if (set && !set.has(String(x.id))) return x;
    return { ...x, status: "sent", sentAt: new Date().toISOString() };
  });
  save(KEY.attendanceBatch, next);
  return next.filter((x) => x.status === "sent");
}

/**
 * 2. After-UT / marks follow-up — failed or weak subject scores → draft notes
 */
export function runMarksFollowUpAgent(students, { failBelow = 8 } = {}) {
  const items = [];
  for (const s of students || []) {
    const weak = [];
    for (const m of s.marks || []) {
      const a = m.assessments || {};
      for (const key of ["UT-1", "UT-2", "UT-3", "UT1", "UT2", "UT3"]) {
        const v = a[key];
        if (v == null || !Number.isFinite(Number(v))) continue;
        if (Number(v) < failBelow) {
          weak.push({ subject: m.subject, assessment: key.replace("UT1", "UT-1").replace("UT2", "UT-2").replace("UT3", "UT-3"), score: Number(v) });
        }
      }
    }
    if (!weak.length) continue;
    const tpl = buildParentMessage(s, "marks");
    items.push({
      id: id("mfu"),
      prn: String(s.prn),
      studentName: s.name,
      cls: s.cls || s.className || "",
      weakSubjects: weak,
      status: "pending",
      draftSubject: tpl.subject,
      draftBody: tpl.body,
      rationale: `Weak/failing assessments: ${weak.map((w) => `${w.subject} ${w.assessment}=${w.score}`).join("; ")}`,
      agent: "marks_followup",
      ts: new Date().toISOString(),
    });
  }
  save(KEY.marksFollowUp, items);
  return items;
}

export function listMarksFollowUp(filter = {}) {
  let all = load(KEY.marksFollowUp, []);
  if (filter.status) all = all.filter((x) => x.status === filter.status);
  return all;
}

export function resolveMarksFollowUp(itemId, decision, edits = {}) {
  const all = load(KEY.marksFollowUp, []);
  const i = all.findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  all[i] = { ...all[i], ...edits, status: decision, resolvedAt: new Date().toISOString() };
  if (decision === "approved") {
    createIntervention({
      prn: all[i].prn,
      studentName: all[i].studentName,
      type: "remedial",
      reason: all[i].rationale,
      status: "open",
    });
  }
  save(KEY.marksFollowUp, all);
  return all[i];
}

/**
 * 3. Intervention reminders — open, no outcome, older than N days
 */
export function runInterventionReminderAgent(students, { olderThanDays = 7 } = {}) {
  // Reuse follow-up scan; store under reminders key for TG-facing label
  const suggestions = runInterventionFollowUpAgent(students, { olderThanDays });
  const reminders = suggestions.map((s) => ({
    ...s,
    agent: "intervention_reminder",
    notifyRole: "teacher_guide",
    title: `Reminder: intervention for ${s.studentName || s.prn}`,
  }));
  save(KEY.interventionReminders, reminders);
  return reminders;
}

export function listInterventionReminders() {
  return load(KEY.interventionReminders, []);
}

/**
 * 4. Upload quality gate — critical errors block commit unless override approved
 */
export function setUploadGateOverride(approved, meta = {}) {
  const rec = {
    approved: Boolean(approved),
    ts: new Date().toISOString(),
    ...meta,
  };
  save(KEY.uploadGateOverride, rec);
  return rec;
}

export function getUploadGateOverride() {
  return load(KEY.uploadGateOverride, { approved: false });
}

export function evaluateUploadGate(qualityReport) {
  const critical =
    qualityReport &&
    Array.isArray(qualityReport.findings) &&
    qualityReport.findings.some((f) => f.level === "error");
  const override = getUploadGateOverride();
  return {
    blocked: Boolean(critical) && !override.approved,
    critical,
    override,
    canCommit: !critical || override.approved,
  };
}

/**
 * 5. TG weekly digest — mentees at risk + suggested actions (approve plan)
 */
export function runTgWeeklyDigest(students, { tgId, tgName, tgIndex } = {}) {
  const pool = tgIndex != null ? studentsForTg(students, tgIndex) : students || [];
  const atRisk = [];
  for (const s of pool) {
    const status = currentStatusOf(s);
    const att = s.attendance;
    if (status !== "At Risk" && !(att != null && att < 75)) continue;
    const type = pickActionType(s, interventionEffectiveness());
    atRisk.push({
      prn: String(s.prn),
      studentName: s.name,
      cls: s.cls || s.className || "",
      status,
      attendance: att,
      suggestedAction: type,
      selected: true,
    });
  }
  const digest = {
    id: id("wdig"),
    ts: new Date().toISOString(),
    tgId: tgId || null,
    tgName: tgName || null,
    tgIndex: tgIndex ?? null,
    status: "pending", // pending | approved | skipped
    menteeCount: pool.length,
    items: atRisk,
    agent: "tg_weekly_digest",
  };
  const all = load(KEY.weeklyDigest, []);
  all.unshift(digest);
  save(KEY.weeklyDigest, all.slice(0, 30));
  return digest;
}

export function listWeeklyDigests() {
  return load(KEY.weeklyDigest, []);
}

export function resolveWeeklyDigest(digestId, decision, itemPrns = null) {
  const all = load(KEY.weeklyDigest, []);
  const i = all.findIndex((d) => d.id === digestId);
  if (i < 0) return null;
  const d = { ...all[i], status: decision, resolvedAt: new Date().toISOString() };
  if (itemPrns) {
    const set = new Set(itemPrns.map(String));
    d.items = (d.items || []).map((it) => ({ ...it, selected: set.has(String(it.prn)) }));
  }
  if (decision === "approved") {
    for (const it of d.items || []) {
      if (it.selected === false) continue;
      createIntervention({
        prn: it.prn,
        studentName: it.studentName,
        type: it.suggestedAction || "mentor_meeting",
        reason: `Weekly digest plan: ${it.status}, attendance ${it.attendance ?? "—"}`,
        ownerTgId: d.tgId,
        ownerName: d.tgName,
        status: "open",
      });
    }
  }
  all[i] = d;
  save(KEY.weeklyDigest, all);
  return d;
}

/**
 * 7. Defaulter / odd marks — review queue (from anomaly detector)
 */
export function runOddMarksReviewAgent(students) {
  const anomalies = detectMarksAnomalies(students) || [];
  const items = anomalies.map((a) => ({
    id: id("odd"),
    status: "pending", // pending | confirmed_issue | data_error | dismissed
    agent: "odd_marks",
    ts: new Date().toISOString(),
    ...a,
  }));
  save(KEY.oddMarks, items);
  return items;
}

export function listOddMarksReview(filter = {}) {
  let all = load(KEY.oddMarks, []);
  if (filter.status) all = all.filter((x) => x.status === filter.status);
  return all;
}

export function resolveOddMarksItem(itemId, decision) {
  const all = load(KEY.oddMarks, []);
  const i = all.findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  all[i] = { ...all[i], status: decision, resolvedAt: new Date().toISOString() };
  save(KEY.oddMarks, all);
  return all[i];
}

/**
 * 8. Slow-learner focus list — remedial nomination (approve names)
 */
export function runSlowLearnerFocusAgent(students) {
  const { slow } = partitionLearners(students || []);
  const items = slow.map((s) => ({
    id: id("slw"),
    prn: String(s.prn),
    studentName: s.name,
    cls: s.cls || s.className || "",
    attendance: s.attendance,
    averagePercentage: s.averagePercentage,
    status: "pending", // pending | nominated | skipped
    selected: true,
    agent: "slow_learner_focus",
    ts: new Date().toISOString(),
  }));
  save(KEY.slowLearnerList, items);
  return items;
}

export function listSlowLearnerFocus(filter = {}) {
  let all = load(KEY.slowLearnerList, []);
  if (filter.status) all = all.filter((x) => x.status === filter.status);
  return all;
}

export function resolveSlowLearnerItem(itemId, decision) {
  const all = load(KEY.slowLearnerList, []);
  const i = all.findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  all[i] = { ...all[i], status: decision, resolvedAt: new Date().toISOString() };
  if (decision === "nominated") {
    createIntervention({
      prn: all[i].prn,
      studentName: all[i].studentName,
      type: "remedial",
      reason: "Nominated via slow-learner focus agent",
      status: "open",
    });
  }
  save(KEY.slowLearnerList, all);
  return all[i];
}

export function nominateAllSlowLearners() {
  const all = load(KEY.slowLearnerList, []);
  const next = all.map((x) => {
    if (x.status !== "pending") return x;
    createIntervention({
      prn: x.prn,
      studentName: x.studentName,
      type: "remedial",
      reason: "Nominated via slow-learner focus agent (batch)",
      status: "open",
    });
    return { ...x, status: "nominated", resolvedAt: new Date().toISOString() };
  });
  save(KEY.slowLearnerList, next);
  return next.filter((x) => x.status === "nominated");
}

/**
 * 9. Exam-window push — recoverable before next UT date
 */
export function runExamWindowAgent(students) {
  const days = typeof daysUntilExam === "function" ? daysUntilExam() : 21;
  const examDate = typeof getNextExamDate === "function" ? getNextExamDate() : null;
  const items = [];
  for (const s of students || []) {
    const status = currentStatusOf(s);
    if (status === "Good") continue;
    const att = s.attendance;
    const avg = s.averagePercentage;
    // Recoverable: not critically low attendance, some headroom before exam
    const recoverable =
      days >= 3 &&
      (att == null || att >= 60) &&
      (status === "Average" || status === "At Risk") &&
      (avg == null || avg >= 40);
    if (!recoverable) continue;
    items.push({
      id: id("exw"),
      prn: String(s.prn),
      studentName: s.name,
      cls: s.cls || s.className || "",
      status: "pending",
      riskStatus: status,
      attendance: att,
      averagePercentage: avg,
      daysLeft: days,
      examDate,
      rationale: `${days} day(s) to exam window — still recoverable with focused support.`,
      agent: "exam_window",
      ts: new Date().toISOString(),
    });
  }
  items.sort((a, b) => (a.attendance ?? 100) - (b.attendance ?? 100));
  save(KEY.examWindow, items);
  return items;
}

export function listExamWindow(filter = {}) {
  let all = load(KEY.examWindow, []);
  if (filter.status) all = all.filter((x) => x.status === filter.status);
  return all;
}

export function resolveExamWindowItem(itemId, decision) {
  const all = load(KEY.examWindow, []);
  const i = all.findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  all[i] = { ...all[i], status: decision, resolvedAt: new Date().toISOString() };
  if (decision === "approved") {
    createIntervention({
      prn: all[i].prn,
      studentName: all[i].studentName,
      type: "mentor_meeting",
      reason: all[i].rationale,
      status: "open",
    });
  }
  save(KEY.examWindow, all);
  return all[i];
}


/**
 * HOD status notify automation
 * Pick statuses (At Risk / Average / Good) → agent builds full list + drafts →
 * one approval → agent sends. Prefer model-backed status from cohort when available;
 * calibrated ML confidence is shown on student views after /predict.
 */
export function runStatusNotifyBatch(students, {
  statuses = ["At Risk"],
  mode = "full",
  channel = "email",
} = {}) {
  const want = new Set((statuses || []).map(String));
  const items = [];
  for (const s of students || []) {
    const st = currentStatusOf(s);
    if (!want.has(st)) continue;
    const tpl = buildParentMessage(
      s,
      mode === "attendance" ? "attendance" : mode === "marks" ? "marks" : "full"
    );
    items.push({
      id: id("snt"),
      prn: String(s.prn),
      studentName: s.name,
      cls: s.cls || s.className || "",
      academicStatus: st,
      attendance: s.attendance,
      averagePercentage: s.averagePercentage,
      email: s.email || s.parentEmail || null,
      phone: s.phone || s.parentPhone || null,
      status: "pending", // pending | approved | skipped | sent | failed
      mode,
      channel,
      draftSubject: tpl.subject,
      draftBody: tpl.body,
      agent: "status_notify",
      ts: new Date().toISOString(),
      error: null,
    });
  }
  // Risk first, then by attendance ascending
  const order = { "At Risk": 0, Average: 1, Good: 2 };
  items.sort((a, b) => {
    const oa = order[a.academicStatus] ?? 9;
    const ob = order[b.academicStatus] ?? 9;
    if (oa !== ob) return oa - ob;
    return (a.attendance ?? 100) - (b.attendance ?? 100);
  });
  save(KEY.statusNotify, {
    statuses: [...want],
    mode,
    channel,
    items,
    createdAt: new Date().toISOString(),
  });
  return items;
}

export function getStatusNotifyBatch() {
  return load(KEY.statusNotify, { items: [], statuses: [], mode: "full", channel: "email" });
}

export function listStatusNotify(filter = {}) {
  let items = getStatusNotifyBatch().items || [];
  if (filter.status) items = items.filter((x) => x.status === filter.status);
  return items;
}

export function resolveStatusNotifyItem(itemId, decision, edits = {}) {
  const batch = getStatusNotifyBatch();
  const items = batch.items || [];
  const i = items.findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  items[i] = { ...items[i], ...edits, status: decision, resolvedAt: new Date().toISOString() };
  batch.items = items;
  save(KEY.statusNotify, batch);
  return items[i];
}

export function approveAllStatusNotify() {
  const batch = getStatusNotifyBatch();
  batch.items = (batch.items || []).map((x) =>
    x.status === "pending"
      ? { ...x, status: "approved", resolvedAt: new Date().toISOString() }
      : x
  );
  save(KEY.statusNotify, batch);
  return (batch.items || []).filter((x) => x.status === "approved");
}

/**
 * After HOD approval: agent sends all approved items in bulk via /api/messages/send-batch.
 * Supports 60–100+ messages in one run (chunks of 100). Falls back to single send if needed.
 * authHeadersFn() → Authorization headers from the logged-in HOD.
 */
export async function executeStatusNotifySend({ authHeadersFn, apiBase } = {}) {
  const API =
    apiBase ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
    "";
  const batch = getStatusNotifyBatch();
  const headers = {
    "Content-Type": "application/json",
    ...(typeof authHeadersFn === "function" ? authHeadersFn() : {}),
  };
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };
  const items = batch.items || [];

  const payload = [];
  const mapIndex = [];

  for (let i = 0; i < items.length; i++) {
    const x = items[i];
    if (x.status !== "approved") {
      results.skipped += 1;
      continue;
    }
    const channel = x.channel || "email";
    const to = channel === "email" ? x.email : x.phone;
    if (!to) {
      items[i] = {
        ...x,
        status: "failed",
        error: channel === "email" ? "No email on student record" : "No phone on student record",
        resolvedAt: new Date().toISOString(),
      };
      results.failed += 1;
      results.errors.push(`${x.studentName}: missing contact`);
      continue;
    }
    mapIndex.push(i);
    payload.push({
      channel,
      to,
      subject: x.draftSubject,
      text: x.draftBody,
      studentPrn: x.prn,
      studentName: x.studentName,
      mode: x.mode || "full",
    });
  }

  if (!payload.length) {
    batch.items = items;
    save(KEY.statusNotify, batch);
    return results;
  }

  const CHUNK = 100;
  for (let start = 0; start < payload.length; start += CHUNK) {
    const chunk = payload.slice(start, start + CHUNK);
    const chunkMap = mapIndex.slice(start, start + CHUNK);
    try {
      const res = await fetch(`${API}/api/messages/send-batch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ items: chunk }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 404) {
        // Older server without batch route — sequential singles
        for (let j = 0; j < chunk.length; j++) {
          const itemIdx = chunkMap[j];
          const x = items[itemIdx];
          try {
            const one = await fetch(`${API}/api/messages/send`, {
              method: "POST",
              headers,
              body: JSON.stringify(chunk[j]),
            });
            const oneData = await one.json().catch(() => ({}));
            if (!one.ok) {
              items[itemIdx] = {
                ...x,
                status: "failed",
                error: oneData.error || one.statusText,
                resolvedAt: new Date().toISOString(),
              };
              results.failed += 1;
              results.errors.push(`${x.studentName}: ${oneData.error || one.statusText}`);
            } else {
              items[itemIdx] = {
                ...x,
                status: "sent",
                error: null,
                messageId: oneData.messageId || null,
                dryRun: oneData.dryRun || false,
                sentAt: new Date().toISOString(),
              };
              results.sent += 1;
            }
          } catch (e) {
            items[itemIdx] = {
              ...x,
              status: "failed",
              error: String(e.message || e),
              resolvedAt: new Date().toISOString(),
            };
            results.failed += 1;
            results.errors.push(`${x.studentName}: ${e.message || e}`);
          }
        }
        continue;
      }

      if (!res.ok) {
        for (const itemIdx of chunkMap) {
          const x = items[itemIdx];
          items[itemIdx] = {
            ...x,
            status: "failed",
            error: data.error || res.statusText,
            resolvedAt: new Date().toISOString(),
          };
          results.failed += 1;
          results.errors.push(`${x.studentName}: ${data.error || res.statusText}`);
        }
        continue;
      }

      const arr = Array.isArray(data.results) ? data.results : [];
      for (let j = 0; j < chunkMap.length; j++) {
        const itemIdx = chunkMap[j];
        const x = items[itemIdx];
        const r = arr.find((row) => Number(row.index) === j) || arr[j];
        if (r?.ok) {
          items[itemIdx] = {
            ...x,
            status: "sent",
            error: null,
            messageId: r.messageId || null,
            dryRun: r.dryRun || data.dryRun || false,
            sentAt: new Date().toISOString(),
          };
          results.sent += 1;
        } else {
          items[itemIdx] = {
            ...x,
            status: "failed",
            error: r?.error || "Send failed",
            resolvedAt: new Date().toISOString(),
          };
          results.failed += 1;
          results.errors.push(`${x.studentName}: ${r?.error || "Send failed"}`);
        }
      }
    } catch (e) {
      for (const itemIdx of chunkMap) {
        const x = items[itemIdx];
        items[itemIdx] = {
          ...x,
          status: "failed",
          error: String(e.message || e),
          resolvedAt: new Date().toISOString(),
        };
        results.failed += 1;
        results.errors.push(`${x.studentName}: ${e.message || e}`);
      }
    }
  }

  batch.items = items;
  save(KEY.statusNotify, batch);
  return results;
}
