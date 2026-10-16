/**
 * S5 — Assessment → Evidence → Skill state update.
 * No S6 adaptive policy, no fabricated improvement, no ML probability.
 */

import {
  SkillAssessment,
  StudentSkillProfile,
  EmployabilityState,
  StudentStateHistory,
  InterventionDecision,
  InterventionResult,
  AuditEmployabilityCycle,
} from "./employability-models.js";
import { buildSkillEntry, deriveSkillEvidenceState } from "./employability-s1-evidence.js";
import { getStudentSkillProfile } from "./employability-s1-profile.js";
import {
  ROLE_REQUIREMENT_VERSION,
  SKILL_GRAPH_VERSION,
  SKILL_LABELS,
} from "./employability-s1-catalog.js";
import { INTERVENTION_CATALOG_VERSION } from "./employability-s4-catalog.js";
import { PRIORITY_FORMULA_VERSION } from "./employability-s2-priority.js";
import { READINESS_FORMULA_VERSION } from "./employability-s3-readiness.js";

export const EVIDENCE_MERGE_VERSION = "s5-v1";
export const STATE_UPDATE_VERSION = "s5-v1";

const NON_SELF_TYPES = new Set([
  "verified_assessment",
  "project_evaluation",
  "coding_test",
  "teacher_evaluation",
  "verified_certificate",
  "verified_github",
]);

const ALLOWED_SOURCE_TYPES = new Set([...NON_SELF_TYPES, "self_report"]);

function assertSourceType(sourceType) {
  if (!ALLOWED_SOURCE_TYPES.has(sourceType)) {
    const err = new Error(
      `Invalid sourceType "${sourceType}". Allowed: ${[...ALLOWED_SOURCE_TYPES].join(", ")}`
    );
    err.code = 400;
    throw err;
  }
}

function normalizeScore(score) {
  if (score === undefined || score === null || score === "") return null;
  const n = Number(score);
  if (Number.isNaN(n)) {
    const err = new Error("score must be numeric");
    err.code = 400;
    throw err;
  }
  return n;
}

/**
 * Deterministic merge of evidence list for one skill.
 * Higher-rank non-self evidence preferred for displayed score when present.
 */
export function mergeEvidenceForSkill(existingSources = [], newEvidence) {
  const sources = [...(existingSources || [])];
  if (newEvidence) sources.push(newEvidence);

  const nonSelf = sources.filter((e) => e.sourceType && e.sourceType !== "self_report");
  const selfOnly = sources.filter((e) => e.sourceType === "self_report");

  // Prefer latest non-self with explicit score for "primary score"
  let primaryScore = null;
  let primaryType = null;
  const scoredNonSelf = nonSelf
    .filter((e) => e.scoreOrResult != null && !Number.isNaN(Number(e.scoreOrResult)))
    .sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime();
      const tb = new Date(b.timestamp || 0).getTime();
      return tb - ta;
    });
  if (scoredNonSelf.length) {
    primaryScore = Number(scoredNonSelf[0].scoreOrResult);
    primaryType = scoredNonSelf[0].sourceType;
  } else {
    const scoredSelf = selfOnly
      .filter((e) => e.scoreOrResult != null && !Number.isNaN(Number(e.scoreOrResult)))
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    if (scoredSelf.length) {
      primaryScore = Number(scoredSelf[0].scoreOrResult);
      primaryType = "self_report";
    }
  }

  const derived = deriveSkillEvidenceState(sources, primaryScore);
  return {
    sources,
    primaryScore,
    primaryType,
    derived,
    mergeVersion: EVIDENCE_MERGE_VERSION,
    mergeReason:
      primaryType === "self_report"
        ? "Only self-report scores available; status cannot be verified"
        : `Primary score from latest non-self evidence (${primaryType})`,
  };
}

/**
 * Snapshot current state then write new current version with updated skills list.
 */
async function bumpEmployabilityState(prn, { skills, reason, actor, extra = {} }) {
  const prnKey = String(prn);
  const current = await EmployabilityState.findOne({ prn: prnKey, isCurrent: true });
  const prevVersion = current?.stateVersion || 0;
  const nextVersion = prevVersion + 1;

  if (current) {
    await StudentStateHistory.create({
      prn: prnKey,
      stateVersion: current.stateVersion,
      snapshot: current.toObject ? current.toObject() : current,
      reason: reason || "skill_state_update",
    });
    current.isCurrent = false;
    await current.save();
  }

  const doc = await EmployabilityState.create({
    prn: prnKey,
    stateVersion: nextVersion,
    skills: skills || current?.skills || [],
    readinessScore: extra.readinessScore ?? current?.readinessScore ?? null,
    readinessBand: extra.readinessBand ?? current?.readinessBand ?? "UNKNOWN",
    insufficientEvidenceSkills:
      extra.insufficientEvidenceSkills ?? current?.insufficientEvidenceSkills ?? [],
    targetRoleId: extra.targetRoleId ?? current?.targetRoleId ?? null,
    targetRoleVersion: extra.targetRoleVersion ?? current?.targetRoleVersion ?? null,
    lastDecisionId: extra.lastDecisionId ?? current?.lastDecisionId ?? null,
    lastInterventionId: extra.lastInterventionId ?? current?.lastInterventionId ?? null,
    lastStagnationStatus: "unknown",
    roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
    skillGraphVersion: SKILL_GRAPH_VERSION,
    priorityFormulaVersion: PRIORITY_FORMULA_VERSION,
    catalogVersion: INTERVENTION_CATALOG_VERSION,
    modelVersion: null,
    featureVersion: null,
    datasetVersion: null,
    source: "assessment_s5",
    isCurrent: true,
  });

  return {
    previousVersion: prevVersion || null,
    stateVersion: nextVersion,
    stateId: String(doc._id),
    actor: actor || null,
    stateUpdateVersion: STATE_UPDATE_VERSION,
  };
}

/**
 * Record an assessment result and update skill profile + employability state.
 */
export async function submitAssessmentResult({
  prn,
  skillId,
  sourceType,
  score,
  decisionId = null,
  interventionId = null,
  assessor = null,
  sourceId = null,
  verificationStatus = "verified",
  meta = {},
  actor = null,
}) {
  if (!prn || !skillId || !sourceType) {
    const err = new Error("prn, skillId, and sourceType are required");
    err.code = 400;
    throw err;
  }
  assertSourceType(sourceType);
  const scoreNum = normalizeScore(score);
  if (scoreNum == null) {
    const err = new Error("score is required for assessment result");
    err.code = 400;
    throw err;
  }

  // Self-report cannot be marked verified
  let vStatus = verificationStatus || "pending";
  if (sourceType === "self_report") {
    vStatus = "unverified";
  } else if (vStatus === "verified" || vStatus === "pending") {
    // staff-submitted non-self defaults to verified when explicitly submitted as assessment
    vStatus = verificationStatus === "rejected" ? "rejected" : "verified";
  }

  const profile = await getStudentSkillProfile(prn);
  const prevSkill = (profile.skills || []).find((s) => s.skillId === skillId) || null;
  const beforeScore = prevSkill?.skillScore != null ? Number(prevSkill.skillScore) : null;

  const newEvidence = {
    sourceType,
    sourceId: sourceId || (decisionId ? `decision:${decisionId}` : null),
    scoreOrResult: scoreNum,
    assessor: assessor || actor || null,
    verificationStatus: vStatus,
    timestamp: new Date(),
    meta: {
      ...meta,
      stage: "S5",
      decisionId: decisionId || null,
      interventionId: interventionId || null,
      evidenceMergeVersion: EVIDENCE_MERGE_VERSION,
    },
  };

  const merged = mergeEvidenceForSkill(prevSkill?.evidenceSources || [], newEvidence);
  const entry = buildSkillEntry(skillId, {
    skillScore: merged.primaryScore,
    evidenceSources: merged.sources,
    trend:
      beforeScore != null && merged.primaryScore != null
        ? merged.primaryScore > beforeScore
          ? "up"
          : merged.primaryScore < beforeScore
            ? "down"
            : "flat"
        : "unknown",
    targetScore: prevSkill?.targetScore ?? null,
  });

  // Force: self_report alone never verified
  if (sourceType === "self_report" && !merged.sources.some((e) => NON_SELF_TYPES.has(e.sourceType))) {
    entry.status = "insufficient_evidence";
    entry.confidence = Math.min(entry.confidence, 0.3);
  }

  // Persist SkillAssessment row
  const assessmentDoc = await SkillAssessment.create({
    prn: String(prn),
    skillId,
    sourceType,
    sourceId: newEvidence.sourceId,
    scoreOrResult: scoreNum,
    assessor: newEvidence.assessor,
    verificationStatus: vStatus,
    beforeScore,
    afterScore: entry.skillScore,
    meta: newEvidence.meta,
  });

  // Update StudentSkillProfile
  const skillsById = new Map((profile.skills || []).map((s) => [s.skillId, s]));
  skillsById.set(skillId, entry);
  const nextSkills = Array.from(skillsById.values());
  await StudentSkillProfile.findOneAndUpdate(
    { prn: String(prn) },
    {
      $set: {
        skills: nextSkills,
        source: profile.source || "assessment",
      },
      $setOnInsert: { prn: String(prn) },
    },
    { upsert: true }
  );

  const stateBump = await bumpEmployabilityState(prn, {
    skills: nextSkills,
    reason: "assessment_result",
    actor,
  });

  const delta =
    beforeScore != null && entry.skillScore != null
      ? Math.round((entry.skillScore - beforeScore) * 100) / 100
      : null;

  return {
    ok: true,
    assessmentId: String(assessmentDoc._id),
    prn: String(prn),
    skillId,
    skillLabel: SKILL_LABELS[skillId] || skillId,
    sourceType,
    verificationStatus: vStatus,
    beforeScore,
    afterScore: entry.skillScore,
    observedDelta: delta,
    skillEntry: entry,
    evidenceMerge: {
      version: merged.mergeVersion,
      reason: merged.mergeReason,
      primaryType: merged.primaryType,
    },
    state: stateBump,
    note:
      sourceType === "self_report"
        ? "Self-report recorded; status is not verified."
        : "Assessment evidence applied to skill profile and versioned employability state.",
  };
}

/**
 * Link assessment to an intervention decision and write InterventionResult.
 * Does not invent improvement if evidence is self-report only / missing.
 */
export async function recordInterventionResult({
  prn,
  decisionId,
  sourceType,
  score,
  assessor = null,
  actor = null,
  timeSpentHours = null,
  meta = {},
}) {
  if (!decisionId) {
    const err = new Error("decisionId required");
    err.code = 400;
    throw err;
  }
  const decision = await InterventionDecision.findById(decisionId);
  if (!decision) {
    const err = new Error("Decision not found");
    err.code = 404;
    throw err;
  }
  if (String(decision.prn) !== String(prn)) {
    const err = new Error("decision prn mismatch");
    err.code = 400;
    throw err;
  }
  if (!["approved", "draft", "pending_approval", "executed"].includes(decision.status)) {
    const err = new Error(
      `Decision status ${decision.status} cannot accept results (rejected/cancelled)`
    );
    err.code = 400;
    throw err;
  }

  const skillId = decision.skillId;
  const interventionId = decision.interventionId;

  const assessment = await submitAssessmentResult({
    prn,
    skillId,
    sourceType,
    score,
    decisionId: String(decision._id),
    interventionId,
    assessor,
    actor,
    meta: { ...meta, interventionResult: true },
  });

  const expected =
    decision.decisionTrace?.selected_intervention_id || interventionId
      ? decision.decisionTrace?.candidates_top?.find?.(
          (c) => c.interventionId === interventionId
        )?.expectedSkillGain
      : null;

  // Look up catalog expected gain if needed — optional
  let expectedImprovement = null;
  try {
    const { INTERVENTION_SEEDS } = await import("./employability-s4-catalog.js");
    const seed = INTERVENTION_SEEDS.find((s) => s.interventionId === interventionId);
    expectedImprovement = seed?.expectedSkillGain ?? null;
  } catch {
    expectedImprovement = null;
  }

  const observed = assessment.observedDelta;
  const meaningfulEvidence = sourceType !== "self_report" && assessment.skillEntry?.status !== "insufficient_evidence";

  const resultDoc = await InterventionResult.create({
    prn: String(prn),
    interventionId,
    decisionId: decision._id,
    expectedImprovement,
    actualImprovement: meaningfulEvidence ? observed : null,
    beforeScore: assessment.beforeScore,
    afterScore: assessment.afterScore,
    timeSpentHours: timeSpentHours != null ? Number(timeSpentHours) : null,
    readinessDelta: null,
    stagnating: false,
    evidence: [
      {
        sourceType,
        sourceId: assessment.assessmentId,
        scoreOrResult: assessment.afterScore,
        assessor: assessor || actor,
        verificationStatus: assessment.verificationStatus,
        timestamp: new Date(),
        meta: { assessmentId: assessment.assessmentId },
      },
    ],
    meta: {
      stage: "S5",
      meaningfulEvidence,
      improvementClaimed: Boolean(meaningfulEvidence && observed != null),
      note: meaningfulEvidence
        ? "Observed delta from verified/non-self evidence"
        : "No improvement claimed — evidence insufficient or self-report only",
    },
  });

  // Mark decision executed only after real evidence path (still not S6)
  if (meaningfulEvidence && decision.status === "approved") {
    decision.status = "executed";
    await decision.save();
  }

  await AuditEmployabilityCycle.create({
    prn: String(prn),
    cycleId: `s5-${decisionId}-${Date.now()}`,
    stateVersionBefore: assessment.state.previousVersion,
    stateVersionAfter: assessment.state.stateVersion,
    decisionId: String(decision._id),
    assessmentIds: [assessment.assessmentId],
    resultId: String(resultDoc._id),
    versions: {
      roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
      skillGraphVersion: SKILL_GRAPH_VERSION,
      priorityFormulaVersion: PRIORITY_FORMULA_VERSION,
      catalogVersion: INTERVENTION_CATALOG_VERSION,
      modelVersion: null,
      featureVersion: null,
      datasetVersion: null,
    },
    payload: {
      readinessFormulaVersion: READINESS_FORMULA_VERSION,
      evidenceMergeVersion: EVIDENCE_MERGE_VERSION,
      stateUpdateVersion: STATE_UPDATE_VERSION,
    },
  });

  return {
    ok: true,
    interventionResultId: String(resultDoc._id),
    decisionId: String(decision._id),
    decisionStatus: decision.status,
    assessment,
    observedDelta: meaningfulEvidence ? observed : null,
    improvementClaimed: Boolean(meaningfulEvidence && observed != null),
    expectedImprovement,
    note: meaningfulEvidence
      ? "Intervention result recorded with observed skill delta from valid evidence."
      : "Intervention result recorded without improvement claim (insufficient/self-report evidence).",
  };
}

export async function getAssessmentHistory(prn, { skillId = null, limit = 50 } = {}) {
  const q = { prn: String(prn) };
  if (skillId) q.skillId = skillId;
  return SkillAssessment.find(q).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function getStateHistory(prn, { limit = 20 } = {}) {
  return StudentStateHistory.find({ prn: String(prn) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function getCurrentEmployabilityState(prn) {
  const state = await EmployabilityState.findOne({ prn: String(prn), isCurrent: true }).lean();
  const profile = await getStudentSkillProfile(prn);
  return {
    state: state || null,
    profile,
    stateUpdateVersion: STATE_UPDATE_VERSION,
    evidenceMergeVersion: EVIDENCE_MERGE_VERSION,
  };
}

export async function getInterventionResults(prn, { limit = 20 } = {}) {
  return InterventionResult.find({ prn: String(prn) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
