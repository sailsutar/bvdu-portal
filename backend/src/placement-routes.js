/**
 * Placement module: student profiles → coordinator verify → head dashboards.
 * Merges AcademicRecord (Excel upload) + StudentBackground + PlacementProfile.
 * Readiness is dynamic (recomputed on every read) until historical placement labels exist.
 */
import { PlacementProfile, StudentBackground, AcademicRecord, writeAudit } from "./db.js";
import { computeTopicStrengthsFromMarks, topicGaps, suggestDomains } from "./placement-topics.js";
import {
  normalizeYear as normYearCohort,
  normalizeBatch as normBatchCohort,
  parseYearBatch,
  applyYearLockToPayload,
  yearLockMask,
  isPlacementPredictionYear,
  isPlacementPrepYear,
} from "./year-cohort.js";
import {
  requireAuth,
  requireStudent,
  requirePlacementStaff,
  requirePlacementCoordinator,
  requirePlacementHead,
} from "./auth.js";

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeYear(raw) {
  const s = String(raw || "").toUpperCase().trim();
  if (!s) return null;
  if (/\b(FY|FE|FIRST)\b/.test(s) || s === "FY" || s === "FE") return "FY";
  if (/\b(SY|SE|SECOND)\b/.test(s) || s === "SY" || s === "SE") return "SY";
  if (/\b(TY|TE|THIRD)\b/.test(s) || s === "TY" || s === "TE") return "TY";
  if (/\b(LY|BE|FINAL|LAST)\b/.test(s) || s === "LY" || s === "BE" || s.includes("FINAL")) return "LY";
  return null;
}

function yearOf(row) {
  const p = parseYearBatch(row);
  return p.year || normalizeYear(row?.yearLevel) || normalizeYear(row?.cls) || null;
}

function computeConsistency(activeKtCount) {
  return (Number(activeKtCount) || 0) > 0 ? "inconsistent" : "consistent";
}

function computeCompleteness(doc) {
  const checks = [
    doc.cgpa != null,
    doc.resumeUrl && String(doc.resumeUrl).trim(),
    doc.skillDsa != null,
    doc.skillC != null || doc.skillCpp != null,
    doc.skillDbms != null,
    doc.skillAiml != null,
    Number(doc.internshipCount) > 0 || (doc.internships && String(doc.internships).trim()),
    doc.tenthPercent != null || doc.twelfthPercent != null,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

function computeReadiness(doc) {
  const gaps = [];
  let score = 35;
  const kt = Number(doc.activeKtCount) || 0;
  if (kt > 0) {
    score -= Math.min(40, kt * 15);
    gaps.push(`Active KT(s): ${kt} — clear backlogs for drive eligibility`);
  } else {
    score += 18;
  }

  const cgpa = num(doc.cgpa);
  if (cgpa == null && doc.degreePercent == null) gaps.push("CGPA / degree % missing");
  else {
    const g = cgpa != null ? cgpa : (num(doc.degreePercent) || 0) / 10;
    if (g >= 8) score += 20;
    else if (g >= 7) score += 12;
    else if (g >= 6) score += 5;
    else {
      score -= 8;
      gaps.push("CGPA below typical drive threshold");
    }
  }

  const att = num(doc.attendance);
  if (att != null) {
    if (att >= 85) score += 10;
    else if (att >= 75) score += 5;
    else if (att < 65) {
      score -= 10;
      gaps.push(`Attendance ${att}% is low for placement readiness`);
    }
  }

  if (doc.resumeUrl && String(doc.resumeUrl).trim()) score += 12;
  else gaps.push("Resume link missing");

  const skills = [doc.skillDsa, doc.skillC, doc.skillCpp, doc.skillDbms, doc.skillAiml]
    .map(num)
    .filter((x) => x != null);
  if (skills.length) {
    const avg = skills.reduce((a, b) => a + b, 0) / skills.length;
    score += Math.round((avg / 5) * 15);
    if (doc.skillDsa == null) gaps.push("DSA skill not rated");
    else if (Number(doc.skillDsa) < 3) gaps.push("Strengthen DSA skill rating");
  } else {
    gaps.push("Core skills (DSA / C / C++ / DBMS / AI-ML) not rated");
  }

  // Internships from 2nd semester (SY) onward are expected; early internship = strong profile
  const year = String(doc.yearLevel || "").toUpperCase();
  const hasIntern =
    Number(doc.internshipCount) > 0 || (doc.internships && String(doc.internships).trim());
  const startSem = num(doc.internshipStartSem); // optional: 2 = 2nd sem, 3, 4…
  const earlyIntern =
    hasIntern &&
    (startSem === 2 ||
      startSem === 3 ||
      /\b(2nd|second)\s*sem/i.test(String(doc.internships || "")) ||
      year === "SY");

  if (hasIntern) {
    score += 12;
    if (earlyIntern || (startSem != null && startSem <= 3)) {
      score += 10; // strong profile: internship begun by ~2nd/3rd semester
      // note as strength only in gaps if we want positives — keep gaps for problems
    } else if (year === "TY" || year === "LY") {
      score += 2; // late-only internship still better than none
    }
    if (startSem != null && startSem >= 6) {
      gaps.push("Internship started late (after mid-degree) — earlier (from 2nd semester) is stronger for placement");
    }
  } else {
    if (year === "FY") {
      gaps.push("Plan internship from 2nd semester — early industry exposure builds a strong placement profile");
      score -= 2;
    } else if (year === "SY") {
      gaps.push("No internship yet — target internship from 2nd semester for a strong profile");
      score -= 8;
    } else if (year === "TY" || year === "LY") {
      gaps.push("No internship logged — expected from 2nd semester onward; critical for drive readiness");
      score -= 14;
    } else {
      gaps.push("No internship logged — internships from 2nd semester strengthen the profile");
      score -= 8;
    }
  }

  if (doc.hackathons && String(doc.hackathons).trim()) score += 4;
  if (doc.buildathons && String(doc.buildathons).trim()) score += 3;
  if (doc.achievements && String(doc.achievements).trim()) score += 3;

  // Predicted academic status from HOD ML/rules if present on merged row
  const pred = String(doc.predictedStatus || doc.academicStatus || doc.statusAcademic || "").toLowerCase();
  if (pred.includes("risk")) {
    score -= 8;
    gaps.push("Academic early-warning: At Risk");
  } else if (pred.includes("good")) {
    score += 5;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let band = "Low";
  if (score >= 75 && kt === 0) band = "High";
  else if (score >= 55) band = "Medium";

  const employable =
    band === "High" ? "Likely employable" : band === "Medium" ? "Borderline — improve gaps" : "Not placement-ready yet";

  return { readinessScore: score, readinessBand: band, gaps, employablePrediction: employable };
}


function buildPreparationPlan(doc) {
  const year = normalizeYear(doc.yearLevel) || "FY";
  const actions = [];
  const explain = [];

  explain.push(
    year === "FY"
      ? "First Year is a preparation stage: build fundamentals and log early internships. Full domain prediction starts from Third Year."
      : year === "SY"
        ? "Second Year is a preparation stage: deepen DSA, projects, and at least one technical internship. Full domain prediction starts from Third Year."
        : "You are in a prediction-eligible year (Third Year or Last Year)."
  );

  if ((Number(doc.internshipCount) || 0) === 0 && !String(doc.internships || "").trim()) {
    actions.push("Plan a technical internship from 2nd semester onward (even 1–2 months helps).");
  } else if ((Number(doc.internshipCount) || 0) < 2) {
    actions.push("Add another technical internship aligned to your target domain (Data / Fullstack / Cloud / Security).");
  }

  const skills = [
    ["skillDsa", "Data Structures and Algorithms", 3],
    ["skillDbms", "Database systems", 3],
    ["skillCpp", "C++ or core programming", 3],
    ["skillAiml", "AI / ML awareness", 2],
  ];
  for (const [key, label, min] of skills) {
    const v = Number(doc[key]);
    if (!Number.isFinite(v) || v < min) {
      actions.push(`Raise ${label} (self-rate at least ${min}/5) with coursework or projects.`);
    }
  }

  if (doc.cgpa == null && doc.degreePercent == null) {
    actions.push("Keep semester CGPA updated — it becomes a core signal from Third Year.");
  } else if (Number(doc.cgpa) > 0 && Number(doc.cgpa) < 7) {
    actions.push("Aim to lift CGPA toward 7.5+ before Third Year placement drives.");
  }

  if ((Number(doc.activeKtCount) || 0) > 0) {
    actions.push("Clear active backlogs (KTs) — they block drive eligibility and mark the profile inconsistent.");
  }

  if (!doc.resumeUrl || !String(doc.resumeUrl).trim()) {
    actions.push("Maintain a one-page resume link (projects + internship bullets).");
  }

  if (doc.tenthPercent == null && doc.twelfthPercent == null && doc.diplomaPercent == null) {
    actions.push("Ensure 10th / 12th or diploma percentages are filled (System Admin Excel or your form).");
  }

  if (!actions.length) {
    actions.push("Continue projects and open-source or hackathons; re-check domain prediction after promotion to Third Year.");
  }

  return {
    stage: "preparation",
    predictionEligible: false,
    yearLevel: year,
    headline:
      year === "SY"
        ? "Preparation mode (Second Year) — domain prediction unlocks in Third Year"
        : "Preparation mode (First Year) — domain prediction unlocks in Third Year",
    explain,
    prepare: actions.slice(0, 8),
    dataSources: doc.dataSources || {},
  };
}

function enrich(doc) {
  const o = doc && doc.toObject ? doc.toObject() : { ...(doc || {}) };
  o.yearLevel = yearOf(o) || o.yearLevel || null;
  if (Array.isArray(o.marks) && o.marks.length) {
    const pack = computeTopicStrengthsFromMarks(o.marks);
    o.topicStrengths = pack.topics;
    o.topicBasicAvg = pack.basicTopicAvg;
    o.topicCoverage = pack.coverage;
    o.subjectTopicBreakdown = pack.subjectBreakdown;
    o.markTopicDsa = pack.topics.dsa?.level1to5 ?? null;
    o.markTopicDsaPct = pack.topics.dsa?.score100 ?? null;
    o.markTopicProg = pack.topics.programming?.level1to5 ?? null;
    o.markTopicProgPct = pack.topics.programming?.score100 ?? null;
    o.markTopicDbms = pack.topics.dbms?.level1to5 ?? null;
    o.markTopicDbmsPct = pack.topics.dbms?.score100 ?? null;
    o.markTopicAiml = pack.topics.aiml?.level1to5 ?? null;
    o.markTopicAimlPct = pack.topics.aiml?.score100 ?? null;
  }
  o.consistency = computeConsistency(o.activeKtCount);
  o.completenessScore = computeCompleteness(o);
  const r = computeReadiness(o);
  const tg = topicGaps(
    { topics: o.topicStrengths, basicTopicAvg: o.topicBasicAvg },
    { skillDsa: o.skillDsa, skillCpp: o.skillCpp, skillDbms: o.skillDbms, skillAiml: o.skillAiml }
  );
  let score = r.readinessScore;
  if (o.topicBasicAvg != null) {
    if (o.topicBasicAvg >= 70) score = Math.min(100, score + 8);
    else if (o.topicBasicAvg < 45) score = Math.max(0, score - 8);
  }
  o.readinessScore = score;
  o.readinessBand =
    score >= 75 && (Number(o.activeKtCount) || 0) === 0 ? "High" : score >= 55 ? "Medium" : "Low";
  o.gaps = [...r.gaps, ...tg];
  o.employablePrediction =
    o.readinessBand === "High"
      ? "Likely employable"
      : o.readinessBand === "Medium"
        ? "Borderline — improve gaps"
        : "Not placement-ready yet";
  o.driveReady = o.readinessBand === "High" && o.consistency === "consistent";
  const domains = suggestDomains(o);
  o.primaryDomain = o.tadeTopDomain || domains.primaryDomain;
  o.primaryDomainFit = domains.primaryFit;
  o.suggestedDomains =
    o.tadeProba && Object.keys(o.tadeProba).length
      ? Object.entries(o.tadeProba)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([domain, fit]) => ({
            domain,
            fitScore: Math.round(Number(fit) * 100),
            reasons: ["TADE"],
          }))
      : domains.suggestedDomains;
  o.domainSummary = domains.summary;
  o.dataSources = {
    student: Boolean(o.sourceProfile || o.updatedBy === o.prn || o.status === "submitted" || o.status === "verified"),
    excel: Boolean(o.sourceExcel || (o.customFields || []).some((c) => c && String(c.key || "").includes("cgpa_"))),
    academic: Boolean(o.sourceAcademic),
    background: Boolean(o.sourceBackground),
  };
  o.predictionEligible = isPlacementPredictionYear(o.yearLevel);
  o.placementMode = o.predictionEligible ? "prediction" : "preparation";

  if (!o.predictionEligible) {
    o.preparation = buildPreparationPlan(o);
    o.employablePrediction = "Preparation stage — full prediction from Third Year";
    o.driveReady = false;
    // Keep light domain hints from rules only as guidance, not TADE verdict
    o.tade = {
      top_domain: null,
      domain_set: [],
      readiness: null,
      source: "prep_only",
      uncertain: false,
      set_size: 0,
      probabilities: {},
      gap_plan: (o.preparation?.prepare || []).map((a) => ({ action: a })),
      mode: "preparation",
    };
  } else {
    o.preparation = null;
    o.tade = {
      top_domain: o.tadeTopDomain || null,
      domain_set: o.tadeDomainSet || [],
      readiness: o.tadeReadiness,
      source: o.tadeSource,
      uncertain: o.tadeUncertain,
      set_size: o.tadeSetSize,
      probabilities: o.tadeProba || {},
      gap_plan: o.tadeGapPlan || [],
      mode: "prediction",
    };
  }
  return o;
}

function pickBody(body) {
  const out = {};
  const map = {
    name: (v) => String(v),
    yearLevel: (v) => normalizeYear(v) || String(v || "") || null,
    batch: (v) => (v != null ? String(v) : null),
    cgpa: num,
    degreePercent: num,
    activeKtCount: (v) => Math.max(0, Number(v) || 0),
    ktDetails: (v) => String(v),
    tenthPercent: num,
    twelfthPercent: num,
    cetScore: num,
    jeeScore: num,
    internships: (v) => String(v),
    internshipCount: (v) => Math.max(0, Number(v) || 0),
    hackathons: (v) => String(v),
    buildathons: (v) => String(v),
    achievements: (v) => String(v),
    skillDsa: num,
    skillC: num,
    skillCpp: num,
    skillDbms: num,
    skillAiml: num,
    skillTags: (v) => String(v),
    resumeUrl: (v) => String(v),
    shareWithPlacement: (v) => !!v,
    coordinatorNote: (v) => String(v),
  };
  for (const [k, fn] of Object.entries(map)) {
    if (body[k] !== undefined) out[k] = fn(body[k]);
  }
  if (Array.isArray(body.customFields)) {
    out.customFields = body.customFields
      .map((c) => ({ key: String(c.key || "").trim(), value: String(c.value || "").trim() }))
      .filter((c) => c.key);
  }
  return out;
}

let _mergeCache = { at: 0, rows: null, light: null };

/** Invalidate after writes */
export function invalidatePlacementMergeCache() {
  _mergeCache = { at: 0, rows: null, light: null };
}

async function mergeSources(opts = {}) {
  const light = !!opts.light;
  const now = Date.now();
  if (_mergeCache.rows && now - _mergeCache.at < 15000 && _mergeCache.light === light) {
    return _mergeCache.rows;
  }

  const [profiles, academics, backgrounds] = await Promise.all([
    PlacementProfile.find({}).lean(),
    AcademicRecord.find({}).lean(),
    StudentBackground.find({}).lean(),
  ]);
  const byPrn = new Map();

  for (const a of academics) {
    const prn = String(a.prn || "").trim();
    if (!prn) continue;
    const topicPack = light
      ? { topics: {}, basicTopicAvg: null, coverage: 0, subjectBreakdown: [] }
      : computeTopicStrengthsFromMarks(a.marks || []);
    byPrn.set(prn, {
      prn,
      name: a.name || "",
      yearLevel: yearOf(a),
      admissionYear: a.admissionYear ?? null,
      cohortId: a.cohortId || null,
      batch: a.batch || null,
      cls: a.cls || a.className || "",
      cgpa: a.cgpa ?? null,
      degreePercent: a.averagePercentage ?? null,
      attendance: a.attendance ?? null,
      academicStatus: a.academicStatus || a.status || null,
      marks: light ? [] : a.marks || [],
      topicStrengths: topicPack.topics,
      topicBasicAvg: topicPack.basicTopicAvg,
      topicCoverage: topicPack.coverage,
      subjectTopicBreakdown: topicPack.subjectBreakdown,
      markTopicDsa: topicPack.topics.dsa?.level1to5 ?? null,
      markTopicDsaPct: topicPack.topics.dsa?.score100 ?? null,
      markTopicProg: topicPack.topics.programming?.level1to5 ?? null,
      markTopicProgPct: topicPack.topics.programming?.score100 ?? null,
      markTopicDbms: topicPack.topics.dbms?.level1to5 ?? null,
      markTopicDbmsPct: topicPack.topics.dbms?.score100 ?? null,
      markTopicAiml: topicPack.topics.aiml?.level1to5 ?? null,
      markTopicAimlPct: topicPack.topics.aiml?.score100 ?? null,
      sourceAcademic: true,
      status: "draft",
      activeKtCount: 0,
    });
  }

  for (const b of backgrounds) {
    const prn = String(b.prn || "").trim();
    if (!prn) continue;
    const prev = byPrn.get(prn) || { prn, status: "draft", activeKtCount: 0 };
    byPrn.set(prn, {
      ...prev,
      name: prev.name || b.name || "",
      yearLevel: prev.yearLevel || normalizeYear(b.yearLevel) || yearOf(b),
      batch: prev.batch || b.batch || null,
      tenthPercent: b.tenthPercent ?? prev.tenthPercent ?? null,
      twelfthPercent: b.twelfthPercent ?? prev.twelfthPercent ?? null,
      cetScore: b.cetScore ?? prev.cetScore ?? null,
      jeeScore: b.jeeScore ?? prev.jeeScore ?? null,
      sourceBackground: true,
    });
  }

  for (const p of profiles) {
    const prn = String(p.prn || "").trim();
    if (!prn) continue;
    const base = byPrn.get(prn) || { prn };
    // Profile fields win for student-entered placement data; keep live academic attendance/cgpa if profile empty
    byPrn.set(prn, {
      ...base,
      ...p,
      sourceProfile: true,
      sourceExcel: Boolean(p.sourceExcel) || base.sourceExcel,
      name: p.name || base.name || "",
      yearLevel: normalizeYear(p.yearLevel) || base.yearLevel || yearOf(p) || yearOf(base),
      admissionYear: p.admissionYear ?? base.admissionYear ?? null,
      cohortId: p.cohortId || base.cohortId || null,
      batch: p.batch || base.batch || null,
      cgpa: p.cgpa != null ? p.cgpa : base.cgpa ?? null,
      degreePercent: p.degreePercent != null ? p.degreePercent : base.degreePercent ?? null,
      attendance: base.attendance ?? null,
      academicStatus: base.academicStatus || null,
      marks: base.marks || [],
      topicStrengths: base.topicStrengths || null,
      topicBasicAvg: base.topicBasicAvg ?? null,
      topicCoverage: base.topicCoverage ?? null,
      subjectTopicBreakdown: base.subjectTopicBreakdown || [],
      markTopicDsa: base.markTopicDsa ?? null,
      markTopicDsaPct: base.markTopicDsaPct ?? null,
      markTopicProg: base.markTopicProg ?? null,
      markTopicProgPct: base.markTopicProgPct ?? null,
      markTopicDbms: base.markTopicDbms ?? null,
      markTopicDbmsPct: base.markTopicDbmsPct ?? null,
      markTopicAiml: base.markTopicAiml ?? null,
      markTopicAimlPct: base.markTopicAimlPct ?? null,
      tenthPercent: p.tenthPercent != null ? p.tenthPercent : base.tenthPercent ?? null,
      twelfthPercent: p.twelfthPercent != null ? p.twelfthPercent : base.twelfthPercent ?? null,
      cetScore: p.cetScore != null ? p.cetScore : base.cetScore ?? null,
      jeeScore: p.jeeScore != null ? p.jeeScore : base.jeeScore ?? null,
      sourceAcademic: !!base.sourceAcademic,
      sourceBackground: !!base.sourceBackground,
      sourceProfile: true,
    });
  }

  const rows = Array.from(byPrn.values()).map(enrich);
  _mergeCache = { at: Date.now(), rows, light };
  return rows;
}


function filterRows(rows, query) {
  let out = rows;
  const year = query.year && query.year !== "All" ? normalizeYear(query.year) || query.year : null;
  const batch = query.batch && query.batch !== "All" ? String(query.batch).toUpperCase() : null;
  const status = query.status && query.status !== "All" ? query.status : null;
  const consistency = query.consistency && query.consistency !== "All" ? query.consistency : null;
  const band = query.band && query.band !== "All" ? query.band : null;

  if (year) out = out.filter((r) => (r.yearLevel || "") === year);
  if (batch) {
    out = out.filter((r) => {
      const b = String(r.batch || "").toUpperCase();
      const cls = String(r.cls || "").toUpperCase();
      return b === batch || cls.includes(` ${batch}`) || cls.endsWith(batch);
    });
  }
  if (status) out = out.filter((r) => r.status === status);
  if (consistency) out = out.filter((r) => r.consistency === consistency);
  if (band) out = out.filter((r) => r.readinessBand === band);
  if (query.verifiedOnly === "1") {
    out = out.filter((r) => r.status === "verified" || r.status === "locked");
  }
  if (query.driveReady === "1") {
    out = out.filter((r) => r.driveReady);
  }
  if (query.missing === "1") {
    out = out.filter(
      (r) =>
        !r.resumeUrl ||
        (!r.internshipCount && !r.internships) ||
        r.cgpa == null ||
        r.skillDsa == null ||
        (r.completenessScore || 0) < 70 ||
        r.consistency === "inconsistent"
    );
  }
  return out;
}

function summarize(rows) {
  return {
    total: rows.length,
    submitted: rows.filter((r) => r.status === "submitted").length,
    verified: rows.filter((r) => r.status === "verified" || r.status === "locked").length,
    draft: rows.filter((r) => r.status === "draft" || r.status === "returned").length,
    inconsistent: rows.filter((r) => r.consistency === "inconsistent").length,
    high: rows.filter((r) => r.readinessBand === "High").length,
    medium: rows.filter((r) => r.readinessBand === "Medium").length,
    low: rows.filter((r) => r.readinessBand === "Low").length,
    driveReady: rows.filter((r) => r.driveReady).length,
    avgCompleteness: rows.length
      ? Math.round(rows.reduce((s, r) => s + (r.completenessScore || 0), 0) / rows.length)
      : 0,
    avgReadiness: rows.length
      ? Math.round(rows.reduce((s, r) => s + (r.readinessScore || 0), 0) / rows.length)
      : 0,
    missingResume: rows.filter((r) => !r.resumeUrl).length,
    missingInternship: rows.filter((r) => !r.internshipCount && !r.internships).length,
  };
}

async function seedFromExisting(prn, nameHint) {
  const bg = await StudentBackground.findOne({ prn }).lean();
  const ac = await AcademicRecord.findOne({ prn }).lean();
  return {
    prn,
    name: nameHint || ac?.name || bg?.name || "",
    yearLevel: yearOf(ac || {}) || normalizeYear(bg?.yearLevel) || null,
    batch: ac?.batch || bg?.batch || null,
    tenthPercent: bg?.tenthPercent ?? null,
    twelfthPercent: bg?.twelfthPercent ?? null,
    cetScore: bg?.cetScore ?? null,
    jeeScore: bg?.jeeScore ?? null,
    cgpa: ac?.cgpa ?? null,
    degreePercent: ac?.averagePercentage ?? null,
    attendance: ac?.attendance ?? null,
  };
}


/** Call TADE ML service (trajectory-aware domain engine). */
async function callTade(path, body) {
  const base = (process.env.ML_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || data.error || "TADE request failed");
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function profileToTadeBody(merged) {
  const interns = [];
  if (Array.isArray(merged.internshipList)) {
    for (const it of merged.internshipList.slice(0, 3)) {
      interns.push({
        role: it.role || it.title || "",
        type: it.type || "Technical",
        months: it.months || it.duration || 2,
      });
    }
  } else if (String(merged.internships || "").trim()) {
    interns.push({ role: String(merged.internships).slice(0, 120), type: "Technical", months: 2 });
  }
  const year = normalizeYear(merged.yearLevel || merged.year || merged.cls) || merged.yearLevel || null;
  const order = { FY: 0, SY: 1, TY: 2, LY: 3 };
  const yi = order[year] ?? 3;
  // Year-mask: never send future CGPA columns past current year
  const body = {
    year,
    yearLevel: year,
    tenthPercent: merged.tenthPercent ?? merged.ssc_pct ?? null,
    twelfthPercent: merged.twelfthPercent ?? null,
    diplomaPercent: merged.diplomaPercent ?? null,
    entrance_score:
      merged.cetScore ?? merged.cetPercent ?? merged.jeeScore ?? merged.jeePercent ?? merged.entrance_score ?? null,
    entrance_exam:
      merged.cetScore != null || merged.cetPercent != null
        ? "MHT-CET"
        : merged.jeeScore != null || merged.jeePercent != null
          ? "JEE Main"
          : null,
    skillC: scaleSkill(merged.skillC),
    skillCpp: scaleSkill(merged.skillCpp),
    skillJava: scaleSkill(merged.skillOop ?? merged.skillJava),
    skillDsa: scaleSkill(merged.skillDsa),
    skillDbms: scaleSkill(merged.skillDbms),
    skillCn: scaleSkill(merged.skillCn),
    skillPython: scaleSkill(merged.skillPython ?? merged.skillAiml),
    skillAi: scaleSkill(merged.skillAi ?? merged.skillAiml),
    skillMl: scaleSkill(merged.skillMl),
    skillDl: scaleSkill(merged.skillDl),
    n_internships: Number(merged.internshipCount) || interns.length || 0,
    internships: interns,
  };
  // CGPA path — only unlocked years (map 1-5 skill style cgpa stays 0-10)
  if (yi >= 0 && merged.cgpaFy != null) body.cgpa_fy = num(merged.cgpaFy);
  if (yi >= 1 && merged.cgpaSy != null) body.cgpa_sy = num(merged.cgpaSy);
  if (yi >= 2 && merged.cgpaTy != null) body.cgpa_ty = num(merged.cgpaTy);
  if (yi >= 3 && merged.cgpaLy != null) body.cgpa_ly = num(merged.cgpaLy);
  // single cgpa field only as latest unlocked
  const cg = num(merged.cgpa);
  if (cg != null) {
    if (yi >= 3) body.cgpa_ly = body.cgpa_ly ?? cg;
    else if (yi >= 2) body.cgpa_ty = body.cgpa_ty ?? cg;
    else if (yi >= 1) body.cgpa_sy = body.cgpa_sy ?? cg;
    else body.cgpa_fy = body.cgpa_fy ?? cg;
    body.cgpa = cg;
  }
  return body;
}

/** Skills in portal are often 1–5; TADE training used 0–100. */
function scaleSkill(v) {
  const n = num(v);
  if (n == null) return null;
  if (n <= 5) return Math.round(n * 20 * 10) / 10;
  return n;
}

function applyTadeToDoc(patch, tade) {
  if (!tade || tade.error) return patch;
  const set = Array.isArray(tade.domain_set) ? tade.domain_set : [];
  patch.tadeTopDomain = tade.top_domain || null;
  patch.tadeDomainSet = set;
  patch.tadeReadiness = tade.readiness != null ? Number(tade.readiness) : null;
  patch.tadeProba = tade.probabilities || {};
  patch.tadeSource = tade.source || null;
  patch.tadeSetSize = set.length;
  patch.tadeUncertain = set.length >= 3;
  patch.tadeUpdatedAt = new Date();
  // Blend readiness: prefer max of rule score and TADE readiness lightly
  if (patch.tadeReadiness != null && patch.readinessScore != null) {
    patch.readinessScore = Math.round(0.55 * Number(patch.readinessScore) + 0.45 * Number(patch.tadeReadiness));
    patch.readinessBand =
      patch.readinessScore >= 75 && (Number(patch.activeKtCount) || 0) === 0
        ? "High"
        : patch.readinessScore >= 55
          ? "Medium"
          : "Low";
  } else if (patch.tadeReadiness != null) {
    patch.readinessScore = Math.round(Number(patch.tadeReadiness));
  }
  if (tade.top_domain) {
    patch.primaryDomain = tade.top_domain;
    patch.suggestedDomains = Object.entries(tade.probabilities || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, fit]) => ({ domain, fitScore: Math.round(fit * 100), reasons: ["TADE"] }));
  }
  return patch;
}

async function runTadeForMerged(merged) {
  let payload = profileToTadeBody(merged);
  payload = applyYearLockToPayload(payload, payload.yearLevel || merged.yearLevel);
  try {
    const tade = await callTade("/placement/tade/predict", payload);
    let gap = null;
    try {
      gap = await callTade("/placement/tade/gap-plan", { ...payload, target_domain: undefined });
    } catch {
      gap = null;
    }
    return { tade, gap, payload };
  } catch (e) {
    return { tade: null, gap: null, payload, error: e.message };
  }
}

export function registerPlacementRoutes(app) {
  app.get("/api/placement/me", requireAuth, requireStudent, async (req, res) => {
    try {
      const prn = req.auth.id;
      let doc = await PlacementProfile.findOne({ prn });
      if (!doc) {
        const seed = await seedFromExisting(prn, req.auth.name);
        doc = await PlacementProfile.create(seed);
      }
      const ac = await AcademicRecord.findOne({ prn }).lean();
      const merged = enrich({
        ...(doc.toObject ? doc.toObject() : doc),
        attendance: ac?.attendance ?? null,
        academicStatus: ac?.academicStatus || ac?.status || null,
        degreePercent: doc.degreePercent ?? ac?.averagePercentage ?? null,
        cgpa: doc.cgpa ?? ac?.cgpa ?? null,
        marks: ac?.marks || [],
      });
      res.json({ profile: merged });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/placement/me", requireAuth, requireStudent, async (req, res) => {
    try {
      const prn = req.auth.id;
      const patch = pickBody(req.body || {});
      const submit = !!req.body?.submit;
      if (submit) {
        patch.status = "submitted";
        patch.submittedAt = new Date();
      }
      patch.updatedBy = prn;

      let doc = await PlacementProfile.findOne({ prn });
      if (!doc) {
        const seed = await seedFromExisting(prn, req.auth.name);
        await PlacementProfile.create({ ...seed, ...patch, prn });
        doc = await PlacementProfile.findOne({ prn });
      } else {
        if (doc.status === "locked") {
          return res.status(400).json({ error: "Profile is locked for a drive. Contact the placement coordinator." });
        }
        if (doc.status === "verified" && !submit) patch.status = "draft";
        Object.assign(doc, patch);
        await doc.save();
        doc = await PlacementProfile.findOne({ prn });
      }

      const ac = await AcademicRecord.findOne({ prn }).lean();
      const bg = await StudentBackground.findOne({ prn }).lean();
      const base = {
        ...(bg || {}),
        ...(doc.toObject ? doc.toObject() : doc),
        attendance: ac?.attendance ?? doc.attendance ?? null,
        academicStatus: ac?.academicStatus || ac?.status || null,
        marks: ac?.marks || [],
      };
      const e = enrich(base);

      // TADE only from Third Year / Last Year; FY/SY get preparation plan
      const tadeSet = {
        consistency: e.consistency,
        completenessScore: e.completenessScore,
        readinessScore: e.readinessScore,
        readinessBand: e.readinessBand,
        gaps: e.gaps,
        yearLevel: e.yearLevel,
        academicStatus: e.academicStatus || null,
        academicAttendance: e.attendance != null ? Number(e.attendance) : null,
        sourceProfile: true,
      };
      if (isPlacementPredictionYear(e.yearLevel)) {
        try {
          const { tade, gap } = await runTadeForMerged({ ...base, ...e });
          if (tade) {
            applyTadeToDoc(tadeSet, tade);
            if (gap?.gap_plan) tadeSet.tadeGapPlan = gap.gap_plan.slice(0, 5);
          }
        } catch (err) {
          console.warn("[placement] TADE on save", err.message);
        }
      } else {
        const prep = buildPreparationPlan({ ...base, ...e });
        tadeSet.tadeTopDomain = null;
        tadeSet.tadeDomainSet = [];
        tadeSet.tadeSource = "prep_only";
        tadeSet.tadeGapPlan = (prep.prepare || []).map((a) => ({ action: a }));
        tadeSet.tadeReadiness = null;
      }

      await PlacementProfile.updateOne({ prn }, { $set: tadeSet });
      const fresh = await PlacementProfile.findOne({ prn }).lean();
      res.json({ profile: enrich({ ...fresh, attendance: base.attendance, marks: base.marks }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Unified grid: Excel cohort + background + placement form (dynamic predictions) */
  /* profiles list uses light merge */
  app.get("/api/placement/profiles", requireAuth, requirePlacementStaff, async (req, res) => {
    try {
      let rows = await mergeSources({ light: true });
      const years = [...new Set(rows.map((r) => r.yearLevel).filter(Boolean))].sort();
      const batches = [...new Set(rows.map((r) => r.batch).filter(Boolean))].sort();
      rows = filterRows(rows, req.query);
      // Queue / shortlist: readiness first, uncertain conformal sets next, then PRN
      rows.sort((a, b) => {
        const rb = (b.readinessScore || 0) - (a.readinessScore || 0);
        if (rb !== 0) return rb;
        const ua = a.tadeUncertain ? 1 : 0;
        const ub = b.tadeUncertain ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return String(a.prn).localeCompare(String(b.prn));
      });
      res.json({
        profiles: rows,
        summary: summarize(rows),
        years,
        batches,
        columns: [
          "prn",
          "name",
          "yearLevel",
          "batch",
          "status",
          "consistency",
          "employablePrediction",
          "readinessBand",
          "readinessScore",
          "tadeTopDomain",
          "tadeDomainSet",
          "tadeReadiness",
          "tadeUncertain",
          "academicStatus",
          "completenessScore",
          "cgpa",
          "attendance",
          "activeKtCount",
          "skillDsa",
          "skillDbms",
          "skillAiml",
          "internshipCount",
          "resumeUrl",
          "tenthPercent",
          "twelfthPercent",
          "cetScore",
          "jeeScore",
        ],
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/placement/profiles/:prn", requireAuth, requirePlacementStaff, async (req, res) => {
    try {
      const rows = await mergeSources();
      const profile = rows.find((r) => String(r.prn) === String(req.params.prn));
      if (!profile) return res.status(404).json({ error: "Profile not found." });
      res.json({ profile });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Materialize placement shells from HOD Excel cohort so coordinator sees everyone */
  app.post("/api/placement/sync-from-cohort", requireAuth, requirePlacementCoordinator, async (req, res) => {
    try {
      const academics = await AcademicRecord.find({}).lean();
      let created = 0;
      let updated = 0;
      for (const a of academics) {
        const prn = String(a.prn || "").trim();
        if (!prn) continue;
        const bg = await StudentBackground.findOne({ prn }).lean();
        const existing = await PlacementProfile.findOne({ prn }).lean();
        const seed = {
          name: a.name || bg?.name || "",
          yearLevel: yearOf(a) || normalizeYear(bg?.yearLevel),
          batch: a.batch || bg?.batch || null,
          cgpa: existing?.cgpa ?? a.cgpa ?? null,
          degreePercent: existing?.degreePercent ?? a.averagePercentage ?? null,
          tenthPercent: existing?.tenthPercent ?? bg?.tenthPercent ?? null,
          twelfthPercent: existing?.twelfthPercent ?? bg?.twelfthPercent ?? null,
          cetScore: existing?.cetScore ?? bg?.cetScore ?? null,
          jeeScore: existing?.jeeScore ?? bg?.jeeScore ?? null,
        };
        if (!existing) {
          const doc = await PlacementProfile.create({ prn, ...seed, status: "draft" });
          const e = enrich(doc);
          await PlacementProfile.updateOne(
            { prn },
            {
              $set: {
                consistency: e.consistency,
                completenessScore: e.completenessScore,
                readinessScore: e.readinessScore,
                readinessBand: e.readinessBand,
                gaps: e.gaps,
              },
            }
          );
          created += 1;
        } else {
          await PlacementProfile.updateOne(
            { prn },
            {
              $set: {
                name: existing.name || seed.name,
                yearLevel: existing.yearLevel || seed.yearLevel,
                batch: existing.batch || seed.batch,
                ...(existing.cgpa == null && seed.cgpa != null ? { cgpa: seed.cgpa } : {}),
                ...(existing.degreePercent == null && seed.degreePercent != null
                  ? { degreePercent: seed.degreePercent }
                  : {}),
              },
            }
          );
          updated += 1;
        }
      }
      await writeAudit(req.auth.id, "placement.sync_cohort", { created, updated });
      res.json({ ok: true, created, updated, totalAcademic: academics.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/placement/profiles/:prn/status", requireAuth, requirePlacementCoordinator, async (req, res) => {
    try {
      const prn = req.params.prn;
      const status = String(req.body?.status || "").toLowerCase();
      if (!["verified", "returned", "locked", "submitted", "draft"].includes(status)) {
        return res.status(400).json({ error: "Invalid status." });
      }
      const note = req.body?.coordinatorNote != null ? String(req.body.coordinatorNote) : undefined;
      let doc = await PlacementProfile.findOne({ prn });
      if (!doc) {
        const seed = await seedFromExisting(prn);
        doc = await PlacementProfile.create({ ...seed, prn, status: "draft" });
      }
      const set = { status, updatedBy: req.auth.id };
      if (note !== undefined) set.coordinatorNote = note;
      if (status === "verified") {
        set.verifiedBy = req.auth.id;
        set.verifiedAt = new Date();
      }
      doc = await PlacementProfile.findOneAndUpdate({ prn }, { $set: set }, { new: true });
      await writeAudit(req.auth.id, "placement.status", { prn, status });
      res.json({ profile: enrich(doc) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/placement/profiles/bulk-status", requireAuth, requirePlacementCoordinator, async (req, res) => {
    try {
      const prns = Array.isArray(req.body?.prns) ? req.body.prns.map(String) : [];
      const status = String(req.body?.status || "").toLowerCase();
      if (!prns.length) return res.status(400).json({ error: "prns required" });
      if (!["verified", "returned", "locked"].includes(status)) {
        return res.status(400).json({ error: "invalid status" });
      }
      const set = { status, updatedBy: req.auth.id };
      if (status === "verified") {
        set.verifiedBy = req.auth.id;
        set.verifiedAt = new Date();
      }
      for (const prn of prns) {
        const exists = await PlacementProfile.findOne({ prn }).lean();
        if (!exists) {
          const seed = await seedFromExisting(prn);
          await PlacementProfile.create({ ...seed, prn, ...set });
        } else {
          await PlacementProfile.updateOne({ prn }, { $set: set });
        }
      }
      invalidatePlacementMergeCache();
      res.json({ ok: true, modified: prns.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/placement/dashboard", requireAuth, requirePlacementHead, async (req, res) => {
    try {
      let rows = await mergeSources({ light: true });
      if (req.query.year && req.query.year !== "All") {
        rows = filterRows(rows, { year: req.query.year });
      }
      const byYear = {};
      for (const r of rows) {
        const y = r.yearLevel || "Unknown";
        if (!byYear[y]) byYear[y] = { total: 0, high: 0, verified: 0, inconsistent: 0, driveReady: 0 };
        byYear[y].total += 1;
        if (r.readinessBand === "High") byYear[y].high += 1;
        if (r.status === "verified" || r.status === "locked") byYear[y].verified += 1;
        if (r.consistency === "inconsistent") byYear[y].inconsistent += 1;
        if (r.driveReady) byYear[y].driveReady += 1;
      }
      const gapCount = {};
      for (const r of rows) for (const g of r.gaps || []) gapCount[g] = (gapCount[g] || 0) + 1;
      res.json({
        summary: summarize(rows),
        byYear,
        topGaps: Object.entries(gapCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([gap, count]) => ({ gap, count })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });


  /** Skill heatmap + batch percentiles (dynamic analytics) */
  app.get("/api/placement/analytics/skills", requireAuth, requirePlacementStaff, async (req, res) => {
    try {
      let rows = await mergeSources({ light: true });
      rows = filterRows(rows, req.query);
      const skillKeys = [
        ["skillDsa", "DSA"],
        ["skillC", "C"],
        ["skillCpp", "C++"],
        ["skillDbms", "DBMS"],
        ["skillAiml", "AI/ML"],
      ];
      const heatmap = skillKeys.map(([key, label]) => {
        const vals = rows.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
        const buckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const v of vals) {
          const b = Math.min(5, Math.max(1, Math.round(v)));
          buckets[b] += 1;
        }
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        return { key, label, avg: avg != null ? Math.round(avg * 10) / 10 : null, rated: vals.length, buckets };
      });

      // Percentile of readiness within year (and batch if set)
      const scored = rows
        .filter((r) => r.readinessScore != null)
        .map((r) => ({ prn: r.prn, name: r.name, yearLevel: r.yearLevel, batch: r.batch, readinessScore: r.readinessScore }))
        .sort((a, b) => b.readinessScore - a.readinessScore);
      const n = scored.length || 1;
      const withPct = scored.map((r, i) => ({
        ...r,
        rank: i + 1,
        percentile: Math.round(((n - i) / n) * 100),
      }));

      const byYearBatch = {};
      for (const r of rows) {
        const k = `${r.yearLevel || "?"} / ${r.batch || "All"}`;
        if (!byYearBatch[k]) byYearBatch[k] = { total: 0, driveReady: 0, inconsistent: 0, avgScore: 0, sum: 0 };
        byYearBatch[k].total += 1;
        byYearBatch[k].sum += r.readinessScore || 0;
        if (r.driveReady) byYearBatch[k].driveReady += 1;
        if (r.consistency === "inconsistent") byYearBatch[k].inconsistent += 1;
      }
      for (const k of Object.keys(byYearBatch)) {
        const o = byYearBatch[k];
        o.avgScore = o.total ? Math.round(o.sum / o.total) : 0;
        delete o.sum;
      }

      res.json({ heatmap, leaderboard: withPct.slice(0, 50), byYearBatch, count: rows.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Auto-draft reminder messages for missing data (coordinator copies / sends) */
  app.post("/api/placement/reminders/draft", requireAuth, requirePlacementCoordinator, async (req, res) => {
    try {
      let rows = await mergeSources();
      rows = filterRows(rows, { ...req.body, missing: "1" });
      const prns = Array.isArray(req.body?.prns) ? req.body.prns.map(String) : null;
      if (prns?.length) rows = rows.filter((r) => prns.includes(String(r.prn)));

      const drafts = rows.slice(0, 100).map((r) => {
        const missing = [];
        if (!r.resumeUrl) missing.push("resume link");
        if (!r.internshipCount && !r.internships) missing.push("internship details");
        if (r.cgpa == null) missing.push("CGPA");
        if (r.skillDsa == null) missing.push("DSA skill rating");
        if (r.skillDbms == null) missing.push("DBMS skill rating");
        if ((r.completenessScore || 0) < 70) missing.push(`profile completeness (now ${r.completenessScore || 0}%)`);
        if (r.consistency === "inconsistent") missing.push(`clear ${r.activeKtCount || ""} active KT(s)`);
        const list = missing.length ? missing.join(", ") : "pending placement profile fields";
        const text = `Dear ${r.name || "Student"} (PRN ${r.prn}),\n\nPlease update your Placement Profile on BVU Portal. Pending: ${list}.\n\nThis is required for placement drives.\n\n— Placement Coordinator`;
        return { prn: r.prn, name: r.name, yearLevel: r.yearLevel, missing, text };
      });
      res.json({ count: drafts.length, drafts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** CSV export of current filter (Excel-friendly) */
  app.get("/api/placement/export.csv", requireAuth, requirePlacementStaff, async (req, res) => {
    try {
      let rows = await mergeSources();
      rows = filterRows(rows, req.query);
      const headers = [
        "prn", "name", "yearLevel", "batch", "status", "consistency", "employablePrediction",
        "readinessBand", "readinessScore", "completenessScore", "cgpa", "attendance", "activeKtCount",
        "skillDsa", "skillC", "skillCpp", "skillDbms", "skillAiml", "internshipCount", "resumeUrl",
        "tenthPercent", "twelfthPercent", "cetScore", "jeeScore", "gaps",
      ];
      const esc = (v) => {
        const s = v == null ? "" : String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const lines = [headers.join(",")];
      for (const r of rows) {
        lines.push(headers.map((h) => esc(h === "gaps" ? (r.gaps || []).join("; ") : r[h])).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=placement_export.csv");
      res.send(lines.join("\n"));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Mock interview nomination queue */
  app.post("/api/placement/mock-interview/nominate", requireAuth, requirePlacementStaff, async (req, res) => {
    try {
      const prns = Array.isArray(req.body?.prns) ? req.body.prns.map(String) : [];
      const note = String(req.body?.note || "Nominated for mock interview");
      if (!prns.length) return res.status(400).json({ error: "prns required" });
      let n = 0;
      for (const prn of prns) {
        const row = (await mergeSources()).find((r) => String(r.prn) === prn);
        let doc = await PlacementProfile.findOne({ prn });
        if (!doc) {
          const seed = await seedFromExisting(prn, row?.name);
          doc = await PlacementProfile.create({ ...seed, prn });
        }
        const cf = Array.isArray(doc.customFields) ? [...doc.customFields] : [];
        const filtered = cf.filter((c) => c.key !== "mockInterview");
        filtered.push({ key: "mockInterview", value: note });
        doc.customFields = filtered;
        doc.coordinatorNote = doc.coordinatorNote
          ? `${doc.coordinatorNote}\n[Mock interview] ${note}`
          : `[Mock interview] ${note}`;
        await doc.save();
        n += 1;
      }
      await writeAudit(req.auth.id, "placement.mock_interview", { count: n });
      res.json({ ok: true, nominated: n });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/placement/mock-interview", requireAuth, requirePlacementStaff, async (req, res) => {
    try {
      let rows = await mergeSources();
      rows = filterRows(rows, req.query);
      const nominated = rows.filter((r) =>
        (r.customFields || []).some((c) => c.key === "mockInterview") ||
        String(r.coordinatorNote || "").includes("[Mock interview]")
      );
      res.json({
        profiles: nominated.map((r) => ({
          ...r,
          mockNote:
            (r.customFields || []).find((c) => c.key === "mockInterview")?.value ||
            "Nominated",
        })),
        count: nominated.length,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Freeze / unfreeze a year for drives (locks all verified in year) */
  app.post("/api/placement/freeze-year", requireAuth, requirePlacementHead, async (req, res) => {
    try {
      const year = String(req.body?.year || "").toUpperCase();
      const action = String(req.body?.action || "freeze"); // freeze | unfreeze
      if (!["FY", "SY", "TY", "LY"].includes(year)) {
        return res.status(400).json({ error: "year must be FY, SY, TY, or LY" });
      }
      const rows = filterRows(await mergeSources(), { year });
      let n = 0;
      for (const r of rows) {
        if (!r.prn) continue;
        if (action === "freeze") {
          if (r.status === "verified" || r.status === "submitted" || r.status === "locked") {
            await PlacementProfile.findOneAndUpdate(
              { prn: r.prn },
              { $set: { status: "locked", updatedBy: req.auth.id } },
              { upsert: false }
            );
            n += 1;
          }
        } else {
          if (r.status === "locked") {
            await PlacementProfile.updateOne(
              { prn: r.prn },
              { $set: { status: "verified", updatedBy: req.auth.id } }
            );
            n += 1;
          }
        }
      }
      await writeAudit(req.auth.id, "placement.freeze_year", { year, action, n });
      res.json({ ok: true, year, action, affected: n });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Leaderboard for a year */
  app.get("/api/placement/leaderboard", requireAuth, requirePlacementStaff, async (req, res) => {
    try {
      let rows = filterRows(await mergeSources(), req.query);
      rows = rows
        .map((r) => enrich(r))
        .sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));
      const n = rows.length || 1;
      res.json({
        leaderboard: rows.slice(0, 100).map((r, i) => ({
          rank: i + 1,
          percentile: Math.round(((n - i) / n) * 100),
          prn: r.prn,
          name: r.name,
          yearLevel: r.yearLevel,
          batch: r.batch,
          readinessScore: r.readinessScore,
          readinessBand: r.readinessBand,
          employablePrediction: r.employablePrediction,
          consistency: r.consistency,
          driveReady: r.driveReady,
        })),
        count: rows.length,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });


  app.get("/api/placement/tade/health", requirePlacementStaff, async (_req, res) => {
    try {
      const base = (process.env.ML_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
      const r = await fetch(`${base}/placement/tade/health`);
      const data = await r.json().catch(() => ({}));
      res.json(data);
    } catch (e) {
      res.json({ ready: false, error: e.message });
    }
  });

  app.post("/api/placement/tade/predict", requireAuth, async (req, res) => {
    try {
      const data = await callTade("/placement/tade/predict", req.body || {});
      res.json(data);
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "TADE predict failed", source: "error" });
    }
  });

  app.post("/api/placement/tade/gap-plan", requireAuth, async (req, res) => {
    try {
      const data = await callTade("/placement/tade/gap-plan", req.body || {});
      res.json(data);
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "TADE gap-plan failed" });
    }
  });

  app.post("/api/placement/tade/predict-profile", requirePlacementStaff, async (req, res) => {
    try {
      const prn = String(req.body?.prn || "").trim();
      if (!prn) return res.status(400).json({ error: "prn required" });
      const profile = await PlacementProfile.findOne({ prn }).lean();
      const bg = await StudentBackground.findOne({ prn }).lean();
      const academic = await AcademicRecord.findOne({ prn }).lean();
      const merged = { ...(academic || {}), ...(bg || {}), ...(profile || {}), prn };
      const payload = profileToTadeBody(merged);
      const data = await callTade("/placement/tade/predict", payload);
      res.json({ prn, name: merged.name || profile?.name, tade: data, payload });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "TADE profile predict failed" });
    }
  });


  /** Batch TADE score for year/batch (verified by default). */
  app.post("/api/placement/tade/batch", requirePlacementStaff, async (req, res) => {
    try {
      const year = req.body?.year || req.query?.year || "All";
      const batch = req.body?.batch || req.query?.batch || "All";
      const verifiedOnly = req.body?.verifiedOnly !== false;
      let rows = await mergeSources();
      rows = filterRows(rows, {
        year: year === "All" ? undefined : year,
        batch: batch === "All" ? undefined : batch,
        verifiedOnly: verifiedOnly ? "1" : undefined,
      });
      const out = [];
      for (const row of rows) {
        if (!isPlacementPredictionYear(row.yearLevel)) {
          out.push({
            prn: row.prn,
            name: row.name,
            yearLevel: row.yearLevel,
            batch: row.batch,
            skipped: true,
            reason: "Preparation stage — TADE prediction starts from Third Year",
            preparation: buildPreparationPlan(row),
          });
          continue;
        }
        const { tade, gap, error } = await runTadeForMerged(row);
        const patch = {};
        if (tade) {
          applyTadeToDoc(patch, tade);
          if (gap?.gap_plan) patch.tadeGapPlan = gap.gap_plan.slice(0, 5);
          await PlacementProfile.updateOne({ prn: row.prn }, { $set: patch }, { upsert: false });
        }
        out.push({
          prn: row.prn,
          name: row.name,
          yearLevel: row.yearLevel,
          batch: row.batch,
          academicStatus: row.academicStatus || row.status,
          attendance: row.attendance,
          readinessScore: patch.readinessScore ?? row.readinessScore,
          readinessBand: patch.readinessBand ?? row.readinessBand,
          tadeTopDomain: patch.tadeTopDomain || null,
          tadeDomainSet: patch.tadeDomainSet || [],
          tadeReadiness: patch.tadeReadiness ?? null,
          tadeUncertain: patch.tadeUncertain || false,
          error: error || null,
        });
      }
      out.sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));
      res.json({ ok: true, count: out.length, year, batch, profiles: out });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Shortlist export CSV with TADE fields */
  app.get("/api/placement/tade/shortlist.csv", requirePlacementStaff, async (req, res) => {
    try {
      let rows = await mergeSources({ light: true });
      rows = filterRows(rows, req.query);
      rows.sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));
      const headers = [
        "prn", "name", "yearLevel", "batch", "readinessScore", "readinessBand",
        "tadeTopDomain", "tadeDomainSet", "tadeReadiness", "tadeUncertain",
        "academicStatus", "attendance", "consistency", "employablePrediction",
      ];
      const esc = (v) => {
        const s = v == null ? "" : String(Array.isArray(v) ? v.join("|") : v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.join(",")];
      for (const r of rows) {
        lines.push(headers.map((h) => esc(r[h])).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=tade_shortlist.csv");
      res.send(lines.join("\n"));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Light domain ↔ drive matching */
  app.post("/api/placement/drives/match", requirePlacementStaff, async (req, res) => {
    try {
      const driveDomain = String(req.body?.domain || req.body?.driveDomain || "").trim();
      const minReady = Number(req.body?.minReadiness ?? 55);
      if (!driveDomain) return res.status(400).json({ error: "domain required (e.g. Fullstack, Data Scientist)" });
      let rows = await mergeSources();
      rows = filterRows(rows, req.body || {});
      const matched = rows.filter((r) => {
        const set = r.tadeDomainSet || [];
        const top = r.tadeTopDomain || r.primaryDomain;
        const inSet = set.includes(driveDomain) || top === driveDomain;
        const ready = (r.readinessScore || 0) >= minReady;
        return inSet && ready;
      });
      matched.sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));
      res.json({
        domain: driveDomain,
        minReadiness: minReady,
        count: matched.length,
        students: matched.map((r) => ({
          prn: r.prn,
          name: r.name,
          yearLevel: r.yearLevel,
          batch: r.batch,
          readinessScore: r.readinessScore,
          tadeTopDomain: r.tadeTopDomain,
          tadeDomainSet: r.tadeDomainSet,
          academicStatus: r.academicStatus,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Gap plan → intervention task list (stored on profile + returned for agents) */
  app.post("/api/placement/tade/gap-to-interventions", requirePlacementStaff, async (req, res) => {
    try {
      const prn = String(req.body?.prn || "").trim();
      if (!prn) return res.status(400).json({ error: "prn required" });
      const doc = await PlacementProfile.findOne({ prn }).lean();
      if (!doc) return res.status(404).json({ error: "Profile not found" });
      let plan = doc.tadeGapPlan || [];
      if (!plan.length) {
        const { gap } = await runTadeForMerged(doc);
        plan = gap?.gap_plan || [];
        if (plan.length) {
          await PlacementProfile.updateOne({ prn }, { $set: { tadeGapPlan: plan.slice(0, 5) } });
        }
      }
      const tasks = plan.slice(0, 5).map((g, i) => ({
        id: `${prn}-tade-${i}`,
        prn,
        name: doc.name,
        source: "tade_gap_plan",
        title: g.action,
        status: "open",
        dueDays: 30,
        meta: {
          target_domain_prob_delta: g.target_domain_prob_delta,
          readiness_delta: g.readiness_delta,
          new_top: g.new_top,
        },
      }));
      await writeAudit({
        action: "placement.tade.gap_interventions",
        actor: req.auth?.id,
        detail: { prn, n: tasks.length },
      });
      res.json({ ok: true, prn, tasks });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Messaging targets: low readiness + weak academic */
  app.get("/api/placement/tade/message-targets", requirePlacementStaff, async (req, res) => {
    try {
      let rows = await mergeSources();
      rows = filterRows(rows, req.query);
      const targets = rows.filter((r) => {
        const low = (r.readinessBand || "") === "Low" || (r.readinessScore || 0) < 55;
        const risk =
          String(r.academicStatus || "").toLowerCase().includes("risk") ||
          (r.attendance != null && Number(r.attendance) < 75);
        return low || risk;
      });
      res.json({
        count: targets.length,
        students: targets.map((r) => ({
          prn: r.prn,
          name: r.name,
          yearLevel: r.yearLevel,
          batch: r.batch,
          readinessBand: r.readinessBand,
          readinessScore: r.readinessScore,
          academicStatus: r.academicStatus,
          attendance: r.attendance,
          phone: r.phone || r.parentPhone || null,
          email: r.email || null,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** System health for handover */
  app.get("/api/placement/system-health", requirePlacementStaff, async (_req, res) => {
    const base = (process.env.ML_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
    let ml = { ok: false };
    let tade = { ready: false };
    try {
      const r = await fetch(`${base}/health`);
      ml = { ok: r.ok, ...(await r.json().catch(() => ({}))) };
    } catch (e) {
      ml = { ok: false, error: e.message };
    }
    try {
      const r = await fetch(`${base}/placement/tade/health`);
      tade = await r.json().catch(() => ({ ready: false }));
    } catch (e) {
      tade = { ready: false, error: e.message };
    }
    const profiles = await PlacementProfile.countDocuments();
    const verified = await PlacementProfile.countDocuments({ status: "verified" });
    const withTade = await PlacementProfile.countDocuments({ tadeTopDomain: { $ne: null } });
    res.json({
      mongo: true,
      ml,
      tade,
      messaging: {
        brevo: Boolean(process.env.BREVO_API_KEY),
        twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      },
      counts: { profiles, verified, withTade },
      roles: ["system_admin", "admin", "teacher_guide", "student", "placement_coordinator", "placement_head"],
    });
  });

  /** Simple drift vs training medians (skills/CGPA) */
  app.get("/api/placement/tade/drift", requirePlacementStaff, async (_req, res) => {
    try {
      const rows = await PlacementProfile.find({}).lean();
      const avg = (key) => {
        const vals = rows.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
        if (!vals.length) return null;
        return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
      };
      res.json({
        n: rows.length,
        live: {
          cgpa: avg("cgpa"),
          skillDsa: avg("skillDsa"),
          skillAiml: avg("skillAiml"),
          readinessScore: avg("readinessScore"),
        },
        note: "Compare live averages to training medians after each term; retrain TADE when drift is large.",
        retrain: "cd ml-service && python train_placement_tade.py",
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

}
