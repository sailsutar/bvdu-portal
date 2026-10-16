import { normalizeYearLevel, normalizeBatch, parseYearBatch, applyCanonicalYearBatch } from "@/lib/year-batch";

function finalizeStudents(list) {
  return (list || []).map((s) => {
    // Prefer original VMedulife group / section when present (e.g. FYCSE-C SEM 1)
    const label =
      s.group ||
      s.Group ||
      s.section ||
      s.cls ||
      s.className ||
      [s._yearRaw, s._batchRaw].filter(Boolean).join(" ") ||
      "";
    const parsed = parseYearBatch({
      yearLevel: s.yearLevel || s._yearRaw,
      batch: s.batch || s._batchRaw,
      cls: label,
      className: s.className,
      section: s.section || s.group || s.Group,
      group: s.group || s.Group,
    });
    // Compact label (FYCSE-C…) always wins over a stale yearLevel (old SY bug)
    const fromLabel = parseYearBatch(String(label));
    const year =
      fromLabel.year ||
      parsed.year ||
      normalizeYearLevel(s.yearLevel) ||
      null;
    const batch =
      fromLabel.batch ||
      parsed.batch ||
      normalizeBatch(s.batch) ||
      null;
    const out = {
      ...s,
      yearLevel: year,
      batch,
    };
    if (year && batch) {
      out.cls = `${year} CSE ${batch}`;
      out.className = out.cls;
    }
    delete out._yearRaw;
    delete out._batchRaw;
    return out;
  });
}
import { useEffect, useMemo, useState } from "react";
import { getCachedCohort, fetchCohortFromServer, subscribeCohort } from "./cohort-store";
import {
  computeAcademicStatus,
  statusFromAttendanceAndBacklogs,
  DEFAULT_THRESHOLDS,
} from "./academic-status";

const UPLOADS_KEY = "bvu.uploads";
const UPLOADS_EVENT = "bvu:uploads";

const PASS_THRESHOLDS = {
  "UT-1": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
  "UT1": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
  "UT-2": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
  "UT2": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
  "UT-3": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
  "UT3": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
  "RE-UT": { max: 60, pass: 22 },
  "REUT": { max: 60, pass: 22 },
  "RE-UT-20": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
  "REUT20": { max: 20, pass: DEFAULT_THRESHOLDS.utPassMark },
};

const PASS_UT_THRESHOLD = DEFAULT_THRESHOLDS.utPassMark;

/**
 * Student-level overall average % from per-subject marks.
 * Prefer m.percentage; else derive from m.average on the /20 → % scale
 * (same conversion as explain-performance.js).
 * Returns null if no subject has a usable value.
 */
function computeOverallAveragePct(marks) {
  if (!Array.isArray(marks) || !marks.length) return null;
  const pcts = [];
  for (const m of marks) {
    if (!m) continue;
    if (typeof m.percentage === "number" && Number.isFinite(m.percentage)) {
      pcts.push(m.percentage);
      continue;
    }
    if (typeof m.average === "number" && Number.isFinite(m.average)) {
      // average is on a ~0–20 continuous-assessment scale → percentage
      pcts.push((m.average / 20) * 100);
    }
  }
  if (!pcts.length) return null;
  const mean = pcts.reduce((s, x) => s + x, 0) / pcts.length;
  return round(mean, 1);
}

/**
 * Column resolution — designed for college Excel/CSV exports.
 *
 * Critical rules:
 * 1. Permanent Registration Number (PRN) is the student identity, NEVER Roll No.
 *    Roll No. restarts per batch (TY-A: 1..N, TY-B: 1..N) and must not dedupe students.
 * 2. Section values like "TY-A" / "TY-B" are full class labels (year + batch).
 * 3. Overall attendance is "Total Attendance (%)", not per-subject attendance columns.
 */

const KEY_PATTERNS = {
  // Strong identity only — roll is handled separately as last resort
  prn: [
    /\bprn\b/,
    /prn\s*no/,
    /prn\s*number/,
    /permanent\s*registration/,
    /registration\s*(no|number|num)/,
    /reg(?:istration)?\s*(no|number)?/,
    /university\s*(no|number|seat)/,
    /\busn\b/,
    /enroll(?:ment)?\s*(no|number|id)?/,
    /enrol(?:ment)?\s*(no|number|id)?/,
    /admission\s*(no|number)/,
    /student\s*id/,
  ],
  // Weak identity — used ONLY when no PRN-like column exists
  roll: [/\broll\s*no/, /\broll\s*number/, /\broll\b/, /^sr\s*no$/, /^s\s*no$/, /^uid$/, /^id$/],
  name: [/student\s*name/, /candidate\s*name/, /learner\s*name/, /full\s*name/, /^name$/, /\bname\b/],
  cls: [/^class$/, /\bclass\s*name\b/, /\bclass\b/, /branch/, /^dept$/, /department/, /programme/, /program/],
  // Section / Division / Batch — often holds "TY-A"
  section: [/^section$/, /\bsection\b/, /\bbatch\b/, /\bdivision\b/, /^div$/, /\bdiv\.?\b/, /^sec$/, /\bgroup\b/, /\bgrp\b/],
  yearLevel: [/\byear\b/, /academic\s*year/],
  email: [/email/, /e\s*mail/, /mail\s*id/],
  phone: [/phone/, /mobile/, /contact/],
  // Prefer overall / total attendance; subject "% sessions" columns score lower via resolveColumnMap
  attendance: [
    /total\s*attendance/,
    /overall\s*attendance/,
    /attendance\s*\(?\s*%\s*\)?/,
    /attendance\s*percentage/,
    /\battendance\b/,
    /att\s*%/,
    /^att$/,
    /present\s*%/,
  ],
  cgpa: [/\bcgpa\b/, /\bsgpa\b/, /\bgpa\b/, /grade\s*point/],
  averagePct: [
    /^average\s*\(?\s*%\s*\)?$/,
    /average\s*\(?\s*%\s*\)?/,
    /average\s*percentage/,
    /average[_\s-]*pct/,
    /^avg[_\s-]*pct$/,
    /overall[_\s-]*pct/,
    /overall\s*%/,
  ],
  marks: [/marks?$/, /score/, /percentage/, /percent/, /result/, /grade/, /obtained/, /total\s*marks?/, /^total$/],
  backlogs: [/backlog/, /\bkt\b/, /arrear/, /fail/],
  period: [/month/, /date/, /period/, /term/, /semester/, /^sem$/],
  feedback: [/sentiment/, /feedback/, /rating/, /review/, /comment/, /remark/],
  day: [/^day$/, /weekday/, /time\s*table\s*day/],
};

/** Score how well a header fits a role (higher = better). */
function scoreHeaderForRole(header, role) {
  const h = String(header || "").toLowerCase().trim();
  if (!h || h.startsWith("__")) return -1;
  const patterns = KEY_PATTERNS[role];
  if (!patterns) return -1;
  let matched = false;
  let indexScore = 0;
  for (let i = 0; i < patterns.length; i++) {
    if (headerMatches(header, [patterns[i]])) {
      matched = true;
      indexScore = (patterns.length - i) * 10;
      break;
    }
  }
  if (!matched) return -1;

  let score = indexScore;

  if (role === "prn") {
    if (/\bprn\b/.test(h)) score += 200;
    if (/permanent\s*registration/.test(h)) score += 200;
    if (/registration/.test(h) && !/roll/.test(h)) score += 80;
    // Never treat roll as PRN in scoring for role prn (roll has its own role)
    if (/\broll\b/.test(h)) score = -1;
  }
  if (role === "roll") {
    if (/\bprn\b/.test(h)) score = -1;
    if (/\broll\b/.test(h)) score += 50;
  }
  if (role === "attendance") {
    if (/total\s*attendance|overall\s*attendance/.test(h)) score += 200;
    // Per-subject attendance columns look like "ML_CSE | ... _%"
    if (/\|/.test(h) || /sessions/i.test(h)) score -= 150;
    if (/theory|practical|lab/i.test(h) && !/total|overall/i.test(h)) score -= 100;
    if (/attendance\s*%|attendance\s*percent/i.test(h) && !/total|overall/i.test(h)) score -= 250;
  }
  if (role === "averagePct") {
    if (/^average/.test(h) || /average\s*\(/.test(h)) score += 100;
    if (/\|/.test(h) || /sessions/i.test(h)) score -= 150;
  }
  if (role === "section") {
    if (/^section$|\bsection\b/.test(h)) score += 100;
    if (/\bbatch\b/.test(h)) score += 80;
    if (/^batch$/.test(h)) score += 120;
  }
  if (role === "name") {
    if (/student\s*name/.test(h)) score += 80;
    if (/^name$/.test(h)) score += 40;
  }
  if (role === "yearLevel") {
    if (/^year$/.test(h)) score += 120;
    if (/academic\s*year/.test(h)) score += 40;
  }
  return score;
}

/**
 * Resolve the best header for each semantic role.
 * PRN is chosen only from strong PRN patterns; Roll is fallback identity only.
 */
function resolveColumnMap(headers) {
  const roles = [
    "prn",
    "roll",
    "name",
    "cls",
    "section",
    "yearLevel",
    "email",
    "phone",
    "attendance",
    "cgpa",
    "averagePct",
    "backlogs",
    "period",
    "feedback",
    "day",
  ];
  const map = {};
  for (const role of roles) {
    let best = undefined;
    let bestScore = -1;
    for (const header of headers || []) {
      const s = scoreHeaderForRole(header, role);
      if (s > bestScore) {
        bestScore = s;
        best = header;
      }
    }
    if (bestScore >= 0) map[role] = best;
  }
  // Identity: PRN wins; use roll only if no PRN column
  map.identity = map.prn || map.roll || null;
  map.identityIsPrn = Boolean(map.prn);
  return map;
}

/** @deprecated prefer resolveColumnMap — kept for call sites that pass role patterns */
const findKey = (headers, patterns) => {
  if (!patterns || !headers?.length) return undefined;
  // Detect which KEY_PATTERNS role this is
  for (const [role, pats] of Object.entries(KEY_PATTERNS)) {
    if (pats === patterns || pats[0] === patterns[0]) {
      return resolveColumnMap(headers)[role];
    }
  }
  let best;
  let bestScore = -1;
  for (const header of headers) {
    if (!headerMatches(header, patterns)) continue;
    const h = String(header).toLowerCase();
    let score = 10;
    if (/\bprn\b/.test(h) && !/roll/.test(h)) score += 100;
    if (/\broll\b/.test(h) && !/prn/.test(h)) score -= 50;
    if (score > bestScore) {
      bestScore = score;
      best = header;
    }
  }
  return best;
};

const ASSESSMENT_SUFFIXES = [
  { re: /[_\s-]*(re[_\s-]*ut[_\s-]*20|reut20)$/i, key: "RE-UT-20" },
  { re: /[_\s-]*(re[_\s-]*ut|reut)$/i, key: "RE-UT" },
  // Roman numerals and Arabic — order III → II → I so "UT-III" is not read as UT-1
  { re: /[_\s-]*(ut[_\s-]*iii|ut[_\s-]*3|utiii|unit[_\s-]*test[_\s-]*iii|unit[_\s-]*test[_\s-]*3)$/i, key: "UT-3" },
  { re: /[_\s-]*(ut[_\s-]*ii(?!i)|ut[_\s-]*2|utii(?!i)|unit[_\s-]*test[_\s-]*ii(?!i)|unit[_\s-]*test[_\s-]*2)$/i, key: "UT-2" },
  { re: /[_\s-]*(ut[_\s-]*i(?![ivx])|ut[_\s-]*1|uti(?![ivx])|unit[_\s-]*test[_\s-]*i(?![ivx])|unit[_\s-]*test[_\s-]*1)$/i, key: "UT-1" },
  { re: /[_\s-]*(ut[_\s-]*1|ut1)$/i, key: "UT-1" },
  { re: /[_\s-]*(ut[_\s-]*2|ut2)$/i, key: "UT-2" },
  { re: /[_\s-]*(ut[_\s-]*3|ut3)$/i, key: "UT-3" },
  { re: /[_\s-]*(lab[_\s-]*pct|lab[_\s-]*percentage)$/i, key: "LAB_Pct" },
  { re: /[_\s-]*(lab[_\s-]*total)$/i, key: "LAB_Total" },
  { re: /[_\s-]*(pct|percentage|%)$/i, key: "Pct" },
  { re: /[_\s-]*(total)$/i, key: "Total" },
  { re: /[_\s-]*(average|avg)$/i, key: "Average" },
  { re: /[_\s-]*(quiz[_\s-]*1|quiz1)$/i, key: "Quiz-1" },
  { re: /[_\s-]*(quiz[_\s-]*2|quiz2)$/i, key: "Quiz-2" },
  { re: /[_\s-]*(midterm|mid[_\s-]*term)$/i, key: "Midterm" },
  { re: /[_\s-]*(assignment|assign)$/i, key: "Assignment" },
  { re: /[_\s-]*(practical|prac)$/i, key: "Practical" },
  { re: /[_\s-]*(viva)$/i, key: "Viva" },
  { re: /[_\s-]*(internal)$/i, key: "Internal" },
  { re: /[_\s-]*(end[_\s-]*sem|endsem|semester)$/i, key: "End Semester" },
];

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const safeText = (value, fallback = "") => {
  if (value == null) return fallback;
  if (value instanceof Date) return value.toLocaleDateString();
  const text = String(value).trim();
  return text || fallback;
};
const normalizeHeader = (header) => header.toLowerCase().replace(/[_\-./()%#]+/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const normalizeIdentifier = (value) => safeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const headerMatches = (header, patterns) => {
  const normalized = normalizeHeader(header);
  const compact = normalized.replace(/\s+/g, "");
  return patterns.some((pattern) => pattern.test(header.toLowerCase()) || pattern.test(normalized) || pattern.test(compact));
};
const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  // Non-numeric academic markers from college sheets
  if (/^(defaulter|ab|absent|na|n\/a|#num!|#value!|#ref!|-)$/i.test(text)) return null;
  const negative = /^\(.*\)$/.test(text);
  const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, places = 1) => Number(value.toFixed(places));
const asPercent = (value) => {
  const n = toNumber(value);
  if (n == null) return null;
  const percent = n > 0 && n <= 1 ? n * 100 : n;
  return round(clamp(percent, 0, 100), 1);
};
const statusOf = (attendance, backlogs) =>
  statusFromAttendanceAndBacklogs(attendance, backlogs);

function titleCaseSubject(raw) {
  return raw.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim().split(" ")
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

function parseAcademicColumn(header) {
  if (!header || header.startsWith("__")) return null;
  const h = String(header).trim();
  // Never treat subject attendance columns as unit-test / marks
  if (/attendance|present\s*sessions|total\s*sessions/i.test(h)) return null;
  // Normalize common college variants for matching only
  const hNorm = h
    .replace(/UT\s*[-–—]?\s*III\b/gi, "UT-3")
    .replace(/UT\s*[-–—]?\s*II\b/gi, "UT-2")
    .replace(/UT\s*[-–—]?\s*I\b/gi, "UT-1")
    .replace(/UNIT\s*TEST\s*[-–—]?\s*III\b/gi, "UT-3")
    .replace(/UNIT\s*TEST\s*[-–—]?\s*II\b/gi, "UT-2")
    .replace(/UNIT\s*TEST\s*[-–—]?\s*I\b/gi, "UT-1")
    .replace(/UNIT\s*TEST\s*[-–—]?\s*3\b/gi, "UT-3")
    .replace(/UNIT\s*TEST\s*[-–—]?\s*2\b/gi, "UT-2")
    .replace(/UNIT\s*TEST\s*[-–—]?\s*1\b/gi, "UT-1");
  // Only skip pure identity / meta headers — never skip "Subject UT-1" style mark columns
  for (const [role, patterns] of Object.entries(KEY_PATTERNS)) {
    if (!headerMatches(h, patterns)) continue;
    // If header also looks like a unit-test column, keep parsing as academic
    if (/\but\b|unit\s*test|re\s*-?\s*ut/i.test(h)) break;
    const looksLikeSubjectPrefixed = /_/.test(h) && !/^(overall|average|avg)[_\s-]/i.test(h);
    if (!looksLikeSubjectPrefixed) return null;
  }
  for (const { re, key } of ASSESSMENT_SUFFIXES) {
    const m = hNorm.match(re) || h.match(re);
    if (m) {
      const subjectRaw = (m.input || hNorm).slice(0, m.index).replace(/[_\s-]+$/g, "");
      if (!subjectRaw) continue;
      return { subject: titleCaseSubject(subjectRaw), assessment: key, original: h };
    }
  }
  const parts = hNorm.split(/[_\s-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^(ut-?[123]|ut|re|quiz|mid|lab|pct|total|avg|average|internal|viva|prac|assign)$/i.test(last) || /^\d+$/.test(last)) {
      let assess = last.toUpperCase();
      if (/^UT-?1$|^UT1$/i.test(last)) assess = "UT-1";
      if (/^UT-?2$|^UT2$/i.test(last)) assess = "UT-2";
      if (/^UT-?3$|^UT3$/i.test(last)) assess = "UT-3";
      return { subject: titleCaseSubject(parts.slice(0, -1).join(" ")), assessment: assess, original: h };
    }
  }
  return null;
}

function classifyHeaders(headers) {
  const col = resolveColumnMap(headers);
  const meta = {
    // Identity: Permanent Registration Number when the file has it; Roll No. only as last resort
    prn: col.identity,
    prnIsStrong: col.identityIsPrn,
    roll: col.roll,
    name: col.name,
    cls: col.cls,
    batch: col.section, // Section / Batch / Division (e.g. TY-A)
    yearLevel: col.yearLevel,
    email: col.email,
    phone: col.phone,
    attendance: col.attendance,
    cgpa: col.cgpa,
    averagePct: col.averagePct,
    backlog: col.backlogs,
    period: col.period,
    sentiment: col.feedback,
    day: col.day,
  };
  const reserved = new Set(
    Object.entries(meta)
      .filter(([k, v]) => typeof v === "string" && v)
      .map(([, v]) => v)
  );
  const academic = [];
  const seen = new Set();
  for (const h of headers) {
    if (reserved.has(h)) continue;
    const parsed = parseAcademicColumn(h);
    if (parsed) {
      academic.push(parsed);
      seen.add(h);
    }
  }
  const numericCols = headers.filter(
    (h) => !reserved.has(h) && !h.startsWith("__") && !seen.has(h)
  );
  return { meta, academic, numericCols };
}

function assessmentStatus(assessmentKey, value) {
  if (value == null || !Number.isFinite(value)) return null;
  const rule = PASS_THRESHOLDS[assessmentKey];
  if (!rule) return null;
  return value >= rule.pass ? "PASS" : "FAIL";
}

function extractSubjectAttendanceFromRow(row, headers) {
  const out = [];
  const teacherBySubject = {};
  for (const h of headers || []) {
    if (!h || String(h).startsWith("__")) continue;
    const hs = String(h).trim();
    const tm = hs.match(/^(.+?)\s+Teacher$/i);
    if (tm) {
      const sub = tm[1].replace(/[_|]+/g, " ").replace(/\s+/g, " ").trim();
      const name = String(row[h] || "").trim();
      if (sub && name) teacherBySubject[sub] = name;
    }
  }
  for (const h of headers || []) {
    if (!h || String(h).startsWith("__")) continue;
    const hs = String(h).trim();
    const m =
      hs.match(/^(.+?)\s+Attendance\s*\%?$/i) ||
      hs.match(/^(.+?)\s+attendance\s*percent(?:age)?$/i);
    if (!m) continue;
    let subject = m[1].replace(/[_|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!subject) continue;
    if (/^(total|overall)$/i.test(subject)) continue;
    if (/total\s*attendance|overall\s*attendance/i.test(hs)) continue;
    const pct = asPercent(row[h]);
    if (pct == null) continue;
    const entry = { subject, pct, attendance: pct, percentage: pct };
    if (teacherBySubject[subject]) entry.teacherName = teacherBySubject[subject];
    out.push(entry);
  }
  return out;
}

function buildStudentMarks(row, academicCols) {
  const bySubject = {};
  for (const col of academicCols) {
    const val = toNumber(row[col.original]);
    if (val == null) continue;
    bySubject[col.subject] ??= { subject: col.subject, assessments: {}, average: null, percentage: null, total: null, statuses: {} };
    const entry = bySubject[col.subject];
    entry.assessments[col.assessment] = val;
    if (col.assessment === "RE-UT" || col.assessment === "REUT") {
      entry.assessments["RE-UT"] = val;
      entry.assessments["RE-UT-20"] = round((val / 60) * 20, 2);
      entry.statuses["RE-UT"] = assessmentStatus("RE-UT", val);
      entry.statuses["RE-UT-20"] = assessmentStatus("RE-UT-20", entry.assessments["RE-UT-20"]);
    } else if (col.assessment === "Average" || col.assessment === "Avg") {
      entry.average = val;
    } else if (col.assessment === "Pct" || col.assessment === "Percentage") {
      entry.percentage = val;
    } else if (col.assessment === "Total") {
      entry.total = val;
    } else {
      entry.statuses[col.assessment] = assessmentStatus(col.assessment, val);
    }
  }
  return Object.values(bySubject).map((m) => {
    if (m.average == null) {
      const u1 = m.assessments["UT-1"] ?? m.assessments["UT1"];
      const u2 = m.assessments["UT-2"] ?? m.assessments["UT2"];
      const u3 = m.assessments["UT-3"] ?? m.assessments["UT3"];
      const r20 = m.assessments["RE-UT-20"];
      const parts = [u1, u2, u3, r20].filter((v) => v != null && Number.isFinite(Number(v)));
      if (parts.length) m.average = round(parts.reduce((a, b) => a + Number(b), 0) / parts.length, 2);
    }
    const fails = Object.values(m.statuses).filter((s) => s === "FAIL");
    m.status = fails.length > 0 ? "FAIL" : Object.keys(m.statuses).length ? "PASS" : null;
    return m;
  });
}

const uniqueHeaders = (provided, rows) => {
  const seen = new Set();
  const headers = [];
  const push = (candidate) => {
    const key = safeText(candidate);
    if (!key || key.startsWith("__") || seen.has(key)) return;
    seen.add(key);
    headers.push(key);
  };
  if (Array.isArray(provided)) provided.forEach(push);
  rows.forEach((row) => Object.keys(row).forEach(push));
  return headers;
};
const normalizeRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (isRecord(row)) return row;
    if (!Array.isArray(row)) return null;
    return row.reduce((acc, cell, index) => { acc[`Column ${index + 1}`] = cell; return acc; }, {});
  }).filter(Boolean);
};
const normalizeUploadRecord = (candidate, index) => {
  if (!isRecord(candidate)) return null;
  const data = normalizeRows(candidate.data);
  const headers = uniqueHeaders(candidate.headers, data);
  if (headers.length === 0 && data.length === 0) return null;
  const uploadedAt = safeText(candidate.uploadedAt) || new Date().toISOString();
  return {
    id: safeText(candidate.id) || `upload-${index}-${uploadedAt}`,
    name: safeText(candidate.name, `Uploaded file ${index + 1}`),
    size: Math.max(0, toNumber(candidate.size) ?? 0),
    rows: Math.max(0, toNumber(candidate.rows) ?? data.length),
    sheets: Array.isArray(candidate.sheets) ? candidate.sheets.map((s) => safeText(s)).filter(Boolean) : [],
    uploadedAt, headers, data,
  };
};
function normalizeUploads(value) {
  if (!Array.isArray(value)) return [];
  return value.map((c, i) => normalizeUploadRecord(c, i)).filter(Boolean);
}
function createUploadRecord({ name, size, sheets, data }) {
  const headers = uniqueHeaders(undefined, data);
  return { id: globalThis.crypto?.randomUUID?.() ?? `upload-${Date.now()}`, name, size, rows: data.length, sheets, uploadedAt: new Date().toISOString(), headers, data };
}
function loadUploads() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UPLOADS_KEY) ?? "[]");
    const clean = normalizeUploads(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(clean)) window.localStorage.setItem(UPLOADS_KEY, JSON.stringify(clean));
    return clean;
  } catch { window.localStorage.removeItem(UPLOADS_KEY); return []; }
}
function saveUploads(next) {
  const clean = normalizeUploads(next);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(UPLOADS_KEY, JSON.stringify(clean));
    window.dispatchEvent(new Event(UPLOADS_EVENT));
  }
  return clean;
}
function useUploads() {
  const [uploads, setUploads] = useState([]);
  useEffect(() => {
    const read = () => setUploads(loadUploads());
    read();
    window.addEventListener(UPLOADS_EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(UPLOADS_EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  return uploads;
}

const rowSheetName = (row) => safeText(row.__sheet) || undefined;
const firstTextValue = (row, headers, excluded) => {
  const blocked = new Set(excluded.filter(Boolean));
  for (const header of headers) {
    if (blocked.has(header) || header.startsWith("__")) continue;
    const value = safeText(row[header]);
    if (value && toNumber(value) == null) return value;
  }
  return "";
};
const hasMeaningfulCells = (row, headers) => headers.some((header) => !header.startsWith("__") && safeText(row[header]) !== "");


/** Combine class / year / batch columns + sheet name into one class label (keeps TY A and TY B distinct). */
function buildClassLabel(row, meta, sheetName) {
  const year = meta.yearLevel ? safeText(row[meta.yearLevel]) : "";
  const cls = meta.cls ? safeText(row[meta.cls]) : "";
  const batchRaw = meta.batch ? safeText(row[meta.batch]) : "";

  // Section values like "TY-A", "FE B", "LY-C" are complete class labels — keep them whole
  const YEAR_BATCH_RE = /^(FY|SY|TY|TE|BE|LY|FE|SE)[\s\-_]*[A-H]$/i;
  if (batchRaw && YEAR_BATCH_RE.test(batchRaw.trim())) {
    return batchRaw.trim().toUpperCase().replace(/\s+/g, "-");
  }
  if (cls && YEAR_BATCH_RE.test(cls.trim())) {
    return cls.trim().toUpperCase().replace(/\s+/g, "-");
  }
  // "FE A" / "FIRST YEAR A" style with words
  if (batchRaw && /\b(FE|FIRST\s*YEAR|LY|SY|TY)\b/i.test(batchRaw) && /\b[A-H]\b/i.test(batchRaw)) {
    return batchRaw.trim().toUpperCase().replace(/\s+/g, " ");
  }

  const parts = [];
  if (year) parts.push(year);
  if (cls) parts.push(cls);

  let batch = batchRaw;
  if (batch && /^[A-H]$/i.test(batch.trim())) batch = batch.trim().toUpperCase();
  else if (batch) {
    const m = batch.toUpperCase().match(/\b([A-H])\b/);
    if (m) batch = m[1];
  }
  const clsUpper = (cls + " " + year).toUpperCase();
  if (batch && !new RegExp("\\b" + batch + "\\b").test(clsUpper) && !clsUpper.includes(batch)) {
    parts.push(batch);
  }

  let label = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if ((!label || label === "—") && sheetName) {
    label = safeText(sheetName);
  }
  return label || "—";
}

function classSpecificity(cls) {
  const u = String(cls || "").toUpperCase();
  let score = u.length;
  if (/\b[A-H]\b/.test(u) || /[A-H]$/.test(u.trim())) score += 50;
  if (/\b(FY|SY|TY|LY|FE|SE|TE|BE|FINAL)\b/.test(u)) score += 20;
  return score;
}

function deriveAll(sourceUploads) {
  const uploads = normalizeUploads(sourceUploads);
  const students = [];
  const studentIds = new Set();
  const subjectSums = {};
  const assessmentSums = {};
  const trendBuckets = {};
  const timetableByDay = new Map();
  const allHeaders = new Set();
  const allSubjects = new Set();
  const allAssessments = new Set();
  let rowIndex = 0;
  let pos = 0, neu = 0, neg = 0, fbTotal = 0;
  let attSum = 0, attCount = 0;
  let markSum = 0, markCount = 0;
  let atRisk = 0;
  let avgPctSum = 0, avgPctCount = 0;

  for (const upload of uploads) {
    const h = upload.headers;
    h.forEach((header) => allHeaders.add(header));
    const { meta, academic, numericCols } = classifyHeaders(h);
    for (const col of academic) { allSubjects.add(col.subject); allAssessments.add(col.assessment); }

    for (const row of upload.data) {
      rowIndex += 1;
      if (!hasMeaningfulCells(row, h)) continue;
      const attendance = meta.attendance ? asPercent(row[meta.attendance]) : null;
      const labAttendance =
        asPercent(row["Lab Attendance (%)"] ?? row["Lab Attendance"] ?? row["labAttendance"]) ?? null;
      const theoryAttendance =
        asPercent(row["Theory Attendance (%)"] ?? row["Theory Attendance"] ?? row["theoryAttendance"]) ?? null;
      const cgpaVal = meta.cgpa ? toNumber(row[meta.cgpa]) : null;
      const avgPctVal = meta.averagePct ? asPercent(row[meta.averagePct]) : null;
      const backlogs = Math.max(0, Math.round(toNumber(meta.backlog ? row[meta.backlog] : null) ?? 0));
      if (attendance != null) { attSum += attendance; attCount++; if (attendance < 75) atRisk++; }
      if (cgpaVal != null) { markSum += cgpaVal; markCount++; }
      if (avgPctVal != null) { avgPctSum += avgPctVal; avgPctCount++; }

      // Student identity = Permanent Registration Number (not Roll No. when PRN exists)
      const prn = meta.prn ? safeText(row[meta.prn]) : "";
      const normalizedPrn = normalizeIdentifier(prn);
      const fallbackId = `row-${rowIndex}`;
      const studentKey = normalizedPrn || fallbackId;
      const fallbackName = firstTextValue(row, h, [meta.prn, meta.cls, meta.email, meta.phone, meta.attendance, meta.cgpa, meta.averagePct, meta.backlog, meta.period, meta.sentiment, meta.day]);
      const marks = buildStudentMarks(row, academic);
      const subjectAttendance = extractSubjectAttendanceFromRow(row, h);
      // Student-level overall average: use Excel column if present, else roll up from real marks only
      let averagePercentageComputed = false;
      let resolvedAvgPct = avgPctVal;
      if (resolvedAvgPct == null) {
        const fromMarks = computeOverallAveragePct(marks);
        if (fromMarks != null) {
          resolvedAvgPct = fromMarks;
          averagePercentageComputed = true;
        }
      }
      // Include computed averages in cohort aggregates so stats aren't empty
      if (avgPctVal == null && resolvedAvgPct != null) {
        avgPctSum += resolvedAvgPct;
        avgPctCount++;
      }
      const legacySubjects = numericCols.map((column) => ({ subject: column, value: asPercent(row[column]) ?? toNumber(row[column]) })).filter((m) => m.value != null && m.value >= 0 && m.value <= 100);
      const looksLikeStudentRow = Boolean(normalizedPrn || meta.name || attendance != null || cgpaVal != null || backlogs > 0 || marks.length > 0 || (!meta.day && (fallbackName || legacySubjects.length > 0)));

      if (looksLikeStudentRow) {
        studentIds.add(studentKey);
        students.push({
          prn: prn || fallbackId,
          name: meta.name ? safeText(row[meta.name], fallbackName || `Student ${rowIndex}`) : fallbackName || `Student ${rowIndex}`,
          cls: buildClassLabel(row, meta, rowSheetName(row)),
          yearLevel: null,
          batch: null,
          _yearRaw:
            (meta.yearLevel ? safeText(row[meta.yearLevel]) : null) ||
            safeText(row.yearLevel) ||
            safeText(row.Year) ||
            safeText(row.year) ||
            safeText(row.Class) ||
            safeText(row.cls) ||
            safeText(row.Section) ||
            null,
          _batchRaw:
            (meta.batch ? safeText(row[meta.batch]) : null) ||
            safeText(row.batch) ||
            safeText(row.Batch) ||
            safeText(row.Section) ||
            safeText(row.Class) ||
            safeText(row.cls) ||
            null,
          attendance: attendance != null ? attendance : null,
          attendanceKnown: attendance != null,
          subjectAttendance,
          labAttendance,
          theoryAttendance,
          cgpa: cgpaVal != null ? round(cgpaVal, 2) : null,
          cgpaKnown: cgpaVal != null,
          marksKnown: marks.length > 0 || legacySubjects.length > 0,
          averagePercentage: resolvedAvgPct,
          averagePercentageComputed,
          backlogs,
          email: meta.email ? safeText(row[meta.email]) : undefined,
          phone: meta.phone ? safeText(row[meta.phone]) : undefined,
          sourceFile: upload.name,
          sourceSheet: rowSheetName(row),
          marks,
          subjects: legacySubjects.length ? legacySubjects : marks.map((m) => ({ subject: m.subject, value: m.percentage ?? m.average ?? 0 })),
          raw: row,
          ...(() => {
            const st = computeAcademicStatus(attendance ?? null, resolvedAvgPct, marks);
            return { ...st, status: st.academicStatus || statusOf(attendance, backlogs) };
          })(),
        });
      }

      for (const m of marks) {
        const v = m.percentage ?? m.average;
        if (v != null) { subjectSums[m.subject] ??= { sum: 0, count: 0 }; subjectSums[m.subject].sum += v; subjectSums[m.subject].count++; }
        for (const [aKey, aVal] of Object.entries(m.assessments)) {
          if (aVal == null) continue;
          assessmentSums[aKey] ??= { sum: 0, count: 0 };
          assessmentSums[aKey].sum += aVal;
          assessmentSums[aKey].count++;
        }
      }
      for (const column of numericCols) {
        const n = asPercent(row[column]) ?? toNumber(row[column]);
        if (n != null && n >= 0 && n <= 100) { subjectSums[column] ??= { sum: 0, count: 0 }; subjectSums[column].sum += n; subjectSums[column].count++; }
      }
      if (meta.period && attendance != null) {
        const label = safeText(row[meta.period]);
        if (label) { trendBuckets[label] ??= { sum: 0, count: 0 }; trendBuckets[label].sum += attendance; trendBuckets[label].count++; }
      }
      if (meta.sentiment) {
        const text = safeText(row[meta.sentiment]).toLowerCase();
        const rating = toNumber(row[meta.sentiment]);
        if (rating != null) { fbTotal++; if (rating >= 4) pos++; else if (rating >= 3) neu++; else neg++; }
        else if (text) { fbTotal++; if (/pos|good|great|excellent|happy|satisf/.test(text)) pos++; else if (/neg|bad|poor|unhappy|issue|problem/.test(text)) neg++; else neu++; }
      }
      if (meta.day) {
        const day = safeText(row[meta.day]);
        const slots = h.filter((header) => header !== meta.day && !header.startsWith("__")).map((header) => safeText(row[header])).filter(Boolean);
        if (day && slots.length > 0 && !timetableByDay.has(day.toLowerCase())) timetableByDay.set(day.toLowerCase(), { day, slots });
      }
    }
  }

  // Merge rows for the same PRN across multiple uploads (e.g. marks file + CGPA file)
  const byPrn = new Map();
  for (const student of students) {
    const key = normalizeIdentifier(student.prn);
    if (!key) continue;
    const prev = byPrn.get(key);
    if (!prev) {
      byPrn.set(key, { ...student });
      continue;
    }
    const merged = { ...prev };
    // Prefer non-empty identity
    if ((!prev.name || /^student\s*\d+$/i.test(prev.name)) && student.name) merged.name = student.name;
    if (!prev.email && student.email) merged.email = student.email;
    if (!prev.phone && student.phone) merged.phone = student.phone;
    // Year/batch/class from THIS upload file (VMedulife group / CLASS line) win together.
    // Never keep cls=TY-A while yearLevel becomes LY from a later file.
    {
      const can = applyCanonicalYearBatch({ ...student, cls: student.cls || student.className });
      const incomingYear = can.yearLevel || normalizeYearLevel(student.yearLevel) || normalizeYearLevel(student._yearRaw);
      const incomingBatch = can.batch || normalizeBatch(student.batch) || normalizeBatch(student._batchRaw);
      if (incomingYear) {
        merged.yearLevel = incomingYear;
        if (incomingBatch) merged.batch = incomingBatch;
        // Rebuild class label from file year so Students filter matches the sheet
        if (incomingBatch) {
          merged.cls = `${incomingYear} CSE ${incomingBatch}`;
          merged.className = merged.cls;
        } else if (student.cls && student.cls !== "—") {
          merged.cls = student.cls;
          merged.className = student.cls;
        }
      } else if (student.cls && student.cls !== "—") {
        if (prev.cls === "—" || !prev.cls || classSpecificity(student.cls) > classSpecificity(prev.cls)) {
          merged.cls = student.cls;
          merged.className = student.cls;
        }
        const fromCls = applyCanonicalYearBatch({ cls: merged.cls });
        if (fromCls.yearLevel) merged.yearLevel = fromCls.yearLevel;
        if (fromCls.batch) merged.batch = fromCls.batch;
      }
    }
    if (student.attendanceKnown) {
      merged.attendance = student.attendance;
      merged.attendanceKnown = true;
    }
    if (Array.isArray(student.subjectAttendance) && student.subjectAttendance.length) {
      const bySub = new Map();
      for (const sa of merged.subjectAttendance || []) {
        if (sa?.subject) bySub.set(String(sa.subject), sa);
      }
      for (const sa of student.subjectAttendance) {
        if (sa?.subject) bySub.set(String(sa.subject), sa);
      }
      merged.subjectAttendance = Array.from(bySub.values());
    }
    if (student.labAttendance != null) merged.labAttendance = student.labAttendance;
    if (student.theoryAttendance != null) merged.theoryAttendance = student.theoryAttendance;
    if (student.cgpaKnown) {
      merged.cgpa = student.cgpa;
      merged.cgpaKnown = true;
    }
    if (student.averagePercentage != null) {
      // Prefer an explicit Excel average over a previously computed one
      if (!student.averagePercentageComputed || merged.averagePercentage == null) {
        merged.averagePercentage = student.averagePercentage;
        merged.averagePercentageComputed = Boolean(student.averagePercentageComputed);
      }
    }
    if (student.backlogs > (prev.backlogs || 0)) merged.backlogs = student.backlogs;
    // Marks: merge by subject. If this upload is a different year with marks, replace
    // previous year's subjects so TY never stays on an LY student (and vice versa).
    const prevY = normalizeYearLevel(prev.yearLevel) || normalizeYearLevel(prev.cls);
    const nextY = normalizeYearLevel(merged.yearLevel) || normalizeYearLevel(merged.cls) || normalizeYearLevel(student.yearLevel);
    const incomingMarks = student.marks || [];
    const yearChangedWithMarks =
      Boolean(nextY) && Boolean(prevY) && nextY !== prevY && incomingMarks.length > 0;

    const markMap = new Map();
    if (!yearChangedWithMarks) {
      for (const m of prev.marks || []) {
        markMap.set(m.subject, { ...m, assessments: { ...m.assessments }, statuses: { ...m.statuses } });
      }
    }
    for (const m of incomingMarks) {
      const existing = markMap.get(m.subject);
      if (!existing) {
        markMap.set(m.subject, { ...m, assessments: { ...m.assessments }, statuses: { ...m.statuses } });
      } else {
        existing.assessments = { ...existing.assessments, ...m.assessments };
        existing.statuses = { ...existing.statuses, ...m.statuses };
        if (m.average != null) existing.average = m.average;
        if (m.percentage != null) existing.percentage = m.percentage;
        if (m.total != null) existing.total = m.total;
        if (m.status) existing.status = m.status;
      }
    }
    merged.marks = Array.from(markMap.values());
    merged.marksKnown = merged.marks.length > 0 || prev.marksKnown || student.marksKnown;
    // After marks merge, fill average from subjects if still missing
    if (merged.averagePercentage == null) {
      const fromMarks = computeOverallAveragePct(merged.marks);
      if (fromMarks != null) {
        merged.averagePercentage = fromMarks;
        merged.averagePercentageComputed = true;
      }
    }
    // Subjects metrics
    if ((student.subjects || []).length > (prev.subjects || []).length) merged.subjects = student.subjects;
    merged.status = statusOf(
      merged.attendanceKnown ? merged.attendance : null,
      merged.backlogs || 0
    );
    merged.raw = { ...prev.raw, ...student.raw };
    const recomputed = computeAcademicStatus(
      merged.attendanceKnown ? merged.attendance : null,
      merged.averagePercentage,
      merged.marks
    );
    Object.assign(merged, recomputed);
    byPrn.set(key, merged);
  }
  const dedupedStudents = Array.from(byPrn.values());
  const subjectAvgMarks = Object.entries(subjectSums).filter(([, v]) => v.count > 0).map(([subject, v]) => ({ subject, avg: round(v.sum / v.count, 1) })).sort((a, b) => b.avg - a.avg);
  const assessmentAvgMarks = Object.entries(assessmentSums).filter(([, v]) => v.count > 0).map(([assessment, v]) => ({ assessment, avg: round(v.sum / v.count, 1) })).sort((a, b) => a.assessment.localeCompare(b.assessment));
  let attendanceTrend = Object.entries(trendBuckets).map(([label, v]) => ({ label, value: round(v.sum / v.count, 1) }));
  if (attendanceTrend.length === 0) {
    attendanceTrend = uploads.map((upload) => {
      const attKey = findKey(upload.headers, KEY_PATTERNS.attendance);
      if (!attKey) return null;
      let sum = 0, count = 0;
      for (const row of upload.data) { const value = asPercent(row[attKey]); if (value != null) { sum += value; count++; } }
      return count ? { label: upload.name.slice(0, 16), value: round(sum / count, 1) } : null;
    }).filter(Boolean);
  }
  let passCount = 0, failCount = 0;
  for (const s of dedupedStudents) for (const m of s.marks || []) { if (m.status === "PASS") passCount++; else if (m.status === "FAIL") failCount++; }

  return {
    stats: {
      totalFiles: uploads.length,
      totalRows: uploads.reduce((sum, u) => sum + u.data.length, 0),
      totalStudents: studentIds.size,
      avgAttendance: attCount ? round(attSum / attCount, 1) : null,
      avgMarks: markCount ? round(markSum / markCount, 1) : null,
      avgPercentage: avgPctCount ? round(avgPctSum / avgPctCount, 1) : null,
      atRisk, passCount, failCount,
      passPct: passCount + failCount > 0 ? round((passCount / (passCount + failCount)) * 100, 1) : null,
    },
    students: finalizeStudents(dedupedStudents),
    subjectAvgMarks, assessmentAvgMarks,
    detectedSubjects: Array.from(allSubjects).sort(),
    detectedAssessments: Array.from(allAssessments).sort(),
    attendanceTrend,
    feedback: fbTotal ? { total: fbTotal, positive: Math.round((pos / fbTotal) * 100), neutral: Math.round((neu / fbTotal) * 100), negative: Math.round((neg / fbTotal) * 100) } : null,
    timetable: Array.from(timetableByDay.values()),
    headers: Array.from(allHeaders),
    hasData: uploads.length > 0,
  };
}

function computeStats(uploads) { return deriveAll(uploads).stats; }

/** Merge Atlas cohort with browser upload derive — never drop marks/attendance when placement creates thin AcademicRecords. */
/** Merge Atlas + browser academic uploads. Academic marks/attendance/year always win over placement-only rows. */
function academicRichness(s) {
  if (!s) return 0;
  let score = 0;
  const marks = s.marks || [];
  if (marks.length) score += 10 + Math.min(marks.length, 20);
  if (s.marksKnown) score += 5;
  if (s.attendanceKnown && s.attendance != null) score += 10;
  if ((s.subjectAttendance || []).length) score += 5;
  if (s.averagePercentage != null) score += 2;
  return score;
}

function mergeServerAndUploadStudents(serverStudents, uploadStudents) {
  const byPrn = new Map();

  function ensure(prn, seed) {
    if (!byPrn.has(prn)) byPrn.set(prn, { ...seed });
    return byPrn.get(prn);
  }

  for (const s of serverStudents || []) {
    const prn = String(s?.prn || "").trim();
    if (!prn) continue;
    byPrn.set(prn, { ...s });
  }

  for (const s of uploadStudents || []) {
    const prn = String(s?.prn || "").trim();
    if (!prn) continue;
    const prev = byPrn.get(prn);
    if (!prev) {
      byPrn.set(prn, { ...s });
      continue;
    }

    const merged = { ...prev };
    const upRich = academicRichness(s);
    const prevRich = academicRichness(prev);
    const academicWins = upRich >= prevRich && upRich > 0;

    // Name: prefer non-empty
    if ((!merged.name || merged.name === prn) && s.name) merged.name = s.name;

    // Marks — academic upload never loses to empty placement row
    const prevMarks = Array.isArray(merged.marks) ? merged.marks : [];
    const upMarks = Array.isArray(s.marks) ? s.marks : [];
    if (upMarks.length && !prevMarks.length) {
      merged.marks = upMarks;
      merged.marksKnown = true;
    } else if (upMarks.length && prevMarks.length) {
      const map = new Map();
      for (const m of prevMarks) {
        if (m?.subject)
          map.set(String(m.subject), {
            ...m,
            assessments: { ...(m.assessments || {}) },
            statuses: { ...(m.statuses || {}) },
          });
      }
      for (const m of upMarks) {
        if (!m?.subject) continue;
        const key = String(m.subject);
        const ex = map.get(key);
        if (!ex) {
          map.set(key, {
            ...m,
            assessments: { ...(m.assessments || {}) },
            statuses: { ...(m.statuses || {}) },
          });
        } else {
          ex.assessments = { ...ex.assessments, ...(m.assessments || {}) };
          ex.statuses = { ...ex.statuses, ...(m.statuses || {}) };
          if (m.average != null) ex.average = m.average;
          if (m.percentage != null) ex.percentage = m.percentage;
        }
      }
      merged.marks = Array.from(map.values());
      merged.marksKnown = merged.marks.length > 0;
    }

    // Attendance — keep any known value; prefer academic upload if server empty
    if (s.attendanceKnown && s.attendance != null) {
      if (!merged.attendanceKnown || merged.attendance == null || academicWins) {
        merged.attendance = s.attendance;
        merged.attendanceKnown = true;
      }
    }
    if (s.labAttendance != null && (merged.labAttendance == null || academicWins))
      merged.labAttendance = s.labAttendance;
    if (s.theoryAttendance != null && (merged.theoryAttendance == null || academicWins))
      merged.theoryAttendance = s.theoryAttendance;
    if ((s.subjectAttendance || []).length) {
      if (!(merged.subjectAttendance || []).length || academicWins) {
        merged.subjectAttendance = s.subjectAttendance;
      }
    }
    if (s.averagePercentage != null) {
      if (merged.averagePercentage == null || academicWins) {
        merged.averagePercentage = s.averagePercentage;
        merged.averagePercentageComputed = s.averagePercentageComputed;
      }
    }
    if (s.cgpaKnown && s.cgpa != null && !merged.cgpaKnown) {
      merged.cgpa = s.cgpa;
      merged.cgpaKnown = true;
    }

    // Year / batch / class — academic upload always wins when it carries academic data
    if (upRich > 0) {
      if (s.cls) {
        merged.cls = s.cls;
        merged.className = s.className || s.cls;
      }
      if (s.yearLevel) merged.yearLevel = s.yearLevel;
      if (s.batch) merged.batch = s.batch;
      if (s.group) merged.group = s.group;
      if (s.sourceGroup) merged.sourceGroup = s.sourceGroup;
      merged.academicYearLocked = true;
    } else if (prevRich === 0) {
      if (s.cls) {
        merged.cls = s.cls;
        merged.className = s.className || s.cls;
      }
      if (s.yearLevel) merged.yearLevel = s.yearLevel;
      if (s.batch) merged.batch = s.batch;
    } else {
      if (!merged.cls && s.cls) {
        merged.cls = s.cls;
        merged.className = s.className || s.cls;
      }
      if (!merged.yearLevel && s.yearLevel) merged.yearLevel = s.yearLevel;
      if (!merged.batch && s.batch) merged.batch = s.batch;
    }

    byPrn.set(prn, merged);
  }

  return Array.from(byPrn.values());
}

function useDerived() {
  const uploads = useUploads();
  const [serverCohort, setServerCohort] = useState(() => getCachedCohort());

  useEffect(() => {
    // Instant from memory/localStorage — network only if cache empty/stale (handled inside fetch)
    setServerCohort(getCachedCohort());
    fetchCohortFromServer().then(setServerCohort).catch(() => {});
    return subscribeCohort(setServerCohort);
  }, []);

  return useMemo(() => {
    const derived = deriveAll(uploads);
    const uploadStudents = derived.students || [];
    // MongoDB is shared source of truth, but placement-feature upserts create thin rows
    // (name/year only). Always merge with local academic uploads so marks/attendance return.
    if (serverCohort?.students?.length) {
      const merged = mergeServerAndUploadStudents(serverCohort.students, uploadStudents);
      const students = finalizeStudents(merged);
      const attVals = students.filter((s) => s.attendanceKnown && s.attendance != null);
      const markKnown = students.filter((s) => s.marksKnown || (s.marks || []).length > 0).length;
      return {
        ...derived,
        students,
        stats: {
          ...derived.stats,
          totalStudents: students.length,
          avgAttendance: attVals.length
            ? Math.round(
                (attVals.reduce((s, x) => s + x.attendance, 0) / attVals.length) * 10
              ) / 10
            : null,
          source: uploadStudents.length ? "mongodb+uploads" : "mongodb",
          withMarks: markKnown,
        },
        source: uploadStudents.length ? "mongodb+uploads" : "mongodb",
      };
    }
    if (!uploadStudents.length) {
      return {
        ...derived,
        students: [],
        stats: {
          ...derived.stats,
          totalStudents: 0,
          avgAttendance: null,
          source: "empty",
        },
        source: "empty",
      };
    }
    return { ...derived, source: "uploaded" };
  }, [uploads, serverCohort]);
}
function findStudentByPrn(students, prn) {
  const target = normalizeIdentifier(prn);
  if (!target) return undefined;
  return students.find((s) => normalizeIdentifier(s.prn) === target);
}
function rawEntries(row) {
  return Object.entries(row).filter(([key]) => !key.startsWith("__")).map(([key, value]) => [key, safeText(value, "—")]);
}
function initials(name) {
  const value = safeText(name, "Student");
  return value.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("") || "ST";
}

function studentPortalData(students, prn) {
  const uploaded = findStudentByPrn(students, prn);
  const assessmentKeys = new Set();
  if (uploaded?.marks?.length) {
    for (const m of uploaded.marks) Object.keys(m.assessments || {}).forEach((k) => assessmentKeys.add(k));
  }

  // Production: no demo marks/subjects when the student is not in the uploaded cohort
  const marks = uploaded?.marks?.length ? uploaded.marks : [];
  let subjectMetrics = [];
  const subjAtt = uploaded?.subjectAttendance;
  if (Array.isArray(subjAtt) && subjAtt.length) {
    subjectMetrics = subjAtt.map((sa) => {
      const name = sa.subject || sa.name || sa.code || "Subject";
      const pct =
        sa.pct != null
          ? Number(sa.pct)
          : sa.percentage != null
            ? Number(sa.percentage)
            : sa.attendance != null
              ? Number(sa.attendance)
              : null;
      let present = sa.present != null ? Number(sa.present) : sa.presentCount != null ? Number(sa.presentCount) : null;
      let total =
        sa.total != null
          ? Number(sa.total)
          : sa.scheduled != null
            ? Number(sa.scheduled)
            : sa.sessions != null
              ? Number(sa.sessions)
              : null;
      let absent =
        sa.absent != null ? Number(sa.absent) : sa.absentCount != null ? Number(sa.absentCount) : null;
      if (present == null && total != null && pct != null) present = Math.round((pct / 100) * total);
      if (total == null && present != null && absent != null) total = present + absent;
      if (absent == null && total != null && present != null) absent = Math.max(0, total - present);
      if (pct != null && present == null && total == null) {
        // percent-only: show on 100 scale for display
        present = Math.round(pct);
        absent = Math.max(0, 100 - present);
        total = 100;
      }
      const attendancePct =
        pct != null
          ? Math.round(pct * 10) / 10
          : total
            ? Math.round((present / total) * 1000) / 10
            : null;
      return {
        code: String(name).slice(0, 8).toUpperCase(),
        name,
        present: present ?? 0,
        absent: absent ?? 0,
        total: total ?? 0,
        attendancePct,
      };
    });
  } else if (uploaded?.subjects?.length) {
    // legacy subjects as % only
    subjectMetrics = uploaded.subjects.map((s) => {
      const pct = Number(s.value);
      return {
        code: String(s.subject || "").slice(0, 8).toUpperCase(),
        name: s.subject,
        present: Number.isFinite(pct) ? Math.round(pct) : 0,
        absent: Number.isFinite(pct) ? Math.max(0, 100 - Math.round(pct)) : 0,
        total: 100,
        attendancePct: Number.isFinite(pct) ? pct : null,
      };
    });
  }

  const att = uploaded?.attendanceKnown ? uploaded.attendance : null;
  const cgpaKnown = Boolean(uploaded?.cgpaKnown);
  const cgpa = cgpaKnown ? uploaded.cgpa : null;
  let avgPct = uploaded?.averagePercentage ?? null;
  let averagePercentageComputed = Boolean(uploaded?.averagePercentageComputed);
  if (avgPct == null && uploaded?.marks?.length) {
    const fromMarks = computeOverallAveragePct(uploaded.marks);
    if (fromMarks != null) {
      avgPct = fromMarks;
      averagePercentageComputed = true;
    }
  }
  const failSubjects = (uploaded?.marks || []).filter((m) => m.status === "FAIL").length;
  let risk = "Unknown";
  if (uploaded) {
    risk = "Low Risk";
    const cgpaForRisk = cgpaKnown ? cgpa : 8;
    const attSafe = att ?? 100;
    if (attSafe < 65 || cgpaForRisk < 6.5 || failSubjects >= 3) risk = "High Risk";
    else if (attSafe < 75 || cgpaForRisk < 7.5 || failSubjects >= 1) risk = "Medium Risk";
  }

  // Current Academic Status — shared rules (academic-status.js). Not the ML early-warning prediction.
  let academicStatus = null;
  let predictedAveragePct = null;
  if (uploaded) {
    const statusResult = computeAcademicStatus(att, avgPct, marks);
    academicStatus = statusResult.academicStatus;
    predictedAveragePct = statusResult.predictedAveragePct;
  }

  return {
    source: uploaded ? "uploaded" : "empty",
    name: uploaded?.name ?? (prn ? `Student ${prn}` : "Student"),
    prn: uploaded?.prn ?? safeText(prn, ""),
    className: uploaded?.cls ?? "",
    email: uploaded?.email || "",
    phone: uploaded?.phone || "",
    attendance: att,
    cgpa,
    cgpaKnown,
    sgpa: cgpaKnown ? uploaded.cgpa : null,
    averagePercentage: avgPct ?? null,
    averagePercentageComputed,
    backlogs: uploaded?.backlogs ?? null,
    status: uploaded?.status ?? null,
    risk,
    academicStatus,
    predictedAveragePct,
    subjects: subjectMetrics,
    marks,
    assessmentKeys: Array.from(assessmentKeys).sort(),
    sgpaTrend: [],
    raw: uploaded?.raw ?? {},
    hasAcademicRecord: Boolean(uploaded),
    subjectAttendance: Array.isArray(uploaded?.subjectAttendance) ? uploaded.subjectAttendance : [],
    labAttendance: uploaded?.labAttendance ?? null,
    theoryAttendance: uploaded?.theoryAttendance ?? null,
    yearLevel: uploaded?.yearLevel ?? null,
    batch: uploaded?.batch ?? null,
  };
}

function portalTimetable(derived) {
  return derived.timetable.length ? derived.timetable : [];
}

function preferredAssessmentOrder(keys) {
  const preferred = ["UT-1", "UT1", "UT-2", "UT2", "UT-3", "UT3", "RE-UT", "REUT", "RE-UT-20", "REUT20", "Quiz-1", "Quiz-2", "Midterm", "Assignment", "Practical", "Viva", "Internal", "End Semester", "Average", "Avg", "Pct", "Percentage", "Total", "LAB_Pct", "LAB_Total"];
  const ordered = [];
  for (const p of preferred) if (keys.includes(p)) ordered.push(p);
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);
  return ordered;
}

/**
 * Dry-run mapping report for Excel upload preview.
 * Returns column mapping, confidence, warnings, and sample issues without writing to Mongo.
 */

/**
 * Data preprocessing: keep only columns the portal needs; ignore the rest.
 * Needed roles: identity (PRN/Roll), name, class/section/year, attendance,
 * CGPA/average/backlogs, contact, subject assessment marks, feedback, timetable day.
 * Everything else (serial no duplicates, remarks, signatures, empty Column N, etc.) is dropped.
 */
function isNeededHeader(header, map, academicSubjects) {
  if (!header || header === "__sheet") return false;
  const h = String(header);
  const mapped = Object.values(map || {}).filter(Boolean);
  if (mapped.includes(h)) return true;
  if (academicSubjects && academicSubjects.has(h)) return true;
  if (parseAcademicColumn(h)?.subject) return true;
  // VMedulife / attendance-report extras
  if (/attendance|lab\s*attendance|theory\s*attendance|section|batch|group|class|prn|name|teacher/i.test(h)) {
    return true;
  }
  return false;
}

function collectAcademicHeaders(headers) {
  const set = new Set();
  for (const h of headers || []) {
    if (parseAcademicColumn(h)?.subject) set.add(h);
  }
  return set;
}

/**
 * @returns {{
 *   keptColumns: { header: string, role: string }[],
 *   ignoredColumns: string[],
 *   rows: object[],
 *   droppedCellCount: number,
 *   cleanedCellCount: number,
 * }}
 */
function preprocessUpload(headers, rows) {
  const map = resolveColumnMap(headers);
  const academic = collectAcademicHeaders(headers);
  const roleByHeader = {};
  const roleLabels = {
    prn: "PRN",
    roll: "Roll No",
    name: "Name",
    cls: "Class",
    section: "Section / batch",
    yearLevel: "Year",
    email: "Email",
    phone: "Phone",
    attendance: "Attendance %",
    cgpa: "CGPA",
    averagePct: "Average %",
    backlogs: "Backlogs",
    feedback: "Feedback text",
    day: "Timetable day",
    period: "Period",
  };
  for (const [role, header] of Object.entries(map)) {
    if (!header || role === "identity" || role === "identityIsPrn") continue;
    roleByHeader[header] = roleLabels[role] || role;
  }
  for (const h of academic) {
    if (!roleByHeader[h]) roleByHeader[h] = "Subject assessment";
  }

  const keptHeaders = (headers || []).filter((h) => isNeededHeader(h, map, academic));
  const ignoredColumns = (headers || []).filter(
    (h) => h && h !== "__sheet" && !keptHeaders.includes(h)
  );

  const keptColumns = keptHeaders.map((h) => ({
    header: h,
    role: roleByHeader[h] || "Kept",
  }));

  const messyPatterns = [/#N\/?A/i, /defaulter/i, /^-+$/, /^n\/?a$/i, /not available/i, /null/i];
  let droppedCellCount = 0;
  let cleanedCellCount = 0;

  const out = [];
  for (const row of rows || []) {
    const lean = {};
    if (row.__sheet) lean.__sheet = row.__sheet;
    let hasIdentity = false;
    for (const h of keptHeaders) {
      let v = row[h];
      if (v == null) {
        lean[h] = "";
        continue;
      }
      const s = String(v).trim();
      if (messyPatterns.some((re) => re.test(s))) {
        lean[h] = "";
        cleanedCellCount += 1;
      } else {
        lean[h] = s === "" ? "" : v;
      }
    }
    const idKey = map.prn || map.roll;
    if (idKey && String(lean[idKey] || "").trim()) hasIdentity = true;
    // Drop fully empty / no-identity rows for roster sheets
    const anyVal = keptHeaders.some((h) => String(lean[h] ?? "").trim() !== "");
    if (!anyVal) {
      droppedCellCount += 1;
      continue;
    }
    // Keep rows without identity only if they look like timetable (day column)
    if (!hasIdentity && !map.day) {
      droppedCellCount += 1;
      continue;
    }
    out.push(lean);
  }

  return {
    keptColumns,
    ignoredColumns,
    rows: out,
    originalRowCount: (rows || []).length,
    keptRowCount: out.length,
    droppedRowCount: Math.max(0, (rows || []).length - out.length),
    droppedCellCount,
    cleanedCellCount,
    keptHeaderCount: keptHeaders.length,
    ignoredHeaderCount: ignoredColumns.length,
  };
}

function analyzeUploadMapping(headers, sampleRows = []) {
  const map = resolveColumnMap(headers);
  const warnings = [];
  const issues = [];
  const detected = [];

  const roleLabels = {
    prn: "Permanent Registration Number",
    roll: "Roll No (fallback only)",
    name: "Student name",
    cls: "Class / programme",
    section: "Section / batch",
    attendance: "Overall attendance %",
    cgpa: "CGPA",
    averagePct: "Average %",
    backlogs: "Backlogs",
    email: "Email",
    phone: "Phone",
    day: "Timetable day",
  };

  for (const [role, label] of Object.entries(roleLabels)) {
    if (map[role]) {
      detected.push({ role, label, column: map[role], confidence: "high" });
    }
  }

  if (!map.prn && !map.roll) {
    warnings.push({
      level: "error",
      message: "No PRN or Roll No column detected. Identity mapping will fail.",
    });
  } else if (!map.prn && map.roll) {
    warnings.push({
      level: "warn",
      message:
        "Only Roll No detected (no PRN). Roll numbers restart per batch and can merge different students — prefer a Permanent Registration Number column.",
    });
  }
  if (!map.name) {
    warnings.push({ level: "warn", message: "No student name column detected." });
  }
  if (!map.attendance) {
    warnings.push({
      level: "warn",
      message: "No overall attendance column detected. At-risk rules may use defaults.",
    });
  }

  // Academic subject columns
  let subjectCols = 0;
  for (const h of headers || []) {
    const parsed = parseAcademicColumn(h);
    if (parsed?.subject) subjectCols++;
  }
  if (subjectCols === 0) {
    warnings.push({
      level: "info",
      message: "No Subject_Assessment style mark columns detected (e.g. DS_UT-1).",
    });
  } else {
    detected.push({
      role: "marks",
      label: "Subject assessments",
      column: `${subjectCols} columns`,
      confidence: "high",
    });
  }

  // Scan sample rows for messy values
  const messyPatterns = [/#N\/?A/i, /defaulter/i, /absent/i, /^-+$/, /^n\/?a$/i, /not available/i];
  let messyCount = 0;
  let emptyPrn = 0;
  const idKey = map.prn || map.roll;
  for (const row of (sampleRows || []).slice(0, 200)) {
    if (idKey) {
      const id = String(row[idKey] ?? "").trim();
      if (!id) emptyPrn++;
    }
    for (const h of headers || []) {
      const v = String(row[h] ?? "").trim();
      if (messyPatterns.some((re) => re.test(v))) {
        messyCount++;
        if (issues.length < 12) {
          issues.push({
            column: h,
            value: v.slice(0, 40),
            note: "Non-numeric / special marker (treated as missing where numeric expected)",
          });
        }
      }
    }
  }
  if (messyCount > 0) {
    warnings.push({
      level: "info",
      message: `Found ${messyCount} cells with markers like #N/A, Defaulter, Absent in the first 200 rows — they will be treated as missing values.`,
    });
  }
  if (emptyPrn > 0) {
    warnings.push({
      level: "warn",
      message: `${emptyPrn} sample rows have empty identity (${idKey || "PRN"}).`,
    });
  }

  const critical = warnings.some((w) => w.level === "error");
  const confidence = critical ? "low" : warnings.some((w) => w.level === "warn") ? "medium" : "high";

  const preprocess = preprocessUpload(headers, sampleRows);
  if (preprocess.ignoredHeaderCount > 0) {
    warnings.push({
      level: "info",
      message: `Preprocess will keep ${preprocess.keptHeaderCount} column(s) and ignore ${preprocess.ignoredHeaderCount} unused column(s).`,
    });
  }
  if (preprocess.cleanedCellCount > 0) {
    warnings.push({
      level: "info",
      message: `Preprocess will clear ${preprocess.cleanedCellCount} messy cell(s) (#N/A, Defaulter, etc.).`,
    });
  }

  return {
    map,
    detected,
    warnings,
    issues,
    confidence,
    subjectColumnCount: subjectCols,
    canCommit: !critical,
    preprocess,
  };
}

export {
  UPLOADS_EVENT, UPLOADS_KEY, PASS_THRESHOLDS, assessmentStatus, analyzeUploadMapping, preprocessUpload,
  computeOverallAveragePct, computeStats,
  createUploadRecord, deriveAll, findKey, resolveColumnMap, findStudentByPrn, initials, loadUploads, normalizeIdentifier,
  normalizeUploads, parseAcademicColumn, portalTimetable, preferredAssessmentOrder, rawEntries, saveUploads,
  studentPortalData, toNumber, useDerived, useUploads,
};
