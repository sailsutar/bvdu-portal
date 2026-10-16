/**
 * S7 prediction — only if an active validated model exists.
 * Never returns a fabricated probability.
 */
import { ModelRegistryEmployability } from "./employability-models.js";
import { buildEmployabilityFeatures } from "./employability-s7-features.js";
import { computeReadiness } from "./employability-s3-readiness.js";
import { inspectEmployabilityMlData } from "./employability-s7-data.js";

/**
 * Predict placement probability for PRN.
 * If no active model → clear unavailable payload (HTTP layer may use 503/200 with ok:false).
 */
export async function predictEmployability(prn, { roleId = null } = {}) {
  const active = await ModelRegistryEmployability.findOne({ status: "active" }).lean();
  const inspection = await inspectEmployabilityMlData();

  let readiness = null;
  if (roleId) {
    try {
      readiness = await computeReadiness({ prn, roleId, persist: false });
    } catch {
      readiness = null;
    }
  }

  if (!active) {
    return {
      ok: false,
      mlStatus: "unavailable",
      productionProbability: false,
      probability: null,
      reason:
        inspection.counts.labeled < 100
          ? "No active employability model. Insufficient real placementOutcome labels for production ML."
          : "No active employability model in registry. Train, validate, and activate before probabilities are served.",
      model: null,
      readiness: readiness
        ? {
            readinessScore: readiness.readinessScore,
            readinessBand: readiness.readinessBand,
            formulaVersion: readiness.formulaVersion,
            note: "S3 readiness is independent of ML probability",
          }
        : null,
      inspectionSummary: {
        labeled: inspection.counts.labeled,
        placed: inspection.counts.placed,
        notPlaced: inspection.counts.notPlaced,
      },
    };
  }

  // Active model path: without a loaded artifact in this Node process, still refuse to invent probability
  const features = await buildEmployabilityFeatures(prn);
  return {
    ok: false,
    mlStatus: "unavailable",
    productionProbability: false,
    probability: null,
    reason:
      "Active registry entry exists but model artifact inference is not loaded in-process. Wire ml-service employability scorer before serving probabilities. Refusing to fabricate a probability.",
    model: {
      modelId: active.modelId,
      modelVersion: active.modelVersion,
      featureVersion: active.featureVersion,
      calibrationMethod: active.calibrationMethod,
      status: active.status,
    },
    features: {
      featureVersion: features.featureVersion,
      names: features.featureNames,
      // values available for external scorer
      vector: features.vector,
    },
    readiness: readiness
      ? {
          readinessScore: readiness.readinessScore,
          readinessBand: readiness.readinessBand,
          formulaVersion: readiness.formulaVersion,
          note: "S3 readiness is independent of ML probability",
        }
      : null,
  };
}

export async function explainEmployabilityPrediction(prn) {
  const pred = await predictEmployability(prn);
  if (!pred.productionProbability) {
    return {
      ok: false,
      mlStatus: pred.mlStatus,
      explanation: null,
      reason: pred.reason,
      note: "No local SHAP/feature attribution without an active loaded model artifact.",
    };
  }
  return pred;
}
