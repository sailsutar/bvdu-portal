import { normalizeBatch, normalizeYearLevel } from "@/lib/year-batch";
import { useEffect, useMemo, useState } from "react";
/**
 * Teacher Guide assignment + slow/fast learner classification.
 *
 * Assignment is Mongo-first via /api/tg-assignments (explicit preferred).
 * Auto-distribution uses admin-configurable tgBatchSize / number of active TGs.
 * Hardcoded BATCH_SIZE=20 / TG_COUNT=3 have been removed.
 *
 * UT marks:
 *  - Use only Unit Tests that have numeric scores (UT-1 / UT-2 / UT-3)
 *  - Mean of available UTs only — blank UTs are ignored (no performance drop)
 *  - Same rule extends if later UTs appear
 *
 * Learner list order: Batch A (numbers ascending) then Batch B (numbers ascending), …
 */

import { DEFAULT_THRESHOLDS } from "./academic-status";
import { authHeaders, getToken } from "@/lib/auth";

const API_BASE = import.meta.env.VITE_API_URL || "";

/** Extract batch letter (A, B, …) and numeric id from student for sorting */
export function batchSortKey(student) {
  const forced = normalizeBatch(student?.batch) || normalizeBatch(student?.cls || student?.className);
  if (forced) {
    const prn = String(student?.prn || "");
    const numMatch = prn.match(/(\d+)\s*$/);
    return { batch: forced, num: numMatch ? parseInt(numMatch[1], 10) : 0, name: String(student?.name || ""), prn };
  }
  const cls = String(student?.cls || student?.className || "").toUpperCase().trim();
  let batch = "ZZ";

  const explicit = cls.match(
    /(?:BATCH|DIV(?:ISION)?|SEC(?:TION)?|GRP|GROUP)\s*[-_.]?\s*([A-Z])\b/
  );
  if (explicit) {
    batch = explicit[1];
  } else {
    const trail = cls.match(/(?:^|[\s\-_./])([A-Z])(?:\s*)$/);
    if (trail) batch = trail[1];
    else {
      const any = cls.match(/\b([A-H])\b/);
      if (any) batch = any[1];
    }
  }

  const prn = String(student?.prn || "");
  const numMatch = prn.match(/(\d+)\s*$/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 0;
  const name = String(student?.name || "");
  return { batch, num, name, prn };
}

/** Sort: Batch A numbers asc → Batch B numbers asc → … */
export function sortByBatchThenNumber(students) {
  return [...(students || [])].sort((a, b) => {
    const ka = batchSortKey(a);
    const kb = batchSortKey(b);
    if (ka.batch !== kb.batch) return ka.batch.localeCompare(kb.batch);
    if (ka.num !== kb.num) return ka.num - kb.num;
    const n = ka.name.localeCompare(kb.name);
    if (n !== 0) return n;
    return ka.prn.localeCompare(kb.prn);
  });
}

/** Stable sort for auto-distribution (class → name → prn) */
function sortStudents(students) {
  return [...(students || [])].sort((a, b) => {
    const c = String(a.cls || a.className || "").localeCompare(String(b.cls || b.className || ""));
    if (c !== 0) return c;
    const n = String(a.name || "").localeCompare(String(b.name || ""));
    if (n !== 0) return n;
    return String(a.prn || "").localeCompare(String(b.prn || ""));
  });
}

/**
 * Resolve mentees for a TG index.
 * Prefer explicit assignment map (prn → tgIndex). Fall back to even auto-split
 * using configurable batchSize and discovered TG count.
 *
 * @param {Array} students
 * @param {number} tgIndex  1-based
 * @param {object} [opts]
 * @param {Map|object} [opts.assignmentMap]  prn → tgIndex from Mongo
 * @param {number} [opts.tgCount]  number of active TGs
 * @param {number} [opts.batchSize]  optional fixed batch size for auto path
 */
export function studentsForTg(students, tgIndex, opts = {}) {
  const idx = Math.max(1, Number(tgIndex) || 1);
  const list = students || [];

  // Explicit assignments win (API map)
  const map = opts.assignmentMap;
  if (map && (map instanceof Map ? map.size > 0 : Object.keys(map).length > 0)) {
    const get = (prn) => (map instanceof Map ? map.get(String(prn)) : map[String(prn)]);
    return list.filter((s) => Number(get(s.prn)) === idx);
  }

  // Prefer teacherGuideIndex stamped on student records (from Mongo TG assignment sync)
  const withIndex = list.filter((s) => s.teacherGuideIndex != null || s.tgIndex != null);
  if (withIndex.length > 0) {
    return list.filter((s) => Number(s.teacherGuideIndex ?? s.tgIndex) === idx);
  }

  // Auto path: configurable
  const sorted = sortStudents(list);
  const tgCount = Math.max(1, Number(opts.tgCount) || 3);
  const batchSize = Number(opts.batchSize) > 0 ? Number(opts.batchSize) : null;

  if (batchSize) {
    if (idx >= tgCount) {
      return sorted.slice((tgCount - 1) * batchSize);
    }
    const start = (idx - 1) * batchSize;
    return sorted.slice(start, start + batchSize);
  }

  // Even split across TGs
  return sorted.filter((_, i) => i % tgCount === idx - 1);
}

export function tgBatchLabel(tgIndex, opts = {}) {
  const idx = Math.max(1, Number(tgIndex) || 1);
  const batchSize = Number(opts.batchSize) > 0 ? Number(opts.batchSize) : DEFAULT_THRESHOLDS.tgBatchSize;
  const tgCount = Math.max(1, Number(opts.tgCount) || 3);
  if (batchSize) {
    if (idx >= tgCount) return `Students ${((tgCount - 1) * batchSize) + 1} and above (remainder)`;
    const start = (idx - 1) * batchSize + 1;
    const end = idx * batchSize;
    return `Students ${start}–${end}`;
  }
  return `Teacher Guide ${idx} (even distribution)`;
}

/** Fetch explicit assignment map from API (prn → tgIndex) */
export async function fetchTgAssignmentMap() {
  try {
    if (!getToken()) return new Map();
    const res = await fetch(`${API_BASE}/api/tg-assignments`, { headers: { ...authHeaders() } });
    if (!res.ok) return new Map();
    const data = await res.json();
    const map = new Map();
    for (const a of data.assignments || []) {
      map.set(String(a.prn), Number(a.tgIndex));
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function fetchPortalConfig() {
  try {
    if (!getToken()) return { ...DEFAULT_THRESHOLDS };
    const res = await fetch(`${API_BASE}/api/portal-config`, { headers: { ...authHeaders() } });
    if (!res.ok) return { ...DEFAULT_THRESHOLDS };
    const data = await res.json();
    return { ...DEFAULT_THRESHOLDS, ...(data.config || {}) };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

/**
 * Unit Test scores on a 0–20 scale.
 * - Prefer UT-1 / UT-2 when present.
 * - If only percentage-style marks exist (attendance sheets), map % → /20 via pct/5.
 */
export function utAverage(student) {
  const marks = student?.marks || [];
  const scores = [];
  for (const m of marks) {
    const a = m.assessments || {};
    const vals = [];
    for (const k of ["UT-1", "UT-2", "UT-3", "UT1", "UT2", "UT3"]) {
      if (a[k] != null && a[k] !== "" && Number.isFinite(Number(a[k]))) vals.push(Number(a[k]));
    }
    if (!vals.length) {
      // Percentage columns stored as assessments.Pct or m.percentage / m.average
      const pct = m.percentage ?? a.Pct ?? a.Percentage;
      if (pct != null && Number.isFinite(Number(pct))) vals.push(Number(pct) / 5); // 100% → 20
      else if (m.average != null && Number(m.average) <= 20) vals.push(Number(m.average));
    }
    if (vals.length) scores.push(vals.reduce((s, x) => s + x, 0) / vals.length);
  }
  if (!scores.length) {
    // Overall average % from Excel → /20
    const ap = student?.averagePercentage;
    if (ap != null && Number.isFinite(Number(ap))) return Number(ap) / 5;
    return null;
  }
  return scores.reduce((s, x) => s + x, 0) / scores.length;
}

/** Per-subject UT trajectory for spike detection (any consecutive filled UTs) */
export function utTrajectory(student) {
  const pairs = [];
  for (const m of student?.marks || []) {
    const a = m.assessments || {};
    const nums = [];
    for (const k of ["UT-1", "UT-2", "UT-3", "UT1", "UT2", "UT3"]) {
      if (a[k] != null && a[k] !== "" && Number.isFinite(Number(a[k]))) nums.push(Number(a[k]));
    }
    if (nums.length >= 2) {
      pairs.push({ subject: m.subject, ut1: nums[0], ut2: nums[nums.length - 1], all: nums });
    }
  }
  return pairs;
}

/**
 * Spike: was low on Unit Test 1 (< 8/20) and jumped to high on Unit Test 2 (> 15/20)
 * on enough subjects — counts as fast learner (recovery / high growth).
 */
export function hasMarksSpike(student) {
  const pairs = utTrajectory(student);
  if (!pairs.length) return false;
  const spikes = pairs.filter((p) => p.ut1 < 8 && p.ut2 > 15);
  return spikes.length >= Math.max(1, Math.ceil(pairs.length * 0.4));
}

/**
 * Slow: mean marks < 8/20
 * Fast: mean marks > 15/20, OR clear low→high spike across Unit Tests
 * (Attendance alone does not force slow unless marks are also weak.)
 */

/**
 * Shared academic signals for interventions, agents, learners, uplift.
 * meanUt on 0–20 scale; meanUtPct on 0–100 when derivable.
 */
export function learnerSignals(student) {
  const attendance =
    student?.attendanceKnown || student?.attendance != null
      ? student.attendance
      : null;
  const marks = student?.marks || [];
  const ut1 = [];
  const ut2 = [];
  const ut3 = [];
  let fail = 0;
  let n = 0;
  for (const m of marks) {
    const a = m.assessments || {};
    const pairs = [
      ["UT-1", a["UT-1"] ?? a.UT1, ut1],
      ["UT-2", a["UT-2"] ?? a.UT2, ut2],
      ["UT-3", a["UT-3"] ?? a.UT3, ut3],
    ];
    for (const [, raw, bucket] of pairs) {
      if (raw == null || raw === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      bucket.push(v);
      n += 1;
      if (v < 8) fail += 1;
    }
  }
  const all = [...ut1, ...ut2, ...ut3];
  let meanUt = null;
  let utBasis = "none";
  if (all.length) {
    meanUt = all.reduce((s, x) => s + x, 0) / all.length;
    const parts = [];
    if (ut1.length) parts.push("UT-1");
    if (ut2.length) parts.push("UT-2");
    if (ut3.length) parts.push("UT-3");
    utBasis = parts.join("+");
  } else {
    meanUt = typeof utAverage === "function" ? utAverage(student) : null;
    if (meanUt != null) utBasis = "derived";
  }
  let meanUtPct = null;
  if (meanUt != null) meanUtPct = Math.round(meanUt * 5 * 10) / 10;
  if (student?.averagePercentage != null && meanUtPct == null) {
    meanUtPct = Number(student.averagePercentage);
  }
  const utFailRate = n > 0 ? fail / n : null;
  return {
    attendance,
    meanUt,
    meanUtPct,
    utFailRate,
    utBasis,
    ut1Count: ut1.length,
    ut2Count: ut2.length,
    ut3Count: ut3.length,
  };
}

export function classifyLearner(student, _passMark = DEFAULT_THRESHOLDS.utPassMark) {
  const avg = utAverage(student);
  const spike = hasMarksSpike(student);

  if (spike) return "fast";
  if (avg == null) return "unknown";
  if (avg < 8) return "slow";
  if (avg > 15) return "fast";
  return "average";
}

export function learnerBand(student) {
  return classifyLearner(student);
}

export function partitionLearners(students) {
  const slow = [];
  const fast = [];
  const average = [];
  for (const s of students || []) {
    const band = classifyLearner(s);
    if (band === "slow") slow.push(s);
    else if (band === "fast") fast.push(s);
    else if (band === "average") average.push(s);
  }
  return { slow, fast, average };
}


/**
 * Load Mongo TG assignments and return mentees for the logged-in Teacher Guide.
 * Explicit assignment map always wins over auto-split.
 */
export function useTgMentees(students, tgIndex) {
  const [assignmentMap, setAssignmentMap] = useState(() => new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = await fetchTgAssignmentMap();
      if (!cancelled) {
        setAssignmentMap(map);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tgIndex, (students || []).length]);

  const mentees = useMemo(
    () => studentsForTg(students, tgIndex, { assignmentMap }),
    [students, tgIndex, assignmentMap]
  );

  return { mentees, assignmentMap, assignmentsLoaded: loaded };
}
