/**
 * S0 bootstrap: feature flag, ensure indexes, seed ML registry as unavailable.
 * Does not create fake skills, readiness, or probabilities.
 */
import {
  ModelRegistryEmployability,
  StudentSkillProfile,
  SkillAssessment,
  JobRole,
  RoleSkillRequirement,
  SkillDependency,
  EmployabilityState,
  StudentStateHistory,
  ReadinessComputation,
  InterventionCatalog,
  InterventionDecision,
  InterventionResult,
  EffectivenessStats,
  AuditEmployabilityCycle,
} from "./employability-models.js";
import { seedEmployabilityS1Catalog } from "./employability-s1-seed.js";
import { seedInterventionCatalog } from "./employability-s4-seed.js";

export function isEmployabilitySystemEnabled() {
  // Default ON so readiness/gaps work without extra .env; set EMPLOYABILITY_SYSTEM_ENABLED=0 to disable.
  const raw = process.env.EMPLOYABILITY_SYSTEM_ENABLED;
  if (raw == null || String(raw).trim() === "") return true;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getEmployabilityS0Status() {
  return {
    stage: "S0",
    featureFlag: "EMPLOYABILITY_SYSTEM_ENABLED",
    enabled: isEmployabilitySystemEnabled(),
    readinessEngine: "not_implemented",
    adaptiveLoop: "not_implemented",
    interventionEngine: "not_implemented",
    skillGapEngine: "not_implemented",
    s1: {
      roles: "seeded_on_bootstrap",
      skillGraph: "seeded_on_bootstrap",
      evidenceProfiles: "api_enabled",
    },
    ml: {
      status: "unavailable",
      productionProbability: false,
      note: "Registry exists; no model trained; no probability generated in S0",
    },
  };
}

/** Ensure indexes for all S0 models (idempotent). */
export async function ensureEmployabilityIndexes() {
  const models = [
    StudentSkillProfile,
    SkillAssessment,
    JobRole,
    RoleSkillRequirement,
    SkillDependency,
    EmployabilityState,
    StudentStateHistory,
    ReadinessComputation,
    InterventionCatalog,
    InterventionDecision,
    InterventionResult,
    EffectivenessStats,
    AuditEmployabilityCycle,
    ModelRegistryEmployability,
  ];
  for (const m of models) {
    await m.syncIndexes();
  }
}

/**
 * Bootstrap: single registry row with status unavailable.
 * Does not invent placement probabilities or student skills.
 */
export async function bootstrapEmployabilityS0() {
  const existing = await ModelRegistryEmployability.findOne({ modelId: "employability_placeholder" }).lean();
  if (!existing) {
    await ModelRegistryEmployability.create({
      modelId: "employability_placeholder",
      modelVersion: "none",
      status: "unavailable",
      targetDefinition: null,
      algorithm: null,
      evaluationMetrics: {},
      featureList: [],
    });
  } else if (existing.status !== "unavailable" && existing.modelVersion === "none") {
    await ModelRegistryEmployability.updateOne(
      { modelId: "employability_placeholder" },
      { $set: { status: "unavailable" } }
    );
  }

  let s1 = null;
  try {
    s1 = await seedEmployabilityS1Catalog();
  } catch (e) {
    s1 = { ok: false, error: String(e.message || e) };
  }
  let s4 = null;
  try {
    s4 = await seedInterventionCatalog();
  } catch (e) {
    s4 = { ok: false, error: String(e.message || e) };
  }

  return {
    ok: true,
    mlStatus: "unavailable",
    featureEnabled: isEmployabilitySystemEnabled(),
    s1,
    s4,
  };
}

export async function getEmployabilityMlRegistryStatus() {
  const active = await ModelRegistryEmployability.findOne({ status: "active" }).lean();
  const placeholder = await ModelRegistryEmployability.findOne({ modelId: "employability_placeholder" }).lean();
  return {
    productionActive: Boolean(active),
    status: active ? "active" : "unavailable",
    activeModel: active
      ? {
          modelId: active.modelId,
          modelVersion: active.modelVersion,
          algorithm: active.algorithm,
        }
      : null,
    placeholder: placeholder
      ? { modelId: placeholder.modelId, status: placeholder.status }
      : null,
  };
}
