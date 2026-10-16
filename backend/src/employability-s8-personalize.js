/**
 * S8 — Deterministic effectiveness personalization from student intervention history.
 * Does not replace S6 suppression, HITL, prerequisites, or S7 ML.
 */

import {
  InterventionResult,
  StudentInterventionPreference,
} from "./employability-models.js";
import { INTERVENTION_SEEDS } from "./employability-s4-catalog.js";
import { EFFECTIVENESS_POLICY_VERSION } from "./employability-s6-adaptive.js";

export const PERSONALIZATION_VERSION = "s8-v1";

/** Recency: weight = exp(-λ * ageDays); λ chosen so ~90-day half-life-ish decay */
export const RECENCY_LAMBDA = 0.0077; // ~90 days to ~0.5 weight
/** Max absolute adjustment applied to adaptive selection score */
export const MAX_PERSONALIZATION_ADJUSTMENT = 12;
/** Cold-start: need this many valid non-self outcomes before MEDIUM influence */
export const MIN_VALID_FOR_LOW = 1;
export const MIN_VALID_FOR_MEDIUM = 3;
export const MIN_VALID_FOR_HIGH = 6;

const seedById = Object.fromEntries(INTERVENTION_SEEDS.map((s) => [s.interventionId, s]));

function evidenceWeight(sourceType) {
  const map = {
    verified_assessment: 1.0,
    project_evaluation: 0.95,
    coding_test: 0.9,
    teacher_evaluation: 0.75,
    verified_certificate: 0.65,
    verified_github: 0.6,
    self_report: 0.15,
  };
  return map[sourceType] || 0.2;
}

function isValidOutcome(result) {
  const sourceType = result.evidence?.[0]?.sourceType || null;
  const meaningful = result.meta?.meaningfulEvidence !== false;
  if (sourceType === "self_report") return false;
  if (!meaningful && result.actualImprovement == null) return false;
  const eff = result.meta?.effectiveness?.status;
  if (eff === "insufficient_evidence") return false;
  return result.actualImprovement != null || (eff && eff !== "unknown");
}

function recencyWeight(createdAt) {
  if (!createdAt) return 0.5; // missing timestamp → neutral conservative weight
  const ageDays = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 86400000);
  return Math.exp(-RECENCY_LAMBDA * ageDays);
}

function outcomeSignal(result) {
  const gain = result.actualImprovement != null ? Number(result.actualImprovement) : 0;
  const eff = result.meta?.effectiveness?.status;
  let base = gain;
  if (eff === "effective") base = Math.max(base, 8);
  if (eff === "partially_effective") base = Math.max(base, 3);
  if (eff === "ineffective") base = Math.min(base, 0);
  const src = result.evidence?.[0]?.sourceType;
  const w = evidenceWeight(src);
  const r = recencyWeight(result.createdAt);
  return base * w * r;
}

/**
 * Rebuild current personalization profile from InterventionResult history.
 */
export async function rebuildPersonalizationProfile(prn) {
  const results = await InterventionResult.find({ prn: String(prn) }).sort({ createdAt: 1 }).lean();
  const interventionAgg = new Map();
  const modalityAgg = new Map();
  const kindAgg = new Map();
  const skillAgg = new Map();

  let validCount = 0;
  for (const r of results) {
    if (!isValidOutcome(r)) continue;
    validCount += 1;
    const seed = seedById[r.interventionId] || {};
    const sig = outcomeSignal(r);
    const add = (map, key) => {
      if (!key) return;
      const cur = map.get(key) || { key, weightedSum: 0, weight: 0, n: 0, lastAt: null };
      const rw = recencyWeight(r.createdAt);
      cur.weightedSum += sig;
      cur.weight += rw * evidenceWeight(r.evidence?.[0]?.sourceType);
      cur.n += 1;
      cur.lastAt = r.createdAt || cur.lastAt;
      map.set(key, cur);
    };
    add(interventionAgg, r.interventionId);
    add(modalityAgg, seed.modality || null);
    add(kindAgg, seed.kind || null);
    add(skillAgg, seed.skillTarget || null);
  }

  const toPrefs = (map) =>
    [...map.values()].map((c) => ({
      key: c.key,
      score: c.weight > 0 ? Math.round((c.weightedSum / Math.max(c.weight, 0.01)) * 100) / 100 : 0,
      n: c.n,
      lastAt: c.lastAt,
    }));

  let evidenceLevel = "NONE";
  if (validCount >= MIN_VALID_FOR_HIGH) evidenceLevel = "HIGH";
  else if (validCount >= MIN_VALID_FOR_MEDIUM) evidenceLevel = "MEDIUM";
  else if (validCount >= MIN_VALID_FOR_LOW) evidenceLevel = "LOW";

  await StudentInterventionPreference.updateMany(
    { prn: String(prn), isCurrent: true },
    { $set: { isCurrent: false } }
  );

  const doc = await StudentInterventionPreference.create({
    prn: String(prn),
    personalizationVersion: PERSONALIZATION_VERSION,
    evidenceLevel,
    evidenceCount: results.length,
    validEvidenceCount: validCount,
    interventionPreferences: toPrefs(interventionAgg),
    modalityPreferences: toPrefs(modalityAgg),
    kindPreferences: toPrefs(kindAgg),
    skillPreferences: toPrefs(skillAgg),
    sourceVersions: {
      personalizationVersion: PERSONALIZATION_VERSION,
      effectivenessPolicyVersion: EFFECTIVENESS_POLICY_VERSION,
    },
    isCurrent: true,
    lastUpdated: new Date(),
  });

  return doc.toObject();
}

export async function getPersonalizationProfile(prn) {
  let doc = await StudentInterventionPreference.findOne({
    prn: String(prn),
    isCurrent: true,
  }).lean();
  if (!doc) {
    doc = await rebuildPersonalizationProfile(prn);
  }
  return doc;
}

/**
 * Lookup score hierarchy: intervention → modality → kind → skill → 0
 */
export function lookupPersonalizationScore(profile, { interventionId, modality, kind, skillId }) {
  if (!profile || profile.evidenceLevel === "NONE") {
    return { score: 0, level: "NONE", matched: "none", n: 0 };
  }
  const find = (arr, key) => (arr || []).find((p) => p.key === key);

  const i = find(profile.interventionPreferences, interventionId);
  if (i && i.n > 0) {
    return { score: i.score, level: profile.evidenceLevel, matched: "intervention", n: i.n };
  }
  const m = find(profile.modalityPreferences, modality);
  if (m && m.n > 0) {
    return { score: m.score * 0.85, level: profile.evidenceLevel, matched: "modality", n: m.n };
  }
  const k = find(profile.kindPreferences, kind);
  if (k && k.n > 0) {
    return { score: k.score * 0.7, level: profile.evidenceLevel, matched: "kind", n: k.n };
  }
  const s = find(profile.skillPreferences, skillId);
  if (s && s.n > 0) {
    return { score: s.score * 0.5, level: profile.evidenceLevel, matched: "skill", n: s.n };
  }
  return { score: 0, level: profile.evidenceLevel, matched: "none", n: 0 };
}

function influenceScale(evidenceLevel) {
  if (evidenceLevel === "HIGH") return 1.0;
  if (evidenceLevel === "MEDIUM") return 0.65;
  if (evidenceLevel === "LOW") return 0.3;
  return 0;
}

/**
 * Bounded adjustment for a candidate intervention.
 * Positive score → boost; negative/ineffective history → penalty.
 * Raw preference scores are roughly in skill-gain units; map to [-MAX, +MAX].
 */
export function computePersonalizationAdjustment(profile, candidate) {
  const seed = seedById[candidate.interventionId] || {};
  const hit = lookupPersonalizationScore(profile, {
    interventionId: candidate.interventionId,
    modality: seed.modality || candidate.modality,
    kind: seed.kind || candidate.kind,
    skillId: seed.skillTarget || candidate.skillId,
  });
  const scale = influenceScale(profile?.evidenceLevel || "NONE");
  // Map historical mean signal to adjustment; clamp
  let adj = hit.score * 0.8 * scale;
  adj = Math.max(-MAX_PERSONALIZATION_ADJUSTMENT, Math.min(MAX_PERSONALIZATION_ADJUSTMENT, adj));
  adj = Math.round(adj * 1000) / 1000;
  return {
    adjustment: adj,
    matched: hit.matched,
    historicalScore: hit.score,
    evidenceLevel: profile?.evidenceLevel || "NONE",
    evidenceN: hit.n,
    personalizationVersion: PERSONALIZATION_VERSION,
  };
}

/**
 * Apply personalization to S6 adaptive result: re-pick among catalog alternatives
 * if a non-suppressed candidate scores higher with adjustment.
 * Never re-enables suppressed IDs.
 */
export async function applyPersonalizationToAdaptiveResult(adaptiveResult, { prn }) {
  const profile = await getPersonalizationProfile(prn);
  const suppressed = new Set(adaptiveResult.suppressedInterventions || []);
  const selected = adaptiveResult.selected;
  if (!selected) {
    return {
      ...adaptiveResult,
      personalization: {
        applied: false,
        reason: "no_base_selection",
        profileEvidenceLevel: profile.evidenceLevel,
        personalizationVersion: PERSONALIZATION_VERSION,
      },
    };
  }

  const baseAdj = computePersonalizationAdjustment(profile, selected);
  const alternatives = INTERVENTION_SEEDS.filter(
    (s) =>
      s.skillTarget === selected.skillId &&
      !suppressed.has(s.interventionId)
  );

  let best = {
    item: selected,
    baseScore: 0,
    adj: baseAdj.adjustment,
    total: baseAdj.adjustment,
    meta: baseAdj,
  };

  const considered = [];
  for (const s of alternatives) {
    const meta = computePersonalizationAdjustment(profile, {
      interventionId: s.interventionId,
      modality: s.modality,
      kind: s.kind,
      skillId: s.skillTarget,
    });
    // Prefer keeping S6 pick unless personalization clearly favors another
    const isBase = s.interventionId === selected.interventionId;
    const total = (isBase ? 2 : 0) + meta.adjustment; // small stickiness to S6 base
    considered.push({
      interventionId: s.interventionId,
      adjustment: meta.adjustment,
      matched: meta.matched,
      n: meta.evidenceN,
      total,
    });
    if (total > best.total) {
      best = {
        item: {
          interventionId: s.interventionId,
          title: s.title,
          description: s.description,
          skillId: s.skillTarget,
          skillLabel: selected.skillLabel,
          kind: s.kind,
          modality: s.modality,
          difficulty: s.difficulty,
          expectedSkillGain: s.expectedSkillGain,
          estimatedDurationHours: s.estimatedDurationHours,
          highImpact: Boolean(s.highImpact),
          hitlRequired: Boolean(s.highImpact) || selected.hitlRequired,
          status: s.highImpact || selected.hitlRequired ? "pending_approval" : selected.status || "draft",
        },
        adj: meta.adjustment,
        total,
        meta,
      };
    }
  }

  considered.sort((a, b) => b.total - a.total);

  const changed = best.item.interventionId !== selected.interventionId;
  const personalizationTrace = {
    applied: profile.evidenceLevel !== "NONE",
    personalizationVersion: PERSONALIZATION_VERSION,
    evidenceLevel: profile.evidenceLevel,
    validEvidenceCount: profile.validEvidenceCount,
    baseInterventionId: selected.interventionId,
    finalInterventionId: best.item.interventionId,
    changed,
    baseAdjustment: baseAdj,
    finalAdjustment: best.meta,
    considered: considered.slice(0, 8),
    suppressedHonored: [...suppressed],
    explanation: buildExplanation(profile, selected, best, changed, baseAdj),
  };

  return {
    ...adaptiveResult,
    selected: best.item,
    decision_trace: {
      ...(adaptiveResult.decision_trace || {}),
      personalization: personalizationTrace,
      explanation: [
        adaptiveResult.decision_trace?.explanation || "",
        personalizationTrace.explanation,
      ]
        .filter(Boolean)
        .join(" "),
    },
    personalization: personalizationTrace,
  };
}

function buildExplanation(profile, base, best, changed, baseAdj) {
  if (profile.evidenceLevel === "NONE") {
    return "Personalization neutral (no valid verified intervention history). S6 selection unchanged.";
  }
  if (!changed) {
    return `Personalization evidence level ${profile.evidenceLevel} (n=${profile.validEvidenceCount}). Bounded adjustment ${baseAdj.adjustment} did not outrank the S6 base pick ${base.interventionId}.`;
  }
  return `Personalization preferred ${best.item.interventionId} over ${base.interventionId} based on historical verified outcomes (match=${best.meta.matched}, n=${best.meta.evidenceN}, adjustment=${best.meta.adjustment}). This is historically associated with stronger measured gains for this student, not a causal claim. S6 suppressions were honored.`;
}

/**
 * Full personalized adaptive next action: S6 then S8 adjustment.
 */
export async function selectPersonalizedNextAction(args) {
  const { selectAdaptiveNextAction } = await import("./employability-s6-adaptive.js");
  // Rebuild profile from latest results before selection
  await rebuildPersonalizationProfile(args.prn);
  const adaptive = await selectAdaptiveNextAction(args);
  const personalized = await applyPersonalizationToAdaptiveResult(adaptive, { prn: args.prn });

  // If persist and selection changed, decision already created by S6 — note in response only
  // Optional: if changed and persist, create additional decision with personalization trace
  if (args.persist && personalized.personalization?.changed && personalized.selected) {
    const { InterventionDecision } = await import("./employability-models.js");
    const {
      PRIORITY_FORMULA_VERSION,
    } = await import("./employability-s2-priority.js");
    const { INTERVENTION_CATALOG_VERSION } = await import("./employability-s4-catalog.js");
    const {
      ROLE_REQUIREMENT_VERSION,
      SKILL_GRAPH_VERSION,
    } = await import("./employability-s1-catalog.js");
    const doc = await InterventionDecision.create({
      prn: String(args.prn),
      interventionId: personalized.selected.interventionId,
      skillId: personalized.selected.skillId,
      decisionTrace: personalized.decision_trace,
      priorityFormulaVersion: PRIORITY_FORMULA_VERSION,
      catalogVersion: INTERVENTION_CATALOG_VERSION,
      roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
      skillGraphVersion: SKILL_GRAPH_VERSION,
      stateVersion: null,
      status: personalized.selected.status || "draft",
      generatedBy: args.actor || "system_s8",
    });
    personalized.decisionId = String(doc._id);
    personalized.personalization.persistedDecision = true;
  }

  return personalized;
}
