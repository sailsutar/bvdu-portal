/**
 * S1 — Evidence-based student skill profile read/write.
 * No readiness score, no ML probability, no gap ranking.
 */
import { StudentSkillProfile, SkillAssessment } from "./employability-models.js";
import { buildSkillEntry } from "./employability-s1-evidence.js";
import { SKILL_LABELS } from "./employability-s1-catalog.js";

export async function getStudentSkillProfile(prn) {
  const doc = await StudentSkillProfile.findOne({ prn: String(prn) }).lean();
  if (!doc) {
    return {
      prn: String(prn),
      skills: [],
      source: null,
      exists: false,
    };
  }
  return {
    prn: doc.prn,
    skills: (doc.skills || []).map((s) => ({
      ...s,
      skillLabel: SKILL_LABELS[s.skillId] || s.skillId,
    })),
    source: doc.source,
    notes: doc.notes || "",
    exists: true,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  };
}

/**
 * Upsert skills for a PRN. Applies evidence hierarchy per skill.
 * Does not auto-create scores without input.
 */
export async function upsertStudentSkills(prn, skillsInput = [], options = {}) {
  const prnKey = String(prn);
  const incoming = Array.isArray(skillsInput) ? skillsInput : [];
  const existing = await StudentSkillProfile.findOne({ prn: prnKey });
  const byId = new Map();
  for (const s of existing?.skills || []) {
    byId.set(s.skillId, s);
  }

  const assessmentWrites = [];

  for (const raw of incoming) {
    if (!raw || !raw.skillId) continue;
    const skillId = String(raw.skillId);
    const prev = byId.get(skillId) || {};
    const mergedEvidence = Array.isArray(raw.evidenceSources)
      ? raw.evidenceSources
      : prev.evidenceSources || [];
    const entry = buildSkillEntry(skillId, {
      skillScore: raw.skillScore !== undefined ? raw.skillScore : prev.skillScore,
      evidenceSources: mergedEvidence,
      trend: raw.trend || prev.trend || "unknown",
      targetScore: raw.targetScore !== undefined ? raw.targetScore : prev.targetScore,
      lastAssessed: raw.lastAssessed || prev.lastAssessed,
    });
    byId.set(skillId, entry);

    if (Array.isArray(raw.evidenceSources) && raw.evidenceSources.length) {
      for (const ev of raw.evidenceSources) {
        assessmentWrites.push({
          prn: prnKey,
          skillId,
          sourceType: ev.sourceType,
          sourceId: ev.sourceId || null,
          scoreOrResult: ev.scoreOrResult ?? entry.skillScore,
          assessor: ev.assessor || options.actor || null,
          verificationStatus: ev.verificationStatus || "pending",
          beforeScore: prev.skillScore ?? null,
          afterScore: entry.skillScore,
          meta: { stage: "S1", ...(ev.meta || {}) },
        });
      }
    }
  }

  const skills = Array.from(byId.values());
  const doc = await StudentSkillProfile.findOneAndUpdate(
    { prn: prnKey },
    {
      $set: {
        skills,
        source: options.source || existing?.source || "manual",
        notes: options.notes !== undefined ? options.notes : existing?.notes || "",
      },
      $setOnInsert: { prn: prnKey },
    },
    { upsert: true, new: true }
  );

  if (assessmentWrites.length) {
    try {
      await SkillAssessment.insertMany(assessmentWrites, { ordered: false });
    } catch (e) {
      console.warn("[employability] assessment log insert:", e?.message || e);
    }
  }

  return getStudentSkillProfile(prnKey);
}

/**
 * Prerequisites that appear unmet given current profile skill scores.
 * Informational only for S1 — does not rank interventions.
 */
export function listUnmetPrerequisites(profileSkills, graphEdges) {
  const scoreById = new Map();
  for (const s of profileSkills || []) {
    if (s.skillScore != null) scoreById.set(s.skillId, Number(s.skillScore));
  }
  const unmet = [];
  for (const edge of graphEdges || []) {
    const prereqScore = scoreById.has(edge.prerequisiteSkill)
      ? scoreById.get(edge.prerequisiteSkill)
      : null;
    const min = edge.minimumThreshold;
    if (min == null) continue;
    if (prereqScore == null || prereqScore < min) {
      unmet.push({
        prerequisiteSkill: edge.prerequisiteSkill,
        dependentSkill: edge.dependentSkill,
        minimumThreshold: min,
        currentPrerequisiteScore: prereqScore,
        status:
          prereqScore == null ? "unknown_prerequisite" : "below_threshold",
      });
    }
  }
  return unmet;
}
