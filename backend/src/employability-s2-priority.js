/**
 * S2 — Skill-gap + multi-factor priority engine + decision_trace.
 * Deterministic for the same profile, role requirements, graph, and formula version.
 * Does NOT compute readiness bands, select interventions, or produce ML probabilities.
 */

import { InterventionDecision, EffectivenessStats } from "./employability-models.js";
import { getStudentSkillProfile } from "./employability-s1-profile.js";
import { getRoleRequirements, getSkillGraph } from "./employability-s1-seed.js";
import { SKILL_LABELS, ROLE_REQUIREMENT_VERSION, SKILL_GRAPH_VERSION } from "./employability-s1-catalog.js";

export const PRIORITY_FORMULA_VERSION = "s2-v1";

/** Configurable weights — sum need not be 1; stored in every decision_trace */
export const DEFAULT_WEIGHTS = {
  gap: 0.28,
  roleImportance: 0.22,
  dependency: 0.18,
  impact: 0.12,
  confidence: 0.08,
  effort: 0.07,
  history: 0.05,
};

/** Default effort (1–10) by skill family when no catalog duration exists */
const DEFAULT_EFFORT = {
  advanced_dsa: 8,
  system_design: 8,
  aiml: 8,
  full_stack: 7,
  dsa: 7,
  devops: 7,
  cloud: 6,
  react: 6,
  backend: 6,
  cybersecurity: 6,
  data_analysis: 5,
  dbms: 5,
  oop: 5,
  javascript: 5,
  programming: 4,
  git: 3,
  web_html_css: 3,
  communication: 4,
  projects: 6,
  internship: 5,
  os: 5,
  networks: 5,
};

function clamp01(x) {
  if (x == null || Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function skillMap(profileSkills) {
  const m = new Map();
  for (const s of profileSkills || []) {
    m.set(s.skillId, s);
  }
  return m;
}

/**
 * Dependency readiness for skill S:
 * 1 if all prerequisites (edges where dependentSkill === S) meet min threshold
 * with known scores; lower if blocked or unknown.
 */
function dependencyScore(skillId, skillsById, edges) {
  const prereqs = (edges || []).filter((e) => e.dependentSkill === skillId);
  if (!prereqs.length) return { score: 1, blocked: false, details: [] };

  const details = [];
  let met = 0;
  let blocked = false;
  for (const e of prereqs) {
    const ps = skillsById.get(e.prerequisiteSkill);
    const score = ps?.skillScore != null ? Number(ps.skillScore) : null;
    const min = e.minimumThreshold != null ? Number(e.minimumThreshold) : 0;
    const ok = score != null && score >= min;
    if (ok) met += 1;
    else blocked = true;
    details.push({
      prerequisiteSkill: e.prerequisiteSkill,
      minimumThreshold: min,
      currentScore: score,
      met: ok,
    });
  }
  const score = prereqs.length ? met / prereqs.length : 1;
  // If any prereq unmet, heavily penalize (blocked path)
  const adjusted = blocked ? score * 0.25 : score;
  return { score: clamp01(adjusted), blocked, details };
}

function effortFor(skillId) {
  const e = DEFAULT_EFFORT[skillId];
  return e != null ? e : 5;
}

/**
 * Estimated relative impact proxy (not a readiness computation):
 * role weight × normalized gap. Used only inside priority formula.
 */
function impactProxy(roleWeight, gapNorm) {
  return clamp01(roleWeight * gapNorm);
}

async function historyEffectiveness(prn, skillId) {
  // Prefer student-specific, then skill-global
  const student = await EffectivenessStats.findOne({
    scope: "student",
    scopeKey: String(prn),
    interventionId: null,
  }).lean();
  // skill-scoped stats if any
  const skillStat = await EffectivenessStats.findOne({
    scope: "skill",
    scopeKey: String(skillId),
  }).lean();
  if (skillStat?.successRate != null) return clamp01(Number(skillStat.successRate));
  if (student?.successRate != null) return clamp01(Number(student.successRate));
  return 0.5; // neutral prior
}

/**
 * Compute ranked skill gaps for a student + target role.
 */
export async function computeSkillGaps({
  prn,
  roleId,
  weights = DEFAULT_WEIGHTS,
  formulaVersion = PRIORITY_FORMULA_VERSION,
}) {
  if (!prn) throw new Error("prn required");
  if (!roleId) throw new Error("roleId required");

  const profile = await getStudentSkillProfile(prn);
  const roleData = await getRoleRequirements(roleId);
  if (!roleData) {
    const err = new Error("Role not found");
    err.code = 404;
    throw err;
  }
  const graph = await getSkillGraph();
  const skillsById = skillMap(profile.skills);
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  const items = [];

  for (const req of roleData.requirements || []) {
    const skillId = req.skillId;
    const sk = skillsById.get(skillId) || {};
    const current =
      sk.skillScore != null && !Number.isNaN(Number(sk.skillScore))
        ? Number(sk.skillScore)
        : null;
    const target =
      req.minimumThreshold != null ? Number(req.minimumThreshold) : null;
    const rawGap =
      target != null && current != null
        ? Math.max(0, target - current)
        : target != null
          ? target
          : 0;
    // Normalize gap to 0–1 assuming 0–100 scale
    const gapNorm = clamp01(rawGap / 100);

    const roleWeight = clamp01(Number(req.skillWeight) || 0);
    const dep = dependencyScore(skillId, skillsById, graph.edges);
    const confidence =
      sk.confidence != null ? clamp01(Number(sk.confidence)) : 0;
    const status = sk.status || (current == null ? "unknown" : "unknown");
    const effort = effortFor(skillId);
    const effortNorm = clamp01(effort / 10);
    const hist = await historyEffectiveness(prn, skillId);
    const impact = impactProxy(roleWeight, gapNorm);

    // Confidence term: low confidence increases priority of measuring (gap still counts)
    // Use (1 - confidence) so unknown skills surface when important
    const confidenceTerm = clamp01(1 - confidence);

    // Measure-first flag (informational for S2; selection is S4)
    const measureFirst =
      status === "insufficient_evidence" ||
      status === "self_reported" ||
      status === "unknown" ||
      current == null;

    let finalPriority =
      w.gap * gapNorm +
      w.roleImportance * roleWeight +
      w.dependency * dep.score +
      w.impact * impact +
      w.confidence * confidenceTerm +
      w.history * hist -
      w.effort * effortNorm;

    // Hard penalty if blocked by prerequisites — do not rank advanced skill first
    if (dep.blocked) {
      finalPriority = finalPriority * 0.35;
    }

    // Preferred skills slightly lower than required if category set
    if (req.category === "preferred") {
      finalPriority = finalPriority * 0.9;
    }

    finalPriority = Math.round(finalPriority * 10000) / 10000;

    const decision_trace = {
      skill: skillId,
      skillLabel: SKILL_LABELS[skillId] || skillId,
      category: req.category,
      currentScore: current,
      targetScore: target,
      gap: rawGap,
      gapNormalized: Math.round(gapNorm * 1000) / 1000,
      role_weight: roleWeight,
      dependency_score: Math.round(dep.score * 1000) / 1000,
      dependency_blocked: dep.blocked,
      dependency_details: dep.details,
      expected_employability_impact_proxy: Math.round(impact * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      skill_status: status,
      estimated_effort: effort,
      effort_normalized: Math.round(effortNorm * 1000) / 1000,
      previous_effectiveness: Math.round(hist * 1000) / 1000,
      measure_first_candidate: measureFirst,
      weights: { ...w },
      formula_version: formulaVersion,
      role_requirement_version: ROLE_REQUIREMENT_VERSION,
      skill_graph_version: SKILL_GRAPH_VERSION,
      final_priority: finalPriority,
      explanation: buildExplanation({
        skillId,
        rawGap,
        roleWeight,
        dep,
        measureFirst,
        finalPriority,
        status,
      }),
    };

    items.push({
      skillId,
      skillLabel: SKILL_LABELS[skillId] || skillId,
      category: req.category,
      currentScore: current,
      targetScore: target,
      gap: rawGap,
      priority: finalPriority,
      measureFirstCandidate: measureFirst,
      dependencyBlocked: dep.blocked,
      decision_trace,
    });
  }

  items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.skillId.localeCompare(b.skillId);
  });

  const top = items[0] || null;

  return {
    prn: String(prn),
    roleId,
    roleName: roleData.role?.roleName || roleId,
    formulaVersion,
    roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
    skillGraphVersion: SKILL_GRAPH_VERSION,
    profileExists: profile.exists,
    rankedGaps: items,
    topPrioritySkill: top
      ? {
          skillId: top.skillId,
          skillLabel: top.skillLabel,
          priority: top.priority,
          measureFirstCandidate: top.measureFirstCandidate,
          dependencyBlocked: top.dependencyBlocked,
          explanation: top.decision_trace.explanation,
        }
      : null,
    note: "S2 priority ranking only. Not a readiness score or placement probability. Not an intervention assignment.",
  };
}

function buildExplanation({ skillId, rawGap, roleWeight, dep, measureFirst, finalPriority, status }) {
  const label = SKILL_LABELS[skillId] || skillId;
  const parts = [];
  parts.push(`${label} ranked with priority ${finalPriority}.`);
  if (rawGap > 0) parts.push(`Skill gap is ${rawGap} points versus the role minimum.`);
  if (roleWeight >= 0.75) parts.push("It carries high importance for the selected target role.");
  if (dep.blocked) {
    parts.push(
      "One or more prerequisites are below threshold, so this skill is down-ranked until foundations improve."
    );
  } else if (dep.score >= 0.99) {
    parts.push("Prerequisite skills appear ready.");
  }
  if (measureFirst) {
    parts.push(
      `Evidence status is "${status}" — measuring this skill (assessment) may be needed before treating a score as verified.`
    );
  }
  parts.push(
    "This ranking is a deterministic multi-factor priority, not a causal claim and not a placement probability."
  );
  return parts.join(" ");
}

/**
 * Persist top decision_trace rows for audit (optional).
 * Does not create interventions or approvals.
 */
export async function persistGapDecisionTraces(prn, roleId, gapResult, { limit = 5, actor = "system" } = {}) {
  const created = [];
  const rows = (gapResult.rankedGaps || []).slice(0, limit);
  for (const row of rows) {
    const doc = await InterventionDecision.create({
      prn: String(prn),
      interventionId: null,
      skillId: row.skillId,
      decisionTrace: row.decision_trace,
      priorityFormulaVersion: gapResult.formulaVersion,
      catalogVersion: null,
      roleRequirementVersion: gapResult.roleRequirementVersion,
      skillGraphVersion: gapResult.skillGraphVersion,
      stateVersion: null,
      status: "draft",
      generatedBy: actor,
    });
    created.push(String(doc._id));
  }
  return { saved: created.length, ids: created };
}
