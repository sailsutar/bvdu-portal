/**
 * Combine VMedulife attendance export + UT marks Excel → one roster sheet
 * suitable for Upload Academic Data (join key: Permanent Registration Number).
 */

import * as XLSX from "xlsx";
import {
  isVmedulifeAttendanceHtml,
  isVmedulifeAttendanceBuffer,
  isVmedulifeAttendanceAoa,
  parseVmedulifeAttendanceHtml,
  parseVmedulifeAttendanceAoa,
} from "@/lib/vmedulife-attendance";

function normalizePrn(v) {
  if (v == null || v === "") return null;
  // Excel may give numbers; strip spaces, dashes, NBSP
  let s = String(v).trim().replace(/[\s\u00a0\-_/]/g, "");
  // Drop trailing .0 from numeric Excel cells
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  if (!/^\d{6,14}$/.test(s)) return null;
  return s;
}

/** Extract first PRN-shaped token from a cell (handles "PRN: 2543110143"). */
function extractPrnFromCell(v) {
  const direct = normalizePrn(v);
  if (direct) return direct;
  if (v == null) return null;
  const s = String(v);
  const m = s.match(/\b(\d{6,14})\b/);
  return m ? normalizePrn(m[1]) : null;
}

function normalizeCell(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (/^#N\/?A$/i.test(s) || /^n\/?a$/i.test(s) || /^defaulter$/i.test(s)) return "";
  return s;
}

function cellText(v) {
  return v == null ? "" : String(v).trim();
}

/** True if this row looks like an identity header (PRN / name / roll). */
function rowHasIdentityHeader(row) {
  if (!Array.isArray(row)) return false;
  return row.some((c) => {
    const lower = cellText(c).toLowerCase();
    return (
      /^prn\b/.test(lower) ||
      /prn\s*(no|number|#)?$/.test(lower) ||
      /permanent\s*registration/.test(lower) ||
      /student\s*name/.test(lower) ||
      /^name$/.test(lower) ||
      /roll\s*(no|number)?/.test(lower)
    );
  });
}

/** True if row is mostly UT-1 / UT-2 / UT-3 / RE-UT sub-headers (not identity). */
function rowIsAssessmentSubHeader(row) {
  if (!Array.isArray(row)) return false;
  let utish = 0;
  let other = 0;
  for (const c of row) {
    const t = cellText(c);
    if (!t) continue;
    if (/^(ut[-\s]?[123]|ut[123]|re[-\s]?ut|reut|avg|average|pct|%|total|lab)$/i.test(t)) utish += 1;
    else other += 1;
  }
  return utish >= 2 && utish > other;
}

/**
 * Prefer the row that contains PRN / Student Name.
 * Never treat a pure UT-1/UT-2/UT-3 sub-header row as the primary header.
 */
export function findHeaderRowIndex(aoa) {
  const scoreRow = (row, idx) => {
    if (!Array.isArray(row) || !row.length) return -1;
    let score = 0;
    let nonEmpty = 0;
    for (const cell of row) {
      const t = cellText(cell);
      if (!t) continue;
      nonEmpty++;
      const lower = t.toLowerCase();
      // Identity — strongest signal
      if (/^prn\b|prn\s*(no|number)/i.test(lower) || /permanent\s*registration/i.test(lower)) score += 50;
      if (/student[_\s-]*name/i.test(lower)) score += 30;
      if (/^name$/i.test(lower)) score += 15;
      if (/roll\s*(no|number)?/i.test(lower)) score += 8;
      if (/section|batch|class|year/i.test(lower)) score += 6;
      if (/overall[_\s-]*attendance|^cgpa$/i.test(lower)) score += 8;
      // Subject + assessment in one cell (flat sheets)
      if (/_(ut[_\s-]*[123]|re[_\s-]*ut|average|avg|pct|total|lab)/i.test(t)) score += 4;
      if (/\but[-\s]?[123]\b|unit\s*test/i.test(lower)) score += 2;
      // Title-only rows
      if (/unit\s*test\s*marks|attendance\s*report/i.test(lower) && nonEmpty <= 2) score -= 20;
    }
    // Pure assessment sub-header must not win
    if (rowIsAssessmentSubHeader(row) && !rowHasIdentityHeader(row)) score -= 80;
    score += Math.min(nonEmpty, 20) * 0.1;
    // Prefer earlier rows slightly when tied
    score -= idx * 0.01;
    return score;
  };
  let bestIdx = 0;
  let bestScore = -Infinity;
  const limit = Math.min(aoa.length, 15);
  for (let i = 0; i < limit; i++) {
    const s = scoreRow(aoa[i], i);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  // If nothing scored well, fall back to first row that has PRN-like text
  if (bestScore < 10) {
    for (let i = 0; i < limit; i++) {
      if (rowHasIdentityHeader(aoa[i])) return i;
    }
  }
  return bestIdx;
}

/**
 * Build flat column names from subject row + optional UT-1/UT-2/UT-3/RE-UT sub-row.
 * Example: "Computer Networks" + "UT-1" → "Computer Networks UT-1"
 */
export function buildCompositeHeaderRow(subjectRow, subRow) {
  const subjects = (subjectRow || []).map((c) => cellText(c));
  const subs = (subRow || []).map((c) => cellText(c));
  const width = Math.max(subjects.length, subs.length);
  const out = [];
  let lastSubject = "";
  for (let i = 0; i < width; i++) {
    const subj = subjects[i] || "";
    const sub = subs[i] || "";
    if (subj) lastSubject = subj;
    const lowerSubj = subj.toLowerCase();
    const isIdentity =
      /^prn\b/.test(lowerSubj) ||
      /prn\s*(no|number)/i.test(lowerSubj) ||
      /student\s*name/i.test(lowerSubj) ||
      /^name$/i.test(lowerSubj) ||
      /roll\s*(no|number)?/i.test(lowerSubj);
    if (isIdentity) {
      out.push(subj);
      continue;
    }
    if (sub && lastSubject && !isIdentity) {
      // Avoid "UT-1 UT-1" if subject cell already empty and lastSubject is assessment
      if (/^(ut[-\s]?1|ut[-\s]?2|re[-\s]?ut|reut)$/i.test(lastSubject)) {
        out.push(sub);
      } else {
        out.push(`${lastSubject} ${sub}`.replace(/\s+/g, " ").trim());
      }
    } else if (subj) {
      out.push(subj);
    } else if (sub) {
      out.push(lastSubject ? `${lastSubject} ${sub}`.replace(/\s+/g, " ").trim() : sub);
    } else {
      out.push(`Column ${i + 1}`);
    }
  }
  // De-dupe identical consecutive names by suffixing index
  const seen = new Map();
  return out.map((h) => {
    const base = h || "Column";
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** Resolve which row is data start after headers (skip pure assessment row if used). */
export function resolveMarksHeader(aoa) {
  const headerIdx = findHeaderRowIndex(aoa);
  const headerRowRaw = aoa[headerIdx] || [];
  const next = aoa[headerIdx + 1] || [];
  let headers;
  let dataStart = headerIdx + 1;
  if (rowHasIdentityHeader(headerRowRaw) && rowIsAssessmentSubHeader(next)) {
    headers = buildCompositeHeaderRow(headerRowRaw, next);
    dataStart = headerIdx + 2;
  } else if (rowIsAssessmentSubHeader(headerRowRaw) && headerIdx > 0 && rowHasIdentityHeader(aoa[headerIdx - 1])) {
    headers = buildCompositeHeaderRow(aoa[headerIdx - 1], headerRowRaw);
    dataStart = headerIdx + 1;
  } else {
    headers = headerRowRaw.map((h, i) => (cellText(h) ? cellText(h) : `Column ${i + 1}`));
  }
  return { headers, dataStart, headerIdx };
}

function pickKey(headers, patterns) {
  for (const p of patterns) {
    const hit = headers.find((h) => p.test(String(h)));
    if (hit) return hit;
  }
  return null;
}

/** Parse marks workbook (xlsx/xls/csv buffer) → { rows: object[], headers, meta } */

/** Map CLASS text → FY | SY | TY | LY */
function classTextToYear(text) {
  const s = String(text || "").toUpperCase();
  // Note: intentionally no \bBE\b check — it false-matches the word "be" in
  // boilerplate like "(Deemed to be University)" that appears on every sheet.
  if (/FINAL|LAST\s*YEAR|\bLY\b|FOURTH\s*YEAR/.test(s)) return "LY";
  if (/THIRD|\bTY\b|THIRD\s*YEAR|\bTE\b/.test(s)) return "TY";
  if (/SECOND|\bSY\b|SECOND\s*YEAR|\bSE\b/.test(s)) return "SY";
  if (/FIRST|\bFY\b|\bFE\b|FIRST\s*YEAR/.test(s) && !/FINAL/.test(s)) return "FY";
  return null;
}

/**
 * College unit-test marks layout:
 *   CLASS | SECOND YEAR
 *   DIVISION | A | UT - I | … | UT - II | … | UT - III
 *   Roll No. | PRN No. | Name of Student | Subj… under each UT band
 * Returns null if sheet does not match.
 */
export function parseCollegeUtMarksAoa(aoa, sheetName) {
  if (!aoa?.length) return null;
  let classYear = null;
  let division = null;

  const isUtLabel = (raw) => {
    const band = String(raw || "")
      .toUpperCase()
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    if (!band) return null;
    // UT 1 / UT-1 / UT - I / Unit Test 1 / UTI
    if (/^(UT\s*-?\s*III|UT\s*-?\s*3|UTIII|UNIT\s*TEST\s*-?\s*III|UNIT\s*TEST\s*-?\s*3)$/.test(band)) return "UT-3";
    if (/^(UT\s*-?\s*II|UT\s*-?\s*2|UTII|UNIT\s*TEST\s*-?\s*II|UNIT\s*TEST\s*-?\s*2)$/.test(band) && !/III/.test(band)) return "UT-2";
    if (/^(UT\s*-?\s*I|UT\s*-?\s*1|UTI|UNIT\s*TEST\s*-?\s*I|UNIT\s*TEST\s*-?\s*1)$/.test(band) && !/II|III/.test(band)) return "UT-1";
    // Partial cell text still counts
    if (/\bUT\s*-?\s*III\b|\bUT\s*-?\s*3\b/.test(band)) return "UT-3";
    if (/\bUT\s*-?\s*II\b|\bUT\s*-?\s*2\b/.test(band) && !/III/.test(band)) return "UT-2";
    if (/\bUT\s*-?\s*I\b|\bUT\s*-?\s*1\b/.test(band) && !/II|III/.test(band)) return "UT-1";
    if (/\bUNIT\s*TEST\s*-?\s*3\b/.test(band)) return "UT-3";
    if (/\bUNIT\s*TEST\s*-?\s*2\b/.test(band)) return "UT-2";
    if (/\bUNIT\s*TEST\s*-?\s*1\b/.test(band)) return "UT-1";
    return null;
  };

  const isPrnHeaderCell = (x) => {
    const s = String(x || "").trim();
    return (
      /^prn\s*(no\.?|number|#)?$/i.test(s) ||
      /prn\s*no/i.test(s) ||
      /permanent\s*registration/i.test(s) ||
      /^registration\s*(no|number)/i.test(s) ||
      /^prn$/i.test(s)
    );
  };

  // CLASS / DIVISION anywhere in top area
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const cells = (aoa[i] || []).map((c) => cellText(c));
    for (let c = 0; c < cells.length; c++) {
      const v = cells[c].toUpperCase();
      if (v === "CLASS" || v === "CLASS:") {
        const next = cells.slice(c + 1).find((x) => x);
        const y = classTextToYear(next);
        if (y) classYear = y;
      }
      if (v === "DIVISION" || v === "DIVISION:" || v === "DIV" || v === "BATCH") {
        const next = cells.slice(c + 1).find((x) => x && !isUtLabel(x));
        if (next && /^[A-H]$/i.test(next.trim())) division = next.trim().toUpperCase();
      }
      // CLASS cell might be "SECOND YEAR" without separate label
      const y2 = classTextToYear(cells[c]);
      if (y2 && !classYear) classYear = y2;
      // DIVISION embedded in one combined free-text cell, e.g.
      // "... CLASS: FIRST YEAR | DIVISION: A | Marks Data ..."
      if (!division) {
        const dm = cells[c].match(/DIVISION\s*:?\s*([A-H])\b/i);
        if (dm) division = dm[1].toUpperCase();
      }
    }
  }

  // A genuine UT-band header cell is a short standalone label ("UT - I", "Unit Test 2"),
  // never a full sentence. Guard against long free-text cells (e.g. a title row that
  // merely *mentions* "(UT-I / UT-II / UT-III)" in passing) being mistaken for the
  // real band-header row.
  const isShortCell = (raw) => cellText(raw).length <= 20;
  const isUtLabelCell = (raw) => (isShortCell(raw) ? isUtLabel(raw) : null);

  // --- Find UT band row: first header row is often only "UT 1", "UT 2", "UT 3" (merged cells) ---
  let utBandIdx = -1;
  let utBandRow = null;
  for (let i = 0; i < Math.min(aoa.length, 25); i++) {
    const row = aoa[i] || [];
    let utHits = 0;
    const mapped = row.map((c) => cellText(c));
    for (const cell of mapped) {
      if (isUtLabelCell(cell)) utHits += 1;
    }
    // Also count after forward-fill simulation of merged cells
    let cur = null;
    let filledHits = 0;
    for (let c = 0; c < mapped.length; c++) {
      const lab = isUtLabelCell(mapped[c]);
      if (lab) cur = lab;
      if (cur) filledHits += 1;
    }
    if (utHits >= 1 && filledHits >= 2) {
      utBandIdx = i;
      utBandRow = mapped;
      break;
    }
  }

  // --- Subject + identity header row: under the UT band (next row with PRN/Name/subjects) ---
  let prnHeaderIdx = -1;
  const searchFrom = utBandIdx >= 0 ? utBandIdx : 0;
  const searchTo = Math.min(aoa.length, (utBandIdx >= 0 ? utBandIdx + 5 : 25));
  for (let i = searchFrom; i < searchTo; i++) {
    if (i === utBandIdx) continue;
    const cells = (aoa[i] || []).map((c) => cellText(c));
    if (cells.some(isPrnHeaderCell)) {
      prnHeaderIdx = i;
      break;
    }
  }
  // Fallback: any PRN header in top 25
  if (prnHeaderIdx < 0) {
    for (let i = 0; i < Math.min(aoa.length, 25); i++) {
      const cells = (aoa[i] || []).map((c) => cellText(c));
      if (cells.some(isPrnHeaderCell)) {
        prnHeaderIdx = i;
        break;
      }
    }
  }
  if (prnHeaderIdx < 0) return null;

  // If UT band not found above, scan near PRN header again
  if (!utBandRow) {
    for (let i = Math.max(0, prnHeaderIdx - 4); i <= prnHeaderIdx; i++) {
      const mapped = (aoa[i] || []).map((c) => cellText(c));
      if (mapped.some((c) => isUtLabelCell(c))) {
        utBandRow = mapped;
        utBandIdx = i;
        break;
      }
    }
  }

  const headerRow = (aoa[prnHeaderIdx] || []).map((c) => cellText(c));
  const width = Math.max(
    headerRow.length,
    utBandRow ? utBandRow.length : 0,
    ...aoa.slice(prnHeaderIdx + 1, prnHeaderIdx + 5).map((r) => (r || []).length),
    1
  );

  let prnCol = headerRow.findIndex((h) => isPrnHeaderCell(h) || /prn/i.test(h));
  let nameCol = headerRow.findIndex((h) => /name of student|student\s*name|^name$/i.test(h));
  let rollCol = headerRow.findIndex((h) => /roll/i.test(h));
  if (prnCol < 0) {
    // Content-based: which column has most PRNs in data rows
    const hits = new Array(width).fill(0);
    for (let r = prnHeaderIdx + 1; r < Math.min(aoa.length, prnHeaderIdx + 40); r++) {
      const row = aoa[r] || [];
      for (let c = 0; c < width; c++) {
        if (extractPrnFromCell(row[c])) hits[c] += 1;
      }
    }
    const max = Math.max(...hits, 0);
    if (max > 0) prnCol = hits.indexOf(max);
  }
  if (prnCol < 0) return null;

  // Forward-fill UT labels across columns (Excel merge: only first cell has "UT 1")
  const colAssess = new Array(width).fill(null);
  if (utBandRow) {
    let current = null;
    for (let c = 0; c < width; c++) {
      const lab = isUtLabelCell(utBandRow[c] || "");
      if (lab) current = lab;
      colAssess[c] = current;
    }
  }

  // Subject columns = non-identity header cells under a UT band (or any non-identity if no band)
  let subjectCols = [];
  for (let c = 0; c < width; c++) {
    if (c === prnCol || c === nameCol || c === rollCol) continue;
    const h = headerRow[c] || "";
    if (!h) continue;
    if (/roll|prn|name|sr\.?\s*no|class|division|batch|section/i.test(h)) continue;
    if (isUtLabel(h)) continue; // header is UT label itself — not a subject
    const assess = colAssess[c] || (utBandRow ? null : "UT-1");
    if (!assess) continue; // column not under any UT band
    subjectCols.push({ col: c, subject: h.trim(), assess });
  }

  // Edge case: identity row (Roll/PRN/Name) and the UT band row are the same row,
  // and the actual subject names live on the very next row instead of being
  // alongside the UT bands. Re-derive subjectCols from that row when the
  // identity row itself contains no subject text.
  let dataStartRow = prnHeaderIdx + 1;
  if (!subjectCols.length) {
    const nextRow = (aoa[prnHeaderIdx + 1] || []).map((c) => cellText(c));
    const nextRowHasSubjects = nextRow.some(
      (h, c) => h && !isUtLabel(h) && !/roll|prn|name|sr\.?\s*no|class|division|batch|section/i.test(h) && colAssess[c]
    );
    if (nextRowHasSubjects) {
      const altSubjectCols = [];
      for (let c = 0; c < width; c++) {
        if (c === prnCol || c === nameCol || c === rollCol) continue;
        const h = nextRow[c] || "";
        if (!h) continue;
        if (/roll|prn|name|sr\.?\s*no|class|division|batch|section/i.test(h)) continue;
        if (isUtLabel(h)) continue;
        const assess = colAssess[c] || (utBandRow ? null : "UT-1");
        if (!assess) continue;
        altSubjectCols.push({ col: c, subject: h.trim(), assess });
      }
      if (altSubjectCols.length) {
        subjectCols = altSubjectCols;
        dataStartRow = prnHeaderIdx + 2; // skip the subject-name row too, it isn't a student
      }
    }
  }
  if (!subjectCols.length) {
    // Maybe headers are only UT labels and subjects are repeated names under each — failed
    return null;
  }

  const objects = [];
  for (let r = dataStartRow; r < aoa.length; r++) {
    const row = aoa[r] || [];
    if (!row.some((x) => cellText(x))) continue;
    const prn =
      extractPrnFromCell(row[prnCol]) ||
      (() => {
        for (let c = 0; c < width; c++) {
          const p = extractPrnFromCell(row[c]);
          if (p) return p;
        }
        return null;
      })();
    if (!prn) continue;
    const name = nameCol >= 0 ? cellText(row[nameCol]) : "";
    const obj = {
      PRN: prn,
      "Student Name": name,
      __sheet: sheetName,
      Year: classYear || "",
      Batch: division || "",
      Section: classYear && division ? `${classYear}-${division}` : sheetName,
      Class: classYear && division ? `${classYear} ${division}` : "",
    };
    if (rollCol >= 0) obj["Roll No"] = cellText(row[rollCol]);
    for (const sc of subjectCols) {
      const raw = normalizeCell(row[sc.col]);
      if (raw === "") continue;
      // Keys that upload-stats parseAcademicColumn understands: "DBMS UT-1"
      const key = `${sc.subject} ${sc.assess}`;
      obj[key] = raw;
      obj[`${sc.subject}_${sc.assess}`] = raw;
    }
    objects.push(obj);
  }
  if (!objects.length) return null;

  const headers = ["PRN", "Student Name", "Year", "Batch", "Section", "Class", "Roll No"];
  for (const o of objects) {
    for (const k of Object.keys(o)) {
      if (!headers.includes(k) && !k.startsWith("__")) headers.push(k);
    }
  }
  return {
    objects,
    headers,
    meta: {
      year: classYear,
      batch: division,
      sheetName,
      kind: "college-ut",
      utBandRow: utBandIdx,
      subjectHeaderRow: prnHeaderIdx,
      subjectCount: subjectCols.length,
    },
  };
}


export function parseMarksWorkbook(buf, fileName = "marks") {
  const wb = XLSX.read(buf, { type: "array" });
  const allObjects = [];
  const headerSet = [];
  const sheetsMeta = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    if (!aoa.length) continue;

    // Preferred path: CLASS / DIVISION / UT-I / UT-II / UT-III college sheets
    const college = parseCollegeUtMarksAoa(aoa, sheetName);
    if (college?.objects?.length) {
      sheetsMeta.push({
        sheetName,
        headers: college.headers,
        rowCount: college.objects.length,
        kind: "college-ut",
        year: college.meta.year,
        batch: college.meta.batch,
      });
      for (const h of college.headers) {
        if (!headerSet.includes(h)) headerSet.push(h);
      }
      allObjects.push(...college.objects);
      continue;
    }

    const { headers: headerRow, dataStart, headerIdx } = resolveMarksHeader(aoa);
    const body = aoa.slice(dataStart);
    if (!body.length) continue;

    // --- Content-based PRN column: column with the most PRN-shaped values ---
    const colCount = Math.max(
      headerRow.length,
      ...body.map((r) => (Array.isArray(r) ? r.length : 0)),
      1
    );
    const prnHits = new Array(colCount).fill(0);
    for (const row of body) {
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < colCount; c++) {
        if (extractPrnFromCell(row[c])) prnHits[c] += 1;
      }
    }
    let prnCol = prnHits.indexOf(Math.max(...prnHits));
    if (Math.max(...prnHits) === 0) {
      // No PRNs in body — try whole sheet including header area
      for (let r = 0; r < aoa.length; r++) {
        const row = aoa[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
          if (extractPrnFromCell(row[c])) prnHits[c] = (prnHits[c] || 0) + 1;
        }
      }
      prnCol = prnHits.indexOf(Math.max(...prnHits, 0));
    }

    // Name column: header match, else first text-heavy column near PRN
    let nameCol = -1;
    for (let c = 0; c < headerRow.length; c++) {
      const h = String(headerRow[c] || "").toLowerCase();
      if (/student\s*name|^name$|candidate|learner/i.test(h)) {
        nameCol = c;
        break;
      }
    }
    if (nameCol < 0) {
      let best = -1;
      let bestScore = -1;
      for (let c = 0; c < colCount; c++) {
        if (c === prnCol) continue;
        let textish = 0;
        for (const row of body.slice(0, 40)) {
          const v = row?.[c];
          const s = cellText(v);
          if (!s) continue;
          if (extractPrnFromCell(s)) continue;
          if (/^[A-Za-z][A-Za-z .'\-]{2,}$/.test(s) || (s.length >= 3 && /[A-Za-z]{2,}/.test(s) && !/^\d/.test(s))) {
            textish += 1;
          }
        }
        if (textish > bestScore) {
          bestScore = textish;
          best = c;
        }
      }
      if (bestScore > 0) nameCol = best;
    }

    // Ensure header labels for PRN / Name even if blank / Column N
    const headers = headerRow.slice();
    while (headers.length < colCount) headers.push(`Column ${headers.length + 1}`);
    if (prnCol >= 0 && prnCol < headers.length) {
      if (!/prn|registration|roll/i.test(headers[prnCol])) headers[prnCol] = "PRN";
    }
    if (nameCol >= 0 && nameCol < headers.length) {
      if (!/name/i.test(headers[nameCol])) headers[nameCol] = "Student Name";
    }

    const objects = body
      .map((row) => {
        const obj = { __sheet: sheetName };
        for (let i = 0; i < colCount; i++) {
          const key = headers[i] || `Column ${i + 1}`;
          obj[key] = normalizeCell(row?.[i]);
        }
        // Attach resolved indices for downstream
        obj.__prnCol = prnCol;
        obj.__nameCol = nameCol;
        // Guaranteed PRN field from content
        const prnVal =
          extractPrnFromCell(row?.[prnCol]) ||
          (() => {
            for (let c = 0; c < colCount; c++) {
              const p = extractPrnFromCell(row?.[c]);
              if (p) return p;
            }
            return null;
          })();
        if (prnVal) obj.PRN = prnVal;
        if (nameCol >= 0 && row?.[nameCol] != null) {
          const nm = cellText(row[nameCol]);
          if (nm && !extractPrnFromCell(nm)) obj["Student Name"] = nm;
        }
        return obj;
      })
      .filter((row) => Object.keys(row).some((k) => !k.startsWith("__") && String(row[k]).trim() !== ""));

    sheetsMeta.push({
      sheetName,
      headers,
      rowCount: objects.length,
      prnColumnIndex: prnCol,
      nameColumnIndex: nameCol,
      prnHits: Math.max(...prnHits, 0),
    });
    headers.forEach((h) => {
      if (!headerSet.includes(h)) headerSet.push(h);
    });
    if (!headerSet.includes("PRN")) headerSet.unshift("PRN");
    if (!headerSet.includes("Student Name")) headerSet.splice(1, 0, "Student Name");
    allObjects.push(...objects);
  }

  const prnKey =
    pickKey(headerSet, [
      /^prn$/i,
      /^prn\b/i,
      /prn\s*(no|number|#)/i,
      /permanent\s*registration/i,
      /registration\s*(no|number)/i,
      /\bprn\b/i,
    ]) || "PRN";
  const nameKey =
    pickKey(headerSet, [/student\s*name/i, /^name$/i, /candidate\s*name/i, /learner\s*name/i]) ||
    "Student Name";

  const byPrn = new Map();
  let skipped = 0;
  for (const row of allObjects) {
    // ANY means ANY: try key, PRN field, then every cell
    let prn =
      extractPrnFromCell(row[prnKey]) ||
      extractPrnFromCell(row.PRN) ||
      extractPrnFromCell(row.prn);
    if (!prn) {
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith("__")) continue;
        prn = extractPrnFromCell(v);
        if (prn) break;
      }
    }
    if (!prn) {
      skipped += 1;
      continue;
    }
    const prev = byPrn.get(prn) || { prn };
    const nameVal = row[nameKey] || row["Student Name"] || row.Name || row.name;
    if (nameVal && !extractPrnFromCell(nameVal)) prev.name = String(nameVal).trim();
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith("__")) continue;
      if (k === prnKey || k === nameKey || k === "PRN" || k === "Student Name") continue;
      if (v === "" || v == null) continue;
      // skip pure identity echo
      if (extractPrnFromCell(v) === prn) continue;
      prev[k] = v;
    }
    byPrn.set(prn, prev);
  }

  return {
    fileName,
    byPrn,
    headers: headerSet,
    sheetsMeta,
    studentCount: byPrn.size,
    skippedNoPrn: skipped,
    prnKey,
    nameKey,
  };
}


/** Parse attendance side: VMedulife HTML or simple attendance sheet */
function studentsToAttendanceSide(parsed, fileName, kind = "vmedulife") {
  const byPrn = new Map();
  for (const s of parsed.students || []) {
    const prn = normalizePrn(s.prn);
    if (!prn) continue;
    byPrn.set(prn, {
      prn,
      name: s.name,
      section: s.cls || s.className,
      batch: s.batch,
      yearLevel: s.yearLevel || parsed.meta?.year || null,
      "Total Attendance (%)": s.attendance,
      Attendance: s.attendance,
      "Lab Attendance (%)": s.labAttendance,
      "Theory Attendance (%)": s.theoryAttendance,
      source: kind,
      subjectAttendance: s.subjectAttendance,
      teachers: parsed.teachers,
      meta: parsed.meta,
      fromFile: fileName,
    });
  }
  return {
    kind,
    fileName,
    byPrn,
    studentCount: byPrn.size,
    skippedNoPrn: parsed.meta?.skippedNoPrn || 0,
    meta: parsed.meta || {},
    teachers: parsed.teachers || [],
  };
}

export async function parseAttendanceSide(buf, fileName = "attendance") {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;

  // HTML-style VMedulife .xls
  if (isVmedulifeAttendanceBuffer(u8) || isVmedulifeAttendanceHtml(new TextDecoder("utf-8").decode(u8.slice(0, 12000)))) {
    const html = new TextDecoder("utf-8").decode(u8);
    const parsed = parseVmedulifeAttendanceHtml(html);
    return studentsToAttendanceSide(parsed, fileName, "vmedulife-html");
  }

  // Real .xlsx / binary .xls — try VMedulife multi-row header (Faculty Incharge)
  try {
    const wb = XLSX.read(u8, { type: "array" });
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const aoa = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      });
      if (!isVmedulifeAttendanceAoa(aoa)) continue;
      const parsed = parseVmedulifeAttendanceAoa(aoa);
      if ((parsed.students || []).length || (parsed.rows || []).length) {
        // Ensure students array if only flat rows
        if (!(parsed.students || []).length && (parsed.rows || []).length) {
          parsed.students = (parsed.rows || []).map((r) => ({
            prn: r.PRN,
            name: r["Student Name"] || r.Name,
            attendance: r["Total Attendance (%)"] ?? r.Attendance,
            cls: r.Section || r.Class,
            batch: r.Batch,
            yearLevel: r.Year,
            subjectAttendance: [],
          }));
        }
        return studentsToAttendanceSide(parsed, fileName, "vmedulife-xlsx");
      }
    }
  } catch {
    /* fall through to generic */
  }

  // Generic attendance workbook
  const marksLike = parseMarksWorkbook(buf, fileName);
  const byPrn = new Map();
  for (const [prn, row] of marksLike.byPrn) {
    const attKey =
      Object.keys(row).find((k) => /total\s*attendance/i.test(k)) ||
      Object.keys(row).find((k) => /^attendance/i.test(k));
    byPrn.set(prn, {
      prn,
      name: row.name,
      section: row.Section || row.Class || row.section,
      batch: row.Batch,
      "Total Attendance (%)": attKey ? row[attKey] : undefined,
      Attendance: attKey ? row[attKey] : undefined,
      source: "workbook",
      fromFile: fileName,
      ...row,
    });
  }
  return {
    kind: "workbook",
    fileName,
    byPrn,
    studentCount: byPrn.size,
    skippedNoPrn: marksLike.skippedNoPrn,
    meta: {},
    teachers: [],
  };
}

/**
 * Merge several attendance files (e.g. SY-A, SY-B, SY-C) into one side map by PRN.
 * Later file wins on the same PRN for overlapping fields; teachers are unioned.
 */
export function mergeAttendanceSides(sides) {
  const list = (sides || []).filter((s) => s && s.byPrn);
  const byPrn = new Map();
  const teachers = [];
  const seenTeach = new Set();
  const fileNames = [];
  const years = new Set();
  const batches = new Set();
  let skippedNoPrn = 0;

  for (const side of list) {
    if (side.fileName) fileNames.push(side.fileName);
    skippedNoPrn += side.skippedNoPrn || 0;
    if (side.meta?.year) years.add(side.meta.year);
    if (side.meta?.batch && side.meta.batch !== "—") batches.add(side.meta.batch);
    for (const t of side.teachers || []) {
      const key = `${t.subject}||${t.teacherName}||${t.year || ""}||${t.batch || ""}`;
      if (seenTeach.has(key)) continue;
      seenTeach.add(key);
      teachers.push(t);
    }
    for (const [prn, row] of side.byPrn) {
      const prev = byPrn.get(prn);
      if (!prev) {
        byPrn.set(prn, { ...row, prn });
        continue;
      }
      // Merge: keep existing non-empty; fill gaps from new; prefer newer attendance %
      const merged = { ...prev };
      for (const [k, v] of Object.entries(row)) {
        if (v == null || v === "") continue;
        if (merged[k] == null || merged[k] === "") merged[k] = v;
        else if (k === "Total Attendance (%)" || k === "Attendance") merged[k] = v;
        else if (k === "subjectAttendance" && Array.isArray(v) && v.length) {
          const bySub = new Map();
          for (const sa of merged.subjectAttendance || []) bySub.set(String(sa.subject || "").toLowerCase(), sa);
          for (const sa of v) bySub.set(String(sa.subject || "").toLowerCase(), sa);
          merged.subjectAttendance = [...bySub.values()];
        }
      }
      byPrn.set(prn, merged);
    }
  }

  return {
    kind: "merged-attendance",
    fileName: fileNames.join(" + ") || "attendance",
    fileNames,
    byPrn,
    studentCount: byPrn.size,
    skippedNoPrn,
    meta: {
      year: years.size === 1 ? [...years][0] : null,
      batch: batches.size === 1 ? [...batches][0] : null,
      years: [...years],
      batches: [...batches],
      files: fileNames.length,
    },
    teachers,
  };
}

/**
 * Merge attendance map + marks map → combined row objects + summary
 */
export function combineAttendanceAndMarks(attendanceSide, marksSide) {
  const attMap = attendanceSide?.byPrn || new Map();
  const markMap = marksSide?.byPrn || new Map();
  const allPrns = new Set([...attMap.keys(), ...markMap.keys()]);

  const rows = [];
  let both = 0;
  let attOnly = 0;
  let marksOnly = 0;

  // Collect mark column names (exclude identity)
  const markCols = new Set();
  for (const row of markMap.values()) {
    for (const k of Object.keys(row)) {
      if (["prn", "name"].includes(k)) continue;
      markCols.add(k);
    }
  }

  for (const prn of [...allPrns].sort()) {
    const a = attMap.get(prn);
    const m = markMap.get(prn);
    if (a && m) both += 1;
    else if (a) attOnly += 1;
    else marksOnly += 1;

    const section =
      a?.section ||
      m?.Section ||
      m?.Class ||
      (m?.Year && m?.Batch ? `${m.Year}-${m.Batch}` : "") ||
      m?.section ||
      "";
    const batch = a?.batch || a?.meta?.batch || m?.Batch || m?.batch || "";
    const year =
      a?.yearLevel || a?.year || a?.meta?.year || m?.Year || m?.year || m?.yearLevel || "";
    const name = a?.name || m?.name || m?.["Student Name"] || "";

    const row = {
      PRN: prn,
      "Student Name": name,
      Section: section,
      Class: section || (year && batch ? `${year} ${batch}` : ""),
      Year: year || "",
      Batch: batch || "",
      "Total Attendance (%)": a?.["Total Attendance (%)"] ?? a?.Attendance ?? "",
      Attendance: a?.["Total Attendance (%)"] ?? a?.Attendance ?? "",
      "Lab Attendance (%)": a?.["Lab Attendance (%)"] ?? "",
      "Theory Attendance (%)": a?.["Theory Attendance (%)"] ?? "",
    };

    // Per-subject attendance % + faculty name from VMedulife (kept on every student row)
    if (a?.subjectAttendance?.length) {
      for (const sa of a.subjectAttendance) {
        const subj = sa.subject || "Subject";
        if (sa.pct != null) {
          const label = sa.isLab ? `${subj} Lab Attendance %` : `${subj} Attendance %`;
          row[label] = sa.pct;
        }
        if (sa.teacherName) {
          row[`${subj} Teacher`] = sa.teacherName;
        }
      }
    }

    // Faculty map for the whole attendance file(s) — fill any missing "* Teacher" columns
    const teacherList = a?.teachers || attendanceSide?.teachers || [];
    for (const te of teacherList) {
      const subj = te.subject || te.Subject;
      const tname = te.teacherName || te.teacher || te["Teacher Name"];
      if (!subj || !tname) continue;
      const col = `${subj} Teacher`;
      if (row[col] == null || row[col] === "") row[col] = tname;
    }

    // Any flat "* Teacher" keys already on the attendance map row
    if (a) {
      for (const [k, v] of Object.entries(a)) {
        if (!/teacher$/i.test(k)) continue;
        if (v == null || v === "") continue;
        if (row[k] == null || row[k] === "") row[k] = v;
      }
    }

    // UT / mark columns from marks file
    if (m) {
      for (const col of markCols) {
        if (m[col] !== undefined && m[col] !== "") row[col] = m[col];
      }
    }

    rows.push(row);
  }

  // Stable column order
  const baseCols = [
    "PRN",
    "Student Name",
    "Section",
    "Class",
    "Year",
    "Batch",
    "Total Attendance (%)",
    "Attendance",
    "Lab Attendance (%)",
    "Theory Attendance (%)",
  ];
  const extra = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!baseCols.includes(k) && !extra.includes(k)) extra.push(k);
    }
  }
  // Guarantee teacher columns from merged attendance faculty list on every row
  const globalTeachers = attendanceSide?.teachers || [];
  for (const te of globalTeachers) {
    const subj = te.subject || te.Subject;
    const tname = te.teacherName || te.teacher || te["Teacher Name"];
    if (!subj || !tname) continue;
    const col = `${subj} Teacher`;
    for (const r of rows) {
      if (r[col] == null || r[col] === "") r[col] = tname;
    }
  }

  extra.sort();
  // Put "* Teacher" columns next to related attendance cols when possible
  const teacherCols = extra.filter((h) => /teacher$/i.test(h));
  const otherExtra = extra.filter((h) => !/teacher$/i.test(h));
  const headers = [...baseCols, ...teacherCols, ...otherExtra];

  return {
    rows,
    headers,
    summary: {
      total: rows.length,
      both,
      attendanceOnly: attOnly,
      marksOnly,
      attendanceFile: attendanceSide?.fileName,
      attendanceFiles: attendanceSide?.fileNames || (attendanceSide?.fileName ? [attendanceSide.fileName] : []),
      marksFile: marksSide?.fileName,
      attendanceKind: attendanceSide?.kind,
      year: attendanceSide?.meta?.year || null,
      batch: attendanceSide?.meta?.batch || null,
      years: attendanceSide?.meta?.years || null,
      batches: attendanceSide?.meta?.batches || null,
      teachers: attendanceSide?.teachers || [],
    },
  };
}

/** Build .xlsx ArrayBuffer for download */
export function combinedRowsToXlsxArrayBuffer(combined, sheetName = "Combined Academic") {
  const { rows, headers, summary } = combined;
  const aoa = [headers];
  for (const r of rows) {
    aoa.push(headers.map((h) => (r[h] == null ? "" : r[h])));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Summary sheet
  const sumAoa = [
    ["Field", "Value"],
    ["Total students", summary.total],
    ["In both files (PRN match)", summary.both],
    ["Attendance only", summary.attendanceOnly],
    ["Marks only", summary.marksOnly],
    ["Attendance file", summary.attendanceFile || ""],
    ["Marks file", summary.marksFile || ""],
    ["Detected year", summary.year || ""],
    ["Detected batch", summary.batch || ""],
  ];
  if (summary.teachers?.length) {
    sumAoa.push([]);
    sumAoa.push(["Subject", "Teacher"]);
    for (const t of summary.teachers) {
      sumAoa.push([t.subject, t.teacherName]);
    }
  }
  const wsSum = XLSX.utils.aoa_to_sheet(sumAoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, wsSum, "Merge summary");

  // Dedicated teachers sheet (read on Upload Academic Data — not skipped)
  let teachers = [...(summary.teachers || [])];
  // Derive from "* Teacher" columns on data rows if faculty list was empty
  if (!teachers.length && rows?.length) {
    const found = new Map();
    for (const r of rows) {
      for (const [k, v] of Object.entries(r || {})) {
        if (!/\s+Teacher$/i.test(k) || v == null || v === "") continue;
        const subject = k.replace(/\s+Teacher$/i, "").trim();
        if (!subject || found.has(subject)) continue;
        found.set(subject, String(v).trim());
      }
    }
    for (const [subject, teacherName] of found) {
      teachers.push({
        subject,
        teacherName,
        year: summary.year || "",
        batch: summary.batch || "",
        isLab: /lab/i.test(subject),
      });
    }
  }
  if (teachers.length) {
    const tAoa = [["Subject", "Teacher Name", "Year", "Batch", "Is Lab"]];
    for (const te of teachers) {
      tAoa.push([
        te.subject || "",
        te.teacherName || te.teacher || te["Teacher Name"] || "",
        te.year || te.yearLevel || summary.year || "",
        te.batch || summary.batch || "",
        te.isLab ? "Yes" : "No",
      ]);
    }
    const wsT = XLSX.utils.aoa_to_sheet(tAoa);
    XLSX.utils.book_append_sheet(wb, wsT, "Subject teachers");
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export function downloadArrayBuffer(buf, fileName) {
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default {
  parseMarksWorkbook,
  parseCollegeUtMarksAoa,
  parseAttendanceSide,
  mergeAttendanceSides,
  combineAttendanceAndMarks,
  combinedRowsToXlsxArrayBuffer,
  downloadArrayBuffer,
  findHeaderRowIndex,
  resolveMarksHeader,
  buildCompositeHeaderRow,
};
