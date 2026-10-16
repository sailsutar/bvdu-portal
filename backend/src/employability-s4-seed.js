import { InterventionCatalog } from "./employability-models.js";
import { INTERVENTION_SEEDS, INTERVENTION_CATALOG_VERSION } from "./employability-s4-catalog.js";

export async function seedInterventionCatalog() {
  let n = 0;
  for (const item of INTERVENTION_SEEDS) {
    await InterventionCatalog.findOneAndUpdate(
      { interventionId: item.interventionId },
      {
        $set: {
          skillTarget: item.skillTarget,
          title: item.title,
          description: item.description,
          difficulty: item.difficulty,
          estimatedDurationHours: item.estimatedDurationHours,
          expectedSkillGain: item.expectedSkillGain,
          evidenceRequired: item.evidenceRequired || [],
          assessmentMethod: item.assessmentMethod || null,
          prerequisites: item.prerequisites || [],
          catalogVersion: INTERVENTION_CATALOG_VERSION,
          status: "active",
          // store extras in a way schema allows — description already; modality via description meta
        },
      },
      { upsert: true, new: true }
    );
    n += 1;
  }
  return {
    ok: true,
    catalogVersion: INTERVENTION_CATALOG_VERSION,
    upserted: n,
    source: "bootstrap",
  };
}

export async function listActiveInterventions() {
  const rows = await InterventionCatalog.find({ status: "active" }).lean().sort({ skillTarget: 1, title: 1 });
  // Enrich from seed for modality/kind/highImpact not all in schema
  const byId = Object.fromEntries(INTERVENTION_SEEDS.map((s) => [s.interventionId, s]));
  return rows.map((r) => {
    const seed = byId[r.interventionId] || {};
    return {
      interventionId: r.interventionId,
      title: r.title,
      description: r.description,
      skillTarget: r.skillTarget,
      difficulty: r.difficulty,
      expectedSkillGain: r.expectedSkillGain,
      estimatedDurationHours: r.estimatedDurationHours,
      estimatedEffort: seed.estimatedEffort ?? null,
      prerequisites: r.prerequisites || [],
      evidenceRequired: r.evidenceRequired || [],
      assessmentMethod: r.assessmentMethod,
      catalogVersion: r.catalogVersion,
      status: r.status,
      kind: seed.kind || null,
      modality: seed.modality || null,
      highImpact: Boolean(seed.highImpact),
    };
  });
}
