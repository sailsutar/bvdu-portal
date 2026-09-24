import { parseYearBatch, subjectPrimaryYearMap, subjectBelongsToYear } from "@/lib/year-batch";
/**
 * Advanced Intelligence — 12 research/ops modules on top of Academic Intelligence.
 * Persistence: MongoDB via remote-state (local mirror for sync reads).
 */

import {
  estimateUplift,
  rankStudentsByUplift,
  listInterventions,
  interventionEffectiveness,
  createIntervention,
  getAiSettings,
  audit,
  predictStudentCOAttainment,
  cohortCOSummary,
  getObeMap,
  listOutcomes
} from "@/lib/academic-intelligence";
import { learnerSignals, learnerBand, batchSortKey, studentsForTg } from "@/lib/tg-assign";
import { currentStatusOf } from "@/lib/ml-predict";
import { readLocalMirror, saveRemoteState } from "@/lib/remote-state";
import { buildParentMessage } from "@/lib/parent-message-templates";

const K = {
  agentDrafts: "bvu.adv.agentDrafts",
  peerPairs: "bvu.adv.peerPairs",
  topics: "bvu.adv.weakTopics",
  coaching: "bvu.adv.coachingNotes",
  curriculum: "bvu.adv.curriculumGraph",
  mlops: "bvu.adv.mlops",
  digests: "bvu.adv.digests",
  anomalies: "bvu.adv.anomalies",
  nextExam: "bvu.adv.nextExamDate",
};

function load(key, fb) {
  return readLocalMirror(key, fb);
}

function notifyIntelligenceConflict() {
  // Derived / concurrent writes are common when opening Advanced Intelligence.
  // Do not interrupt the HOD with a browser alert — silently refresh local mirror.
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("bvu:intelligence-conflict", {
      detail: { message: "Intelligence state refreshed from server." },
    }));
  } catch { /* ignore */ }
}

function save(key, v) {
  void saveRemoteState(key, v).then((result) => {
    if (result?.conflict) {
      notifyIntelligenceConflict();
      try {
        window.dispatchEvent(new Event("bvu:intelligence-reload"));
      } catch { /* ignore */ }
    }
  });
}

/* ================================================================== */
/* 5. Window of opportunity — urgency clock                            */
/* ================================================================== */
export function getNextExamDate() {
  return load(K.nextExam, null);
}
export function setNextExamDate(iso) {
  save(K.nextExam, iso);
  audit("urgency.nextExam", { iso });
}

/** Days until next UT/exam; default 21 if unset */
export function daysUntilExam() {
  const iso = getNextExamDate();
  if (!iso) return 21;
  const d = (new Date(iso).getTime() - Date.now()) / (86400000);
  return Math.max(0, Math.ceil(d));
}

/**
 * Urgency 0–1: high if at-risk, low uplift window remaining, compounding risk.
 * Decays as exam approaches (less time to recover → higher urgency).
 */
export function urgencyScore(student) {
  const days = daysUntilExam();
  const timePressure = 1 - Math.min(1, days / 30); // closer exam → higher
  const status = currentStatusOf(student);
  const sig = learnerSignals(student);
  const uplift = estimateUplift(student);

  let severity = 0.3;
  if (status === "At Risk") severity = 0.85;
  else if (status === "Average") severity = 0.45;
  if (sig.attendance != null && sig.attendance < 65) severity += 0.1;
  if (sig.meanUt != null && sig.meanUt < 8) severity += 0.1;

  // High uplift + little time = act now; already Good = low urgency
  const opportunity = status === "Good" ? 0.1 : Math.min(1, uplift + 0.2);
  const u = Math.min(0.99, 0.4 * severity + 0.35 * timePressure + 0.25 * opportunity);
  return {
    urgency: Math.round(u * 1000) / 1000,
    daysLeft: days,
    label: u >= 0.7 ? "critical" : u >= 0.45 ? "soon" : "monitor",
  };
}

export function rankByUrgency(students) {
  return [...(students || [])]
    .map((s) => ({ student: s, ...urgencyScore(s), uplift: estimateUplift(s), status: currentStatusOf(s) }))
    .sort((a, b) => b.urgency - a.urgency);
}

/* ================================================================== */
/* 1. Autonomous TG Action Agent                                       */
/* ================================================================== */
function pickActionType(student, eff) {
  const sig = learnerSignals(student);
  const rates = Object.fromEntries((eff || []).map((e) => [e.type, e.rate ?? 0]));
  // Prefer historically successful types when available
  if (sig.attendance != null && sig.attendance < 75) {
    if ((rates.parent_mail ?? 0) >= (rates.mentor_meeting ?? 0)) return "parent_mail";
    return "attendance_plan";
  }
  if (sig.meanUt != null && sig.meanUt < 10) return "remedial";
  return "mentor_meeting";
}

export function runTgActionAgent(students, { tgId, tgName, tgIndex } = {}) {
  const pool = tgIndex != null ? studentsForTg(students, tgIndex) : students || [];
  const eff = interventionEffectiveness();
  const settings = getAiSettings();
  const ranked = rankByUrgency(pool).slice(0, Math.max(3, Math.ceil(pool.length * (settings.flagRateCap || 0.15))));

  const drafts = [];
  for (const row of ranked) {
    if (row.status === "Good" && row.urgency < 0.4) continue;
    const type = pickActionType(row.student, eff);
    const tpl = buildParentMessage(row.student, type === "attendance_plan" ? "attendance" : "full");
    const sig = learnerSignals(row.student);
    const draft = {
      id: `agd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: new Date().toISOString(),
      prn: String(row.student.prn),
      studentName: row.student.name,
      tgId: tgId || null,
      tgName: tgName || null,
      status: "pending", // pending | approved | edited | skipped
      actionType: type,
      urgency: row.urgency,
      urgencyLabel: row.label,
      daysLeft: row.daysLeft,
      uplift: row.uplift,
      riskStatus: row.status,
      drivers: [
        sig.attendance != null ? `Attendance ${sig.attendance}%` : null,
        sig.meanUt != null ? `Mean Unit Test ${sig.meanUt.toFixed(1)}/20 (${sig.utBasis})` : null,
        sig.utFailRate != null ? `Unit Test fail rate ${(sig.utFailRate * 100).toFixed(0)}%` : null,
      ].filter(Boolean),
      rationale: `Urgency ${(row.urgency * 100).toFixed(0)}% · ${row.daysLeft}d to exam window · uplift ${(row.uplift * 100).toFixed(0)}%. Recommended ${type} based on drivers + past effectiveness.`,
      draftSubject: tpl.subject,
      draftBody: tpl.body,
      channelHint: type === "parent_mail" ? "whatsapp" : "email",
    };
    drafts.push(draft);
  }
  const all = load(K.agentDrafts, []);
  // Replace pending for this TG
  const kept = all.filter((d) => d.status !== "pending" || (tgId && d.tgId !== tgId));
  const next = [...drafts, ...kept].slice(0, 200);
  save(K.agentDrafts, next);
  audit("agent.run", { tgId, n: drafts.length });
  return drafts;
}

export function listAgentDrafts(filter = {}) {
  let all = load(K.agentDrafts, []);
  if (filter.tgId) all = all.filter((d) => d.tgId === filter.tgId);
  if (filter.status) all = all.filter((d) => d.status === filter.status);
  return all;
}

export function resolveAgentDraft(id, decision, edits = {}) {
  const all = load(K.agentDrafts, []);
  const i = all.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const d = { ...all[i], ...edits, status: decision, resolvedAt: new Date().toISOString() };
  all[i] = d;
  save(K.agentDrafts, all);
  if (decision === "approved") {
    createIntervention({
      prn: d.prn,
      studentName: d.studentName,
      type: d.actionType,
      ownerTgId: d.tgId,
      ownerName: d.tgName,
      reason: d.rationale,
      drivers: d.drivers,
      upliftScore: d.uplift,
    });
  }
  audit("agent.resolve", { id, decision });
  return d;
}

/* ================================================================== */
/* 10. What-if / counterfactual simulator                              */
/* ================================================================== */
/**
 * Heuristic re-score status under perturbed features (attendance %, mean Unit Test /20).
 * Uses same thresholds as portal rules + band logic approximation.
 */
export function simulateTrajectory(student, { attendance, meanUt } = {}) {
  const sig = learnerSignals(student);
  const att = attendance != null ? attendance : sig.attendance;
  const ut = meanUt != null ? meanUt : sig.meanUt;
  const utPct = ut != null ? (ut / 20) * 100 : sig.meanUtPct;

  let status = "Average";
  if ((att != null && att < 65) || (utPct != null && utPct < 50) || (ut != null && ut < 8)) status = "At Risk";
  else if ((att == null || att >= 80) && (ut == null || ut >= 14) && (utPct == null || utPct >= 70)) status = "Good";

  const baseline = currentStatusOf(student);
  return {
    baseline,
    simulated: status,
    flipped: baseline !== status,
    inputs: { attendance: att, meanUt: ut, meanUtPct: utPct },
  };
}

/** Minimum change to leave At Risk (or reach Good) — simple grid search */
export function minimumActionableChange(student) {
  const sig = learnerSignals(student);
  const baseAtt = sig.attendance ?? 70;
  const baseUt = sig.meanUt ?? 10;
  const baseline = currentStatusOf(student);
  if (baseline === "Good") return { alreadyGood: true };

  const target = baseline === "At Risk" ? "Average" : "Good";
  let best = null;
  for (let dAtt = 0; dAtt <= 25; dAtt += 1) {
    for (let dUt = 0; dUt <= 8; dUt += 0.5) {
      const r = simulateTrajectory(student, { attendance: Math.min(100, baseAtt + dAtt), meanUt: Math.min(20, baseUt + dUt) });
      if (r.simulated === target || (target === "Average" && r.simulated !== "At Risk")) {
        const cost = dAtt / 25 + dUt / 8;
        if (!best || cost < best.cost) {
          best = {
            target: r.simulated,
            deltaAttendance: dAtt,
            deltaMeanUt: dUt,
            newAttendance: Math.min(100, baseAtt + dAtt),
            newMeanUt: Math.min(20, baseUt + dUt),
            cost,
          };
        }
      }
    }
  }
  return best || { unreachable: true, target };
}

/* ================================================================== */
/* 6. Peer tutoring matcher                                            */
/* ================================================================== */
function subjectWeakness(student) {
  const weak = [];
  for (const m of student?.marks || []) {
    const a = m.assessments || {};
    const scores = [];
    for (const [k, v] of Object.entries(a)) {
      if (/^ut/i.test(String(k).replace(/[\s_-]/g, ""))) {
        const n = Number(v);
        if (Number.isFinite(n)) scores.push(n);
      }
    }
    if (!scores.length && m.average != null) scores.push(Number(m.average));
    if (!scores.length) continue;
    const mean = scores.reduce((x, y) => x + y, 0) / scores.length;
    if (mean < 10) weak.push({ subject: m.subject, mean });
  }
  return weak.sort((a, b) => a.mean - b.mean);
}

function subjectStrength(student) {
  const strong = [];
  for (const m of student?.marks || []) {
    const a = m.assessments || {};
    const scores = [];
    for (const [k, v] of Object.entries(a)) {
      if (/^ut/i.test(String(k).replace(/[\s_-]/g, ""))) {
        const n = Number(v);
        if (Number.isFinite(n)) scores.push(n);
      }
    }
    if (!scores.length && m.average != null) scores.push(Number(m.average));
    if (!scores.length) continue;
    const mean = scores.reduce((x, y) => x + y, 0) / scores.length;
    if (mean >= 14) strong.push({ subject: m.subject, mean });
  }
  return strong.sort((a, b) => b.mean - a.mean);
}

export function matchPeerTutors(students) {
  const list = students || [];
  const pairs = [];
  for (const weakS of list) {
    const weaknesses = subjectWeakness(weakS);
    if (!weaknesses.length) continue;
    const top = weaknesses[0];
    let best = null;
    for (const strongS of list) {
      if (String(strongS.prn) === String(weakS.prn)) continue;
      const strengths = subjectStrength(strongS);
      const hit = strengths.find((s) => s.subject === top.subject);
      if (!hit) continue;
      const score = hit.mean - top.mean;
      if (!best || score > best.score) {
        best = { tutor: strongS, score, subject: top.subject, learnerMean: top.mean, tutorMean: hit.mean };
      }
    }
    if (best) {
      pairs.push({
        id: `peer_${weakS.prn}_${best.subject}`,
        learnerPrn: weakS.prn,
        learnerName: weakS.name,
        tutorPrn: best.tutor.prn,
        tutorName: best.tutor.name,
        subject: best.subject,
        learnerMean: best.learnerMean,
        tutorMean: best.tutorMean,
        matchScore: Math.round(best.score * 10) / 10,
        status: "suggested",
      });
    }
  }
  save(K.peerPairs, pairs);
  audit("peer.match", { n: pairs.length });
  return pairs;
}

export function listPeerPairs() {
  return load(K.peerPairs, []);
}

/* ================================================================== */
/* 2. Weak-topic remediation from marks                                */
/* ================================================================== */
export function detectWeakTopics(students, { allStudents = null } = {}) {
  const primary = subjectPrimaryYearMap(allStudents || students);
  // Infer year of this filtered slice (if homogeneous)
  const yearsInView = new Set();
  for (const s of students || []) {
    const y = parseYearBatch(s).year;
    if (y && y !== "Unspecified") yearsInView.add(y);
  }
  const singleYear = yearsInView.size === 1 ? [...yearsInView][0] : null;

  const bySubject = {};
  for (const s of students || []) {
    for (const m of s.marks || []) {
      const sub = m.subject || "Unknown";
      if (singleYear && !subjectBelongsToYear(sub, singleYear, primary)) continue;
      bySubject[sub] ??= { scores: [], nStudents: 0, fails: 0 };
      bySubject[sub].nStudents += 1;
      const a = m.assessments || {};
      let any = false;
      for (const [k, v] of Object.entries(a)) {
        if (!/^ut/i.test(String(k).replace(/[\s_-]/g, ""))) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        bySubject[sub].scores.push(n);
        any = true;
        if (n < 8) bySubject[sub].fails += 1;
      }
      if (!any && m.average != null) {
        bySubject[sub].scores.push(Number(m.average));
        if (Number(m.average) < 8) bySubject[sub].fails += 1;
      }
    }
  }
  const topics = Object.entries(bySubject)
    .map(([subject, v]) => {
      const mean = v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null;
      const failRate = v.scores.length ? v.fails / v.scores.length : null;
      return {
        subject,
        meanUt: mean != null ? Math.round(mean * 10) / 10 : null,
        failRate,
        nScores: v.scores.length,
        weak: mean != null && (mean < 10 || (failRate != null && failRate >= 0.35)),
        remediation: mean != null && mean < 10
          ? `Remedial focus on ${subject}: mean Unit Test ${mean.toFixed(1)}/20. Suggest 1 short worksheet on fundamentals + 2 worked examples before next UT.`
          : null,
      };
    })
    .sort((a, b) => (a.meanUt ?? 99) - (b.meanUt ?? 99));
  // In-memory only — avoid remote write on every page open
  return topics;
}

export function listWeakTopics() {
  return load(K.topics, []);
}

/* ================================================================== */
/* 3. Feedback → coaching notes                                        */
/* ================================================================== */
const THEME_RULES = [
  { id: "pace", re: /pace|fast|slow|speed|rush/i, label: "Pace of teaching" },
  { id: "clarity", re: /unclear|confus|not clear|hard to understand|explain/i, label: "Clarity of explanation" },
  { id: "assignments", re: /assignment|homework|deadline|workload/i, label: "Assignments / workload" },
  { id: "support", re: /help|available|approach|support|doubt/i, label: "Support availability" },
  { id: "materials", re: /notes|material|slide|resource|book/i, label: "Learning materials" },
];

export function clusterFeedbackThemes(feedbacks) {
  const themes = {};
  for (const f of feedbacks || []) {
    if (f.sentiment && f.sentiment !== "bad" && f.sentiment !== "negative") continue;
    const text = String(f.text || f.summary || "");
    let hit = false;
    for (const rule of THEME_RULES) {
      if (rule.re.test(text)) {
        themes[rule.id] ??= { id: rule.id, label: rule.label, count: 0, samples: [] };
        themes[rule.id].count += 1;
        if (themes[rule.id].samples.length < 3) themes[rule.id].samples.push(text.slice(0, 120));
        hit = true;
      }
    }
    if (!hit && text) {
      themes.other ??= { id: "other", label: "Other concerns", count: 0, samples: [] };
      themes.other.count += 1;
      if (themes.other.samples.length < 3) themes.other.samples.push(text.slice(0, 120));
    }
  }
  return Object.values(themes).sort((a, b) => b.count - a.count);
}

export function draftTeacherCoachingNotes(feedbacks) {
  const byTeacher = {};
  for (const f of feedbacks || []) {
    const tid = f.teacherId || f.teacher || "unknown";
    byTeacher[tid] ??= [];
    byTeacher[tid].push(f);
  }
  const notes = [];
  for (const [teacherId, list] of Object.entries(byTeacher)) {
    const themes = clusterFeedbackThemes(list);
    if (!themes.length) continue;
    const top = themes.slice(0, 2).map((t) => t.label).join("; ");
    notes.push({
      id: `coach_${teacherId}_${Date.now()}`,
      teacherId,
      ts: new Date().toISOString(),
      themeSummary: top,
      negativeCount: list.filter((f) => f.sentiment === "bad" || f.sentiment === "negative").length,
      note: `Private coaching note: Recent student feedback clusters around “${top}”. Consider one concrete adjustment next fortnight and re-check feedback volume.`,
      themes,
    });
  }
  save(K.coaching, notes);
  audit("feedback.coaching", { n: notes.length });
  return notes;
}

export function listCoachingNotes() {
  return load(K.coaching, []);
}

/* ================================================================== */
/* 4. Self-updating Outcome-Based Education evidence document                              */
/* ================================================================== */
export function buildObeEvidenceDocument(students) {
  const map = getObeMap();
  const cos = cohortCOSummary(students);
  const topics = detectWeakTopics(students);
  const outs = listOutcomes();
  const ints = listInterventions();
  const lines = [];
  lines.push(`# OBE / Accreditation Evidence Pack`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Program: ${map.program}`);
  lines.push(`Cohort size: ${students?.length || 0}`);
  lines.push(``);
  lines.push(`## 1. Predicted CO attainment (mid-term)`);
  lines.push(`| CO | Title | Mean predicted % | Target % | % students below |`);
  lines.push(`|----|-------|------------------|----------|------------------|`);
  for (const c of cos) {
    lines.push(`| ${c.coId} | ${c.title} | ${c.meanPredicted ?? "—"} | ${c.targetPct} | ${c.pctStudentsBelow ?? "—"} |`);
  }
  lines.push(``);
  lines.push(`## 2. Weak subject signals (remediation)`);
  for (const t of topics.filter((x) => x.weak)) {
    lines.push(`- **${t.subject}**: mean Unit Test ${t.meanUt}; ${t.remediation}`);
  }
  lines.push(``);
  lines.push(`## 3. Closed-loop interventions`);
  lines.push(`- Open interventions: ${ints.filter((i) => i.status === "open").length}`);
  lines.push(`- Completed: ${ints.filter((i) => i.status === "done").length}`);
  lines.push(`- Outcomes logged: ${outs.length} (improved: ${outs.filter((o) => o.improved).length})`);
  lines.push(``);
  lines.push(`## 4. Declaration`);
  lines.push(`This pack was auto-compiled from portal early-warning, OBE forecasts, and intervention logs for continuous improvement evidence.`);
  const markdown = lines.join("\n");
  return { markdown, generatedAt: new Date().toISOString(), cos, weakTopics: topics.filter((t) => t.weak) };
}

/* ================================================================== */
/* 7. Cross-cohort structural risk                                     */
/* ================================================================== */
export function detectStructuralRisks(students) {
  // Within current cohort: subject co-weakness patterns (proxy until multi-year store exists)
  const subjectFailers = {};
  for (const s of students || []) {
    for (const w of subjectWeakness(s)) {
      subjectFailers[w.subject] ??= new Set();
      subjectFailers[w.subject].add(String(s.prn));
    }
  }
  const subjects = Object.keys(subjectFailers);
  const edges = [];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const a = subjectFailers[subjects[i]];
      const b = subjectFailers[subjects[j]];
      let inter = 0;
      for (const p of a) if (b.has(p)) inter++;
      const union = a.size + b.size - inter;
      const jaccard = union ? inter / union : 0;
      if (inter >= 2 && jaccard >= 0.25) {
        edges.push({
          from: subjects[i],
          to: subjects[j],
          coWeakStudents: inter,
          jaccard: Math.round(jaccard * 100) / 100,
          insight: `Students weak in ${subjects[i]} often also weak in ${subjects[j]} (${inter} shared). Consider joint remediation or prerequisite review.`,
        });
      }
    }
  }
  edges.sort((x, y) => y.coWeakStudents - x.coWeakStudents);

  // Batch structural underperformance
  const batches = {};
  for (const s of students || []) {
    const b = batchSortKey(s).batch;
    batches[b] ??= { n: 0, atRisk: 0 };
    batches[b].n += 1;
    if (currentStatusOf(s) === "At Risk") batches[b].atRisk += 1;
  }
  const batchFlags = Object.entries(batches)
    .map(([batch, v]) => ({
      batch,
      n: v.n,
      atRiskRate: v.n ? v.atRisk / v.n : 0,
      flag: v.n >= 5 && v.atRisk / v.n >= 0.35,
    }))
    .filter((x) => x.flag);

  // Flat list for UI (always an array)
  const list = [];
  for (const e of edges) {
    list.push({
      type: "subject_link",
      label: e.insight,
      message: e.insight,
      from: e.from,
      to: e.to,
      coWeakStudents: e.coWeakStudents,
      jaccard: e.jaccard,
    });
  }
  for (const b of batchFlags) {
    const msg = `Batch ${b.batch}: ${(b.atRiskRate * 100).toFixed(0)}% at risk (${b.n} students) — structural underperformance.`;
    list.push({
      type: "batch_flag",
      label: msg,
      message: msg,
      batch: b.batch,
      n: b.n,
      atRiskRate: b.atRiskRate,
    });
  }
  return list;
}

/* ================================================================== */
/* 8. Marks anomaly guard                                              */
/* ================================================================== */
export function detectMarksAnomalies(students) {
  const anomalies = [];
  const subjScores = {};
  for (const s of students || []) {
    for (const m of s.marks || []) {
      const sub = m.subject;
      for (const [k, v] of Object.entries(m.assessments || {})) {
        if (!/^ut/i.test(String(k).replace(/[\s_-]/g, ""))) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        subjScores[sub] ??= [];
        subjScores[sub].push(n);
      }
    }
  }
  const stats = {};
  for (const [sub, arr] of Object.entries(subjScores)) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    stats[sub] = { mean, std: Math.sqrt(variance) };
  }

  for (const s of students || []) {
    const personal = [];
    for (const m of s.marks || []) {
      for (const [k, v] of Object.entries(m.assessments || {})) {
        if (!/^ut/i.test(String(k).replace(/[\s_-]/g, ""))) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        personal.push({ n, subject: m.subject, assessment: k });
        const st = stats[m.subject];
        if (st && st.std > 0.5 && Math.abs(n - st.mean) > 2.5 * st.std) {
          const direction = n > st.mean ? "up" : "down";
          const arrow = direction === "up" ? "↑" : "↓";
          anomalies.push({
            type: "outlier_vs_class",
            prn: s.prn,
            name: s.name,
            subject: m.subject,
            assessment: k,
            score: n,
            classMean: Math.round(st.mean * 10) / 10,
            direction,
            arrow,
            detail:
              `${arrow} ${k} score ${n}/20 is far from the class average ${st.mean.toFixed(1)} in ${m.subject}. ` +
              (direction === "down"
                ? "Possible underperformance or entry error — review this paper."
                : "Unusually high vs class — confirm marks or note strong performance."),
          });
        }
      }
    }
    if (personal.length >= 3) {
      const pMean = personal.reduce((a, b) => a + b.n, 0) / personal.length;
      for (const row of personal) {
        if (Math.abs(row.n - pMean) >= 8) {
          const direction = row.n > pMean ? "up" : "down";
          const arrow = direction === "up" ? "↑" : "↓";
          anomalies.push({
            type: "outlier_vs_self",
            prn: s.prn,
            name: s.name,
            subject: row.subject,
            assessment: row.assessment,
            score: row.n,
            selfMean: Math.round(pMean * 10) / 10,
            direction,
            arrow,
            detail:
              `${arrow} ${row.assessment} in ${row.subject}: score ${row.n}/20 vs this student's typical ${pMean.toFixed(1)}. ` +
              (direction === "down"
                ? "Sharp drop relative to their other papers — check for absence, weak topic, or data issue."
                : "Sharp rise relative to their other papers — may be recovery or a recording spike."),
          });
        }
      }
    }
  }
  // Prefer larger deviations first
  anomalies.sort((a, b) => {
    const da = Math.abs((a.score || 0) - (a.classMean ?? a.selfMean ?? 0));
    const db = Math.abs((b.score || 0) - (b.classMean ?? b.selfMean ?? 0));
    return db - da;
  });
  return anomalies.slice(0, 100);
}

export function listAnomalies() {
  return load(K.anomalies, []);
}

/* ================================================================== */
/* 9. Silent cohort digest                                             */
/* ================================================================== */
export function buildCohortDigest(students, { tgIndex, tgName } = {}) {
  const pool = tgIndex != null ? studentsForTg(students, tgIndex) : students || [];
  let atRisk = 0,
    slow = 0,
    lowAtt = 0;
  for (const s of pool) {
    if (currentStatusOf(s) === "At Risk") atRisk++;
    if (learnerBand(s) === "slow") slow++;
    const sig = learnerSignals(s);
    if (sig.attendance != null && sig.attendance < 75) lowAtt++;
  }
  const eff = interventionEffectiveness();
  const effLine =
    eff.length > 0
      ? eff.map((e) => `${e.type}: ${e.improved}/${e.n} improved`).join("; ")
      : "No intervention outcomes logged yet.";

  const urgent = rankByUrgency(pool).filter((u) => u.urgency >= 0.7).slice(0, 5);

  const text = [
    `BVU Portal weekly digest${tgName ? ` — ${tgName}` : ""}`,
    `Cohort size: ${pool.length}`,
    `At Risk: ${atRisk} · Slow band: ${slow} · Attendance <75%: ${lowAtt}`,
    `Exam window: ${daysUntilExam()} days`,
    urgent.length
      ? `Highest urgency: ${urgent.map((u) => `${u.student.name} (${(u.urgency * 100).toFixed(0)}%)`).join(", ")}`
      : `No critical urgency cases.`,
    `Intervention effectiveness: ${effLine}`,
    `Open the portal only if you need to approve agent drafts or message parents.`,
  ].join("\n");

  const digest = { id: `dig_${Date.now()}`, ts: new Date().toISOString(), tgIndex, text, atRisk, slow };
  const all = load(K.digests, []);
  all.unshift(digest);
  save(K.digests, all.slice(0, 30));
  audit("digest.build", { tgIndex, atRisk });
  return digest;
}

export function listDigests() {
  return load(K.digests, []);
}

/* ================================================================== */
/* 12. Curriculum knowledge graph — built from uploaded subjects       */
/* ================================================================== */

/** Normalize subject name to a stable node id */
export function subjectToNodeId(subject) {
  return String(subject || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "subject";
}

/**
 * Build curriculum graph dynamically from the cohort:
 * - One node per subject appearing in uploaded marks
 * - Edges: theory → matching practical/lab; sequential subjects by name affinity
 * - Year tag from student class (FY/SY/TY)
 */
export function buildCurriculumGraphFromCohort(students, allStudents = null) {
  const primary = subjectPrimaryYearMap(allStudents || students);
  const yearsInView = new Set();
  for (const s of students || []) {
    const y = parseYearBatch(s).year;
    if (y && y !== "Unspecified") yearsInView.add(y);
  }
  const singleYear = yearsInView.size === 1 ? [...yearsInView][0] : null;

  const subjectMeta = new Map(); // id -> { label, yearHints, theory, practical }
  for (const s of students || []) {
    const cls = String(s.cls || s.className || s.yearLevel || "").toUpperCase();
    let year = "general";
    if (/\bFY\b|\bFE\b|FIRST/.test(cls)) year = "first_year";
    else if (/\bSY\b|\bSE\b|SECOND/.test(cls)) year = "second_year";
    else if (/\bTY\b|\bTE\b|THIRD/.test(cls)) year = "third_year";
    else if (/FINAL|BE\b|FOURTH|LY\b/.test(cls)) year = "final_year";

    for (const m of s.marks || []) {
      const label = String(m.subject || "").trim();
      if (!label) continue;
      if (singleYear && !subjectBelongsToYear(label, singleYear, primary)) continue;
      const id = subjectToNodeId(label);
      const isLab = /lab|practical|prac/i.test(label);
      const prev = subjectMeta.get(id) || {
        id,
        label,
        years: new Set(),
        isLab,
        count: 0,
      };
      prev.years.add(year);
      prev.count += 1;
      prev.isLab = prev.isLab || isLab;
      subjectMeta.set(id, prev);
    }
  }

  const nodes = [...subjectMeta.values()].map((n) => ({
    id: n.id,
    label: n.label,
    year: [...n.years][0] || "general",
    isLab: n.isLab,
    studentCount: n.count,
  }));

  // Edges: theory subject → lab with similar stem; weak sequential links alphabetically within year
  const edges = [];
  const byYear = {};
  for (const n of nodes) {
    byYear[n.year] = byYear[n.year] || [];
    byYear[n.year].push(n);
  }
  for (const n of nodes) {
    if (n.isLab) continue;
    const stem = n.id.replace(/_lab.*$/, "").replace(/_practical.*$/, "").slice(0, 12);
    for (const lab of nodes) {
      if (!lab.isLab) continue;
      if (lab.id.includes(stem) || stem.includes(lab.id.slice(0, 8))) {
        edges.push({ from: n.id, to: lab.id, weight: 0.75, reason: "theory_to_lab" });
      }
    }
  }
  // Within same year, chain a few high-enrollment subjects as soft prerequisites
  for (const list of Object.values(byYear)) {
    const theory = list.filter((n) => !n.isLab).sort((a, b) => b.studentCount - a.studentCount);
    for (let i = 0; i < Math.min(theory.length - 1, 4); i++) {
      edges.push({
        from: theory[i].id,
        to: theory[i + 1].id,
        weight: 0.35,
        reason: "cohort_sequence",
      });
    }
  }

  return { nodes, edges, source: "cohort_excel", generatedAt: new Date().toISOString() };
}

export function getCurriculumGraph(students, allStudents = null) {
  // Derive from filtered students, then drop subjects that belong to another year.
  if (Array.isArray(students)) {
    const g = buildCurriculumGraphFromCohort(students, allStudents || students);
    return g.nodes.length ? { ...g, source: "cohort" } : { nodes: [], edges: [], source: "empty" };
  }
  const stored = load(K.curriculum, null);
  if (stored?.nodes?.length) return stored;
  return { nodes: [], edges: [], source: "empty" };
}

export function setCurriculumGraph(graph) {
  save(K.curriculum, graph);
}

function curriculumSubjectWeakness(student) {
  const out = [];
  for (const m of student?.marks || []) {
    const a = m.assessments || {};
    const vals = [];
    for (const k of ["UT-1","UT-2","UT-3","UT1","UT2","UT3"]) {
      if (a[k] != null && a[k] !== "" && Number.isFinite(Number(a[k]))) vals.push(Number(a[k]));
    }
    let mean = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
    if (mean == null && m.percentage != null) mean = Number(m.percentage) / 5;
    if (mean == null && m.average != null && Number(m.average) <= 20) mean = Number(m.average);
    if (mean != null && mean < 12) out.push({ subject: m.subject, mean });
  }
  return out;
}

/**
 * Risk on curriculum nodes from weak subjects in the uploaded cohort, then propagate downstream.
 */
export function propagateCurriculumRisk(students, { allStudents = null } = {}) {
  const graph = getCurriculumGraph(students, allStudents || students);
  if (!graph.nodes?.length) return [];

  const nodeRisk = {};
  for (const n of graph.nodes) nodeRisk[n.id] = { mass: 0, count: 0 };

  for (const s of students || []) {
    for (const w of curriculumSubjectWeakness(s)) {
      const nid = subjectToNodeId(w.subject);
      if (!nodeRisk[nid]) nodeRisk[nid] = { mass: 0, count: 0 };
      nodeRisk[nid].mass += Math.max(0, 12 - w.mean);
      nodeRisk[nid].count += 1;
    }
  }

  const propagated = { ...Object.fromEntries(Object.entries(nodeRisk).map(([k, v]) => [k, v.mass])) };
  for (const e of graph.edges || []) {
    const src = nodeRisk[e.from]?.mass || 0;
    propagated[e.to] = (propagated[e.to] || 0) + src * (e.weight || 0.5) * 0.4;
  }

  const rawScores = graph.nodes.map((n) => propagated[n.id] || 0);
  const maxRaw = Math.max(0.0001, ...rawScores);
  return graph.nodes
    .map((n) => {
      const raw = propagated[n.id] || 0;
      // 0–100% relative to highest risk subject in this filtered cohort
      const riskPct = Math.round((raw / maxRaw) * 1000) / 10;
      return {
        ...n,
        directWeakness: nodeRisk[n.id]?.count || 0,
        riskScore: riskPct,
        riskPercent: riskPct,
        downstream: (graph.edges || []).filter((e) => e.from === n.id).map((e) => e.to),
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

/* ================================================================== */
/* 11. Machine Learning operations loop (client registry + promote/rollback metadata)        */
/* ================================================================== */
export function getMlopsState() {
  return load(K.mlops, {
    production: { version: "rf_early_warning_v1", metrics: { holdout: 0.86 }, promotedAt: null },
    candidates: [],
    rejections: [],
  });
}

export function registerCandidateModel({ version, metrics, notes }) {
  const st = getMlopsState();
  const cand = {
    version,
    metrics: metrics || {},
    notes: notes || "",
    registeredAt: new Date().toISOString(),
  };
  st.candidates.unshift(cand);
  save(K.mlops, st);
  audit("mlops.candidate", { version });
  return cand;
}

export function evaluateAndPromoteCandidate(version, { minHoldout = 0.8, maxFairnessGap = 0.15 } = {}) {
  const st = getMlopsState();
  const cand = st.candidates.find((c) => c.version === version);
  if (!cand) return { ok: false, error: "candidate not found" };
  const holdout = cand.metrics.holdout ?? cand.metrics.accuracy_holdout ?? 0;
  const fairnessGap = cand.metrics.fairnessGap ?? 0;
  const prod = st.production?.metrics?.holdout ?? 0;

  if (holdout < minHoldout || holdout < prod - 0.005 || fairnessGap > maxFairnessGap) {
    const reason = `Rejected: holdout=${holdout} (prod=${prod}, min=${minHoldout}), fairnessGap=${fairnessGap}`;
    st.rejections.unshift({ ...cand, reason, at: new Date().toISOString() });
    st.candidates = st.candidates.filter((c) => c.version !== version);
    save(K.mlops, st);
    audit("mlops.reject", { version, reason });
    return { ok: false, reason };
  }
  const prev = st.production;
  st.production = { ...cand, promotedAt: new Date().toISOString(), previous: prev?.version };
  st.candidates = st.candidates.filter((c) => c.version !== version);
  save(K.mlops, st);
  audit("mlops.promote", { version });
  return { ok: true, production: st.production };
}

export function rollbackProduction() {
  const st = getMlopsState();
  const prevVer = st.production?.previous;
  if (!prevVer) return { ok: false, error: "no previous version" };
  st.production = {
    version: prevVer,
    metrics: st.production.metrics,
    promotedAt: new Date().toISOString(),
    rolledBackFrom: st.production.version,
  };
  save(K.mlops, st);
  audit("mlops.rollback", { to: prevVer });
  return { ok: true, production: st.production };
}
