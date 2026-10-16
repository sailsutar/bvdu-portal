/**
 * S9 — Read-only dashboard aggregation. No new scoring/selection/ML logic.
 */
import { computeSkillGaps } from "./employability-s2-priority.js";
import { computeReadiness } from "./employability-s3-readiness.js";
import { selectNextAction } from "./employability-s4-select.js";
import { getCurrentEmployabilityState, getAssessmentHistory, getStateHistory, getInterventionResults } from "./employability-s5-assessment.js";
import { detectStagnation, listAdaptiveCycles, getEffectivenessHistory } from "./employability-s6-adaptive.js";
import { predictEmployability } from "./employability-s7-predict.js";
import { getPersonalizationProfile } from "./employability-s8-personalize.js";
import { getSkillGraph, getRoleRequirements, listActiveRoles, seedEmployabilityS1Catalog } from "./employability-s1-seed.js";
import { getStudentSkillProfile } from "./employability-s1-profile.js";
import { inspectEmployabilityMlData, getRegistryStatus } from "./employability-s7-data.js";
import { SKILL_LABELS } from "./employability-s1-catalog.js";
import { PlacementProfile } from "./db.js";

const DEFAULT_ROLE = "software_developer";

export async function buildStudentDashboard(prn, { roleId = DEFAULT_ROLE } = {}) {
  const role = roleId || DEFAULT_ROLE;
  // Ensure catalog exists (idempotent); fixes empty graph / role-not-found after partial deploy
  try {
    await seedEmployabilityS1Catalog();
  } catch (e) {
    console.warn("[employability] dashboard seed:", e?.message || e);
  }

  const [profile, gaps, readiness, graph, roles, nextAction, statePack, assessments, stateHistory, interventionResults, stagnation, cycles, effectiveness, personalization, ml] =
    await Promise.all([
      getStudentSkillProfile(prn),
      computeSkillGaps({ prn, roleId: role }).catch((e) => ({ error: String(e.message || e) })),
      computeReadiness({ prn, roleId: role, persist: false }).catch((e) => ({ error: String(e.message || e) })),
      getSkillGraph(),
      listActiveRoles(),
      selectNextAction({ prn, roleId: role, persist: false, actor: "dashboard" }).catch((e) => ({ error: String(e.message || e) })),
      getCurrentEmployabilityState(prn),
      getAssessmentHistory(prn, { limit: 20 }),
      getStateHistory(prn, { limit: 15 }),
      getInterventionResults(prn, { limit: 15 }),
      detectStagnation(prn),
      listAdaptiveCycles(prn, { limit: 15 }),
      getEffectivenessHistory(prn),
      getPersonalizationProfile(prn).catch(() => null),
      predictEmployability(prn, { roleId: role }),
    ]);

  return {
    prn: String(prn),
    roleId: role,
    roles,
    profile: {
      exists: profile.exists,
      skills: profile.skills || [],
    },
    readiness: readiness?.error
      ? { error: readiness.error }
      : {
          readinessScore: readiness.readinessScore,
          readinessBand: readiness.readinessBand,
          formulaVersion: readiness.formulaVersion,
          explanation: readiness.explanation,
          labels: readiness.labels,
          note: "Evidence-Based Readiness — not a placement probability",
        },
    gaps: gaps?.error
      ? { error: gaps.error }
      : {
          rankedGaps: gaps.rankedGaps || [],
          topPrioritySkill: gaps.topPrioritySkill,
          note: gaps.note,
        },
    skillGraph: {
      version: graph.version,
      edges: graph.edges || [],
    },
    skillLabels: SKILL_LABELS,
    nextAction: nextAction?.error
      ? { error: nextAction.error }
      : {
          selected: nextAction.selected,
          decision_trace: nextAction.decision_trace,
          note: nextAction.note,
        },
    state: statePack,
    assessments,
    stateHistory,
    interventionResults,
    stagnation,
    adaptiveCycles: cycles,
    effectiveness,
    personalization,
    ml: {
      mlStatus: ml.mlStatus,
      productionProbability: ml.productionProbability,
      probability: ml.probability,
      reason: ml.reason,
      model: ml.model,
      note:
        ml.productionProbability
          ? "Model-based placement probability (separate from readiness)"
          : "Placement prediction unavailable — insufficient real historical placement outcomes or no active model.",
    },
  };
}

export async function buildFacultyDashboard({ prns = [], roleId = DEFAULT_ROLE } = {}) {
  const rows = [];
  for (const prn of prns.slice(0, 100)) {
    try {
      const [readiness, gaps, nextAction, stagnation, personalization] = await Promise.all([
        computeReadiness({ prn, roleId, persist: false }).catch(() => null),
        computeSkillGaps({ prn, roleId }).catch(() => null),
        selectNextAction({ prn, roleId, persist: false }).catch(() => null),
        detectStagnation(prn).catch(() => null),
        getPersonalizationProfile(prn).catch(() => null),
      ]);
      rows.push({
        prn,
        readinessBand: readiness?.readinessBand ?? "UNKNOWN",
        readinessScore: readiness?.readinessScore ?? null,
        insufficientEvidence: readiness?.readinessBand === "INSUFFICIENT_EVIDENCE",
        topSkillGap: gaps?.topPrioritySkill || null,
        currentIntervention: nextAction?.selected?.title || null,
        interventionStatus: nextAction?.selected?.status || null,
        stagnation: Boolean(stagnation?.stagnating),
        personalizationEvidenceLevel: personalization?.evidenceLevel || "NONE",
      });
    } catch {
      rows.push({ prn, error: "failed_to_load" });
    }
  }
  return { roleId, students: rows, count: rows.length };
}

export async function buildHodDashboard({ prns = [], roleId = DEFAULT_ROLE } = {}) {
  if (!prns.length) {
    return {
      roleId,
      insufficientData: true,
      message: "Insufficient data — no student PRNs in scope",
      totals: { students: 0 },
    };
  }
  const faculty = await buildFacultyDashboard({ prns, roleId });
  const bandCounts = {};
  let stagnating = 0;
  let insufficient = 0;
  const gapSkills = {};
  for (const s of faculty.students) {
    const b = s.readinessBand || "UNKNOWN";
    bandCounts[b] = (bandCounts[b] || 0) + 1;
    if (s.stagnation) stagnating += 1;
    if (s.insufficientEvidence) insufficient += 1;
    const g = s.topSkillGap?.skillId;
    if (g) gapSkills[g] = (gapSkills[g] || 0) + 1;
  }
  const majorGaps = Object.entries(gapSkills)
    .map(([skillId, count]) => ({ skillId, skillLabel: SKILL_LABELS[skillId] || skillId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    roleId,
    insufficientData: false,
    totals: {
      students: faculty.students.length,
      stagnating,
      insufficientEvidence: insufficient,
    },
    readinessBandDistribution: bandCounts,
    majorSkillGaps: majorGaps,
    studentsRequiringAttention: faculty.students.filter(
      (s) => s.stagnation || s.insufficientEvidence || s.readinessBand === "NOT_READY"
    ),
    note: "Aggregates use Evidence-Based Readiness bands — not placement success rates.",
  };
}

export async function buildPlacementDashboard({ prns = [], roleId = DEFAULT_ROLE } = {}) {
  const faculty = await buildFacultyDashboard({ prns, roleId });
  const ml = await inspectEmployabilityMlData();
  const registry = await getRegistryStatus();
  return {
    ...faculty,
    ml: {
      status: registry.status,
      productionActive: registry.productionActive,
      labeledOutcomes: ml.counts.labeled,
      message:
        registry.productionActive
          ? "Active model present"
          : "ML placement prediction unavailable.",
    },
    note: "Do not interpret readiness bands as placement probability.",
  };
}

export async function buildAdminDashboard() {
  const [mlData, registry] = await Promise.all([
    inspectEmployabilityMlData(),
    getRegistryStatus(),
  ]);
  return {
    system: {
      stages: ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"],
      presentation: "S9 dashboards",
    },
    ml: {
      data: mlData,
      registry,
      displayStatus: registry.productionActive ? "active" : "unavailable",
    },
  };
}

/** Resolve PRNs for cohort from placement profiles or explicit list */
export async function resolveDashboardPrns({ yearLevel = null, limit = 80 } = {}) {
  const q = {};
  if (yearLevel) q.yearLevel = yearLevel;
  const rows = await PlacementProfile.find(q).select("prn").limit(limit).lean();
  return rows.map((r) => r.prn).filter(Boolean);
}
