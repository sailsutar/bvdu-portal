/**
 * S6 — Adaptive employability loop: effectiveness, stagnation, next-action adaptation.
 * Does not train ML, invent gains, or bypass HITL.
 */

import {
  InterventionDecision,
  InterventionResult,
  EffectivenessStats,
  AuditEmployabilityCycle,
  EmployabilityState,
} from "./employability-models.js";
import { computeSkillGaps, PRIORITY_FORMULA_VERSION } from "./employability-s2-priority.js";
import { computeReadiness, READINESS_FORMULA_VERSION } from "./employability-s3-readiness.js";
import { selectNextAction, SELECTION_FORMULA_VERSION } from "./employability-s4-select.js";
import {
  INTERVENTION_CATALOG_VERSION,
  INTERVENTION_SEEDS,
} from "./employability-s4-catalog.js";
import {
  ROLE_REQUIREMENT_VERSION,
  SKILL_GRAPH_VERSION,
  SKILL_LABELS,
} from "./employability-s1-catalog.js";
import { getCurrentEmployabilityState } from "./employability-s5-assessment.js";
import { listActiveInterventions } from "./employability-s4-seed.js";

export const EFFECTIVENESS_POLICY_VERSION = "s6-v1";
export const STAGNATION_POLICY_VERSION = "s6-v1";
export const ADAPTIVE_POLICY_VERSION = "s6-v1";

/** Stagnation: ≥2 valid ineffective results on same intervention, or ≥3 valid attempts on skill with total gain < MIN_TOTAL_GAIN */
const STAGNATION_MIN_INEFFECTIVE = 2;
const STAGNATION_MIN_ATTEMPTS = 3;
const STAGNATION_MAX_TOTAL_GAIN = 5;

/** Effectiveness ratio thresholds (observed / expected) */
const RATIO_EFFECTIVE = 0.7;
const RATIO_PARTIAL = 0.3;

function seedById(id) {
  return INTERVENTION_SEEDS.find((s) => s.interventionId === id) || null;
}

/**
 * Deterministic effectiveness from an InterventionResult document (+ optional expected).
 */
export function classifyEffectiveness({
  expectedGain,
  observedGain,
  meaningfulEvidence,
  sourceType,
}) {
  if (!meaningfulEvidence || sourceType === "self_report") {
    return {
      status: "insufficient_evidence",
      effectivenessRatio: null,
      reason: "No valid non-self post-intervention evidence",
      policyVersion: EFFECTIVENESS_POLICY_VERSION,
    };
  }
  if (observedGain == null) {
    return {
      status: "unknown",
      effectivenessRatio: null,
      reason: "Observed gain not measurable (missing before/after)",
      policyVersion: EFFECTIVENESS_POLICY_VERSION,
    };
  }
  const expected = expectedGain != null ? Number(expectedGain) : null;
  if (expected == null || expected === 0) {
    // No catalog expectation: use absolute thresholds
    if (observedGain >= 8) {
      return {
        status: "effective",
        effectivenessRatio: null,
        reason: `Observed gain ${observedGain} with no expected baseline; treated effective if ≥8`,
        policyVersion: EFFECTIVENESS_POLICY_VERSION,
      };
    }
    if (observedGain >= 3) {
      return {
        status: "partially_effective",
        effectivenessRatio: null,
        reason: `Observed gain ${observedGain} with no expected baseline; partial if ≥3`,
        policyVersion: EFFECTIVENESS_POLICY_VERSION,
      };
    }
    if (observedGain <= 0) {
      return {
        status: "ineffective",
        effectivenessRatio: null,
        reason: `Observed gain ${observedGain} ≤ 0`,
        policyVersion: EFFECTIVENESS_POLICY_VERSION,
      };
    }
    return {
      status: "partially_effective",
      effectivenessRatio: null,
      reason: `Observed gain ${observedGain} small without expected baseline`,
      policyVersion: EFFECTIVENESS_POLICY_VERSION,
    };
  }
  const ratio = Math.round((observedGain / expected) * 1000) / 1000;
  if (ratio >= RATIO_EFFECTIVE) {
    return {
      status: "effective",
      effectivenessRatio: ratio,
      reason: `ratio ${ratio} ≥ ${RATIO_EFFECTIVE}`,
      policyVersion: EFFECTIVENESS_POLICY_VERSION,
    };
  }
  if (ratio >= RATIO_PARTIAL) {
    return {
      status: "partially_effective",
      effectivenessRatio: ratio,
      reason: `ratio ${ratio} ≥ ${RATIO_PARTIAL} and < ${RATIO_EFFECTIVE}`,
      policyVersion: EFFECTIVENESS_POLICY_VERSION,
    };
  }
  return {
    status: "ineffective",
    effectivenessRatio: ratio,
    reason: `ratio ${ratio} < ${RATIO_PARTIAL}`,
    policyVersion: EFFECTIVENESS_POLICY_VERSION,
  };
}

async function loadResults(prn, { skillId = null, interventionId = null } = {}) {
  const q = { prn: String(prn) };
  if (interventionId) q.interventionId = interventionId;
  const rows = await InterventionResult.find(q).sort({ createdAt: 1 }).lean();
  if (!skillId) return rows;
  // filter via decision skill if needed
  const filtered = [];
  for (const r of rows) {
    if (r.meta?.skillId === skillId) {
      filtered.push(r);
      continue;
    }
    if (r.decisionId) {
      const d = await InterventionDecision.findById(r.decisionId).lean();
      if (d?.skillId === skillId) filtered.push(r);
    } else if (seedById(r.interventionId)?.skillTarget === skillId) {
      filtered.push(r);
    }
  }
  return filtered;
}

/**
 * Evaluate effectiveness for a stored intervention result; annotate meta (non-destructive append).
 */
export async function evaluateInterventionResult(resultId) {
  const doc = await InterventionResult.findById(resultId);
  if (!doc) {
    const err = new Error("Intervention result not found");
    err.code = 404;
    throw err;
  }
  const meaningful = doc.meta?.meaningfulEvidence !== false && doc.actualImprovement != null;
  const sourceType = doc.evidence?.[0]?.sourceType || null;
  const classification = classifyEffectiveness({
    expectedGain: doc.expectedImprovement,
    observedGain: doc.actualImprovement,
    meaningfulEvidence: meaningful || (doc.actualImprovement != null && sourceType !== "self_report"),
    sourceType,
  });

  // Append evaluation without wiping history fields
  doc.meta = {
    ...(doc.meta || {}),
    effectiveness: classification,
    evaluatedAt: new Date().toISOString(),
  };
  // stagnating flag on result if ineffective
  if (classification.status === "ineffective") doc.stagnating = true;
  await doc.save();

  await refreshEffectivenessStats(doc.prn, doc.interventionId, null);

  try {
    const { rebuildPersonalizationProfile } = await import("./employability-s8-personalize.js");
    await rebuildPersonalizationProfile(doc.prn);
  } catch (_) {
    /* S8 optional */
  }

  return {
    resultId: String(doc._id),
    prn: doc.prn,
    interventionId: doc.interventionId,
    expectedImprovement: doc.expectedImprovement,
    actualImprovement: doc.actualImprovement,
    ...classification,
  };
}

async function refreshEffectivenessStats(prn, interventionId, skillId) {
  const results = await InterventionResult.find({
    prn: String(prn),
    interventionId,
  }).lean();

  const evaluated = results
    .map((r) => r.meta?.effectiveness)
    .filter(Boolean);
  const valid = evaluated.filter((e) => e.status !== "insufficient_evidence" && e.status !== "unknown");
  const success = valid.filter((e) => e.status === "effective" || e.status === "partially_effective");
  const ineffective = valid.filter((e) => e.status === "ineffective");

  const meanActual =
    results.filter((r) => r.actualImprovement != null).reduce((s, r) => s + r.actualImprovement, 0) /
    Math.max(1, results.filter((r) => r.actualImprovement != null).length);

  const payload = {
    sampleSize: results.length,
    meanActualImprovement: Math.round(meanActual * 100) / 100,
    meanExpectedImprovement:
      results.filter((r) => r.expectedImprovement != null).reduce((s, r) => s + r.expectedImprovement, 0) /
      Math.max(1, results.filter((r) => r.expectedImprovement != null).length),
    successRate: valid.length ? Math.round((success.length / valid.length) * 1000) / 1000 : null,
    stagnationRate: valid.length ? Math.round((ineffective.length / valid.length) * 1000) / 1000 : null,
    meta: {
      policyVersion: EFFECTIVENESS_POLICY_VERSION,
      updatedAt: new Date().toISOString(),
    },
  };

  await EffectivenessStats.findOneAndUpdate(
    { scope: "student", scopeKey: String(prn), interventionId: interventionId || null },
    { $set: payload },
    { upsert: true }
  );

  if (interventionId) {
    await EffectivenessStats.findOneAndUpdate(
      { scope: "global", scopeKey: "global", interventionId },
      {
        $set: {
          ...payload,
          meta: { ...payload.meta, aggregatedFrom: "last_writer_student_refresh" },
        },
      },
      { upsert: true }
    );
  }
}

/**
 * Detect stagnation for skill / intervention.
 */
export async function detectStagnation(prn, { skillId = null, interventionId = null } = {}) {
  const results = await loadResults(prn, { skillId, interventionId });
  const valid = [];
  for (const r of results) {
    const eff = r.meta?.effectiveness || classifyEffectiveness({
      expectedGain: r.expectedImprovement,
      observedGain: r.actualImprovement,
      meaningfulEvidence: r.meta?.meaningfulEvidence !== false && r.actualImprovement != null,
      sourceType: r.evidence?.[0]?.sourceType,
    });
    if (eff.status === "insufficient_evidence" || eff.status === "unknown") continue;
    valid.push({ result: r, eff });
  }

  const byIntervention = new Map();
  for (const v of valid) {
    const id = v.result.interventionId || "unknown";
    if (!byIntervention.has(id)) byIntervention.set(id, []);
    byIntervention.get(id).push(v);
  }

  let stagnating = false;
  let reason = null;
  let affectedIntervention = null;
  let affectedSkill = skillId;

  for (const [iid, list] of byIntervention) {
    const ineffectiveCount = list.filter((x) => x.eff.status === "ineffective").length;
    if (ineffectiveCount >= STAGNATION_MIN_INEFFECTIVE) {
      stagnating = true;
      affectedIntervention = iid;
      reason = `${ineffectiveCount} ineffective results for intervention ${iid} (threshold ${STAGNATION_MIN_INEFFECTIVE})`;
      const seed = seedById(iid);
      affectedSkill = skillId || seed?.skillTarget || null;
      break;
    }
  }

  if (!stagnating && valid.length >= STAGNATION_MIN_ATTEMPTS) {
    const totalGain = valid.reduce((s, x) => s + (x.result.actualImprovement || 0), 0);
    if (totalGain < STAGNATION_MAX_TOTAL_GAIN) {
      stagnating = true;
      reason = `${valid.length} valid attempts with total observed gain ${totalGain} < ${STAGNATION_MAX_TOTAL_GAIN}`;
      affectedIntervention = valid[valid.length - 1]?.result?.interventionId || null;
    }
  }

  // Update current state stagnation field if present
  if (stagnating) {
    await EmployabilityState.updateOne(
      { prn: String(prn), isCurrent: true },
      { $set: { lastStagnationStatus: "stagnating" } }
    );
  }

  return {
    prn: String(prn),
    stagnating,
    status: stagnating ? "stagnating" : valid.length ? "not_stagnating" : "unknown",
    reason,
    affectedSkill,
    affectedIntervention,
    validAttemptCount: valid.length,
    policyVersion: STAGNATION_POLICY_VERSION,
    thresholds: {
      minIneffectiveSameIntervention: STAGNATION_MIN_INEFFECTIVE,
      minAttempts: STAGNATION_MIN_ATTEMPTS,
      maxTotalGainForStagnation: STAGNATION_MAX_TOTAL_GAIN,
    },
  };
}

/**
 * Build suppression set for adaptive selection.
 */
export async function getSuppressedInterventions(prn, skillId) {
  const stag = await detectStagnation(prn, { skillId });
  const suppressed = new Set();
  if (stag.stagnating && stag.affectedIntervention) {
    suppressed.add(stag.affectedIntervention);
  }
  // Also suppress any intervention with ≥2 ineffective on this student
  const results = await InterventionResult.find({ prn: String(prn) }).lean();
  const counts = {};
  for (const r of results) {
    const st = r.meta?.effectiveness?.status;
    if (st === "ineffective" && r.interventionId) {
      counts[r.interventionId] = (counts[r.interventionId] || 0) + 1;
    }
  }
  for (const [id, c] of Object.entries(counts)) {
    if (c >= STAGNATION_MIN_INEFFECTIVE) suppressed.add(id);
  }
  return { suppressed: [...suppressed], stagnation: stag };
}

/**
 * Adaptive next action: S4 selection with suppressions + modality switch preference.
 */
export async function selectAdaptiveNextAction({
  prn,
  roleId,
  persist = true,
  actor = "system",
}) {
  const stateInfo = await getCurrentEmployabilityState(prn);
  const startVersion = stateInfo.state?.stateVersion ?? null;

  const readiness = await computeReadiness({ prn, roleId, persist: false });
  const gaps = await computeSkillGaps({ prn, roleId });
  const topSkill = gaps.topPrioritySkill?.skillId || gaps.rankedGaps?.[0]?.skillId;

  const { suppressed, stagnation } = await getSuppressedInterventions(prn, topSkill);

  // Base S4 recommendation
  const base = await selectNextAction({
    prn,
    roleId,
    persist: false,
    actor,
  });

  const catalog = await listActiveInterventions();
  const seedMap = Object.fromEntries(INTERVENTION_SEEDS.map((s) => [s.interventionId, s]));

  let selected = base.selected;
  let adapted = false;
  let adaptReason = "Use S4 ranking";
  const alternatives = [];

  if (selected && suppressed.includes(selected.interventionId)) {
    adapted = true;
    adaptReason = `Suppressed ineffective/stagnant intervention ${selected.interventionId}`;
    // Find alternate for same skill with different modality/kind
    const skillId = selected.skillId;
    const prevModality = seedMap[selected.interventionId]?.modality;
    const candidates = INTERVENTION_SEEDS.filter((s) => {
      if (s.skillTarget !== skillId) return false;
      if (suppressed.includes(s.interventionId)) return false;
      return true;
    }).sort((a, b) => {
      // prefer different modality
      const aDiff = a.modality !== prevModality ? 0 : 1;
      const bDiff = b.modality !== prevModality ? 0 : 1;
      if (aDiff !== bDiff) return aDiff - bDiff;
      // prefer measure if stagnating
      if (stagnation.stagnating) {
        if (a.kind === "measure" && b.kind !== "measure") return -1;
        if (b.kind === "measure" && a.kind !== "measure") return 1;
      }
      return (a.estimatedEffort || 5) - (b.estimatedEffort || 5);
    });

    for (const c of candidates.slice(0, 5)) {
      alternatives.push({
        interventionId: c.interventionId,
        title: c.title,
        kind: c.kind,
        modality: c.modality,
        difficulty: c.difficulty,
      });
    }

    if (candidates.length) {
      const c = candidates[0];
      const highImpact = Boolean(c.highImpact);
      selected = {
        interventionId: c.interventionId,
        title: c.title,
        description: c.description,
        skillId: c.skillTarget,
        skillLabel: SKILL_LABELS[c.skillTarget] || c.skillTarget,
        kind: c.kind,
        modality: c.modality,
        difficulty: c.difficulty,
        expectedSkillGain: c.expectedSkillGain,
        estimatedDurationHours: c.estimatedDurationHours,
        highImpact,
        hitlRequired: highImpact || stagnation.stagnating,
        status: highImpact || stagnation.stagnating ? "pending_approval" : "draft",
      };
      adaptReason += `; switched to ${c.interventionId} (${c.kind}/${c.modality})`;
    } else {
      // escalate HITL
      selected = {
        ...selected,
        hitlRequired: true,
        status: "pending_approval",
        suppressed: true,
      };
      adaptReason += "; no alternate found — escalate HITL";
    }
  } else if (stagnation.stagnating && selected) {
    // Prefer measure-first under stagnation even if not suppressed id
    const measure = INTERVENTION_SEEDS.find(
      (s) =>
        s.skillTarget === selected.skillId &&
        s.kind === "measure" &&
        !suppressed.includes(s.interventionId)
    );
    if (measure && selected.kind !== "measure") {
      adapted = true;
      adaptReason = `Stagnation on skill — prefer measure ${measure.interventionId}`;
      selected = {
        interventionId: measure.interventionId,
        title: measure.title,
        description: measure.description,
        skillId: measure.skillTarget,
        skillLabel: SKILL_LABELS[measure.skillTarget] || measure.skillTarget,
        kind: measure.kind,
        modality: measure.modality,
        difficulty: measure.difficulty,
        expectedSkillGain: 0,
        estimatedDurationHours: measure.estimatedDurationHours,
        highImpact: false,
        hitlRequired: true,
        status: "pending_approval",
      };
    }
  }

  // If readiness insufficient evidence, force measure-first (already often true in S4)
  if (readiness.readinessBand === "INSUFFICIENT_EVIDENCE" && selected?.kind !== "measure") {
    const gap = gaps.rankedGaps?.find((g) => g.measureFirstCandidate) || gaps.rankedGaps?.[0];
    const measure = INTERVENTION_SEEDS.find(
      (s) => s.skillTarget === (gap?.skillId || selected?.skillId) && s.kind === "measure"
    );
    if (measure && !suppressed.includes(measure.interventionId)) {
      adapted = true;
      adaptReason = "Readiness INSUFFICIENT_EVIDENCE — measure-first adaptive override";
      selected = {
        interventionId: measure.interventionId,
        title: measure.title,
        description: measure.description,
        skillId: measure.skillTarget,
        skillLabel: SKILL_LABELS[measure.skillTarget] || measure.skillTarget,
        kind: "measure",
        modality: measure.modality,
        difficulty: measure.difficulty,
        expectedSkillGain: 0,
        estimatedDurationHours: measure.estimatedDurationHours,
        highImpact: false,
        hitlRequired: false,
        status: "draft",
      };
    }
  }

  const decision_trace = {
    adaptive: true,
    adapted,
    adapt_reason: adaptReason,
    suppressed_interventions: suppressed,
    stagnation,
    readiness_band: readiness.readinessBand,
    readiness_score: readiness.readinessScore,
    top_skill: topSkill,
    s2_top_priority: gaps.topPrioritySkill,
    base_s4_selection: base.selected?.interventionId || null,
    selected_intervention_id: selected?.interventionId || null,
    alternatives,
    policy_versions: {
      adaptive: ADAPTIVE_POLICY_VERSION,
      effectiveness: EFFECTIVENESS_POLICY_VERSION,
      stagnation: STAGNATION_POLICY_VERSION,
      selection: SELECTION_FORMULA_VERSION,
      priority: PRIORITY_FORMULA_VERSION,
      readiness: READINESS_FORMULA_VERSION,
      catalog: INTERVENTION_CATALOG_VERSION,
      role_requirement: ROLE_REQUIREMENT_VERSION,
      skill_graph: SKILL_GRAPH_VERSION,
    },
    explanation: [
      adaptReason,
      stagnation.stagnating ? `Stagnation: ${stagnation.reason}` : "No stagnation detected",
      `Readiness band ${readiness.readinessBand} (not placement probability)`,
      selected ? `Next action: ${selected.title}` : "No action selected",
    ].join(". "),
  };

  let decisionId = null;
  let cycleId = null;
  if (persist && selected) {
    const doc = await InterventionDecision.create({
      prn: String(prn),
      interventionId: selected.interventionId,
      skillId: selected.skillId,
      decisionTrace: decision_trace,
      priorityFormulaVersion: PRIORITY_FORMULA_VERSION,
      catalogVersion: INTERVENTION_CATALOG_VERSION,
      roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
      skillGraphVersion: SKILL_GRAPH_VERSION,
      stateVersion: startVersion,
      status: selected.status || "draft",
      generatedBy: actor,
    });
    decisionId = String(doc._id);

    cycleId = `cycle-${prn}-${Date.now()}`;
    await AuditEmployabilityCycle.create({
      prn: String(prn),
      cycleId,
      stateVersionBefore: startVersion,
      stateVersionAfter: startVersion,
      decisionId,
      predictionId: null,
      assessmentIds: [],
      resultId: null,
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
        phase: "adaptive_next_action",
        adaptivePolicyVersion: ADAPTIVE_POLICY_VERSION,
        decision_trace,
        roleId,
      },
    });
  }

  return {
    prn: String(prn),
    roleId,
    selected,
    decisionId,
    cycleId,
    decision_trace,
    stagnation,
    suppressedInterventions: suppressed,
    readiness: {
      readinessScore: readiness.readinessScore,
      readinessBand: readiness.readinessBand,
    },
    ml: { status: "unavailable", productionProbability: false },
    note: "Adaptive recommendation uses observed effectiveness/stagnation. HITL still required for high-impact/stagnation escalations. No ML probability.",
  };
}

/**
 * Finalize adaptive cycle after S5 intervention result exists.
 */
export async function finalizeAdaptiveCycle({
  prn,
  roleId,
  decisionId,
  resultId,
  actor = "system",
}) {
  const result = await InterventionResult.findById(resultId);
  if (!result) {
    const err = new Error("result not found");
    err.code = 404;
    throw err;
  }
  const evaluation = await evaluateInterventionResult(resultId);
  const stagnation = await detectStagnation(prn, {
    skillId: null,
    interventionId: result.interventionId,
  });
  const stateInfo = await getCurrentEmployabilityState(prn);
  const next = await selectAdaptiveNextAction({
    prn,
    roleId,
    persist: true,
    actor,
  });

  const cycleId = `cycle-final-${decisionId}-${Date.now()}`;
  await AuditEmployabilityCycle.create({
    prn: String(prn),
    cycleId,
    stateVersionBefore: null,
    stateVersionAfter: stateInfo.state?.stateVersion ?? null,
    decisionId,
    assessmentIds: [],
    resultId: String(resultId),
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
      phase: "cycle_finalize",
      effectiveness: evaluation,
      stagnation,
      nextDecisionId: next.decisionId,
      nextInterventionId: next.selected?.interventionId,
      adaptivePolicyVersion: ADAPTIVE_POLICY_VERSION,
    },
  });

  return {
    ok: true,
    cycleId,
    effectiveness: evaluation,
    stagnation,
    nextAction: next,
  };
}

export async function listAdaptiveCycles(prn, { limit = 30 } = {}) {
  return AuditEmployabilityCycle.find({ prn: String(prn) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function getEffectivenessHistory(prn, { interventionId = null } = {}) {
  const q = { prn: String(prn) };
  if (interventionId) q.interventionId = interventionId;
  const results = await InterventionResult.find(q).sort({ createdAt: -1 }).lean();
  const stats = await EffectivenessStats.find({
    scope: "student",
    scopeKey: String(prn),
  }).lean();
  return { results, stats };
}
