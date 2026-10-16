import {
  getCareerCoach,
  selectCareerDomain,
  setCareerDsaTopic,
  setCareerDomainTopic,
  submitFinalProject,
  CAREER_DOMAINS,
} from "./career-coach.js";
import { runCareerCoachChat } from "./career-coach-chatbot.js";
/**
 * Employability HTTP routes — S1 surface only.
 * Full gap/readiness/intervention APIs belong to later stages.
 */
import {
  requireAuth,
  requireRoles,
  requireAdmin,
} from "./auth.js";
import { getDsaRoadmap, setDsaTopicDone, DSA_ROADMAP_TOPICS } from "./employability-dsa-roadmap.js";
import { isEmployabilitySystemEnabled, getEmployabilityS0Status, getEmployabilityMlRegistryStatus } from "./employability-s0.js";
import {
  seedEmployabilityS1Catalog,
  getSkillGraph,
  listActiveRoles,
  getRoleRequirements,
} from "./employability-s1-seed.js";
import {
  getStudentSkillProfile,
  upsertStudentSkills,
  listUnmetPrerequisites,
} from "./employability-s1-profile.js";
import {
  computeSkillGaps,
  persistGapDecisionTraces,
  PRIORITY_FORMULA_VERSION,
  DEFAULT_WEIGHTS,
} from "./employability-s2-priority.js";
import {
  computeReadiness,
  READINESS_FORMULA_VERSION,
  READINESS_BAND_THRESHOLDS,
} from "./employability-s3-readiness.js";
import { seedInterventionCatalog, listActiveInterventions } from "./employability-s4-seed.js";
import {
  selectNextAction,
  getDecision,
  listDecisionsForPrn,
  hitlUpdateDecision,
  SELECTION_FORMULA_VERSION,
} from "./employability-s4-select.js";
import { INTERVENTION_CATALOG_VERSION } from "./employability-s4-catalog.js";
import {
  submitAssessmentResult,
  recordInterventionResult,
  getAssessmentHistory,
  getStateHistory,
  getCurrentEmployabilityState,
  getInterventionResults,
  EVIDENCE_MERGE_VERSION,
  STATE_UPDATE_VERSION,
} from "./employability-s5-assessment.js";
import {
  selectAdaptiveNextAction,
  finalizeAdaptiveCycle,
  listAdaptiveCycles,
  getEffectivenessHistory,
  detectStagnation,
  evaluateInterventionResult,
  ADAPTIVE_POLICY_VERSION,
  EFFECTIVENESS_POLICY_VERSION,
  STAGNATION_POLICY_VERSION,
} from "./employability-s6-adaptive.js";
import { inspectEmployabilityMlData, getRegistryStatus } from "./employability-s7-data.js";
import {
  getPersonalizationProfile,
  rebuildPersonalizationProfile,
  selectPersonalizedNextAction,
  PERSONALIZATION_VERSION,
} from "./employability-s8-personalize.js";
import {
  buildStudentDashboard,
  buildFacultyDashboard,
  buildHodDashboard,
  buildPlacementDashboard,
  buildAdminDashboard,
  resolveDashboardPrns,
} from "./employability-s9-dashboard.js";
import {
  runEvaluation,
  listEvaluationRuns,
  getEvaluationRun,
  getEvaluationStatus,
  buildComparisonTable,
  EVALUATION_VERSION,
} from "./employability-s10-evaluation.js";
import { runEmployabilityTraining, tryActivateModel, MODEL_PIPELINE_VERSION } from "./employability-s7-train.js";
import { predictEmployability, explainEmployabilityPrediction } from "./employability-s7-predict.js";
import { buildEmployabilityFeatures, FEATURE_NAMES } from "./employability-s7-features.js";
import { FEATURE_VERSION, DATASET_VERSION } from "./employability-s7-data.js";
import {
  SKILL_LABELS,
  SKILL_GRAPH_VERSION,
  ROLE_REQUIREMENT_VERSION,
  CATALOG_VERSION,
} from "./employability-s1-catalog.js";

const requireStaff = requireRoles("admin", "system_admin", "teacher_guide", "placement_coordinator", "placement_head");

/** Auth middleware sets req.auth (not req.user). Support both. */
function authUser(req) {
  return req.auth || req.user || {};
}

function canAccessPrn(req, prn) {
  const u = authUser(req);
  const role = u.role;
  const sub = String(u.sub || u.id || u.prn || "");
  if (["admin", "system_admin", "teacher_guide", "placement_coordinator", "placement_head", "hod"].includes(role)) {
    return true;
  }
  // students: own PRN only
  return Boolean(sub && String(prn) === sub);
}

export function registerEmployabilityRoutes(app) {
  /** Extended health: S0 + S1 catalog versions */
  app.get("/api/employability/s0-status", async (_req, res) => {
    try {
      const status = getEmployabilityS0Status();
      const ml = await getEmployabilityMlRegistryStatus();
      res.json({
        ok: true,
        ...status,
        s1: {
          catalogVersion: CATALOG_VERSION,
          skillGraphVersion: SKILL_GRAPH_VERSION,
          roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
          skillCatalogSize: Object.keys(SKILL_LABELS).length,
        },
        s2: {
          priorityFormulaVersion: PRIORITY_FORMULA_VERSION,
          skillGapEngine: "available",
          defaultWeights: DEFAULT_WEIGHTS,
        },
        s3: {
          readinessFormulaVersion: READINESS_FORMULA_VERSION,
          readinessEngine: "available",
          bandThresholds: READINESS_BAND_THRESHOLDS,
        },
        s4: {
          catalogVersion: INTERVENTION_CATALOG_VERSION,
          selectionFormulaVersion: SELECTION_FORMULA_VERSION,
          nextActionEngine: "available",
        },
        s5: {
          evidenceMergeVersion: EVIDENCE_MERGE_VERSION,
          stateUpdateVersion: STATE_UPDATE_VERSION,
          assessmentEngine: "available",
        },
        s6: {
          adaptivePolicyVersion: ADAPTIVE_POLICY_VERSION,
          effectivenessPolicyVersion: EFFECTIVENESS_POLICY_VERSION,
          stagnationPolicyVersion: STAGNATION_POLICY_VERSION,
          adaptiveLoop: "available",
        },
        s7: {
          pipelineVersion: MODEL_PIPELINE_VERSION,
          featureVersion: FEATURE_VERSION,
          datasetVersion: DATASET_VERSION,
          ml: "gated_unavailable_without_real_labels",
        },
        s8: {
          personalizationVersion: PERSONALIZATION_VERSION,
          personalization: "available",
        },
        s10: {
          evaluationVersion: EVALUATION_VERSION,
          researchHarness: "available",
        },
        mlRegistry: ml,
        message:
          "S0+S1 foundation. Employability ML = unavailable. S2 skill-gap + S3 readiness available. Intervention engine and employability ML not implemented.",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/skills/catalog", requireAuth, (_req, res) => {
    res.json({
      ok: true,
      version: CATALOG_VERSION,
      skills: Object.entries(SKILL_LABELS).map(([skillId, label]) => ({ skillId, label })),
    });
  });

  app.get("/api/employability/roles", requireAuth, async (_req, res) => {
    try {
      const roles = await listActiveRoles();
      res.json({
        ok: true,
        roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
        roles: roles.map((r) => ({
          roleId: r.roleId,
          roleName: r.roleName,
          description: r.description,
          version: r.version,
          status: r.status,
        })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/roles/:roleId/requirements", requireAuth, async (req, res) => {
    try {
      const data = await getRoleRequirements(req.params.roleId);
      if (!data) return res.status(404).json({ ok: false, error: "Role not found" });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/skill-graph", requireAuth, async (_req, res) => {
    try {
      const graph = await getSkillGraph();
      res.json({
        ok: true,
        ...graph,
        skillLabels: SKILL_LABELS,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/profile/:prn", requireAuth, async (req, res) => {
    try {
      const prn = req.params.prn;
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const profile = await getStudentSkillProfile(prn);
      const graph = await getSkillGraph();
      const unmet = listUnmetPrerequisites(profile.skills, graph.edges);
      res.json({
        ok: true,
        profile,
        prerequisiteHints: unmet,
        note: "Prerequisite hints are informational only. Gap ranking and readiness are not implemented in S1.",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/employability/profile/:prn/skills", requireAuth, async (req, res) => {
    try {
      const prn = req.params.prn;
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const skills = req.body?.skills;
      if (!Array.isArray(skills)) {
        return res.status(400).json({ ok: false, error: "body.skills array required" });
      }
      const profile = await upsertStudentSkills(prn, skills, {
        actor: (req.auth || req.user)?.sub || (req.auth || req.user)?.name || null,
        source: req.body?.source || "manual",
        notes: req.body?.notes,
      });
      res.json({
        ok: true,
        profile,
        message:
          "Skills saved with evidence hierarchy. Self-report alone yields insufficient_evidence for strong claims. No readiness or placement probability computed.",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });


  /** S2: ranked skill gaps + decision_trace for a PRN and target role */
  app.get("/api/employability/gaps", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      const roleId = req.query.roleId;
      if (!prn) return res.status(400).json({ ok: false, error: "prn required" });
      if (!roleId) return res.status(400).json({ ok: false, error: "roleId query required" });
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const result = await computeSkillGaps({ prn, roleId });
      const persist = String(req.query.persist || "").toLowerCase() === "1" || req.query.persist === "true";
      let saved = null;
      if (persist) {
        saved = await persistGapDecisionTraces(prn, roleId, result, {
          actor: (req.auth || req.user)?.sub || "system",
        });
      }
      res.json({ ok: true, ...result, persisted: saved });
    } catch (e) {
      const code = e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/gaps", requireAuth, async (req, res) => {
    try {
      const prn = req.body?.prn || (req.auth || req.user)?.sub;
      const roleId = req.body?.roleId;
      if (!prn || !roleId) {
        return res.status(400).json({ ok: false, error: "prn and roleId required" });
      }
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const weights = req.body?.weights;
      const result = await computeSkillGaps({
        prn,
        roleId,
        weights: weights && typeof weights === "object" ? weights : undefined,
      });
      let saved = null;
      if (req.body?.persist) {
        saved = await persistGapDecisionTraces(prn, roleId, result, {
          actor: (req.auth || req.user)?.sub || "system",
        });
      }
      res.json({ ok: true, ...result, persisted: saved });
    } catch (e) {
      const code = e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  /** Staff-only: re-run S1 catalog seed (idempotent) */
  app.post("/api/employability/s1/seed-catalog", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await seedEmployabilityS1Catalog();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Guard: explicitly reject premature readiness/probability endpoints


  app.post("/api/employability/assessments", requireAuth, requireStaff, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await submitAssessmentResult({
        prn: body.prn,
        skillId: body.skillId,
        sourceType: body.sourceType,
        score: body.score,
        decisionId: body.decisionId || null,
        interventionId: body.interventionId || null,
        assessor: body.assessor || (req.auth || req.user)?.sub,
        sourceId: body.sourceId || null,
        verificationStatus: body.verificationStatus,
        meta: body.meta || {},
        actor: (req.auth || req.user)?.sub || null,
      });
      res.json(result);
    } catch (e) {
      const code = e.code === 400 ? 400 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/intervention-results", requireAuth, requireStaff, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.prn || !body.decisionId) {
        return res.status(400).json({ ok: false, error: "prn and decisionId required" });
      }
      const result = await recordInterventionResult({
        prn: body.prn,
        decisionId: body.decisionId,
        sourceType: body.sourceType,
        score: body.score,
        assessor: body.assessor || (req.auth || req.user)?.sub,
        actor: (req.auth || req.user)?.sub || null,
        timeSpentHours: body.timeSpentHours,
        meta: body.meta || {},
      });
      res.json(result);
    } catch (e) {
      const code = e.code === 400 ? 400 : e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/assessments", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      if (!prn) return res.status(400).json({ ok: false, error: "prn required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const rows = await getAssessmentHistory(prn, {
        skillId: req.query.skillId || null,
        limit: Number(req.query.limit) || 50,
      });
      res.json({ ok: true, assessments: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/state/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const data = await getCurrentEmployabilityState(req.params.prn);
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/state-history/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const rows = await getStateHistory(req.params.prn, {
        limit: Number(req.query.limit) || 20,
      });
      res.json({ ok: true, history: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/intervention-results", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      if (!prn) return res.status(400).json({ ok: false, error: "prn required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const rows = await getInterventionResults(prn);
      res.json({ ok: true, results: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/interventions/catalog", requireAuth, async (_req, res) => {
    try {
      const items = await listActiveInterventions();
      res.json({ ok: true, catalogVersion: INTERVENTION_CATALOG_VERSION, interventions: items });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/s4/seed-catalog", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await seedInterventionCatalog();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });





  // --- Career Coach (domain roadmaps) ---
  app.get("/api/career-coach/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const data = await getCareerCoach(req.params.prn);
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/career-coach/:prn/domain", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const domainId = req.body?.domainId;
      const data = await selectCareerDomain(req.params.prn, domainId);
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(e.code === 400 ? 400 : 500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/career-coach/:prn/dsa-topic", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const data = await setCareerDsaTopic(
        req.params.prn,
        req.body?.topicId,
        req.body?.done !== false && req.body?.done !== "false"
      );
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(e.code === 400 ? 400 : 500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/career-coach/:prn/topic", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const data = await setCareerDomainTopic(req.params.prn, {
        domainId: req.body?.domainId,
        topicId: req.body?.topicId || req.body?.stageId,
        done: req.body?.done !== false && req.body?.done !== "false",
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(e.code === 400 ? 400 : 500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/career-coach/:prn/final-project", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const data = await submitFinalProject(req.params.prn, {
        domainId: req.body?.domainId,
        projectId: req.body?.projectId || req.body?.stageId,
        note: req.body?.note,
        markDone: Boolean(req.body?.markDone),
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(e.code === 400 ? 400 : 500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/career-coach/meta/domains", requireAuth, (_req, res) => {
    res.json({ ok: true, domains: CAREER_DOMAINS });
  });

  /** Offline Career Coach chatbot — no external AI API required */
  app.post("/api/career-coach/:prn/chat", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const message = String(req.body?.message || req.body?.text || "").trim();
      if (!message) return res.status(400).json({ ok: false, error: "message required" });
      if (message.length > 2000) return res.status(400).json({ ok: false, error: "message too long" });
      let progress = null;
      try {
        progress = await getCareerCoach(req.params.prn);
      } catch (_) {
        progress = null;
      }
      const out = runCareerCoachChat({ message, progress });
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // --- Student DSA roadmap (self-prep checklist) ---
  app.get("/api/employability/dsa-roadmap/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const data = await getDsaRoadmap(req.params.prn);
      res.json({ ok: true, ...data, catalog: DSA_ROADMAP_TOPICS.map((t) => t.id) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/employability/dsa-roadmap/:prn/topic", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const topicId = req.body?.topicId || req.body?.id;
      const done = req.body?.done !== false && req.body?.done !== "false";
      const data = await setDsaTopicDone(req.params.prn, topicId, done);
      res.json({ ok: true, ...data });
    } catch (e) {
      const code = e.code === 400 ? 400 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/dashboard/student/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const data = await buildStudentDashboard(req.params.prn, {
        roleId: req.query.roleId || "software_developer",
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/dashboard/faculty", requireAuth, requireStaff, async (req, res) => {
    try {
      let prns = String(req.query.prns || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!prns.length) {
        prns = await resolveDashboardPrns({ yearLevel: req.query.yearLevel || null });
      }
      prns = prns.filter((p) => canAccessPrn(req, p));
      const data = await buildFacultyDashboard({
        prns,
        roleId: req.query.roleId || "software_developer",
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/dashboard/hod", requireAuth, requireStaff, async (req, res) => {
    try {
      let prns = String(req.query.prns || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!prns.length) {
        prns = await resolveDashboardPrns({ yearLevel: req.query.yearLevel || null, limit: 120 });
      }
      const data = await buildHodDashboard({
        prns,
        roleId: req.query.roleId || "software_developer",
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/dashboard/placement", requireAuth, requireStaff, async (req, res) => {
    try {
      let prns = String(req.query.prns || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!prns.length) {
        prns = await resolveDashboardPrns({ limit: 100 });
      }
      const data = await buildPlacementDashboard({
        prns,
        roleId: req.query.roleId || "software_developer",
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });


  app.get("/api/employability/evaluation/status", requireAuth, requireStaff, async (_req, res) => {
    try {
      const data = await getEvaluationStatus();
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/evaluation/run", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await runEvaluation({ actor: (req.auth || req.user)?.sub || "admin" });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/evaluation/runs", requireAuth, requireStaff, async (_req, res) => {
    try {
      const runs = await listEvaluationRuns();
      res.json({ ok: true, runs });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/evaluation/runs/:evaluationId", requireAuth, requireStaff, async (req, res) => {
    try {
      const data = await getEvaluationRun(req.params.evaluationId);
      if (!data) return res.status(404).json({ ok: false, error: "Not found" });
      res.json({
        ok: true,
        ...data,
        comparison: buildComparisonTable(data.results || []),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/evaluation/compare/:evaluationId", requireAuth, requireStaff, async (req, res) => {
    try {
      const data = await getEvaluationRun(req.params.evaluationId);
      if (!data) return res.status(404).json({ ok: false, error: "Not found" });
      res.json({
        ok: true,
        evaluationId: req.params.evaluationId,
        comparison: buildComparisonTable(data.results || []),
        limitations: data.run?.limitations || [],
        note: "Observed historical evaluation — not causal proof",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/dashboard/admin", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const data = await buildAdminDashboard();
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/personalization/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const rebuild = String(req.query.rebuild || "") === "1";
      const profile = rebuild
        ? await rebuildPersonalizationProfile(req.params.prn)
        : await getPersonalizationProfile(req.params.prn);
      res.json({
        ok: true,
        personalizationVersion: PERSONALIZATION_VERSION,
        profile,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/adaptive/next-action/personalized", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      const roleId = req.query.roleId;
      if (!prn || !roleId) return res.status(400).json({ ok: false, error: "prn and roleId required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const result = await selectPersonalizedNextAction({
        prn,
        roleId,
        persist: String(req.query.persist || "1") !== "0",
        actor: (req.auth || req.user)?.sub || "system",
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/adaptive/next-action/personalized", requireAuth, async (req, res) => {
    try {
      const prn = req.body?.prn || (req.auth || req.user)?.sub;
      const roleId = req.body?.roleId;
      if (!prn || !roleId) return res.status(400).json({ ok: false, error: "prn and roleId required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const result = await selectPersonalizedNextAction({
        prn,
        roleId,
        persist: req.body?.persist !== false,
        actor: (req.auth || req.user)?.sub || "system",
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/adaptive/next-action", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      const roleId = req.query.roleId;
      if (!prn || !roleId) return res.status(400).json({ ok: false, error: "prn and roleId required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const result = await selectAdaptiveNextAction({
        prn,
        roleId,
        persist: String(req.query.persist || "1") !== "0",
        actor: (req.auth || req.user)?.sub || "system",
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/adaptive/next-action", requireAuth, async (req, res) => {
    try {
      const prn = req.body?.prn || (req.auth || req.user)?.sub;
      const roleId = req.body?.roleId;
      if (!prn || !roleId) return res.status(400).json({ ok: false, error: "prn and roleId required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const result = await selectAdaptiveNextAction({
        prn,
        roleId,
        persist: req.body?.persist !== false,
        actor: (req.auth || req.user)?.sub || "system",
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/adaptive/finalize-cycle", requireAuth, requireStaff, async (req, res) => {
    try {
      const { prn, roleId, decisionId, resultId } = req.body || {};
      if (!prn || !roleId || !decisionId || !resultId) {
        return res.status(400).json({ ok: false, error: "prn, roleId, decisionId, resultId required" });
      }
      const result = await finalizeAdaptiveCycle({
        prn,
        roleId,
        decisionId,
        resultId,
        actor: (req.auth || req.user)?.sub || "staff",
      });
      res.json(result);
    } catch (e) {
      const code = e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/adaptive/cycles", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      if (!prn) return res.status(400).json({ ok: false, error: "prn required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const cycles = await listAdaptiveCycles(prn);
      res.json({ ok: true, cycles });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/effectiveness", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      if (!prn) return res.status(400).json({ ok: false, error: "prn required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const data = await getEffectivenessHistory(prn, {
        interventionId: req.query.interventionId || null,
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/stagnation", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      if (!prn) return res.status(400).json({ ok: false, error: "prn required" });
      if (!canAccessPrn(req, prn)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const data = await detectStagnation(prn, {
        skillId: req.query.skillId || null,
        interventionId: req.query.interventionId || null,
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/effectiveness/evaluate/:resultId", requireAuth, requireStaff, async (req, res) => {
    try {
      const data = await evaluateInterventionResult(req.params.resultId);
      res.json({ ok: true, ...data });
    } catch (e) {
      const code = e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/next-action", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      const roleId = req.query.roleId;
      if (!prn || !roleId) {
        return res.status(400).json({ ok: false, error: "prn and roleId required" });
      }
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const persist = String(req.query.persist || "1") !== "0";
      const result = await selectNextAction({
        prn,
        roleId,
        persist,
        actor: (req.auth || req.user)?.sub || "system",
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/next-action", requireAuth, async (req, res) => {
    try {
      const prn = req.body?.prn || (req.auth || req.user)?.sub;
      const roleId = req.body?.roleId;
      if (!prn || !roleId) {
        return res.status(400).json({ ok: false, error: "prn and roleId required" });
      }
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const result = await selectNextAction({
        prn,
        roleId,
        persist: req.body?.persist !== false,
        actor: (req.auth || req.user)?.sub || "system",
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/decisions/:id", requireAuth, async (req, res) => {
    try {
      const doc = await getDecision(req.params.id);
      if (!doc) return res.status(404).json({ ok: false, error: "Not found" });
      if (!canAccessPrn(req, doc.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      res.json({ ok: true, decision: doc });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/decisions", requireAuth, async (req, res) => {
    try {
      const prn = req.query.prn || (req.auth || req.user)?.sub;
      if (!prn) return res.status(400).json({ ok: false, error: "prn required" });
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const rows = await listDecisionsForPrn(prn);
      res.json({ ok: true, decisions: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/decisions/:id/hitl", requireAuth, requireStaff, async (req, res) => {
    try {
      const action = req.body?.action;
      const updated = await hitlUpdateDecision(req.params.id, {
        action,
        actor: (req.auth || req.user)?.sub || (req.auth || req.user)?.name || "staff",
      });
      res.json({
        ok: true,
        decision: updated,
        message: "HITL updated. completed status is not set in S4 (requires S5 assessment).",
      });
    } catch (e) {
      const code = e.code === 404 ? 404 : e.code === 400 ? 400 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/readiness/:prn", requireAuth, async (req, res) => {
    try {
      const prn = req.params.prn;
      const roleId = req.query.roleId;
      if (!roleId) {
        return res.status(400).json({ ok: false, error: "roleId query parameter required" });
      }
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const persist = String(req.query.persist || "1") !== "0";
      const result = await computeReadiness({ prn, roleId, persist });
      res.json({ ok: true, ...result });
    } catch (e) {
      const code = e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/readiness", requireAuth, async (req, res) => {
    try {
      const prn = req.body?.prn || (req.auth || req.user)?.sub;
      const roleId = req.body?.roleId;
      if (!prn || !roleId) {
        return res.status(400).json({ ok: false, error: "prn and roleId required" });
      }
      if (!canAccessPrn(req, prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const persist = req.body?.persist !== false;
      const result = await computeReadiness({ prn, roleId, persist });
      res.json({ ok: true, ...result });
    } catch (e) {
      const code = e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });
  
  app.get("/api/employability/ml/data-status", requireAuth, requireStaff, async (_req, res) => {
    try {
      const data = await inspectEmployabilityMlData();
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/ml/registry", requireAuth, requireStaff, async (_req, res) => {
    try {
      const data = await getRegistryStatus();
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/ml/features/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const f = await buildEmployabilityFeatures(req.params.prn);
      res.json({ ok: true, ...f });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/ml/train", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await runEmployabilityTraining({ actor: (req.auth || req.user)?.sub || "admin" });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/employability/ml/activate", requireAuth, requireAdmin, async (req, res) => {
    try {
      const modelId = req.body?.modelId;
      if (!modelId) return res.status(400).json({ ok: false, error: "modelId required" });
      const result = await tryActivateModel(modelId, { actor: (req.auth || req.user)?.sub || "admin" });
      res.json(result);
    } catch (e) {
      const code = e.code === 404 ? 404 : 500;
      res.status(code).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/employability/predict/:prn/explain", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const result = await explainEmployabilityPrediction(req.params.prn);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

app.get("/api/employability/predict/:prn", requireAuth, async (req, res) => {
    try {
      if (!canAccessPrn(req, req.params.prn)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const result = await predictEmployability(req.params.prn, {
        roleId: req.query.roleId || null,
      });
      const code = result.productionProbability ? 200 : 200;
      res.status(code).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
