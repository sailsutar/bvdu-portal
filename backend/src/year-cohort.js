/**
 * Longitudinal academic journey + strong year/batch detection.
 * Codes: FY | SY | TY | LY (must match frontend/src/lib/year-batch.js)
 */

export const YEAR_FLOW = ["FY", "SY", "TY", "LY"];

function compact(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[.\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function squeeze(s) {
  return compact(s).replace(/[\s_./\\-]+/g, "");
}

export function normalizeYear(raw) {
  if (raw == null || raw === "" || raw === "All" || raw === "—") return null;
  const s = compact(raw);
  if (!s || s === "UNSPECIFIED" || s === "UNSPECIFIED YEAR") return null;
  const z = squeeze(s);

  // Fast path: compact VMedulife codes at start — FYCSE-C SEM 1 → FYCSECSEM1
  // Must NOT use bare /SECSE/ which false-matches inside FYCSECSEM1
  const head = z.match(/^(FY|SY|TY|LY|FE|SE|TE|BE)(?:CSE|IT|AIDS|AIML|DS)?/);
  if (head) {
    const code = head[1];
    if (code === "FY" || code === "FE") return "FY";
    if (code === "SY" || code === "SE") return "SY";
    if (code === "TY" || code === "TE") return "TY";
    if (code === "LY" || code === "BE") return "LY";
  }

  // ========== LAST / FINAL YEAR (before any FIRST check) ==========
  if (
    z.includes("FINALYEAR") ||
    z.includes("LASTYEAR") ||
    z.includes("FOURTHYEAR") ||
    z.includes("4THYEAR") ||
    z === "FINAL" ||
    z === "LY" ||
    /\bLY\b/.test(s) ||
    /\bFINAL\s*YEAR\b/.test(s) ||
    /\bFINAL\b/.test(s) ||
    /\bLAST\s*YEAR\b/.test(s) ||
    /\bFOURTH\s*YEAR\b/.test(s) ||
    /\b4TH\s*YEAR\b/.test(s) ||
    (/\bBE\b/.test(s) && !/\bBECOME\b/.test(s) && !/\bBEFORE\b/.test(s) && !/DEEMED\s+TO\s+BE/i.test(s))
  ) {
    return "LY";
  }

  // ========== THIRD YEAR ==========
  if (
    /^(TY|TE|THIRDYEAR|3RDYEAR|III)$/.test(z) ||
    /\b(TY|T\.Y\.|TE|T\.E\.|THIRD\s*YEAR|3RD\s*YEAR)\b/.test(s) ||
    /\bTHIRD\b/.test(s)
  ) {
    return "TY";
  }

  // ========== SECOND YEAR ==========
  if (
    /^(SY|SE|SECONDYEAR|2NDYEAR|II)$/.test(z) ||
    /\b(SY|S\.Y\.|SE|S\.E\.|SECOND\s*YEAR|2ND\s*YEAR)\b/.test(s) ||
    /\bSECOND\b/.test(s)
  ) {
    return "SY";
  }

  // ========== FIRST YEAR ==========
  if (z.includes("FINAL") || /\bFINAL\b/.test(s) || z.includes("LASTYEAR")) {
    return "LY";
  }
  if (
    /^(FY|FE|FIRSTYEAR|1STYEAR|I)$/.test(z) ||
    /\b(FY|F\.Y\.|FE|F\.E\.|FIRST\s*YEAR|1ST\s*YEAR)\b/.test(s) ||
    /\bFIRST\b/.test(s)
  ) {
    return "FY";
  }

  // Semester-only hints (weak)
  if (/\bSEM(?:ESTER)?[\s._-]*([1-8])\b/.test(s) || /SEM([1-8])/.test(z)) {
    const sm = s.match(/\bSEM(?:ESTER)?[\s._-]*([1-8])\b/) || z.match(/SEM([1-8])/);
    const n = sm ? parseInt(sm[1], 10) : 0;
    if (n === 1 || n === 2) return "FY";
    if (n === 3 || n === 4) return "SY";
    if (n === 5 || n === 6) return "TY";
    if (n === 7 || n === 8) return "LY";
  }

  return null;
}


export function normalizeBatch(raw) {
  if (raw == null || raw === "" || raw === "All" || raw === "—") return null;
  const s = compact(raw);
  if (!s) return null;
  if (/^[A-H]$/.test(s)) return s;

  let m = s.match(/(?:BATCH|DIV(?:ISION)?|SEC(?:TION)?|GRP|GROUP)\s*[-_.]?\s*([A-H])\b/);
  if (m) return m[1];

  m = s.match(/\b(?:FY|SY|TY|LY|FE|SE|TE|BE)\s*[-_.]?\s*(?:CSE|IT|AIDS|AIML|DS)?\s*[-_.]?\s*([A-H])\b/);
  if (m) return m[1];

  const z = squeeze(s);
  m = z.match(/(?:FY|SY|TY|LY|FE|SE|TE|BE)(?:CSE|IT|AIDS|AIML|DS)?([A-H])(?:SEM|$)/);
  if (m) return m[1];
  m = z.match(/(?:CSE|IT|AIDS|AIML|DS)([A-H])(?:SEM|$)/);
  if (m) return m[1];

  m = s.match(/(?:^|[\s\-_./])([A-H])(?:\s*)$/);
  if (m) return m[1];

  m = s.match(/\b([A-H])\s*[-_]?\s*SEM\b/) || z.match(/([A-H])SEM/);
  if (m) return m[1];

  m = s.match(/\b([A-H])\b/);
  if (m) return m[1];

  return null;
}

export function parseYearBatch(obj) {
  if (obj == null) return { year: null, batch: null };
  if (typeof obj === "string") {
    return { year: normalizeYear(obj), batch: normalizeBatch(obj) };
  }
  const joined = [obj.yearLevel, obj.year, obj.cls, obj.className, obj.section, obj.batch]
    .filter(Boolean)
    .join(" | ");
  let year =
    normalizeYear(obj.yearLevel) ||
    normalizeYear(obj.year) ||
    normalizeYear(obj.cls) ||
    normalizeYear(obj.className) ||
    normalizeYear(obj.section) ||
    normalizeYear(joined);
  let batch =
    normalizeBatch(obj.batch) ||
    normalizeBatch(obj.section) ||
    normalizeBatch(obj.cls) ||
    normalizeBatch(obj.className) ||
    normalizeBatch(joined);
  if (!year && obj.batch) year = normalizeYear(obj.batch);
  return { year: year || null, batch: batch || null };
}

export function yearIndex(year) {
  const y = normalizeYear(year);
  const i = YEAR_FLOW.indexOf(y);
  return i >= 0 ? i : null;
}

export function nextYear(year) {
  const i = yearIndex(year);
  if (i == null || i >= YEAR_FLOW.length - 1) return null;
  return YEAR_FLOW[i + 1];
}

export function inferAdmissionYear(yearLevel, academicYearStart) {
  const start = Number(academicYearStart);
  const base = Number.isFinite(start) ? start : new Date().getFullYear();
  const i = yearIndex(yearLevel);
  if (i == null) return base;
  return base - i;
}

export function cohortIdFromAdmission(admissionYear, programme = "CSE") {
  if (admissionYear == null || admissionYear === "") return null;
  const y = Number(admissionYear);
  if (!Number.isFinite(y)) return `COHORT-${admissionYear}`;
  return `${programme}-${y}-${y + 4}`;
}

export function yearLockMask(yearLevel) {
  const i = yearIndex(yearLevel);
  const idx = i == null ? 3 : i;
  return {
    yearLevel: normalizeYear(yearLevel),
    yearIndex: idx,
    allowFy: idx >= 0,
    allowSy: idx >= 1,
    allowTy: idx >= 2,
    allowLy: idx >= 3,
  };
}

export function applyYearLockToPayload(payload, yearLevel) {
  const mask = yearLockMask(yearLevel || payload.year || payload.yearLevel);
  const out = { ...payload, year: mask.yearLevel, yearLevel: mask.yearLevel };
  if (!mask.allowSy) {
    delete out.cgpa_sy;
    delete out.cgpaSy;
  }
  if (!mask.allowTy) {
    delete out.cgpa_ty;
    delete out.cgpaTy;
  }
  if (!mask.allowLy) {
    delete out.cgpa_ly;
    delete out.cgpaLy;
  }
  return out;
}

export function promotionPlan(fromYear, toYear) {
  const from = normalizeYear(fromYear);
  const to = normalizeYear(toYear) || nextYear(from);
  if (!from || !to) return { ok: false, error: "fromYear and toYear required (FY|SY|TY|LY)" };
  const fi = yearIndex(from);
  const ti = yearIndex(to);
  if (ti !== fi + 1) {
    return { ok: false, error: `Only promote one step at a time. Got ${from}→${to}` };
  }
  return { ok: true, from, to };
}

export function isPlacementPredictionYear(year) {
  const y = normalizeYear(year);
  return y === "TY" || y === "LY";
}

export function isPlacementPrepYear(year) {
  const y = normalizeYear(year);
  return y === "FY" || y === "SY" || y == null;
}
