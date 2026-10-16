/**
 * S1 — Evidence hierarchy helpers for skill profile updates.
 * Does NOT compute readiness or employability probability.
 *
 * Hierarchy (high → low):
 * verified_assessment > project_evaluation > coding_test >
 * teacher_evaluation > verified_certificate > verified_github > self_report
 */

export const EVIDENCE_RANK = {
  verified_assessment: 70,
  project_evaluation: 60,
  coding_test: 55,
  teacher_evaluation: 50,
  verified_certificate: 40,
  verified_github: 35,
  self_report: 10,
};

const STRONG_CLAIM_THRESHOLD = 70; // claimed score at/above this needs non-self evidence

/**
 * Derive skill status + confidence cap from evidence list and optional claimed score.
 * Self-report alone cannot justify verified/high confidence.
 */
export function deriveSkillEvidenceState(evidenceSources = [], claimedScore = null) {
  const sources = Array.isArray(evidenceSources) ? evidenceSources : [];
  const types = sources.map((e) => e.sourceType).filter(Boolean);
  const hasSelf = types.includes("self_report");
  const nonSelf = types.filter((t) => t !== "self_report");
  const bestRank = types.reduce((m, t) => Math.max(m, EVIDENCE_RANK[t] || 0), 0);

  let status = "unknown";
  let confidence = 0;
  let evidenceCount = sources.length;

  if (evidenceCount === 0) {
    status = "unknown";
    confidence = 0;
  } else if (nonSelf.length === 0 && hasSelf) {
    // Self-report only — usable for gap ranking with low confidence (placement profile path)
    status = "self_reported";
    confidence = Math.min(0.4, 0.2 + 0.05 * Math.min(sources.length, 4));
  } else if (nonSelf.length > 0 && bestRank >= 55) {
    status = "verified";
    confidence = Math.min(0.95, 0.55 + bestRank / 200 + 0.05 * Math.min(nonSelf.length, 4));
  } else if (nonSelf.length > 0) {
    status = "partial";
    confidence = Math.min(0.7, 0.4 + bestRank / 250 + 0.05 * nonSelf.length);
  } else {
    status = "insufficient_evidence";
    confidence = 0.2;
  }

  // Strong numeric claim with only self-report stays insufficient_evidence
  if (
    claimedScore != null &&
    Number(claimedScore) >= STRONG_CLAIM_THRESHOLD &&
    nonSelf.length === 0
  ) {
    status = "self_reported";
    confidence = Math.min(confidence, 0.35);
  }

  return {
    status,
    confidence: Math.round(confidence * 1000) / 1000,
    evidenceCount,
    bestEvidenceRank: bestRank,
    hasVerifiedEvidence: nonSelf.length > 0,
    selfReportOnly: hasSelf && nonSelf.length === 0,
  };
}

/**
 * Merge incoming skill patch with evidence rules.
 * Does not invent scores when none provided.
 */
export function buildSkillEntry(skillId, patch = {}) {
  const evidenceSources = Array.isArray(patch.evidenceSources) ? patch.evidenceSources : [];
  const skillScore =
    patch.skillScore === undefined || patch.skillScore === null || patch.skillScore === ""
      ? null
      : Number(patch.skillScore);

  const derived = deriveSkillEvidenceState(
    evidenceSources,
    skillScore != null && !Number.isNaN(skillScore) ? skillScore : null
  );

  return {
    skillId: String(skillId),
    skillScore: skillScore != null && !Number.isNaN(skillScore) ? skillScore : null,
    confidence: derived.confidence,
    evidenceCount: derived.evidenceCount,
    evidenceSources,
    lastAssessed: evidenceSources.length ? new Date() : patch.lastAssessed || null,
    trend: patch.trend || "unknown",
    targetScore: patch.targetScore != null ? Number(patch.targetScore) : null,
    status: derived.status,
  };
}
