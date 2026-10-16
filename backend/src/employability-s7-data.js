/**
 * S7 — Inspect real placement labels and dataset readiness.
 * Does not invent outcomes.
 */
import { PlacementProfile } from "./db.js";
import { StudentSkillProfile, ModelRegistryEmployability } from "./employability-models.js";

export const FEATURE_VERSION = "emp_ml_feat_v1";
export const DATASET_VERSION = "emp_ml_data_v1";
export const MIN_LABELED_FOR_TRAINING = 80;
export const MIN_LABELED_FOR_ACTIVATION = 100;

/**
 * Count real historical placement outcomes only.
 * Labels accepted: placementOutcome === 0 | 1
 */
export async function inspectEmployabilityMlData() {
  const totalProfiles = await PlacementProfile.countDocuments({});
  const labeled = await PlacementProfile.countDocuments({
    placementOutcome: { $in: [0, 1] },
  });
  const placed = await PlacementProfile.countDocuments({ placementOutcome: 1 });
  const notPlaced = await PlacementProfile.countDocuments({ placementOutcome: 0 });

  const sampleLabeled = await PlacementProfile.find({ placementOutcome: { $in: [0, 1] } })
    .select("prn placementOutcome placementOutcomeAt placementOutcomeCohort admissionYear yearLevel cohortId")
    .limit(5)
    .lean();

  const skillProfiles = await StudentSkillProfile.countDocuments({});

  const availableFeaturesAtPredictionPoint = [
    { name: "cgpa", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "degreePercent", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "activeKtCount", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "tenthPercent", source: "PlacementProfile", timing: "admission_or_profile" },
    { name: "twelfthPercent", source: "PlacementProfile", timing: "admission_or_profile" },
    { name: "cetScore", source: "PlacementProfile", timing: "admission_or_profile" },
    { name: "jeeScore", source: "PlacementProfile", timing: "admission_or_profile" },
    { name: "internshipCount", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "skillDsa", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "skillC", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "skillCpp", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "skillDbms", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "skillAiml", source: "PlacementProfile", timing: "pre_placement_profile" },
    { name: "completenessScore", source: "PlacementProfile", timing: "pre_placement_profile" },
    {
      name: "verified_skill_* (from StudentSkillProfile, non-self evidence only)",
      source: "StudentSkillProfile",
      timing: "pre_prediction_evidence",
    },
  ];

  const excludedAsLeakage = [
    "placementOutcome",
    "placementOutcomeAt",
    "any field written after offer/placement",
    "future skill assessments after prediction point",
    "post-placement interventions",
  ];

  const sufficientForTraining = labeled >= MIN_LABELED_FOR_TRAINING;
  const sufficientForActivation = labeled >= MIN_LABELED_FOR_ACTIVATION && placed > 0 && notPlaced > 0;

  return {
    ok: true,
    collections: {
      placementProfiles: "PlacementProfile",
      skillProfiles: "StudentSkillProfile",
      modelRegistry: "ModelRegistryEmployability",
    },
    targetField: "placementOutcome",
    targetDefinition: {
      placed: 1,
      not_placed: 0,
      null: "unknown / not labeled — excluded from supervised training",
    },
    counts: {
      totalProfiles,
      labeled,
      placed,
      notPlaced,
      unlabeled: totalProfiles - labeled,
      skillProfiles,
    },
    classDistribution:
      labeled > 0
        ? {
            placedRate: Math.round((placed / labeled) * 1000) / 1000,
            notPlacedRate: Math.round((notPlaced / labeled) * 1000) / 1000,
          }
        : null,
    sampleLabeledRecords: sampleLabeled,
    predictionPoint:
      "Features available on the student placement profile and verified skill evidence before outcome is recorded. Outcome itself is never a feature.",
    featureCutoff: "All features must exist prior to placementOutcomeAt when that timestamp is present.",
    availableFeaturesAtPredictionPoint,
    excludedAsLeakage,
    missingDataNotes: [
      "Most deployments have placementOutcome=null for all rows until institution imports historical outcomes.",
      "Profile status draft/submitted/verified is a workflow state, NOT a placement outcome label.",
    ],
    thresholds: {
      MIN_LABELED_FOR_TRAINING,
      MIN_LABELED_FOR_ACTIVATION,
    },
    gate: {
      sufficientForTraining,
      sufficientForActivation,
      productionMlAllowed: false, // flipped only by activation after successful train+validate
      reason: !sufficientForActivation
        ? `Insufficient real placement labels (labeled=${labeled}, need ≥${MIN_LABELED_FOR_ACTIVATION} with both classes). Production ML remains unavailable.`
        : "Labeled volume meets minimum; still requires leakage audit, temporal split, metrics, and explicit activation.",
    },
    featureVersion: FEATURE_VERSION,
    datasetVersion: DATASET_VERSION,
  };
}

export async function getRegistryStatus() {
  const rows = await ModelRegistryEmployability.find({}).sort({ createdAt: -1 }).lean();
  const active = rows.find((r) => r.status === "active");
  return {
    models: rows,
    activeModel: active || null,
    productionActive: Boolean(active),
    status: active ? "active" : rows.length ? rows[0].status : "unavailable",
  };
}
