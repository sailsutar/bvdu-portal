/**
 * S1 bootstrap: seed job roles, role skill requirements, skill dependency graph.
 * Idempotent. Does not create student skills or readiness values.
 */
import {
  JobRole,
  RoleSkillRequirement,
  SkillDependency,
} from "./employability-models.js";
import {
  JOB_ROLE_SEEDS,
  SKILL_DEPENDENCY_SEEDS,
  SKILL_GRAPH_VERSION,
  ROLE_REQUIREMENT_VERSION,
  CATALOG_VERSION,
  SKILL_LABELS,
} from "./employability-s1-catalog.js";

export async function seedEmployabilityS1Catalog() {
  let rolesUpserted = 0;
  let requirementsUpserted = 0;
  let depsUpserted = 0;

  for (const role of JOB_ROLE_SEEDS) {
    await JobRole.findOneAndUpdate(
      { roleId: role.roleId },
      {
        $set: {
          roleName: role.roleName,
          description: role.description,
          status: "active",
          version: ROLE_REQUIREMENT_VERSION,
        },
        $setOnInsert: { roleId: role.roleId },
      },
      { upsert: true, new: true }
    );
    rolesUpserted += 1;

    for (const sk of role.skills) {
      await RoleSkillRequirement.findOneAndUpdate(
        {
          roleId: role.roleId,
          version: ROLE_REQUIREMENT_VERSION,
          skillId: sk.skillId,
        },
        {
          $set: {
            category: sk.category,
            skillWeight: sk.skillWeight,
            minimumThreshold: sk.minimumThreshold,
            prerequisites: [],
            evidenceRequirements: ["verified_assessment", "project_evaluation", "coding_test"],
            status: "active",
          },
        },
        { upsert: true, new: true }
      );
      requirementsUpserted += 1;
    }
  }

  for (const edge of SKILL_DEPENDENCY_SEEDS) {
    await SkillDependency.findOneAndUpdate(
      {
        prerequisiteSkill: edge.prerequisiteSkill,
        dependentSkill: edge.dependentSkill,
        version: SKILL_GRAPH_VERSION,
      },
      {
        $set: {
          minimumThreshold: edge.minimumThreshold,
          status: "active",
        },
      },
      { upsert: true, new: true }
    );
    depsUpserted += 1;
  }

  return {
    ok: true,
    catalogVersion: CATALOG_VERSION,
    skillGraphVersion: SKILL_GRAPH_VERSION,
    roleRequirementVersion: ROLE_REQUIREMENT_VERSION,
    rolesUpserted,
    requirementsUpserted,
    dependenciesUpserted: depsUpserted,
    skillCatalogSize: Object.keys(SKILL_LABELS).length,
    source: "bootstrap",
  };
}

export async function getSkillGraph() {
  try {
    const edges = await SkillDependency.find({
      version: SKILL_GRAPH_VERSION,
      status: "active",
    })
      .lean()
      .sort({ prerequisiteSkill: 1, dependentSkill: 1 });
    if (edges.length) {
      return {
        version: SKILL_GRAPH_VERSION,
        source: "mongodb",
        edges: edges.map((e) => ({
          prerequisiteSkill: e.prerequisiteSkill,
          dependentSkill: e.dependentSkill,
          minimumThreshold: e.minimumThreshold,
        })),
      };
    }
  } catch (e) {
    console.warn("[employability] getSkillGraph DB:", e?.message || e);
  }
  return {
    version: SKILL_GRAPH_VERSION,
    source: "catalog_fallback",
    edges: SKILL_DEPENDENCY_SEEDS.map((e) => ({
      prerequisiteSkill: e.prerequisiteSkill,
      dependentSkill: e.dependentSkill,
      minimumThreshold: e.minimumThreshold,
    })),
  };
}

export async function listActiveRoles() {
  try {
    const rows = await JobRole.find({ status: "active" }).lean().sort({ roleName: 1 });
    if (rows?.length) return rows;
  } catch (e) {
    console.warn("[employability] listActiveRoles:", e?.message || e);
  }
  return JOB_ROLE_SEEDS.map((r) => ({
    roleId: r.roleId,
    roleName: r.roleName,
    description: r.description,
    status: "active",
  }));
}

function roleRequirementsFromCatalog(roleId) {
  const seed = JOB_ROLE_SEEDS.find((r) => r.roleId === roleId) || JOB_ROLE_SEEDS[0];
  if (!seed) return null;
  return {
    role: {
      roleId: seed.roleId,
      roleName: seed.roleName,
      description: seed.description,
      status: "active",
    },
    version: ROLE_REQUIREMENT_VERSION,
    source: "catalog_fallback",
    requirements: (seed.skills || []).map((r) => ({
      skillId: r.skillId,
      skillLabel: SKILL_LABELS[r.skillId] || r.skillId,
      category: r.category,
      skillWeight: r.skillWeight,
      minimumThreshold: r.minimumThreshold,
      evidenceRequirements: ["verified_assessment", "project_evaluation", "coding_test"],
    })),
  };
}

export async function getRoleRequirements(roleId, version = ROLE_REQUIREMENT_VERSION) {
  try {
    const role = await JobRole.findOne({ roleId }).lean();
    if (role) {
      const requirements = await RoleSkillRequirement.find({
        roleId,
        version,
        status: "active",
      })
        .lean()
        .sort({ skillWeight: -1 });
      if (requirements.length) {
        return {
          role,
          version,
          source: "mongodb",
          requirements: requirements.map((r) => ({
            skillId: r.skillId,
            skillLabel: SKILL_LABELS[r.skillId] || r.skillId,
            category: r.category,
            skillWeight: r.skillWeight,
            minimumThreshold: r.minimumThreshold,
            evidenceRequirements: r.evidenceRequirements || [],
          })),
        };
      }
    }
  } catch (e) {
    console.warn("[employability] getRoleRequirements DB:", e?.message || e);
  }
  // Always have roles for S2/S3 even if Mongo seed failed
  return roleRequirementsFromCatalog(roleId);
}

/** Alias for callers that expect listRoles */
export const listRoles = listActiveRoles;
