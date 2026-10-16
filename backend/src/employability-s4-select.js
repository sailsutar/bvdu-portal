/**
 * S4 — Deterministic next-action selection + HITL decision records.
 * Does not apply skill gains or mark interventions completed without S5 assessment.
 */

import { InterventionDecision } from "./employability-models.js";
import { computeSkillGaps, PRIORITY_FORMULA_VERSION } from "./employability-s2-priority.js";
import { computeReadiness, READINESS_FORMULA_VERSION } from "./employability-s3-readiness.js";
import { listActiveInterventions } from "./employability-s4-seed.js";
import {
  INTERVENTION_CATALOG_VERSION,
  INTERVENTION_SEEDS,
  HIGH_IMPACT_MODALITIES,
} from "./employability-s4-catalog.js";
import {
  SKILL_GRAPH_VERSION,
  ROLE_REQUIREMENT_VERSION,
  SKILL_LABELS,
} from "./employability-s1-catalog.js";
import { getSkillGraph } from "./employability-s1-seed.js";
import { getStudentSkillProfile } from "./employability-s1-profile.js";

export const SELECTION_FORMULA_VERSION = "s4-v1";

function skillMap(skills) {
  const m = new Map();
  for (const s of skills || []) m.set(s.skillId, s);
  return m;
}

function prereqsMet(prereqIds, skillsById, graphEdges) {
  const details = [];
  let ok = true;
  for (const pid of prereqIds || []) {
    const sk = skillsById.get(pid);
    const edge = (graphEdges || []).find(
      (e) => e.dependentSkill && prereqIds.includes(e.prerequisiteSkill)
    );
    // For intervention prereqs: require skill exists with score >= 40 or verified/partial
    const score = sk?.skillScore != null ? Number(sk.skillScore) : null;
    const met =
      score != null && score >= 40 && sk?.status !== "insufficient_evidence"
        ? true
        : sk?.status === "verified" || sk?.status === "partial";
    if (!met) ok = false;
    details.push({
      skillId: pid,
      met: Boolean(met),
      currentScore: score,
      status: sk?.status || "unknown",
    });
  }
  return { ok, details };
}

function isHighImpact(item) {
  if (item.highImpact) return true;
  if (item.modality && HIGH_IMPACT_MODALITIES.has(item.modality)) return true;
  return false;
}

/**
 * Score candidate intervention for a target gap row.
 * Higher is better. Deterministic.
 */
function scoreCandidate({ gapRow, item, readinessBand, skillsById, graphEdges }) {
  const reasons = [];
  let score = 0;

  // Align to target skill
  if (item.skillTarget !== gapRow.skillId) {
    return { score: -1, reasons: ["skill mismatch"], eligible: false };
  }

  const measureFirst = Boolean(gapRow.measureFirstCandidate);
  const isMeasure = item.kind === "measure";

  if (measureFirst) {
    if (isMeasure) {
      score += 40;
      reasons.push("measure-first: assessment preferred when evidence insufficient/unknown");
    } else {
      score -= 25;
      reasons.push("learning intervention deprioritized until evidence is measured");
    }
  } else {
    if (isMeasure) {
      score += 5;
      reasons.push("optional re-measure");
    } else {
      score += 25;
      reasons.push("learning/practice suitable when evidence exists");
    }
  }

  // Gap magnitude
  const gap = gapRow.gap != null ? Number(gapRow.gap) : 0;
  score += Math.min(30, gap * 0.35);
  reasons.push(`gap contribution from ${gap} points`);

  // S2 priority
  score += (Number(gapRow.priority) || 0) * 20;
  reasons.push(`S2 priority ${gapRow.priority}`);

  // Dependency blocked on skill → prefer foundation measure/practice, not advanced project
  if (gapRow.dependencyBlocked) {
    if (isMeasure || item.difficulty === "low") {
      score += 8;
      reasons.push("skill dependency blocked: prefer foundation measure/low difficulty");
    } else if (item.difficulty === "high") {
      score -= 20;
      reasons.push("skill dependency blocked: high-difficulty penalized");
    }
  }

  // Intervention prerequisites
  const pr = prereqsMet(item.prerequisites, skillsById, graphEdges);
  if (!pr.ok) {
    score -= 30;
    reasons.push("intervention prerequisites not met");
  } else {
    score += 5;
    reasons.push("intervention prerequisites OK");
  }

  // Effort penalty
  const effort = item.estimatedEffort != null ? Number(item.estimatedEffort) : 5;
  score -= effort * 0.8;
  reasons.push(`effort ${effort}`);

  // Expected gain (learning only)
  if (!isMeasure && item.expectedSkillGain) {
    score += Math.min(15, Number(item.expectedSkillGain) * 0.6);
    reasons.push(`expected gain ${item.expectedSkillGain}`);
  }

  // Readiness context
  if (readinessBand === "INSUFFICIENT_EVIDENCE" && isMeasure) {
    score += 12;
    reasons.push("readiness band INSUFFICIENT_EVIDENCE reinforces measure-first");
  }
  if (readinessBand === "READY" && isMeasure) {
    score -= 5;
    reasons.push("already READY: pure measurement slightly less urgent");
  }

  // Prefer required over preferred gap categories
  if (gapRow.category === "required") {
    score += 6;
    reasons.push("required role skill");
  }

  const eligible = score > 0 && (pr.ok || isMeasure);
  return {
    score: Math.round(score * 1000) / 1000,
    reasons,
    eligible,
    prereqDetails: pr.details,
    highImpact: isHighImpact(item),
  };
}

/**
 * Select next action for student + role.
 */
export async function selectNextAction({
  prn,
  roleId,
  persist = true,
  actor = "system",
}) {
  const profile = await getStudentSkillProfile(prn);
  const skillsById = skillMap(profile.skills);
  const graph = await getSkillGraph();

  const gaps = await computeSkillGaps({ prn, roleId });
  const readiness = await computeReadiness({ prn, roleId, persist: false });
  const catalog = await listActiveInterventions();
  // Ensure seed fields present if DB empty of modality
  const seedById = Object.fromEntries(INTERVENTION_SEEDS.map((s) => [s.interventionId, s]));
  const catalogFull = catalog.map((c) => ({ ...seedById[c.interventionId], ...c }));

  const rankedGaps = gaps.rankedGaps || [];
  const candidatesConsidered = [];
  let best = null;

  // Walk gaps by priority; for each, score matching interventions
  for (const gapRow of rankedGaps) {
    for (const item of catalogFull) {
      if (item.skillTarget !== gapRow.skillId) continue;
      const sc = scoreCandidate({
        gapRow,
        item,
        readinessBand: readiness.readinessBand,
        skillsById,
        graphEdges: graph.edges,
      });
      const entry = {
        interventionId: item.interventionId,
        title: item.title,
        skillId: gapRow.skillId,
        kind: item.kind,
        modality: item.modality,
        score: sc.score,
        eligible: sc.eligible,
        highImpact: sc.highImpact,
        reasons: sc.reasons,
        gap: gapRow.gap,
        s2Priority: gapRow.priority,
        measureFirstCandidate: gapRow.measureFirstCandidate,
        dependencyBlocked: gapRow.dependencyBlocked,
      };
      candidatesConsidered.push(entry);
      if (!sc.eligible) continue;
      if (!best || sc.score > best.selectionScore) {
        best = {
          intervention: item,
          gapRow,
          selectionScore: sc.score,
          reasons: sc.reasons,
          prereqDetails: sc.prereqDetails,
          highImpact: sc.highImpact,
        };
      }
    }
  }

  // Stable tie-break: already by score; if equal, interventionId lexical handled by > only

  candidatesConsidered.sort((a, b) => b.score - a.score || a.interventionId.localeCompare(b.interventionId));

  if (!best) {
    // Self-prep fallback: always recommend the top S2 gap as a practice action
    const top = (gapResult.rankedGaps || [])[0];
    if (top) {
      const skillLabel = top.skillLabel || top.skillId;
      const synthetic = {
        interventionId: `selfprep_${top.skillId}`,
        title: top.measureFirstCandidate
          ? `Practice and document: ${skillLabel}`
          : `Strengthen: ${skillLabel}`,
        skillId: top.skillId,
        skillLabel,
        kind: top.measureFirstCandidate ? "assessment_prep" : "practice",
        modality: "self_study",
        difficulty: top.gap >= 40 ? "high" : top.gap >= 20 ? "medium" : "low",
        status: "suggested",
        hitlRequired: false,
        reason:
          top.currentScore == null
            ? `No rating yet for ${skillLabel} (role target ${top.targetScore ?? "—"}). Add evidence on Placement profile or practice this skill next.`
            : `Gap ${top.gap} vs target ${top.targetScore} on ${skillLabel}. Focus practice here for role ${roleId}.`,
      };
      return {
        prn: String(prn),
        roleId,
        selected: synthetic,
        message: "Self-prep suggestion from top skill gap (no staff approval required).",
        readinessBand: readiness.readinessBand,
        readinessScore: readiness.readinessScore,
        candidatesConsidered: candidatesConsidered.slice(0, 15),
        selectionFormulaVersion: SELECTION_FORMULA_VERSION + "+selfprep",
        catalogVersion: INTERVENTION_CATALOG_VERSION,
        source: "selfprep_top_gap",
      };
    }
    return {
      prn: String(prn),
      roleId,
      selected: null,
      message: "No skill gaps available yet. Save Core skills on Placement profile first.",
      readinessBand: readiness.readinessBand,
      readinessScore: readiness.readinessScore,
      candidatesConsidered: candidatesConsidered.slice(0, 15),
      selectionFormulaVersion: SELECTION_FORMULA_VERSION,
      catalogVersion: INTERVENTION_CATALOG_VERSION,
    };
  }

  const hitlRequired = best.highImpact;
  const initialStatus = hitlRequired ? "pending_approval" : "draft";

  const decision_trace = {
    selected_skill: best.gapRow.skillId,
    skillLabel: SKILL_LABELS[best.gapRow.skillId] || best.gapRow.skillId,
    reason_for_selection: best.reasons.join("; "),
    gap: best.gapRow.gap,
    s2_priority: best.gapRow.priority,
    s2_priority_formula_version: PRIORITY_FORMULA_VERSION,
    evidence_status: best.gapRow.decision_trace?.skill_status || null,
    measure_first: Boolean(best.gapRow.measureFirstCandidate),
    readiness_band: readiness.readinessBand,
    readiness_score: readiness.readinessScore,
    readiness_formula_version: READINESS_FORMULA_VERSION,
    dependency_blocked: Boolean(best.gapRow.dependencyBlocked),
    intervention_prerequisites: best.prereqDetails,
    selected_intervention_id: best.intervention.interventionId,
    selected_title: best.intervention.title,
    selected_kind: best.intervention.kind,
    selection_score: best.selectionScore,
    high_impact: best.highImpact,
    hitl_required: hitlRequired,
    initial_status: initialStatus,
    candidates_top: candidatesConsidered.slice(0, 8),
    catalog_version: INTERVENTION_CATALOG_VERSION,
    selection_formula_version: SELECTION_FORMULA_VERSION,
    role_requirement_version: ROLE_REQUIREMENT_VERSION,
    skill_graph_version: SKILL_GRAPH_VERSION,
    explanation: buildSelectionExplanation(best, readiness, hitlRequired),
  };

  let decisionId = null;
  if (persist) {
    const doc = await InterventionDecision.create({
      prn: String(prn),
      interventionId: best.intervention.interventionId,
      skillId: best.gapRow.skillId,
      decisionTrace: decision_trace,
      priorityFormulaVersion: PRIORITY_FORMULA_VERSION,
      catalogVersion: INTERVENTION_CATALOG_VERSION,
      roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
      skillGraphVersion: SKILL_GRAPH_VERSION,
      stateVersion: null,
      status: initialStatus,
      generatedBy: actor,
      approvedBy: null,
    });
    decisionId = String(doc._id);
  }

  return {
    prn: String(prn),
    roleId,
    selected: {
      interventionId: best.intervention.interventionId,
      title: best.intervention.title,
      description: best.intervention.description,
      skillId: best.gapRow.skillId,
      skillLabel: SKILL_LABELS[best.gapRow.skillId] || best.gapRow.skillId,
      kind: best.intervention.kind,
      modality: best.intervention.modality,
      difficulty: best.intervention.difficulty,
      expectedSkillGain: best.intervention.expectedSkillGain,
      estimatedDurationHours: best.intervention.estimatedDurationHours,
      highImpact: best.highImpact,
      hitlRequired,
      status: initialStatus,
    },
    decisionId,
    decision_trace,
    readiness: {
      readinessScore: readiness.readinessScore,
      readinessBand: readiness.readinessBand,
      formulaVersion: READINESS_FORMULA_VERSION,
    },
    note: "Recommendation only. Skill improvement is NOT claimed until S5 assessment evidence is recorded. High-impact items require HITL approval.",
    ml: { status: "unavailable", productionProbability: false },
  };
}

function buildSelectionExplanation(best, readiness, hitlRequired) {
  const parts = [];
  parts.push(
    `Selected "${best.intervention.title}" for skill ${best.gapRow.skillId} (selection score ${best.selectionScore}).`
  );
  if (best.gapRow.measureFirstCandidate) {
    parts.push("Measure-first applied because evidence was insufficient or unknown.");
  }
  if (best.gapRow.dependencyBlocked) {
    parts.push("Skill has unmet graph prerequisites; selection preferred compatible foundation actions.");
  }
  parts.push(
    `Readiness context: score ${readiness.readinessScore}, band ${readiness.readinessBand} (not a placement probability).`
  );
  if (hitlRequired) {
    parts.push("High-impact action → status pending_approval until staff approves.");
  } else {
    parts.push("Status draft — staff may approve before treating as student-facing commitment.");
  }
  parts.push("No skill gain is assumed without later verified assessment (S5).");
  return parts.join(" ");
}

export async function getDecision(decisionId) {
  const doc = await InterventionDecision.findById(decisionId).lean();
  if (!doc) return null;
  return doc;
}

export async function listDecisionsForPrn(prn, { limit = 20 } = {}) {
  return InterventionDecision.find({ prn: String(prn) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * HITL approve / reject. Cannot mark completed here (S5).
 */
export async function hitlUpdateDecision(decisionId, { action, actor }) {
  const doc = await InterventionDecision.findById(decisionId);
  if (!doc) {
    const err = new Error("Decision not found");
    err.code = 404;
    throw err;
  }
  const status = doc.status;
  if (action === "approve") {
    if (!["draft", "pending_approval"].includes(status)) {
      const err = new Error(`Cannot approve from status=${status}`);
      err.code = 400;
      throw err;
    }
    doc.status = "approved";
    doc.approvedBy = actor || null;
    await doc.save();
    return doc.toObject();
  }
  if (action === "reject") {
    if (!["draft", "pending_approval", "approved"].includes(status)) {
      const err = new Error(`Cannot reject from status=${status}`);
      err.code = 400;
      throw err;
    }
    doc.status = "rejected";
    doc.approvedBy = actor || null;
    await doc.save();
    return doc.toObject();
  }
  if (action === "submit_for_approval") {
    if (status !== "draft") {
      const err = new Error(`Cannot submit from status=${status}`);
      err.code = 400;
      throw err;
    }
    doc.status = "pending_approval";
    await doc.save();
    return doc.toObject();
  }
  const err = new Error("action must be approve | reject | submit_for_approval");
  err.code = 400;
  throw err;
}
