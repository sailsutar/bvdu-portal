/**
 * S0 — Employability Intelligence foundation schemas (additive only).
 * No readiness formulas, skill-gap ranking, intervention selection, or ML inference.
 * ML registry defaults to status = unavailable.
 */
import mongoose from "mongoose";

const EVIDENCE_SOURCE_TYPES = [
  "verified_assessment",
  "project_evaluation",
  "coding_test",
  "teacher_evaluation",
  "verified_certificate",
  "verified_github",
  "self_report",
];

const SKILL_STATUS = ["verified", "partial", "insufficient_evidence", "unknown"];
const READINESS_BANDS = ["READY", "NEAR_READY", "NOT_READY", "INSUFFICIENT_EVIDENCE", "UNKNOWN"];

/** Evidence event attached to a skill or assessment */
const evidenceItemSchema = new mongoose.Schema(
  {
    sourceType: { type: String, enum: EVIDENCE_SOURCE_TYPES, required: true },
    sourceId: { type: String, default: null },
    scoreOrResult: { type: mongoose.Schema.Types.Mixed, default: null },
    assessor: { type: String, default: null },
    verificationStatus: {
      type: String,
      enum: ["verified", "unverified", "rejected", "pending"],
      default: "pending",
    },
    timestamp: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const skillEntrySchema = new mongoose.Schema(
  {
    skillId: { type: String, required: true },
    skillScore: { type: Number, default: null }, // null until evidence-based computation (later stages)
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    evidenceCount: { type: Number, default: 0 },
    evidenceSources: { type: [evidenceItemSchema], default: [] },
    lastAssessed: { type: Date, default: null },
    trend: { type: String, enum: ["up", "down", "flat", "unknown"], default: "unknown" },
    targetScore: { type: Number, default: null },
    status: { type: String, enum: SKILL_STATUS, default: "unknown" },
  },
  { _id: false }
);

/** Per-PRN skill profile (may exist without a full employability state) */
const studentSkillProfileSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, unique: true, index: true },
    skills: { type: [skillEntrySchema], default: [] },
    source: { type: String, default: "manual" }, // manual | bootstrap | import | system
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

/** Raw assessment / evidence events */
const skillAssessmentSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    skillId: { type: String, required: true, index: true },
    sourceType: { type: String, enum: EVIDENCE_SOURCE_TYPES, required: true },
    sourceId: { type: String, default: null },
    scoreOrResult: { type: mongoose.Schema.Types.Mixed, default: null },
    assessor: { type: String, default: null },
    verificationStatus: {
      type: String,
      enum: ["verified", "unverified", "rejected", "pending"],
      default: "pending",
    },
    beforeScore: { type: Number, default: null },
    afterScore: { type: Number, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
skillAssessmentSchema.index({ prn: 1, skillId: 1, createdAt: -1 });

const jobRoleSchema = new mongoose.Schema(
  {
    roleId: { type: String, required: true, unique: true, index: true },
    roleName: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["active", "draft", "retired"], default: "draft", index: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const roleSkillRequirementSchema = new mongoose.Schema(
  {
    roleId: { type: String, required: true, index: true },
    version: { type: Number, default: 1, index: true },
    skillId: { type: String, required: true },
    category: { type: String, enum: ["required", "preferred"], default: "required" },
    skillWeight: { type: Number, default: 1 },
    minimumThreshold: { type: Number, default: null },
    prerequisites: { type: [String], default: [] },
    evidenceRequirements: { type: [String], default: [] },
    status: { type: String, enum: ["active", "draft", "retired"], default: "draft" },
  },
  { timestamps: true }
);
roleSkillRequirementSchema.index({ roleId: 1, version: 1, skillId: 1 }, { unique: true });

const skillDependencySchema = new mongoose.Schema(
  {
    prerequisiteSkill: { type: String, required: true, index: true },
    dependentSkill: { type: String, required: true, index: true },
    minimumThreshold: { type: Number, default: null },
    version: { type: Number, default: 1 },
    status: { type: String, enum: ["active", "draft", "retired"], default: "active" },
  },
  { timestamps: true }
);
skillDependencySchema.index(
  { prerequisiteSkill: 1, dependentSkill: 1, version: 1 },
  { unique: true }
);

/** Canonical versioned employability state */
const employabilityStateSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    stateVersion: { type: Number, required: true, default: 1 },
    skills: { type: [skillEntrySchema], default: [] },
    // Placeholders only — not computed in S0
    readinessScore: { type: Number, default: null },
    readinessBand: { type: String, enum: READINESS_BANDS, default: "UNKNOWN" },
    insufficientEvidenceSkills: { type: [String], default: [] },
    targetRoleId: { type: String, default: null, index: true },
    targetRoleVersion: { type: Number, default: null },
    lastDecisionId: { type: String, default: null },
    lastInterventionId: { type: String, default: null },
    lastStagnationStatus: {
      type: String,
      enum: ["none", "stagnating", "recovering", "unknown"],
      default: "unknown",
    },
    // Version stamps (foundation only)
    roleRequirementVersion: { type: Number, default: null },
    skillGraphVersion: { type: Number, default: null },
    priorityFormulaVersion: { type: String, default: null },
    catalogVersion: { type: String, default: null },
    modelVersion: { type: String, default: null },
    featureVersion: { type: String, default: null },
    datasetVersion: { type: String, default: null },
    source: { type: String, default: "system" }, // system | bootstrap | import
    isCurrent: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);
employabilityStateSchema.index({ prn: 1, stateVersion: 1 }, { unique: true });
employabilityStateSchema.index({ prn: 1, isCurrent: 1 });

/** Immutable history snapshots (copy of state at a point) */
const studentStateHistorySchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    stateVersion: { type: Number, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: { type: String, default: "state_change" },
  },
  { timestamps: true }
);
studentStateHistorySchema.index({ prn: 1, createdAt: -1 });
studentStateHistorySchema.index({ prn: 1, stateVersion: 1 });

/** Readiness computation records — empty until S3 */
const readinessComputationSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    stateVersion: { type: Number, default: null },
    readinessScore: { type: Number, default: null },
    readinessBand: { type: String, enum: READINESS_BANDS, default: "UNKNOWN" },
    formulaVersion: { type: String, default: null },
    components: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["placeholder", "computed", "invalid"], default: "placeholder" },
  },
  { timestamps: true }
);
readinessComputationSchema.index({ prn: 1, createdAt: -1 });

const interventionCatalogSchema = new mongoose.Schema(
  {
    interventionId: { type: String, required: true, unique: true, index: true },
    skillTarget: { type: String, default: null, index: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    difficulty: { type: String, enum: ["low", "medium", "high", "unknown"], default: "unknown" },
    estimatedDurationHours: { type: Number, default: null },
    expectedSkillGain: { type: Number, default: null },
    evidenceRequired: { type: [String], default: [] },
    assessmentMethod: { type: String, default: null },
    prerequisites: { type: [String], default: [] },
    catalogVersion: { type: String, default: "v0" },
    status: { type: String, enum: ["active", "draft", "retired"], default: "draft" },
  },
  { timestamps: true }
);

const interventionDecisionSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    interventionId: { type: String, default: null },
    skillId: { type: String, default: null },
    decisionTrace: { type: mongoose.Schema.Types.Mixed, default: {} },
    priorityFormulaVersion: { type: String, default: null },
    catalogVersion: { type: String, default: null },
    roleRequirementVersion: { type: Number, default: null },
    skillGraphVersion: { type: Number, default: null },
    stateVersion: { type: Number, default: null },
    status: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected", "executed", "cancelled"],
      default: "draft",
      index: true,
    },
    generatedBy: { type: String, default: "system" },
    approvedBy: { type: String, default: null },
  },
  { timestamps: true }
);
interventionDecisionSchema.index({ prn: 1, createdAt: -1 });
interventionDecisionSchema.index({ prn: 1, status: 1 });

const interventionResultSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    interventionId: { type: String, default: null, index: true },
    decisionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    expectedImprovement: { type: Number, default: null },
    actualImprovement: { type: Number, default: null },
    beforeScore: { type: Number, default: null },
    afterScore: { type: Number, default: null },
    timeSpentHours: { type: Number, default: null },
    readinessDelta: { type: Number, default: null },
    stagnating: { type: Boolean, default: false },
    evidence: { type: [evidenceItemSchema], default: [] },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
interventionResultSchema.index({ prn: 1, createdAt: -1 });
interventionResultSchema.index({ prn: 1, interventionId: 1, createdAt: -1 });

const effectivenessStatsSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ["global", "student", "role", "skill"],
      required: true,
      index: true,
    },
    scopeKey: { type: String, required: true, index: true }, // e.g. prn, roleId, skillId, or "global"
    interventionId: { type: String, default: null, index: true },
    sampleSize: { type: Number, default: 0 },
    meanActualImprovement: { type: Number, default: null },
    meanExpectedImprovement: { type: Number, default: null },
    successRate: { type: Number, default: null },
    stagnationRate: { type: Number, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
effectivenessStatsSchema.index({ scope: 1, scopeKey: 1, interventionId: 1 }, { unique: true });

const auditEmployabilityCycleSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    cycleId: { type: String, required: true },
    stateVersionBefore: { type: Number, default: null },
    stateVersionAfter: { type: Number, default: null },
    predictionId: { type: String, default: null },
    decisionId: { type: String, default: null },
    assessmentIds: { type: [String], default: [] },
    resultId: { type: String, default: null },
    versions: {
      roleRequirementVersion: { type: Number, default: null },
      skillGraphVersion: { type: Number, default: null },
      priorityFormulaVersion: { type: String, default: null },
      catalogVersion: { type: String, default: null },
      modelVersion: { type: String, default: null },
      featureVersion: { type: String, default: null },
      datasetVersion: { type: String, default: null },
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
auditEmployabilityCycleSchema.index({ prn: 1, createdAt: -1 });
auditEmployabilityCycleSchema.index({ cycleId: 1 }, { unique: true });

/** Employability ML registry — production probability never generated in S0 */
const modelRegistryEmployabilitySchema = new mongoose.Schema(
  {
    modelId: { type: String, required: true, unique: true, index: true },
    modelVersion: { type: String, required: true },
    datasetVersion: { type: String, default: null },
    featureVersion: { type: String, default: null },
    trainingDate: { type: Date, default: null },
    trainingCohort: { type: String, default: null },
    targetDefinition: { type: String, default: null },
    predictionPoint: { type: String, default: null },
    algorithm: { type: String, default: null },
    hyperparameters: { type: mongoose.Schema.Types.Mixed, default: {} },
    calibrationMethod: { type: String, default: null },
    evaluationMetrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    featureList: { type: [String], default: [] },
    classDistribution: { type: mongoose.Schema.Types.Mixed, default: {} },
    validationStrategy: { type: String, default: null },
    status: {
      type: String,
      enum: ["unavailable", "training", "validation", "active", "retired", "rejected"],
      default: "unavailable",
      index: true,
    },
  },
  { timestamps: true }
);
modelRegistryEmployabilitySchema.index({ status: 1, modelVersion: 1 });

export const EVIDENCE_SOURCE_TYPES_LIST = EVIDENCE_SOURCE_TYPES;
export const SKILL_STATUS_LIST = SKILL_STATUS;
export const READINESS_BANDS_LIST = READINESS_BANDS;

export const StudentSkillProfile =
  mongoose.models.StudentSkillProfile ||
  mongoose.model("StudentSkillProfile", studentSkillProfileSchema);
export const SkillAssessment =
  mongoose.models.SkillAssessment || mongoose.model("SkillAssessment", skillAssessmentSchema);
export const JobRole = mongoose.models.JobRole || mongoose.model("JobRole", jobRoleSchema);
export const RoleSkillRequirement =
  mongoose.models.RoleSkillRequirement ||
  mongoose.model("RoleSkillRequirement", roleSkillRequirementSchema);
export const SkillDependency =
  mongoose.models.SkillDependency || mongoose.model("SkillDependency", skillDependencySchema);
export const EmployabilityState =
  mongoose.models.EmployabilityState ||
  mongoose.model("EmployabilityState", employabilityStateSchema);
export const StudentStateHistory =
  mongoose.models.StudentStateHistory ||
  mongoose.model("StudentStateHistory", studentStateHistorySchema);
export const ReadinessComputation =
  mongoose.models.ReadinessComputation ||
  mongoose.model("ReadinessComputation", readinessComputationSchema);
export const InterventionCatalog =
  mongoose.models.InterventionCatalog ||
  mongoose.model("InterventionCatalog", interventionCatalogSchema);
export const InterventionDecision =
  mongoose.models.InterventionDecision ||
  mongoose.model("InterventionDecision", interventionDecisionSchema);
export const InterventionResult =
  mongoose.models.InterventionResult ||
  mongoose.model("InterventionResult", interventionResultSchema);
export const EffectivenessStats =
  mongoose.models.EffectivenessStats ||
  mongoose.model("EffectivenessStats", effectivenessStatsSchema);
export const AuditEmployabilityCycle =
  mongoose.models.AuditEmployabilityCycle ||
  mongoose.model("AuditEmployabilityCycle", auditEmployabilityCycleSchema);
export const ModelRegistryEmployability =
  mongoose.models.ModelRegistryEmployability ||
  mongoose.model("ModelRegistryEmployability", modelRegistryEmployabilitySchema);

const studentInterventionPreferenceSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, index: true },
    personalizationVersion: { type: String, default: "s8-v1" },
    evidenceLevel: {
      type: String,
      enum: ["NONE", "LOW", "MEDIUM", "HIGH"],
      default: "NONE",
    },
    evidenceCount: { type: Number, default: 0 },
    validEvidenceCount: { type: Number, default: 0 },
    interventionPreferences: { type: [mongoose.Schema.Types.Mixed], default: [] },
    modalityPreferences: { type: [mongoose.Schema.Types.Mixed], default: [] },
    kindPreferences: { type: [mongoose.Schema.Types.Mixed], default: [] },
    skillPreferences: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sourceVersions: { type: mongoose.Schema.Types.Mixed, default: {} },
    isCurrent: { type: Boolean, default: true, index: true },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
studentInterventionPreferenceSchema.index({ prn: 1, isCurrent: 1 });

export const StudentInterventionPreference =
  mongoose.models.StudentInterventionPreference ||
  mongoose.model("StudentInterventionPreference", studentInterventionPreferenceSchema);

const employabilityEvaluationRunSchema = new mongoose.Schema(
  {
    evaluationId: { type: String, required: true, unique: true, index: true },
    evaluationVersion: { type: String, default: "s10-v1" },
    status: {
      type: String,
      enum: ["completed", "failed", "insufficient_data", "leakage_detected"],
      default: "completed",
    },
    cohort: { type: mongoose.Schema.Types.Mixed, default: {} },
    dataQuality: { type: mongoose.Schema.Types.Mixed, default: {} },
    systemVersions: { type: mongoose.Schema.Types.Mixed, default: {} },
    arms: { type: [String], default: [] },
    limitations: { type: [String], default: [] },
    leakageCheck: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);

const employabilityEvaluationResultSchema = new mongoose.Schema(
  {
    evaluationId: { type: String, required: true, index: true },
    arm: { type: String, required: true, index: true },
    metric: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    sampleSize: { type: Number, default: 0 },
    validCount: { type: Number, default: 0 },
    missingCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["VALID", "INSUFFICIENT_DATA", "NOT_APPLICABLE", "UNAVAILABLE"],
      default: "INSUFFICIENT_DATA",
    },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    methodologyVersion: { type: String, default: "s10-v1" },
  },
  { timestamps: true }
);
employabilityEvaluationResultSchema.index({ evaluationId: 1, arm: 1, metric: 1 });

export const EmployabilityEvaluationRun =
  mongoose.models.EmployabilityEvaluationRun ||
  mongoose.model("EmployabilityEvaluationRun", employabilityEvaluationRunSchema);
export const EmployabilityEvaluationResult =
  mongoose.models.EmployabilityEvaluationResult ||
  mongoose.model("EmployabilityEvaluationResult", employabilityEvaluationResultSchema);



