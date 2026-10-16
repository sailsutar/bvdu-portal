/**
 * Maps PlacementProfile fields → Employability S1 skill scores on save.
 * Student keeps one form (placement profile); employability engine is fed automatically.
 */
import { upsertStudentSkills } from "./employability-s1-profile.js";

/** Placement skill ratings are 1–5 → map to 0–100 */
export function skillLevelToScore(level) {
  if (level == null || level === "") return null;
  const n = Number(level);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 20)));
}

/**
 * Build skill rows from a placement profile document (or lean object).
 */
export function placementProfileToSkillRows(doc) {
  if (!doc) return [];
  const pairs = [
    ["programming", doc.skillC ?? doc.skillCpp],
    ["oop", doc.skillCpp ?? doc.skillC],
    ["dsa", doc.skillDsa],
    ["dbms", doc.skillDbms],
    ["aiml", doc.skillAiml],
    ["networks", doc.skillCn],
    ["communication", doc.communicationRating ?? doc.skillCommunication],
    ["projects", doc.projectCount != null ? Math.min(5, Number(doc.projectCount) || 0) : null],
    ["internship", doc.internshipCount != null ? Math.min(5, Number(doc.internshipCount) || 0) : null],
  ];

  // skillTags free text → weak self-report bump for matching known tags
  const tags = String(doc.skillTags || "").toLowerCase();
  const tagBoosts = [
    ["javascript", /javascript|\bjs\b/],
    ["react", /react/],
    ["backend", /node|express|backend|spring|django|flask/],
    ["git", /\bgit\b|github/],
    ["cloud", /aws|azure|gcp|cloud/],
    ["python", /python/],
  ];

  const rows = [];
  for (const [skillId, level] of pairs) {
    let score = skillLevelToScore(level);
    // projects / internship counts already on 0–5 scale via min(5, count)
    if ((skillId === "projects" || skillId === "internship") && level != null && level !== "") {
      score = skillLevelToScore(Math.min(5, Number(level) || 0));
    }
    if (score == null) continue;
    rows.push({
      skillId,
      skillScore: score,
      evidenceSources: [
        {
          sourceType: "self_report",
          scoreOrResult: score,
          verificationStatus: "unverified",
          timestamp: new Date(),
          meta: { from: "placement_profile" },
        },
      ],
    });
  }

  for (const [skillId, re] of tagBoosts) {
    if (!re.test(tags)) continue;
    if (rows.some((r) => r.skillId === skillId)) continue;
    rows.push({
      skillId,
      skillScore: 60,
      evidenceSources: [
        {
          sourceType: "self_report",
          scoreOrResult: 60,
          verificationStatus: "unverified",
          timestamp: new Date(),
          meta: { from: "placement_skillTags" },
        },
      ],
    });
  }

  // Derive Project Evidence from free-text achievements / hackathons / buildathons / internships
  if (!rows.some((r) => r.skillId === "projects")) {
    const blob = [
      doc.internships,
      doc.hackathons,
      doc.buildathons,
      doc.achievements,
      doc.projects,
    ]
      .filter(Boolean)
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(" ");
    if (blob.length >= 8) {
      const lenScore = Math.min(85, 45 + Math.floor(blob.length / 12));
      rows.push({
        skillId: "projects",
        skillScore: lenScore,
        evidenceSources: [
          {
            sourceType: "self_report",
            scoreOrResult: lenScore,
            verificationStatus: "unverified",
            timestamp: new Date(),
            meta: { from: "placement_experience_text" },
          },
        ],
      });
    }
  }

  // Soft communication signal if achievements mention soft skills
  if (!rows.some((r) => r.skillId === "communication")) {
    const soft = String(doc.achievements || doc.skillTags || "").toLowerCase();
    if (/communicat|presentation|leadership|team|speak|english/.test(soft)) {
      rows.push({
        skillId: "communication",
        skillScore: 55,
        evidenceSources: [
          {
            sourceType: "self_report",
            scoreOrResult: 55,
            verificationStatus: "unverified",
            timestamp: new Date(),
            meta: { from: "placement_soft_signal" },
          },
        ],
      });
    }
  }

  return rows;
}

/**
 * After placement profile save — best-effort sync into employability profile.
 * Never throws to caller; returns { ok, count } or { ok:false, error }.
 */
export async function syncEmployabilityFromPlacementProfile(prn, doc, actor = null) {
  try {
    const skills = placementProfileToSkillRows(doc);
    if (!skills.length) {
      return { ok: true, count: 0, note: "No rated skills on placement profile to sync" };
    }
    const profile = await upsertStudentSkills(prn, skills, {
      actor: actor || prn,
      source: "placement_profile_sync",
      notes: "Auto-synced from student placement profile save",
    });
    return {
      ok: true,
      count: skills.length,
      skillIds: skills.map((s) => s.skillId),
      exists: profile?.exists !== false,
    };
  } catch (e) {
    console.warn("[employability] placement sync failed:", e?.message || e);
    return { ok: false, error: String(e.message || e) };
  }
}
