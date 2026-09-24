import { normalizeYearLevel, normalizeBatch } from "@/lib/year-batch";
/**
 * Dynamic identity-only Excel parser for System Admin roster.
 * Accepts attendance sheets, marks sheets, combined files, VMedulife HTML .xls —
 * keeps Permanent Registration Number + name only; ignores every other column.
 */
import * as XLSX from "xlsx";
import { parseVmedulifeAttendanceHtml } from "@/lib/vmedulife-attendance";

const SKIP_SHEET = /merge\s*summary|summary|instruction|readme|meta/i;

function normKey(k) {
  return String(k || "")
    .toLowerCase()
    .replace(/[\s._\-()/]+/g, "")
    .trim();
}

/** True if header looks like a Permanent Registration Number column */
function isPrnHeader(key) {
  const k = normKey(key);
  if (!k) return false;
  if (k === "prn" || k === "prno" || k === "prnnumber" || k === "prnno") return true;
  if (k.includes("permanentregistration")) return true;
  if (k.includes("prn") && !k.includes("print")) return true;
  if (k === "regno" || k === "registrationno" || k === "registrationnumber") return true;
  if (k === "enrollmentno" || k === "enrolmentno" || k === "enrollno") return true;
  return false;
}

/** True if header looks like a student name column (not subject name, etc.) */
function isNameHeader(key) {
  const k = normKey(key);
  if (!k) return false;
  if (k === "name" || k === "studentname" || k === "student" || k === "fullname") return true;
  if (k.includes("studentname") || k.includes("fullnameofstudent")) return true;
  if (k === "fullname" || k.endsWith("studentname")) return true;
  // Avoid matching "filename", "username" as weak — still allow pure "name"
  if (k.includes("name") && !k.includes("file") && !k.includes("user") && !k.includes("scheme") && !k.includes("subject")) {
    if (k.includes("student") || k === "name" || k.startsWith("name")) return true;
  }
  return false;
}

function isClassHeader(key) {
  const k = normKey(key);
  return (
    k === "class" ||
    k === "classname" ||
    k === "section" ||
    k === "batch" ||
    k === "year" ||
    k === "yearlevel" ||
    k === "group" ||
    k === "division" ||
    k.includes("class")
  );
}

function detectYear(text) {
  return normalizeYearLevel(text);
}

function detectBatch(text) {
  return normalizeBatch(text);
}

function looksLikePrnValue(v) {
  const s = String(v || "").trim();
  if (!s || s.length < 4) return false;
  // Typical BVU / college PRN: mostly digits, optional leading year digits
  if (/^\d{6,}$/.test(s)) return true;
  if (/^[A-Z0-9]{6,}$/i.test(s) && /\d/.test(s)) return true;
  return false;
}

/**
 * Map object-row keys to prn / name / class using header heuristics.
 */
function extractFromObjectRow(row) {
  let prn = "";
  let name = "";
  let cls = "";
  const entries = Object.entries(row || {});

  for (const [key, val] of entries) {
    if (isPrnHeader(key) && val != null && String(val).trim()) {
      prn = String(val).trim();
      break;
    }
  }
  for (const [key, val] of entries) {
    if (isNameHeader(key) && val != null && String(val).trim()) {
      name = String(val).trim();
      break;
    }
  }
  for (const [key, val] of entries) {
    if (isClassHeader(key) && val != null && String(val).trim()) {
      cls = String(val).trim();
      break;
    }
  }

  // Fallback: scan values if headers unknown — first PRN-like cell + first long alpha name
  if (!prn) {
    for (const [, val] of entries) {
      if (looksLikePrnValue(val)) {
        prn = String(val).trim();
        break;
      }
    }
  }
  if (!name) {
    for (const [key, val] of entries) {
      if (isPrnHeader(key)) continue;
      const s = String(val || "").trim();
      if (s.length >= 3 && /[A-Za-z]{2,}/.test(s) && !looksLikePrnValue(s) && !/^\d+(\.\d+)?%?$/.test(s)) {
        // skip obvious marks headers
        if (/ut-?\d|attendance|total|average|percent/i.test(key)) continue;
        name = s;
        break;
      }
    }
  }

  return { prn, name, cls };
}

function isHtmlBuffer(buf) {
  try {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 200)).trim().toLowerCase();
    return head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<table");
  } catch {
    return false;
  }
}

/**
 * @returns {{ students: Array<{prn,name,yearLevel,batch}>, meta: object }}
 */
export async function parseIdentityRosterFromFile(file) {
  const buf = await file.arrayBuffer();
  const meta = {
    fileName: file.name,
    sheetsScanned: 0,
    rowsSeen: 0,
    ignoredColumnsSample: [],
    source: "excel",
  };

  // VMedulife often exports HTML disguised as .xls
  if (isHtmlBuffer(buf) || /\.xls$/i.test(file.name)) {
    try {
      const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      if (html.includes("<table") || html.includes("<TABLE")) {
        const parsed = parseVmedulifeAttendanceHtml(html);
        const students = [];
        const seen = new Set();
        for (const s of parsed.students || []) {
          const prn = String(s.prn || "").trim();
          if (!prn || seen.has(prn)) continue;
          seen.add(prn);
          students.push({
            prn,
            name: String(s.name || `Student ${prn}`).trim(),
            yearLevel: s.yearLevel || detectYear(s.cls || s.className) || null,
            batch: s.batch || detectBatch(s.cls || s.className) || null,
          });
        }
        if (students.length) {
          meta.source = "vmedulife_html";
          meta.rowsSeen = (parsed.students || []).length;
          return { students, meta };
        }
      }
    } catch {
      /* fall through to XLSX */
    }
  }

  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const byPrn = new Map();
  const ignoredHeaders = new Set();

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEET.test(sheetName)) continue;
    meta.sheetsScanned += 1;
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    if (!rows.length) continue;

    // Record non-identity headers once for transparency
    const sample = rows[0] || {};
    for (const key of Object.keys(sample)) {
      if (!isPrnHeader(key) && !isNameHeader(key) && !isClassHeader(key)) {
        ignoredHeaders.add(String(key));
      }
    }

    for (const row of rows) {
      meta.rowsSeen += 1;
      const { prn, name, cls } = extractFromObjectRow(row);
      if (!prn) continue;
      const cleanPrn = prn.replace(/\s+/g, "");
      if (!cleanPrn) continue;
      const displayName = (name || "").trim() || `Student ${cleanPrn}`;
      // Skip header-like rows accidentally parsed
      if (/^prn$/i.test(cleanPrn) || /^name$/i.test(displayName)) continue;

      const yearLevel = detectYear(cls) || detectYear(sheetName) || null;
      const batch = detectBatch(cls) || null;
      const prev = byPrn.get(cleanPrn);
      if (!prev) {
        byPrn.set(cleanPrn, {
          prn: cleanPrn,
          name: displayName,
          yearLevel,
          batch,
        });
      } else {
        // Prefer longer real name over placeholder
        if (prev.name.startsWith("Student ") && !displayName.startsWith("Student ")) {
          prev.name = displayName;
        }
        if (!prev.yearLevel && yearLevel) prev.yearLevel = yearLevel;
        if (!prev.batch && batch) prev.batch = batch;
      }
    }
  }

  meta.ignoredColumnsSample = Array.from(ignoredHeaders).slice(0, 12);
  return { students: Array.from(byPrn.values()), meta };
}
