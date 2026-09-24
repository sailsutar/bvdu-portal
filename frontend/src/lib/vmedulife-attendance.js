import { normalizeYearLevel, normalizeBatch, parseYearBatch } from "@/lib/year-batch";
/**
 * Parse VMedulife Attendance Report exports (.xls as HTML table).
 * Extracts: students, PRN, group→year/batch, subject+lab attendance,
 * faculty→teacher map, report date range (for bunk analysis).
 */

function textContent(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

/** Very small HTML table → grid with colspan/rowspan expanded */
export function htmlTableToGrid(html) {
  let table = null;
  try {
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(html, "text/html");
      table = doc?.querySelector?.("table") || doc?.body?.querySelector?.("table") || null;
    }
  } catch (e) {
    table = null;
  }
  if (!table && typeof document !== "undefined") {
    try {
      const d = document.createElement("div");
      d.innerHTML = textContent(html);
      table = d.querySelector("table");
    } catch (e) {
      table = null;
    }
  }
  if (!table) return [];

  const trs = [...table.querySelectorAll("tr")];
  const grid = [];
  const occup = {}; // `${r},${c}` → true

  trs.forEach((tr, r) => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    const cells = [...tr.querySelectorAll("th,td")];
    for (const cell of cells) {
      while (occup[`${r},${c}`]) c += 1;
      const text = (cell.textContent || "").replace(/\s+/g, " ").trim();
      const cs = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
      const rs = Math.max(1, parseInt(cell.getAttribute("rowspan") || "1", 10) || 1);
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (!grid[rr]) grid[rr] = [];
          grid[rr][cc] = dr === 0 && dc === 0 ? text : grid[rr][cc] || text;
          occup[`${rr},${cc}`] = true;
        }
      }
      c += cs;
    }
  });

  const width = Math.max(0, ...grid.map((row) => row?.length || 0));
  return grid.map((row) => {
    const out = [];
    for (let i = 0; i < width; i++) out.push(row?.[i] ?? "");
    return out;
  });
}

/** Detect VMedulife attendance export */
export function isVmedulifeAttendanceHtml(text) {
  const s = String(text || "").toLowerCase();
  return (
    s.includes("attendancereportid") ||
    (s.includes("attendance report") && s.includes("prn number")) ||
    (s.includes("total attendance") && s.includes("faculty incharge")) ||
    (s.includes("present sessions") && s.includes("vmedu"))
  );
}

export function isVmedulifeAttendanceBuffer(buf) {
  try {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 8000));
    return /<html|<table|AttendanceReportId|Faculty Incharge/i.test(head);
  } catch {
    return false;
  }
}

function parseGroupLabel(group) {
  const { year, batch } = parseYearBatch(String(group || ""));
  return {
    year: year || normalizeYearLevel(group),
    batch: batch || normalizeBatch(group),
    raw: group,
  };
}

function cleanSubjectTitle(raw) {
  let s = String(raw || "").trim();
  // "DBMS_CSE | Database management System (Theory) (regular)"
  const pipe = s.split("|").map((x) => x.trim());
  if (pipe.length >= 2) s = pipe[1] || pipe[0];
  s = s.replace(/\(\s*regular\s*\)/gi, "").replace(/\(\s*Theory\s*\)/gi, "").replace(/\(\s*Practical\s*\)/gi, "").trim();
  const code = (pipe[0] || "").replace(/_CSE$/i, "").replace(/_LAB$/i, " Lab").trim();
  const isLab = /_LAB\b|Practical|Lab/i.test(raw);
  if (!s && code) s = code;
  if (isLab && !/lab/i.test(s)) s = `${s} Lab`;
  return { subject: s || code || "Subject", isLab, code: pipe[0] || s };
}

function parseDateRange(rows) {
  for (const row of rows) {
    for (const cell of row) {
      const m = String(cell).match(/From\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
      if (m) return { from: m[1], to: m[2] };
    }
  }
  return { from: null, to: null };
}

/**
 * @returns {{
 *   students: Array,
 *   teachers: Array<{subject, teacherName, year, batch, isLab}>,
 *   meta: object,
 *   headers: string[],
 *   rows: object[],
 * }}
 */
export function parseVmedulifeAttendanceGrid(grid) {
  if (!grid || !grid.length) {
    return { students: [], teachers: [], meta: { error: "No table found" }, headers: [], rows: [] };
  }

  const dateRange = parseDateRange(grid);
  let groupLabel = "";
  for (const row of grid) {
    const c = row.find((x) => /SEM\s*III|SEM\s*IV|CSE[-]?[A-H]|SYCSE|TYCSE|FYCSE|LYCSE/i.test(String(x)));
    if (c) {
      groupLabel = c;
      break;
    }
  }

  // Find header row with PRN / Student Name
  let headerIdx = grid.findIndex((r) => {
    const j = r.map((x) => String(x).toLowerCase());
    return j.some((x) => x.includes("prn")) && j.some((x) => x.includes("student name") || x === "name");
  });
  if (headerIdx < 0) headerIdx = grid.findIndex((r) => r.some((x) => /Sr\.?\s*No/i.test(String(x))));

  const headerRow = grid[headerIdx] || [];
  const facultyRow = grid[headerIdx + 1] || [];
  const subHeaderRow = grid[headerIdx + 2] || [];

  // Identity columns
  const colPrn = headerRow.findIndex((x) => /prn/i.test(String(x)));
  const colName = headerRow.findIndex((x) => /student\s*name|^name$/i.test(String(x)));
  const colRoll = headerRow.findIndex((x) => /roll/i.test(String(x)));
  const colGroup = headerRow.findIndex((x) => /group|class|section/i.test(String(x)));

  // Subject blocks: consecutive same title in header with span of 3 typically
  const subjects = []; // { startCol, endCol, title, isLab, teacher }
  let c = 0;
  while (c < headerRow.length) {
    const title = String(headerRow[c] || "").trim();
    if (!title || /sr\.?\s*no|roll|student name|prn|grn|group|total|leave|average|remark|faculty/i.test(title)) {
      c += 1;
      continue;
    }
    if (/present sessions|total sessions|^%$/i.test(title)) {
      c += 1;
      continue;
    }
    // extend while same title
    let end = c;
    while (end + 1 < headerRow.length && String(headerRow[end + 1]).trim() === title) end += 1;
    // or look at subheaders for % Present Total pattern
    if (end === c) {
      // single cell but colspan may have been expanded already; check next two subheaders
      const s0 = String(subHeaderRow[c] || "");
      const s1 = String(subHeaderRow[c + 1] || "");
      const s2 = String(subHeaderRow[c + 2] || "");
      if (/%|present|total/i.test(s0 + s1 + s2)) end = Math.min(c + 2, headerRow.length - 1);
    }
    const meta = cleanSubjectTitle(title);
    // Collect faculty across the subject colspan (multi-teacher cells, HTML <p> already flattened)
    const teacherParts = [];
    for (let tc = c; tc <= end; tc++) {
      const raw = String(facultyRow[tc] || "").trim();
      if (!raw || /^Faculty Incharge$/i.test(raw)) continue;
      for (const part of raw.split(/[,;/]+/)) {
        const name = part.replace(/\s+/g, " ").trim();
        if (name && !teacherParts.includes(name)) teacherParts.push(name);
      }
    }
    const teacherName = teacherParts.join(", ");
    subjects.push({
      startCol: c,
      endCol: end,
      subject: meta.subject,
      code: meta.code,
      isLab: meta.isLab || /lab|practical/i.test(title),
      teacherName: teacherName || null,
      pctCol: c,
      presentCol: c + 1 <= end ? c + 1 : c,
      totalCol: c + 2 <= end ? c + 2 : c,
    });
    c = end + 1;
  }

  // Total Attendance % column — prefer exact "Total Attendance (%)" near end of header
  let totalAttCol = -1;
  for (let i = headerRow.length - 1; i >= 0; i--) {
    if (/^total\s*attendance\s*\(?%\)?$/i.test(String(headerRow[i]).trim())) {
      totalAttCol = i;
      break;
    }
  }
  if (totalAttCol < 0) {
    for (let i = headerRow.length - 1; i >= 0; i--) {
      if (/total\s*attendance/i.test(String(headerRow[i]))) {
        totalAttCol = i;
        break;
      }
    }
  }

  // Data rows
  const dataStart = headerIdx + 3;
  const students = [];
  const flatRows = [];
  let skippedNoPrn = 0;

  for (let r = dataStart; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.some((x) => String(x).trim())) continue;
    const name = colName >= 0 ? String(row[colName] || "").trim() : "";
    let prn = colPrn >= 0 ? String(row[colPrn] || "").trim() : "";
    if (!name && !prn) continue;
    if (/^sr\.?\s*no/i.test(name)) continue;
    // VMedulife sometimes lists a roll with blank PRN — cannot roster without PRN
    prn = prn.replace(/\s+/g, "");
    if (!prn || !/^\d{6,}$/.test(prn)) {
      skippedNoPrn += 1;
      continue;
    }

    const group = colGroup >= 0 ? String(row[colGroup] || "").trim() : groupLabel;
    const parsed = parseGroupLabel(group || groupLabel);
    const roll = colRoll >= 0 ? String(row[colRoll] || "").trim() : "";

    let totalAtt = null;
    if (totalAttCol >= 0) {
      const v = parseFloat(String(row[totalAttCol]).replace(/[^\d.]/g, ""));
      if (Number.isFinite(v)) totalAtt = v;
    }
    // fallback: last numeric-looking % in row > 0
    if (totalAtt == null) {
      for (let i = row.length - 1; i >= 0; i--) {
        const v = parseFloat(String(row[i]).replace(/[^\d.]/g, ""));
        if (Number.isFinite(v) && v > 0 && v <= 100) {
          totalAtt = v;
          break;
        }
      }
    }

    const subjectAtt = [];
    let labPresent = 0;
    let labTotal = 0;
    let theoryPresent = 0;
    let theoryTotal = 0;
    let absentSessions = 0;
    let scheduledSessions = 0;

    for (const sub of subjects) {
      const pct = parseFloat(String(row[sub.pctCol] || "").replace(/[^\d.]/g, ""));
      const present = parseFloat(String(row[sub.presentCol] || "").replace(/[^\d.]/g, ""));
      const total = parseFloat(String(row[sub.totalCol] || "").replace(/[^\d.]/g, ""));
      const p = Number.isFinite(present) ? present : null;
      const t = Number.isFinite(total) ? total : null;
      const pc = Number.isFinite(pct) ? pct : p != null && t ? (t > 0 ? (p / t) * 100 : null) : null;
      subjectAtt.push({
        subject: sub.subject,
        code: sub.code,
        isLab: sub.isLab,
        pct: pc,
        present: p,
        total: t,
        teacherName: sub.teacherName,
      });
      if (t != null && t > 0) {
        scheduledSessions += t;
        absentSessions += Math.max(0, t - (p || 0));
        if (sub.isLab) {
          labTotal += t;
          labPresent += p || 0;
        } else {
          theoryTotal += t;
          theoryPresent += p || 0;
        }
      }
    }

    const labAttPct = labTotal > 0 ? round1((labPresent / labTotal) * 100) : null;
    const theoryAttPct = theoryTotal > 0 ? round1((theoryPresent / theoryTotal) * 100) : null;
    // Blend for model attendance signal when total missing
    let attendance = totalAtt;
    if (attendance == null && theoryAttPct != null && labAttPct != null) {
      attendance = round1(theoryAttPct * 0.7 + labAttPct * 0.3);
    } else if (attendance == null && theoryAttPct != null) attendance = theoryAttPct;
    else if (attendance == null && labAttPct != null) attendance = labAttPct;

    // Year from group label (e.g. FYCSE-C SEM 1) — never invent SY when SEM 1 implies FY
    let year = parsed.year || null;
    if (!year) {
      const g = String(group || groupLabel || "");
      year = normalizeYearLevel(g);
      if (!year && /\bSEM(?:ESTER)?\s*[12]\b/i.test(g)) year = "FY";
      if (!year && /\bSEM(?:ESTER)?\s*[34]\b/i.test(g)) year = "SY";
      if (!year && /\bSEM(?:ESTER)?\s*[56]\b/i.test(g)) year = "TY";
      if (!year && /\bSEM(?:ESTER)?\s*[78]\b/i.test(g)) year = "LY";
    }
    const batch = parsed.batch || normalizeBatch(String(group || groupLabel || "")) || null;
    const cls = year && batch ? `${year} CSE ${batch}` : (year ? String(year) : String(group || groupLabel || "").trim());

    const student = {
      prn,
      name,
      roll,
      cls,
      className: cls,
      group,
      yearLevel: year,
      group: group || groupLabel || "",
      sourceGroup: group || groupLabel || "",
      batch,
      attendance,
      attendanceKnown: attendance != null,
      labAttendance: labAttPct,
      theoryAttendance: theoryAttPct,
      subjectAttendance: subjectAtt,
      absentSessions,
      scheduledSessions,
      bunkRate: scheduledSessions > 0 ? round3(absentSessions / scheduledSessions) : null,
      marks: [], // attendance-only export
      source: "vmedulife-attendance",
      reportFrom: dateRange.from,
      reportTo: dateRange.to,
    };
    students.push(student);

    // Flat row for upload-stats pipeline
    const flat = {
      PRN: student.prn,
      "Student Name": name,
      Name: name,
      Section: cls,
      Class: cls,
      Batch: batch,
      Group: group,
      "Total Attendance (%)": attendance,
      Attendance: attendance,
      "Lab Attendance (%)": labAttPct,
      "Theory Attendance (%)": theoryAttPct,
    };
    for (const sa of subjectAtt) {
      flat[`${sa.subject} Attendance %`] = sa.pct;
      if (sa.teacherName) flat[`${sa.subject} Teacher`] = sa.teacherName;
      if (sa.present != null) flat[`${sa.subject} Present`] = sa.present;
      if (sa.total != null) flat[`${sa.subject} Total Sessions`] = sa.total;
    }
    flatRows.push(flat);
  }

  const g0 = parseGroupLabel(groupLabel);
  const teachers = subjects
    .filter((s) => s.teacherName)
    .map((s) => ({
      subject: s.subject,
      teacherName: s.teacherName,
      year: g0.year || "SY",
      batch: g0.batch || "All",
      isLab: s.isLab,
    }));

  // unique headers for upload record
  const headers = flatRows[0] ? Object.keys(flatRows[0]) : ["PRN", "Student Name", "Section", "Total Attendance (%)"];

  return {
    students,
    teachers,
    meta: {
      format: "vmedulife-attendance",
      groupLabel,
      year: g0.year,
      batch: g0.batch,
      dateRange,
      subjectCount: subjects.length,
      studentCount: students.length,
      skippedNoPrn,
      labSubjects: subjects.filter((s) => s.isLab).map((s) => s.subject),
      theorySubjects: subjects.filter((s) => !s.isLab).map((s) => s.subject),
    },
    headers,
    rows: flatRows,
    subjects,
  };
}


export function parseVmedulifeAttendanceHtml(html) {
  return parseVmedulifeAttendanceGrid(htmlTableToGrid(html));
}

/** Detect multi-row VMedulife-style attendance sheet (Faculty Incharge row). */
export function isVmedulifeAttendanceAoa(aoa) {
  if (!Array.isArray(aoa) || aoa.length < 4) return false;
  const sample = aoa
    .slice(0, 15)
    .map((r) => (r || []).map((c) => String(c || "").toLowerCase()).join(" | "))
    .join("\n");
  // Marks sheets (UT 1 / UT-2 bands, CLASS+DIVISION) must NOT be treated as attendance
  const looksLikeUtMarks =
    (/\but\s*-?\s*[123]\b/.test(sample) || /\but\s*-?\s*(i|ii|iii)\b/.test(sample)) &&
    !/faculty\s*in[-\s]*charge/.test(sample) &&
    !/present\s*sessions/.test(sample);
  if (looksLikeUtMarks) return false;

  const hasFaculty = /faculty\s*in[-\s]*charge/.test(sample);
  const hasPrn = /\bprn\b/.test(sample);
  const hasSessions = /present\s*sessions|total\s*sessions|total\s*attendance/.test(sample);
  return hasFaculty && hasPrn && hasSessions;
}

/** Parse real .xlsx / .xls sheet already loaded as array-of-arrays. */
export function parseVmedulifeAttendanceAoa(aoa) {
  const grid = (aoa || []).map((row) =>
    (row || []).map((c) => {
      if (c == null || c === "") return "";
      if (typeof c === "number" && Number.isFinite(c)) return String(c);
      return String(c).replace(/\s+/g, " ").trim();
    })
  );
  return parseVmedulifeAttendanceGrid(grid);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Weekdays in [from, to] excluding Sundays (and optionally Saturdays).
 */
export function teachingDaysInRange(fromIso, toIso, { excludeSaturday = false } = {}) {
  if (!fromIso || !toIso) return [];
  const out = [];
  const cur = new Date(fromIso + "T12:00:00");
  const end = new Date(toIso + "T12:00:00");
  if (Number.isNaN(+cur) || Number.isNaN(+end)) return [];
  while (cur <= end) {
    const dow = cur.getDay(); // 0 Sun
    if (dow !== 0 && (!excludeSaturday || dow !== 6)) {
      out.push(cur.toISOString().slice(0, 10));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Bunk analysis without per-day matrix:
 * uses absent session counts + teaching calendar to estimate
 * probability mass of absence on each teaching day (uniform prior over weekdays).
 */
export function analyzeBunkPatterns(students, { from, to } = {}) {
  const days = teachingDaysInRange(from, to, { excludeSaturday: false });
  const sundayCount = (() => {
    if (!from || !to) return 0;
    let n = 0;
    const cur = new Date(from + "T12:00:00");
    const end = new Date(to + "T12:00:00");
    while (cur <= end) {
      if (cur.getDay() === 0) n += 1;
      cur.setDate(cur.getDate() + 1);
    }
    return n;
  })();

  const subjectAbsents = {};
  let totalAbsent = 0;
  let totalScheduled = 0;
  const highRisk = [];

  for (const s of students || []) {
    totalAbsent += s.absentSessions || 0;
    totalScheduled += s.scheduledSessions || 0;
    for (const sa of s.subjectAttendance || []) {
      if (sa.total == null) continue;
      const ab = Math.max(0, (sa.total || 0) - (sa.present || 0));
      if (!subjectAbsents[sa.subject]) subjectAbsents[sa.subject] = { absent: 0, total: 0, isLab: sa.isLab };
      subjectAbsents[sa.subject].absent += ab;
      subjectAbsents[sa.subject].total += sa.total || 0;
    }
    if ((s.bunkRate || 0) >= 0.35 || (s.attendance != null && s.attendance < 75)) {
      highRisk.push({
        prn: s.prn,
        name: s.name,
        attendance: s.attendance,
        bunkRate: s.bunkRate,
        absentSessions: s.absentSessions,
        labAttendance: s.labAttendance,
      });
    }
  }

  // Per teaching day: equal share of absences (no day-level data in export)
  const perDay = days.map((date) => {
    const d = new Date(date + "T12:00:00");
    const dow = d.toLocaleDateString("en-IN", { weekday: "long" });
    const share = days.length ? totalAbsent / days.length : 0;
    const probability = totalScheduled > 0 ? share / (totalScheduled / Math.max(days.length, 1)) : 0;
    return {
      date,
      weekday: dow,
      isSunday: false,
      estimatedAbsentSessions: Math.round(share * 10) / 10,
      // relative bunk pressure 0–1 (normalized later)
      bunkPressure: share,
    };
  });
  const maxP = Math.max(1e-6, ...perDay.map((x) => x.bunkPressure));
  for (const p of perDay) {
    p.bunkProbability = Math.round((p.bunkPressure / maxP) * 1000) / 1000;
    p.note =
      p.bunkProbability >= 0.7
        ? "Higher estimated absence pressure (session-based; not a specific student calendar)"
        : "Baseline teaching day";
  }

  const subjectRanking = Object.entries(subjectAbsents)
    .map(([subject, v]) => ({
      subject,
      isLab: v.isLab,
      absent: v.absent,
      total: v.total,
      absentRate: v.total ? Math.round((v.absent / v.total) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.absentRate - a.absentRate);

  return {
    dateRange: { from, to },
    teachingDays: days.length,
    sundaysExcluded: sundayCount,
    totalAbsentSessions: totalAbsent,
    totalScheduledSessions: totalScheduled,
    overallAbsentRate: totalScheduled ? Math.round((totalAbsent / totalScheduled) * 1000) / 1000 : 0,
    perDay,
    subjectRanking,
    highRiskStudents: highRisk.sort((a, b) => (b.bunkRate || 0) - (a.bunkRate || 0)).slice(0, 40),
    method:
      "VMedulife export has subject session totals, not per-calendar-day rolls. Bunk probabilities are estimated from absent sessions distributed across teaching days (Sundays excluded). Subject ranking uses actual subject-level absence rates.",
  };
}

export default {
  isVmedulifeAttendanceHtml,
  isVmedulifeAttendanceBuffer,
  isVmedulifeAttendanceAoa,
  parseVmedulifeAttendanceHtml,
  parseVmedulifeAttendanceAoa,
  parseVmedulifeAttendanceGrid,
  analyzeBunkPatterns,
  teachingDaysInRange,
  htmlTableToGrid,
};
