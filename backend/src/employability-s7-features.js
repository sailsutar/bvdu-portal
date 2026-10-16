/**
 * S7 feature builder — prediction-time features only (no outcome leakage).
 */
import { PlacementProfile } from "./db.js";
import { StudentSkillProfile } from "./employability-models.js";
import { FEATURE_VERSION } from "./employability-s7-data.js";

export const FEATURE_NAMES = [
  "cgpa",
  "degreePercent",
  "activeKtCount",
  "tenthPercent",
  "twelfthPercent",
  "cetScore",
  "jeeScore",
  "internshipCount",
  "skillDsa",
  "skillC",
  "skillCpp",
  "skillDbms",
  "skillAiml",
  "completenessScore",
  "verifiedSkillMean",
  "verifiedSkillCount",
  "selfReportOnlyCount",
];

function num(v, fill = 0) {
  if (v === null || v === undefined || v === "") return fill;
  const n = Number(v);
  return Number.isNaN(n) ? fill : n;
}

/**
 * Build feature vector for one PRN. Never includes placementOutcome.
 */
export async function buildEmployabilityFeatures(prn) {
  const pp = await PlacementProfile.findOne({ prn: String(prn) }).lean();
  const sp = await StudentSkillProfile.findOne({ prn: String(prn) }).lean();

  let verifiedSkillMean = 0;
  let verifiedSkillCount = 0;
  let selfReportOnlyCount = 0;
  const skills = sp?.skills || [];
  const verifiedScores = [];
  for (const s of skills) {
    const nonSelf = (s.evidenceSources || []).some((e) => e.sourceType && e.sourceType !== "self_report");
    if (s.status === "verified" || (nonSelf && s.skillScore != null)) {
      verifiedSkillCount += 1;
      if (s.skillScore != null) verifiedScores.push(Number(s.skillScore));
    } else if (s.status === "insufficient_evidence" || (!nonSelf && s.skillScore != null)) {
      selfReportOnlyCount += 1;
    }
  }
  if (verifiedScores.length) {
    verifiedSkillMean = verifiedScores.reduce((a, b) => a + b, 0) / verifiedScores.length;
  }

  const values = {
    cgpa: num(pp?.cgpa),
    degreePercent: num(pp?.degreePercent),
    activeKtCount: num(pp?.activeKtCount),
    tenthPercent: num(pp?.tenthPercent),
    twelfthPercent: num(pp?.twelfthPercent),
    cetScore: num(pp?.cetScore),
    jeeScore: num(pp?.jeeScore),
    internshipCount: num(pp?.internshipCount),
    skillDsa: num(pp?.skillDsa),
    skillC: num(pp?.skillC),
    skillCpp: num(pp?.skillCpp),
    skillDbms: num(pp?.skillDbms),
    skillAiml: num(pp?.skillAiml),
    completenessScore: num(pp?.completenessScore),
    verifiedSkillMean: Math.round(verifiedSkillMean * 100) / 100,
    verifiedSkillCount,
    selfReportOnlyCount,
  };

  const vector = FEATURE_NAMES.map((n) => values[n]);

  return {
    prn: String(prn),
    featureVersion: FEATURE_VERSION,
    featureNames: FEATURE_NAMES,
    values,
    vector,
    hasProfile: Boolean(pp),
    // Explicit: outcome never returned as feature
    leakageCheck: { placementOutcomeExcluded: true },
  };
}

/**
 * Export labeled matrix for training (only rows with placementOutcome 0|1).
 */
export async function exportLabeledFeatureMatrix() {
  const rows = await PlacementProfile.find({ placementOutcome: { $in: [0, 1] } }).lean();
  const X = [];
  const y = [];
  const meta = [];
  for (const pp of rows) {
    const f = await buildEmployabilityFeatures(pp.prn);
    X.push(f.vector);
    y.push(Number(pp.placementOutcome));
    meta.push({
      prn: pp.prn,
      cohortId: pp.cohortId || null,
      admissionYear: pp.admissionYear || null,
      placementOutcomeAt: pp.placementOutcomeAt || null,
    });
  }
  return {
    featureVersion: FEATURE_VERSION,
    featureNames: FEATURE_NAMES,
    n: X.length,
    X,
    y,
    meta,
  };
}
