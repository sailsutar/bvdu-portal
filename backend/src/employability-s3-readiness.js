/**
 * S3 — Evidence-based Employability Readiness Score (deterministic).
 * Independent of employability ML. Not a placement probability.
 *
 * Band semantics:
 * - INSUFFICIENT_EVIDENCE: not enough non-self-report evidence to trust the score
 * - READY / NEAR_READY / NOT_READY: only when evidence floor is met
 */

import {
  ReadinessComputation,
  EmployabilityState,
} from "./employability-models.js";
import { getStudentSkillProfile } from "./employability-s1-profile.js";
import { getRoleRequirements } from "./employability-s1-seed.js";
import { SKILL_LABELS, ROLE_REQUIREMENT_VERSION } from "./employability-s1-catalog.js";
import { computeSkillGaps } from "./employability-s2-priority.js";

export const READINESS_FORMULA_VERSION = "s3-v2-selfprep";

/** Score thresholds apply only when evidence is sufficient */
export const READINESS_BAND_THRESHOLDS = {
  READY: 75,
  NEAR_READY: 55,
};

/** At least this fraction of required skills must have non-self evidence */
const REQUIRED_EVIDENCE_COVERAGE = 0.4;
/** At least this many required skills with verified/partial status */
const MIN_REQUIRED_WITH_EVIDENCE = 2;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hasNonSelfEvidence(skill) {
  const sources = skill?.evidenceSources || [];
  return sources.some((e) => e.sourceType && e.sourceType !== "self_report");
}

function evidenceQuality(skill) {
  if (!skill) return 0;
  if (skill.status === "verified" && hasNonSelfEvidence(skill)) return 1;
  if (skill.status === "partial" && hasNonSelfEvidence(skill)) return 0.7;
  if (hasNonSelfEvidence(skill)) return 0.5;
  // Student self-prep mode: placement self-ratings are usable guidance signals
  if (skill.status === "self_reported" || skill.skillScore != null) {
    return 0.75;
  }
  if (skill.status === "insufficient_evidence" || skill.status === "unknown") return 0.25;
  return 0.2;
}

/**
 * Optional bounded academic signal from placement profile / academic record.
 * Max contribution ±5 points — never dominates readiness.
 */
async function boundedAcademicSignal(prn) {
  const components = [];
  let delta = 0;
  try {
    const { PlacementProfile, AcademicRecord } = await import("./db.js");
    const pp = await PlacementProfile.findOne({ prn: String(prn) }).lean();
    if (pp) {
      if (pp.internshipCount > 0 || (pp.internships && String(pp.internships).trim())) {
        delta += 2;
        components.push({
          id: "internship_signal",
          label: "Internship evidence on placement profile",
          contribution: 2,
          detail: "Bounded +2 from recorded internship information",
        });
      }
      if (pp.cgpa != null && Number(pp.cgpa) >= 7) {
        delta += 2;
        components.push({
          id: "cgpa_signal",
          label: "CGPA signal",
          contribution: 2,
          detail: `Bounded +2 for CGPA ${pp.cgpa} (not a placement probability)`,
        });
      } else if (pp.cgpa != null && Number(pp.cgpa) < 6) {
        delta -= 2;
        components.push({
          id: "cgpa_signal",
          label: "CGPA signal",
          contribution: -2,
          detail: `Bounded -2 for CGPA ${pp.cgpa}`,
        });
      }
      if (pp.activeKtCount > 0) {
        delta -= 2;
        components.push({
          id: "kt_signal",
          label: "Active backlog signal",
          contribution: -2,
          detail: `Bounded -2 for active KT count ${pp.activeKtCount}`,
        });
      }
    }
    const ar = await AcademicRecord.findOne({ prn: String(prn) }).lean();
    if (ar && ar.attendance != null) {
      const att = Number(ar.attendance);
      if (att >= 75) {
        delta += 1;
        components.push({
          id: "attendance_signal",
          label: "Attendance signal",
          contribution: 1,
          detail: `Bounded +1 for attendance ${att}%`,
        });
      } else if (att < 60) {
        delta -= 1;
        components.push({
          id: "attendance_signal",
          label: "Attendance signal",
          contribution: -1,
          detail: `Bounded -1 for attendance ${att}%`,
        });
      }
    }
  } catch {
    // db models optional during isolated tests
  }
  delta = clamp(delta, -5, 5);
  return { delta, components };
}

/**
 * Compute evidence-based readiness for PRN + target role.
 */
export async function computeReadiness({ prn, roleId, persist = true }) {
  if (!prn) throw new Error("prn required");
  if (!roleId) throw new Error("roleId required");

  const profile = await getStudentSkillProfile(prn);
  const roleData = await getRoleRequirements(roleId);
  if (!roleData) {
    const err = new Error("Role not found");
    err.code = 404;
    throw err;
  }

  const skillsById = new Map();
  for (const s of profile.skills || []) skillsById.set(s.skillId, s);

  const required = (roleData.requirements || []).filter((r) => r.category === "required");
  const preferred = (roleData.requirements || []).filter((r) => r.category === "preferred");

  const components = [];
  let weightedSum = 0;
  let weightTotal = 0;
  let requiredWithEvidence = 0;
  let requiredCount = required.length || 1;
  let missingPenalty = 0;
  let selfReportHeavy = 0;

  const skillBreakdown = [];

  for (const req of required) {
    const w = Number(req.skillWeight) || 0.5;
    const minT = req.minimumThreshold != null ? Number(req.minimumThreshold) : 60;
    const sk = skillsById.get(req.skillId);
    const q = evidenceQuality(sk);
    const score = sk?.skillScore != null ? Number(sk.skillScore) : null;

    // Attainment 0–1 vs threshold; unknown score → 0 attainment but still apply evidence quality
    let attainment = 0;
    if (score != null && minT > 0) {
      attainment = clamp(score / minT, 0, 1.15);
    }

    // Self-prep: student scores drive preparation score; verified evidence still gets full weight
    const effectiveAttainment = attainment * (0.55 + 0.45 * q);
    const contribution = w * effectiveAttainment * 100;
    weightedSum += contribution;
    weightTotal += w * 100;

    if (q >= 0.5) requiredWithEvidence += 1;
    if (!sk || sk.status === "unknown" || score == null) {
      missingPenalty += 4 * w;
      components.push({
        id: `missing_${req.skillId}`,
        label: `Missing evidence: ${SKILL_LABELS[req.skillId] || req.skillId}`,
        contribution: -4 * w,
        detail: "Required skill has no usable verified score — penalty applied",
      });
    } else if (sk.status === "insufficient_evidence" || (q <= 0.15 && score != null)) {
      selfReportHeavy += 1;
      missingPenalty += 3 * w;
      components.push({
        id: `self_report_${req.skillId}`,
        label: `Self-report limited: ${SKILL_LABELS[req.skillId] || req.skillId}`,
        contribution: -3 * w,
        detail: "Self-report alone does not support high readiness for this required skill",
      });
    }

    skillBreakdown.push({
      skillId: req.skillId,
      skillLabel: SKILL_LABELS[req.skillId] || req.skillId,
      category: "required",
      weight: w,
      minimumThreshold: minT,
      currentScore: score,
      evidenceQuality: Math.round(q * 1000) / 1000,
      status: sk?.status || "unknown",
      contribution: Math.round(contribution * 100) / 100,
    });

    components.push({
      id: `skill_${req.skillId}`,
      label: SKILL_LABELS[req.skillId] || req.skillId,
      contribution: Math.round(contribution * 100) / 100,
      detail: `Required skill weighted contribution (evidence quality ${q.toFixed(2)}, score ${score ?? "n/a"} vs min ${minT})`,
    });
  }

  for (const req of preferred) {
    const w = (Number(req.skillWeight) || 0.4) * 0.5; // preferred counts less
    const minT = req.minimumThreshold != null ? Number(req.minimumThreshold) : 50;
    const sk = skillsById.get(req.skillId);
    const q = evidenceQuality(sk);
    const score = sk?.skillScore != null ? Number(sk.skillScore) : null;
    let attainment = score != null && minT > 0 ? clamp(score / minT, 0, 1.1) : 0;
    if (q < 0.35) attainment = Math.min(attainment, 0.35) * q;
    else attainment = attainment * (0.4 + 0.6 * q);
    const contribution = w * attainment * 100;
    weightedSum += contribution;
    weightTotal += w * 100;
    skillBreakdown.push({
      skillId: req.skillId,
      skillLabel: SKILL_LABELS[req.skillId] || req.skillId,
      category: "preferred",
      weight: w,
      minimumThreshold: minT,
      currentScore: score,
      evidenceQuality: Math.round(q * 1000) / 1000,
      status: sk?.status || "unknown",
      contribution: Math.round(contribution * 100) / 100,
    });
  }

  let base = weightTotal > 0 ? (weightedSum / weightTotal) * 100 : 0;
  base = clamp(base, 0, 100);

  const academic = await boundedAcademicSignal(prn);
  let score = clamp(base - missingPenalty + academic.delta, 0, 100);
  score = Math.round(score * 10) / 10;

  components.push(...academic.components);
  if (missingPenalty > 0) {
    components.push({
      id: "missing_evidence_penalty_total",
      label: "Missing / weak evidence penalty",
      contribution: -Math.round(missingPenalty * 10) / 10,
      detail: "Penalties for required skills without verified evidence",
    });
  }

  const coverage = requiredWithEvidence / requiredCount;
  const insufficientEvidence =
    !profile.exists ||
    coverage < REQUIRED_EVIDENCE_COVERAGE ||
    requiredWithEvidence < Math.min(MIN_REQUIRED_WITH_EVIDENCE, requiredCount) ||
    (selfReportHeavy >= Math.ceil(requiredCount * 0.5) && requiredWithEvidence < requiredCount * 0.5);

  // Student self-prep mode: band from preparation score when the student has skill data.
  // Staff-verified evidence can still raise quality; it is not required to show guidance.
  let readinessBand;
  if (!profile.exists || !(profile.skills || []).length) {
    readinessBand = "INSUFFICIENT_EVIDENCE";
  } else if (score >= READINESS_BAND_THRESHOLDS.READY) {
    readinessBand = "STRONG";
  } else if (score >= READINESS_BAND_THRESHOLDS.NEAR_READY) {
    readinessBand = "BUILDING";
  } else if (score > 0) {
    readinessBand = "STARTING";
  } else {
    readinessBand = "STARTING";
  }

  // S2 gaps for context (does not change readiness formula)
  let topGaps = [];
  try {
    const gaps = await computeSkillGaps({ prn, roleId });
    topGaps = (gaps.rankedGaps || []).slice(0, 5).map((g) => ({
      skillId: g.skillId,
      skillLabel: g.skillLabel,
      gap: g.gap,
      priority: g.priority,
      measureFirstCandidate: g.measureFirstCandidate,
    }));
  } catch {
    topGaps = [];
  }

  const explanation = {
    summary:
      readinessBand === "INSUFFICIENT_EVIDENCE"
        ? `No skill data yet for role ${roleData.role?.roleName || roleId}. Save Core skills on Placement profile to get a preparation plan.`
        : `Preparation score ${score}/100 (${readinessBand}) for role ${roleData.role?.roleName || roleId}, based on your Placement profile skills. This is self-prep guidance — not a placement probability and not an ML prediction.`,
    components: components.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
    skillBreakdown,
    evidenceCoverage: {
      requiredCount,
      requiredWithNonSelfEvidence: requiredWithEvidence,
      coverageRatio: Math.round(coverage * 1000) / 1000,
      selfReportHeavyRequiredCount: selfReportHeavy,
      insufficientEvidence,
    },
  };

  const result = {
    prn: String(prn),
    roleId,
    roleName: roleData.role?.roleName || roleId,
    readinessScore: score,
    readinessBand,
    formulaVersion: READINESS_FORMULA_VERSION,
    roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
    profileExists: profile.exists,
    explanation,
    topGapsContext: topGaps,
    labels: {
      readinessScoreMeaning:
        "Deterministic evidence-based readiness for the target role (0–100). Not employability ML probability. Not “percent chance of placement.”",
      bands: {
        READY: `Score ≥ ${READINESS_BAND_THRESHOLDS.READY} with adequate verified evidence`,
        NEAR_READY: `Score ≥ ${READINESS_BAND_THRESHOLDS.NEAR_READY} with adequate verified evidence`,
        NOT_READY: `Score < ${READINESS_BAND_THRESHOLDS.NEAR_READY} with adequate verified evidence`,
        INSUFFICIENT_EVIDENCE:
          "Too little non-self-report evidence on required skills — measure first; do not treat score as decision-grade",
      },
    },
    ml: {
      status: "unavailable",
      productionProbability: false,
      note: "Readiness is independent of employability ML",
    },
  };

  if (persist) {
    const doc = await ReadinessComputation.create({
      prn: String(prn),
      stateVersion: null,
      readinessScore: score,
      readinessBand,
      formulaVersion: READINESS_FORMULA_VERSION,
      components: explanation,
      status: "computed",
    });
    result.computationId = String(doc._id);

    // Optional: refresh current employability state readiness fields only
    await EmployabilityState.findOneAndUpdate(
      { prn: String(prn), isCurrent: true },
      {
        $set: {
          readinessScore: score,
          readinessBand,
          insufficientEvidenceSkills: skillBreakdown
            .filter((s) => s.status === "insufficient_evidence" || s.status === "unknown")
            .map((s) => s.skillId),
          targetRoleId: roleId,
          targetRoleVersion: ROLE_REQUIREMENT_VERSION,
          roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
        },
        $setOnInsert: {
          prn: String(prn),
          stateVersion: 1,
          skills: profile.skills || [],
          isCurrent: true,
          source: "readiness_s3",
        },
      },
      { upsert: true }
    );
  }

  return result;
}
