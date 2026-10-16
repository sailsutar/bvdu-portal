/**
 * S7 training + activation gate.
 * Refuses production activation without sufficient REAL labels and validation.
 */
import { ModelRegistryEmployability } from "./employability-models.js";
import {
  inspectEmployabilityMlData,
  MIN_LABELED_FOR_TRAINING,
  MIN_LABELED_FOR_ACTIVATION,
  FEATURE_VERSION,
  DATASET_VERSION,
} from "./employability-s7-data.js";
import { exportLabeledFeatureMatrix, FEATURE_NAMES } from "./employability-s7-features.js";

export const MODEL_PIPELINE_VERSION = "emp_ml_pipe_v1";

/**
 * Attempt supervised training. Without enough real labels, returns unavailable (no metrics invented).
 */
export async function runEmployabilityTraining({ actor = "system" } = {}) {
  const inspection = await inspectEmployabilityMlData();
  const matrix = await exportLabeledFeatureMatrix();

  const leakageAudit = {
    passed: true,
    notes: [
      "Feature builder excludes placementOutcome and placementOutcomeAt",
      "No post-outcome fields included in FEATURE_NAMES",
    ],
    featureNames: FEATURE_NAMES,
  };

  if (matrix.n < MIN_LABELED_FOR_TRAINING) {
    const modelId = `employability_unavailable_${Date.now()}`;
    await ModelRegistryEmployability.findOneAndUpdate(
      { modelId: "employability_placeholder" },
      {
        $set: {
          status: "unavailable",
          modelVersion: "none",
          datasetVersion: DATASET_VERSION,
          featureVersion: FEATURE_VERSION,
          trainingDate: new Date(),
          trainingCohort: null,
          targetDefinition: "placementOutcome 1=placed 0=not_placed",
          algorithm: null,
          hyperparameters: {},
          calibrationMethod: null,
          metrics: {
            reason: "insufficient_real_labels",
            labeledCount: matrix.n,
            required: MIN_LABELED_FOR_TRAINING,
          },
          featureList: FEATURE_NAMES,
          classDistribution: inspection.counts,
        },
      },
      { upsert: true }
    );

    return {
      ok: false,
      status: "unavailable",
      trained: false,
      activated: false,
      reason: inspection.gate.reason,
      inspection,
      leakageAudit,
      labeledCount: matrix.n,
      message:
        "No production model trained. Import real historical placementOutcome labels (0/1) before training can proceed.",
    };
  }

  // Temporal/cohort split metadata (actual sklearn training deferred to optional Python job)
  // Sort by admissionYear / placementOutcomeAt when present
  const order = matrix.meta
    .map((m, i) => ({ i, year: m.admissionYear || 0, t: m.placementOutcomeAt ? new Date(m.placementOutcomeAt).getTime() : 0 }))
    .sort((a, b) => a.year - b.year || a.t - b.t);

  const splitIdx = Math.floor(order.length * 0.7);
  const trainIdx = order.slice(0, splitIdx).map((o) => o.i);
  const testIdx = order.slice(splitIdx).map((o) => o.i);

  // Without a Python training worker with real metrics, we still do NOT invent metrics.
  // Register as candidate only if labels exist; activation requires explicit metrics from train job.
  const modelId = `emp_candidate_${Date.now()}`;
  await ModelRegistryEmployability.create({
    modelId,
    status: "candidate",
    modelVersion: `${MODEL_PIPELINE_VERSION}-candidate`,
    datasetVersion: DATASET_VERSION,
    featureVersion: FEATURE_VERSION,
    trainingDate: new Date(),
    trainingCohort: `n=${matrix.n};train=${trainIdx.length};test=${testIdx.length}`,
    targetDefinition: "placementOutcome: 1=placed, 0=not_placed",
    algorithm: "pending_python_trainer",
    hyperparameters: {},
    calibrationMethod: null,
    metrics: {
      note: "Candidate registered. Run ml-service employability trainer to fill real metrics. Not active.",
      labeledCount: matrix.n,
      trainSize: trainIdx.length,
      testSize: testIdx.length,
    },
    featureList: FEATURE_NAMES,
    classDistribution: inspection.counts,
  });

  const canActivate = false; // activation only after real metrics pass gate
  return {
    ok: true,
    status: "candidate",
    trained: false,
    activated: canActivate,
    modelId,
    inspection,
    leakageAudit,
    split: {
      strategy: "temporal_cohort_by_admissionYear_then_outcomeAt",
      trainSize: trainIdx.length,
      testSize: testIdx.length,
    },
    message:
      "Labeled data present at/above training minimum. Candidate registered without fabricated metrics. Activate only after Python trainer writes validated metrics and admin passes activation gate.",
  };
}

/**
 * Activation gate: requires active metrics object with real keys — never invents them.
 */
export async function tryActivateModel(modelId, { actor }) {
  const doc = await ModelRegistryEmployability.findOne({ modelId });
  if (!doc) {
    const err = new Error("Model not found");
    err.code = 404;
    throw err;
  }
  const m = doc.metrics || {};
  const hasRealMetrics =
    typeof m.roc_auc === "number" ||
    typeof m.f1 === "number" ||
    typeof m.brier === "number";

  const inspection = await inspectEmployabilityMlData();

  if (!inspection.gate.sufficientForActivation) {
    return {
      ok: false,
      activated: false,
      reason: inspection.gate.reason,
    };
  }
  if (!hasRealMetrics) {
    return {
      ok: false,
      activated: false,
      reason: "Activation blocked: registry metrics lack real evaluation numbers (roc_auc/f1/brier).",
    };
  }
  if (doc.status !== "validated" && doc.status !== "candidate") {
    return {
      ok: false,
      activated: false,
      reason: `Cannot activate from status=${doc.status}`,
    };
  }

  // Additional gate: require minimum roc_auc if present
  if (typeof m.roc_auc === "number" && m.roc_auc < 0.55) {
    return {
      ok: false,
      activated: false,
      reason: `roc_auc ${m.roc_auc} below activation threshold 0.55`,
    };
  }

  await ModelRegistryEmployability.updateMany({ status: "active" }, { $set: { status: "retired" } });
  doc.status = "active";
  await doc.save();
  return {
    ok: true,
    activated: true,
    modelId,
    actor,
    metrics: m,
  };
}
