/**
 * S10 — Research / evaluation harness.
 * Observational metrics from real InterventionResult / assessments only.
 * Never fabricates outcomes or presents synthetic data as research findings.
 */

import {
  InterventionResult,
  InterventionDecision,
  SkillAssessment,
  ReadinessComputation,
  EmployabilityEvaluationRun,
  EmployabilityEvaluationResult,
  ModelRegistryEmployability,
} from "./employability-models.js";
import { classifyEffectiveness } from "./employability-s6-adaptive.js";
import { getRegistryStatus } from "./employability-s7-data.js";
import { PRIORITY_FORMULA_VERSION } from "./employability-s2-priority.js";
import { READINESS_FORMULA_VERSION } from "./employability-s3-readiness.js";
import { INTERVENTION_CATALOG_VERSION } from "./employability-s4-catalog.js";
import { SELECTION_FORMULA_VERSION } from "./employability-s4-select.js";
import {
  EFFECTIVENESS_POLICY_VERSION,
  STAGNATION_POLICY_VERSION,
  ADAPTIVE_POLICY_VERSION,
} from "./employability-s6-adaptive.js";
import { PERSONALIZATION_VERSION } from "./employability-s8-personalize.js";

export const EVALUATION_VERSION = "s10-v1";
export const MIN_SAMPLES_FOR_VALID = 5;

function mean(arr) {
  if (!arr.length) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1000) / 1000;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 1000) / 1000;
}

function stddev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.round(Math.sqrt(v) * 1000) / 1000;
}

function metricResult({ metric, arm, values, missingCount = 0, extra = {} }) {
  const valid = values.filter((v) => v != null && !Number.isNaN(Number(v))).map(Number);
  const sampleSize = valid.length + missingCount;
  if (valid.length < MIN_SAMPLES_FOR_VALID) {
    return {
      arm,
      metric,
      value: null,
      sampleSize,
      validCount: valid.length,
      missingCount,
      status: valid.length === 0 ? "INSUFFICIENT_DATA" : "INSUFFICIENT_DATA",
      details: {
        reason: `Need ≥${MIN_SAMPLES_FOR_VALID} valid observations; found ${valid.length}`,
        mean: mean(valid),
        median: median(valid),
        ...extra,
      },
    };
  }
  return {
    arm,
    metric,
    value: {
      mean: mean(valid),
      median: median(valid),
      stddev: stddev(valid),
      n: valid.length,
    },
    sampleSize,
    validCount: valid.length,
    missingCount,
    status: "VALID",
    details: extra,
  };
}

/**
 * Leakage audit for evaluation dataset construction.
 * Fails if result timestamps systematically precede decision timestamps incorrectly,
 * or if we detect outcome fields mixed as pre-features (not applicable to result-only metrics).
 */
export function runLeakageCheck(pairs) {
  let violations = 0;
  const notes = [];
  for (const p of pairs) {
    if (p.decisionAt && p.resultAt) {
      const d = new Date(p.decisionAt).getTime();
      const r = new Date(p.resultAt).getTime();
      if (!Number.isNaN(d) && !Number.isNaN(r) && r < d - 60000) {
        violations += 1;
        notes.push(`result before decision: decision=${p.decisionId}`);
      }
    }
  }
  return {
    passed: violations === 0,
    violations,
    notes: notes.slice(0, 20),
    rule: "Intervention result timestamp must not precede decision timestamp (tolerance 60s)",
  };
}

/**
 * Classify intervention result arm from decision trace metadata.
 * Observational: we tag historical decisions by what engines left in decisionTrace.
 */
export function classifyArm(decision, result) {
  const trace = decision?.decisionTrace || {};
  if (trace.personalization?.applied || trace.adaptive === true && trace.personalization) {
    if (trace.personalization?.applied) return "C";
  }
  if (trace.personalization?.applied) return "C";
  if (trace.adaptive || decision?.generatedBy === "system" || result?.meta?.stage === "S5") {
    // Adaptive without explicit personalization → B
    if (trace.personalization?.applied) return "C";
    return "B";
  }
  // No adaptive / personalization markers → treat as static-like observational baseline
  return "A";
}

async function loadObservationPairs() {
  const results = await InterventionResult.find({}).sort({ createdAt: 1 }).lean();
  const pairs = [];
  for (const result of results) {
    let decision = null;
    if (result.decisionId) {
      decision = await InterventionDecision.findById(result.decisionId).lean();
    }
    const sourceType = result.evidence?.[0]?.sourceType || null;
    const meaningful =
      result.meta?.meaningfulEvidence !== false && sourceType !== "self_report";
    const gain =
      result.actualImprovement != null
        ? Number(result.actualImprovement)
        : result.beforeScore != null && result.afterScore != null
          ? Number(result.afterScore) - Number(result.beforeScore)
          : null;

    const eff =
      result.meta?.effectiveness ||
      classifyEffectiveness({
        expectedGain: result.expectedImprovement,
        observedGain: gain,
        meaningfulEvidence: meaningful,
        sourceType,
      });

    pairs.push({
      prn: result.prn,
      resultId: String(result._id),
      decisionId: result.decisionId ? String(result.decisionId) : null,
      interventionId: result.interventionId,
      decisionAt: decision?.createdAt || null,
      resultAt: result.createdAt || null,
      beforeScore: result.beforeScore,
      afterScore: result.afterScore,
      skillGain: meaningful ? gain : null,
      expectedGain: result.expectedImprovement,
      effectivenessStatus: eff.status,
      stagnating: Boolean(result.stagnating || result.meta?.effectiveness?.status === "ineffective"),
      arm: classifyArm(decision, result),
      measureFirst: Boolean(decision?.decisionTrace?.measure_first),
      personalized: Boolean(decision?.decisionTrace?.personalization?.applied),
      adaptive: Boolean(decision?.decisionTrace?.adaptive),
      sourceType,
      meaningful,
    });
  }
  return pairs;
}

function armMetrics(arm, pairs) {
  const subset = pairs.filter((p) => p.arm === arm);
  const gains = subset.map((p) => p.skillGain);
  const gainMetric = metricResult({
    metric: "skill_gain",
    arm,
    values: gains.filter((g) => g != null),
    missingCount: gains.filter((g) => g == null).length,
  });

  const effCounts = {
    effective: 0,
    partially_effective: 0,
    ineffective: 0,
    insufficient_evidence: 0,
    unknown: 0,
  };
  for (const p of subset) {
    const k = p.effectivenessStatus || "unknown";
    if (effCounts[k] != null) effCounts[k] += 1;
    else effCounts.unknown += 1;
  }
  const effValid = subset.filter((p) =>
    ["effective", "partially_effective", "ineffective"].includes(p.effectivenessStatus)
  ).length;
  const effectivenessMetric = {
    arm,
    metric: "effectiveness_distribution",
    value: effValid >= MIN_SAMPLES_FOR_VALID ? effCounts : null,
    sampleSize: subset.length,
    validCount: effValid,
    missingCount: subset.length - effValid,
    status: effValid >= MIN_SAMPLES_FOR_VALID ? "VALID" : "INSUFFICIENT_DATA",
    details: { counts: effCounts },
  };

  const stagN = subset.filter((p) => p.stagnating).length;
  const stagnationMetric = {
    arm,
    metric: "stagnation_rate",
    value:
      subset.length >= MIN_SAMPLES_FOR_VALID
        ? Math.round((stagN / subset.length) * 1000) / 1000
        : null,
    sampleSize: subset.length,
    validCount: subset.length,
    missingCount: 0,
    status: subset.length >= MIN_SAMPLES_FOR_VALID ? "VALID" : "INSUFFICIENT_DATA",
    details: { stagnatingCount: stagN },
  };

  const interventionCountMetric = {
    arm,
    metric: "intervention_count",
    value: subset.length,
    sampleSize: subset.length,
    validCount: subset.length,
    missingCount: 0,
    status: subset.length > 0 ? "VALID" : "INSUFFICIENT_DATA",
    details: { uniqueStudents: new Set(subset.map((p) => p.prn)).size },
  };

  // Repeated ineffective same intervention before alternate (simple observational)
  const byStudent = new Map();
  for (const p of subset) {
    if (!byStudent.has(p.prn)) byStudent.set(p.prn, []);
    byStudent.get(p.prn).push(p);
  }
  let repeatIneffective = 0;
  let sequences = 0;
  for (const list of byStudent.values()) {
    sequences += 1;
    for (let i = 1; i < list.length; i++) {
      if (
        list[i].interventionId === list[i - 1].interventionId &&
        list[i - 1].effectivenessStatus === "ineffective"
      ) {
        repeatIneffective += 1;
      }
    }
  }
  const repeatMetric = {
    arm,
    metric: "repeated_ineffective_rate",
    value:
      subset.length >= MIN_SAMPLES_FOR_VALID
        ? Math.round((repeatIneffective / Math.max(subset.length - 1, 1)) * 1000) / 1000
        : null,
    sampleSize: subset.length,
    validCount: subset.length,
    missingCount: 0,
    status: subset.length >= MIN_SAMPLES_FOR_VALID ? "VALID" : "INSUFFICIENT_DATA",
    details: { repeatedIneffectivePairs: repeatIneffective, studentSequences: sequences },
  };

  return [gainMetric, effectivenessMetric, stagnationMetric, interventionCountMetric, repeatMetric];
}

/**
 * Run full evaluation against current database observations.
 */
export async function runEvaluation({ actor = "system" } = {}) {
  const evaluationId = `eval_${Date.now()}`;
  const pairs = await loadObservationPairs();
  const leakageCheck = runLeakageCheck(pairs);

  const assessmentCount = await SkillAssessment.countDocuments({});
  const readinessCount = await ReadinessComputation.countDocuments({});
  const registry = await getRegistryStatus();

  const systemVersions = {
    evaluationVersion: EVALUATION_VERSION,
    priorityFormulaVersion: PRIORITY_FORMULA_VERSION,
    readinessFormulaVersion: READINESS_FORMULA_VERSION,
    catalogVersion: INTERVENTION_CATALOG_VERSION,
    selectionFormulaVersion: SELECTION_FORMULA_VERSION,
    effectivenessPolicyVersion: EFFECTIVENESS_POLICY_VERSION,
    stagnationPolicyVersion: STAGNATION_POLICY_VERSION,
    adaptivePolicyVersion: ADAPTIVE_POLICY_VERSION,
    personalizationVersion: PERSONALIZATION_VERSION,
    s7ActiveModel: registry.activeModel?.modelId || null,
  };

  const limitations = [
    "Observational evaluation — not a randomized controlled trial",
    "Arm labels inferred from decision traces; incomplete traces may misclassify into Arm A",
    "Selection bias and missing evidence may affect comparisons",
    "Small samples yield INSUFFICIENT_DATA rather than fabricated zeros",
    "S7 Arm D unavailable without validated placement model and real labels",
    "No causal claims are made from arm mean differences alone",
  ];

  if (!leakageCheck.passed) {
    await EmployabilityEvaluationRun.create({
      evaluationId,
      evaluationVersion: EVALUATION_VERSION,
      status: "leakage_detected",
      cohort: { interventionResults: pairs.length },
      dataQuality: { leakageCheck },
      systemVersions,
      arms: ["A", "B", "C", "D"],
      limitations,
      leakageCheck,
      createdBy: actor,
    });
    return {
      ok: false,
      evaluationId,
      status: "leakage_detected",
      leakageCheck,
      message: "Evaluation failed leakage check — results not published as valid research metrics.",
    };
  }

  const results = [];
  for (const arm of ["A", "B", "C"]) {
    results.push(...armMetrics(arm, pairs));
  }

  // Readiness delta: only if we have sequential readiness computations per PRN
  const readinessRows = await ReadinessComputation.find({ status: "computed" })
    .sort({ createdAt: 1 })
    .lean();
  const byPrnReady = new Map();
  for (const r of readinessRows) {
    if (!byPrnReady.has(r.prn)) byPrnReady.set(r.prn, []);
    byPrnReady.get(r.prn).push(r);
  }
  const readinessDeltas = [];
  for (const list of byPrnReady.values()) {
    if (list.length < 2) continue;
    const pre = list[list.length - 2].readinessScore;
    const post = list[list.length - 1].readinessScore;
    if (pre != null && post != null) readinessDeltas.push(Number(post) - Number(pre));
  }
  results.push(
    metricResult({
      metric: "readiness_delta",
      arm: "ALL_OBSERVED",
      values: readinessDeltas,
      missingCount: 0,
      extra: { note: "Paired consecutive readiness computations only; not arm-split" },
    })
  );

  // Evidence quality
  const measureFirstCount = pairs.filter((p) => p.measureFirst).length;
  const selfReportResults = pairs.filter((p) => p.sourceType === "self_report").length;
  results.push({
    arm: "ALL_OBSERVED",
    metric: "evidence_quality",
    value: {
      totalInterventionResults: pairs.length,
      measureFirstDecisions: measureFirstCount,
      selfReportResults,
      assessments: assessmentCount,
      readinessComputations: readinessCount,
    },
    sampleSize: pairs.length,
    validCount: pairs.length,
    missingCount: 0,
    status: pairs.length > 0 ? "VALID" : "INSUFFICIENT_DATA",
    details: {},
  });

  // Arm D
  results.push({
    arm: "D",
    metric: "s7_ml_evaluation",
    value: null,
    sampleSize: 0,
    validCount: 0,
    missingCount: 0,
    status: "UNAVAILABLE",
    details: {
      reason: registry.productionActive
        ? "Active model present but S10 placement prediction evaluation not enabled without explicit labeled holdout protocol"
        : "No validated active S7 model and/or insufficient real placementOutcome labels",
      registryStatus: registry.status,
    },
  });

  const runStatus =
    pairs.length === 0 && readinessDeltas.length === 0 ? "insufficient_data" : "completed";

  await EmployabilityEvaluationRun.create({
    evaluationId,
    evaluationVersion: EVALUATION_VERSION,
    status: runStatus,
    cohort: {
      interventionResults: pairs.length,
      uniqueStudents: new Set(pairs.map((p) => p.prn)).size,
      assessments: assessmentCount,
      readinessComputations: readinessCount,
      armCounts: {
        A: pairs.filter((p) => p.arm === "A").length,
        B: pairs.filter((p) => p.arm === "B").length,
        C: pairs.filter((p) => p.arm === "C").length,
      },
    },
    dataQuality: {
      minSamplesForValid: MIN_SAMPLES_FOR_VALID,
      leakageCheck,
    },
    systemVersions,
    arms: ["A", "B", "C", "D"],
    limitations,
    leakageCheck,
    createdBy: actor,
  });

  for (const r of results) {
    await EmployabilityEvaluationResult.create({
      evaluationId,
      arm: r.arm,
      metric: r.metric,
      value: r.value,
      sampleSize: r.sampleSize,
      validCount: r.validCount,
      missingCount: r.missingCount,
      status: r.status,
      details: r.details || {},
      methodologyVersion: EVALUATION_VERSION,
    });
  }

  return {
    ok: true,
    evaluationId,
    evaluationVersion: EVALUATION_VERSION,
    status: runStatus,
    leakageCheck,
    systemVersions,
    limitations,
    cohort: {
      interventionResults: pairs.length,
      assessments: assessmentCount,
    },
    results,
    reportNote:
      "Observed historical evaluation only. INSUFFICIENT_DATA means not enough real observations — not a fabricated zero.",
  };
}

export async function listEvaluationRuns({ limit = 20 } = {}) {
  return EmployabilityEvaluationRun.find({}).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function getEvaluationRun(evaluationId) {
  const run = await EmployabilityEvaluationRun.findOne({ evaluationId }).lean();
  if (!run) return null;
  const results = await EmployabilityEvaluationResult.find({ evaluationId }).lean();
  return { run, results };
}

export async function getEvaluationStatus() {
  const registry = await getRegistryStatus();
  const resultCount = await InterventionResult.countDocuments({});
  const assessmentCount = await SkillAssessment.countDocuments({});
  return {
    evaluationVersion: EVALUATION_VERSION,
    minSamplesForValid: MIN_SAMPLES_FOR_VALID,
    data: {
      interventionResults: resultCount,
      assessments: assessmentCount,
      enoughForPrimaryMetrics: resultCount >= MIN_SAMPLES_FOR_VALID,
    },
    armD: {
      status: registry.productionActive ? "conditional" : "UNAVAILABLE",
      registryStatus: registry.status,
    },
    note: "Evaluation reports INSUFFICIENT_DATA when real observations are below threshold. No synthetic research results.",
  };
}

export function buildComparisonTable(results) {
  const metrics = [
    "skill_gain",
    "readiness_delta",
    "intervention_count",
    "stagnation_rate",
    "effectiveness_distribution",
    "s7_ml_evaluation",
  ];
  const arms = ["A", "B", "C", "D", "ALL_OBSERVED"];
  const table = {};
  for (const m of metrics) {
    table[m] = {};
    for (const a of arms) {
      const row = results.find((r) => r.metric === m && r.arm === a);
      if (!row) {
        table[m][a] = { status: "NOT_APPLICABLE", value: null };
      } else {
        table[m][a] = { status: row.status, value: row.value, validCount: row.validCount };
      }
    }
  }
  return table;
}
