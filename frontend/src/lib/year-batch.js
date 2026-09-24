/**
 * Canonical year + batch detection for the whole portal.
 * Codes: FY | SY | TY | LY
 *
 * Handles messy Excel / VMedulife labels, e.g.:
 *   SYCSE-A SEM III, TY-A SEM 5, FY-CSE A SEM 1, LY-A SEM 7
 *   Second Year, Final Year, TE CSE A, BE CSE B
 *   Compact: SYCSEASEMIII, TYCSE-B
 */

export const YEAR_ORDER = ["FY", "SY", "TY", "LY"];

export const YEAR_LABELS = {
  FY: "First Year (FY)",
  SY: "Second Year (SY)",
  TY: "Third Year (TY)",
  LY: "Last Year (LY)",
};

/** Compact string: strip spaces/dots, keep letters/digits/hyphen */
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

/**
 * Map any year-ish string to FY | SY | TY | LY | null
 * Order matters: Last Year before First Year so FINAL≠FY, and
 * check explicit codes before loose "FIRST/SECOND" words.
 */
export function normalizeYearLevel(raw) {
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

  // Pure letter
  if (/^[A-H]$/.test(s)) return s;

  // BATCH / DIV / SEC / GROUP A
  let m = s.match(/(?:BATCH|DIV(?:ISION)?|SEC(?:TION)?|GRP|GROUP)\s*[-_.]?\s*([A-H])\b/);
  if (m) return m[1];

  // Compact VMedulife: FYCSE-C SEM 1, SYCSE-A SEM III (hyphen before letter)
  m = s.match(/\b(?:FY|SY|TY|LY|FE|SE|TE|BE)\s*CSE\s*[-_.]?\s*([A-H])\b/);
  if (m) return m[1];
  m = s.match(/\b(?:FY|SY|TY|LY|FE|SE|TE|BE)CSE\s*[-_.]?\s*([A-H])\b/);
  if (m) return m[1];

  // Year code then letter: SY-A, TY A, FYCSE-A, SYCSE A, LY-B
  m = s.match(/\b(?:FY|SY|TY|LY|FE|SE|TE|BE)\s*[-_.]?\s*(?:CSE|IT|AIDS|AIML|DS)?\s*[-_.]?\s*([A-H])\b/);
  if (m) return m[1];

  // Compact squeezed: FYCSECSEM1, SYCSEASEM3, TYCSEB → letter after CSE / year
  const z = squeeze(s);
  m = z.match(/(?:FY|SY|TY|LY|FE|SE|TE|BE)(?:CSE|IT|AIDS|AIML|DS)([A-H])(?:SEM|\d|$)/);
  if (m) return m[1];
  m = z.match(/(?:FY|SY|TY|LY|FE|SE|TE|BE)([A-H])(?:CSE|SEM|\d|$)/);
  if (m) return m[1];
  m = z.match(/(?:CSE|IT|AIDS|AIML|DS)([A-H])(?:SEM|\d|$)/);
  if (m) return m[1];

  // Trailing letter: "TE CSE A", "Second Year A"
  m = s.match(/(?:^|[\s\-_./])([A-H])(?:\s*)$/);
  if (m) return m[1];

  // "C SEM" / "A-SEM"
  m = s.match(/\b([A-H])\s*[-_]?\s*SEM\b/) || z.match(/([A-H])SEM/);
  if (m) return m[1];

  // Any standalone A–H token (last resort)
  m = s.match(/\b([A-H])\b/);
  if (m) return m[1];

  return null;
}

/**
 * Parse year + batch from a student row or free-text class label.
 */
export function parseYearBatch(studentOrText) {
  if (studentOrText == null) return { year: null, batch: null };

  if (typeof studentOrText === "string") {
    return {
      year: normalizeYearLevel(studentOrText),
      batch: normalizeBatch(studentOrText),
    };
  }

  const s = studentOrText;

  // Class / section labels are authoritative when they encode FY|SY|TY|LY.
  // yearLevel alone can be stale after a multi-year upload merge (e.g. TY-A row
  // wrongly stamped yearLevel=LY) — never let that override a clear class year.
  const fromCls =
    normalizeYearLevel(s.cls) ||
    normalizeYearLevel(s.className) ||
    normalizeYearLevel(s.section) ||
    normalizeYearLevel(s.group) ||
    normalizeYearLevel(s.Group);
  const fromLevel =
    normalizeYearLevel(s.yearLevel) ||
    normalizeYearLevel(s.year);

  let year = fromCls || fromLevel;
  if (fromCls && fromLevel && fromCls !== fromLevel) {
    year = fromCls;
  }

  const parts = [
    s.cls,
    s.className,
    s.section,
    s.yearLevel,
    s.year,
    s.batch,
    s.division,
    s.group,
  ]
    .filter((x) => x != null && String(x).trim() !== "")
    .map(String);
  const joined = parts.join(" | ");
  if (!year) year = normalizeYearLevel(joined);

  let batch =
    normalizeBatch(s.batch) ||
    normalizeBatch(s.section) ||
    normalizeBatch(s.division) ||
    normalizeBatch(s.cls) ||
    normalizeBatch(s.className) ||
    normalizeBatch(s.group) ||
    normalizeBatch(s.Group) ||
    normalizeBatch(joined);

  if (!year && s.batch) year = normalizeYearLevel(s.batch);
  if (!year && s.section) year = normalizeYearLevel(s.section);

  return {
    year: year || null,
    batch: batch || null,
  };
}

/** Apply canonical year/batch onto a student object (returns new object). */
export function applyCanonicalYearBatch(student) {
  const { year, batch } = parseYearBatch(student);
  return {
    ...student,
    yearLevel: year || student?.yearLevel || null,
    batch: batch || (student?.batch && normalizeBatch(student.batch)) || student?.batch || null,
  };
}

export function uniqueYears(students) {
  const set = new Set();
  for (const s of students || []) {
    const y =
      parseYearBatch(s).year ||
      normalizeYearLevel(s?.group) ||
      normalizeYearLevel(s?.Group) ||
      normalizeYearLevel(s?.section);
    if (y) set.add(y);
  }
  return YEAR_ORDER.filter((y) => set.has(y));
}

export function uniqueBatches(students, yearFilter = "All") {
  const want = yearFilter === "All" ? null : normalizeYearLevel(yearFilter) || yearFilter;
  const set = new Set();
  for (const s of students || []) {
    const { year, batch } = parseYearBatch(s);
    if (want && year !== want) continue;
    if (batch) set.add(batch);
  }
  return Array.from(set).sort();
}

export function filterByYearBatch(students, year = "All", batch = "All") {
  const wantY = year === "All" || !year ? null : normalizeYearLevel(year) || year;
  const wantB = batch === "All" || !batch ? null : normalizeBatch(batch) || batch;
  return (students || []).filter((s) => {
    const { year: y, batch: b } = parseYearBatch(s);
    // Specific year/batch: require exact match — unknown is excluded
    if (wantY && (!y || y !== wantY)) return false;
    if (wantB && (!b || b !== wantB)) return false;
    return true;
  });
}

/** Pass percentage helper (kept for analytics) */
export function computePassPercentage(students) {
  let pass = 0;
  let total = 0;
  for (const s of students || []) {
    for (const m of s.marks || []) {
      const st = String(m.status || m.result || "").toUpperCase();
      if (!st) continue;
      total += 1;
      if (st.includes("PASS") || st === "P") pass += 1;
    }
  }
  if (!total) return null;
  return Math.round((pass / total) * 1000) / 10;
}

export function attendanceDropAlerts(students, threshold = 65) {
  return (students || [])
    .filter((s) => s.attendance != null && Number(s.attendance) < threshold)
    .sort((a, b) => Number(a.attendance) - Number(b.attendance))
    .slice(0, 8)
    .map((s) => ({
      prn: s.prn,
      name: s.name,
      attendance: s.attendance,
      cls: s.cls || s.className,
      kind: "attendance",
      message: `Attendance ${s.attendance}% (below ${threshold}%)`,
    }));
}

export function marksDropAlerts(students) {
  const out = [];
  for (const s of students || []) {
    const weak = [];
    for (const m of s.marks || []) {
      const a = m.assessments || {};
      let mean = null;
      const vals = [];
      for (const [k, v] of Object.entries(a)) {
        if (!/ut|quiz|mid|test|internal/i.test(String(k))) continue;
        const n = Number(v);
        if (Number.isFinite(n)) vals.push(n);
      }
      if (vals.length) mean = vals.reduce((x, y) => x + y, 0) / vals.length;
      else if (m.average != null) mean = Number(m.average);
      if (mean != null && mean < 8) weak.push(`${m.subject || "Subject"} (${Math.round(mean * 10) / 10})`);
    }
    if (weak.length) {
      out.push({
        prn: s.prn,
        name: s.name,
        cls: s.cls || s.className,
        kind: "marks",
        message: `Low UT scores: ${weak.slice(0, 3).join(", ")}`,
      });
    } else if (s.academicStatus === "At Risk") {
      out.push({
        prn: s.prn,
        name: s.name,
        cls: s.cls || s.className,
        kind: "status",
        message: "Current Academic Status: At Risk",
      });
    }
  }
  return out.slice(0, 10);
}

/**
 * Primary year for each subject = year with the most real scores (> 0).
 * Stops empty TY columns on SY rows from stealing affinity.
 */
export function subjectPrimaryYearMap(allStudents) {
  const counts = {};
  for (const s of allStudents || []) {
    const y = parseYearBatch(s).year;
    if (!y) continue;
    for (const m of s.marks || []) {
      const sub = String(m.subject || "").trim();
      if (!sub) continue;
      let hasReal = false;
      const a = m.assessments || {};
      for (const v of Object.values(a)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          hasReal = true;
          break;
        }
      }
      if (!hasReal && m.average != null) {
        const n = Number(m.average);
        if (Number.isFinite(n) && n > 0) hasReal = true;
      }
      if (!hasReal && m.percentage != null) {
        const n = Number(m.percentage);
        if (Number.isFinite(n) && n > 0) hasReal = true;
      }
      if (!hasReal) continue;
      if (!counts[sub]) counts[sub] = {};
      counts[sub][y] = (counts[sub][y] || 0) + 1;
    }
  }
  const primary = {};
  for (const [sub, byY] of Object.entries(counts)) {
    let best = null;
    let bestN = -1;
    for (const [y, n] of Object.entries(byY)) {
      if (n > bestN) {
        best = y;
        bestN = n;
      }
    }
    if (best) primary[sub] = best;
  }
  return primary;
}

/**
 * Strict: subject must belong to selected year.
 * Unknown primary under a specific year filter → exclude.
 */
export function subjectBelongsToYear(subject, yearFilter, primaryMap) {
  if (!yearFilter || yearFilter === "All") return true;
  const y = normalizeYearLevel(yearFilter) || yearFilter;
  const key = String(subject || "").trim();
  if (!key) return false;
  const p = primaryMap?.[key] ?? primaryMap?.[subject];
  // Unknown subject under a specific year → hide (never leak TY under LY)
  if (!p) return false;
  return p === y;
}

/**
 * Keep only marks whose subject primary year matches lockYear (FY|SY|TY|LY).
 */
export function filterMarksForYear(marks, lockYear, primaryMap) {
  if (!lockYear || lockYear === "All") return marks || [];
  const y = normalizeYearLevel(lockYear) || lockYear;
  const map = primaryMap || {};
  return (marks || []).filter((m) => subjectBelongsToYear(m.subject, y, map));
}

/**
 * Subjects list for dropdowns locked to a year.
 */
export function filterSubjectsForYear(subjects, lockYear, primaryMap) {
  if (!lockYear || lockYear === "All") return subjects || [];
  const y = normalizeYearLevel(lockYear) || lockYear;
  return (subjects || []).filter((sub) => subjectBelongsToYear(sub, y, primaryMap));
}

/** Subject averages from a filtered student list (optional year subject lock). */
export function computeSubjectAverages(students, { allStudents = null, yearFilter = "All" } = {}) {
  const primary = subjectPrimaryYearMap(allStudents || students);
  const yearsInView = new Set();
  for (const s of students || []) {
    const y = parseYearBatch(s).year;
    if (y) yearsInView.add(y);
  }
  const singleYear =
    yearFilter && yearFilter !== "All"
      ? normalizeYearLevel(yearFilter) || yearFilter
      : yearsInView.size === 1
        ? [...yearsInView][0]
        : null;

  const sums = {};
  for (const s of students || []) {
    for (const m of s.marks || []) {
      const sub = m.subject || "Unknown";
      if (singleYear && !subjectBelongsToYear(sub, singleYear, primary)) continue;
      if (!sums[sub]) sums[sub] = { sum: 0, count: 0 };
      const a = m.assessments || {};
      const vals = [];
      for (const [k, v] of Object.entries(a)) {
        const key = String(k).toUpperCase().replace(/[\s_-]/g, "");
        if (key.includes("UT") || key === "AVERAGE" || key === "AVG") {
          const n = Number(v);
          if (Number.isFinite(n)) vals.push(n);
        }
      }
      if (!vals.length && m.average != null && Number.isFinite(Number(m.average))) {
        vals.push(Number(m.average));
      }
      if (!vals.length && m.percentage != null && Number.isFinite(Number(m.percentage))) {
        vals.push(Number(m.percentage) / 5);
      }
      if (!vals.length) continue;
      const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
      sums[sub].sum += mean;
      sums[sub].count += 1;
    }
  }
  return Object.entries(sums)
    .filter(([, v]) => v.count > 0)
    .map(([subject, v]) => ({
      subject,
      avg: Math.round((v.sum / v.count) * 10) / 10,
      n: v.count,
    }))
    .sort((a, b) => a.avg - b.avg);
}

/** Assessment-level averages (UT-1, UT-2, …) within filtered cohort */
export function computeAssessmentAverages(students) {
  const sums = {};
  for (const s of students || []) {
    for (const m of s.marks || []) {
      const a = m.assessments || {};
      for (const [k, v] of Object.entries(a)) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        const label = String(k);
        if (!sums[label]) sums[label] = { sum: 0, count: 0 };
        sums[label].sum += n;
        sums[label].count += 1;
      }
    }
  }
  return Object.entries(sums)
    .filter(([, v]) => v.count > 0)
    .map(([assessment, v]) => ({
      assessment,
      avg: Math.round((v.sum / v.count) * 10) / 10,
    }))
    .sort((a, b) => a.assessment.localeCompare(b.assessment));
}
