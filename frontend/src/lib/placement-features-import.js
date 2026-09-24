import { normalizeYearLevel, normalizeBatch } from "@/lib/year-batch";
/**
 * Parse System Admin placement-features Excel
 * (PRN, year, SSC, CGPA path, skills, internships, optional Target Domain).
 */
import * as XLSX from "xlsx";

function normHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pick(row, aliases) {
  const keys = Object.keys(row);
  for (const a of aliases) {
    const want = normHeader(a);
    const found = keys.find((k) => normHeader(k) === want);
    if (found != null && row[found] !== "" && row[found] != null) return row[found];
  }
  // fuzzy contains
  for (const a of aliases) {
    const want = normHeader(a);
    const found = keys.find((k) => normHeader(k).includes(want) || want.includes(normHeader(k)));
    if (found != null && row[found] !== "" && row[found] != null) return row[found];
  }
  return null;
}

export function mapPlacementFeatureSheetRow(row) {
  const prn = String(pick(row, ["PRN", "prn", "permanent registration number", "roll"]) || "").trim();
  const name = String(pick(row, ["Student Name", "name", "student name", "full name"]) || "").trim();
  if (!prn || !name) return null;

  const out = {
    prn,
    name,
    "Current Year": pick(row, ["Current Year", "year", "year level", "class"]),
    Batch: pick(row, ["Batch", "batch", "div", "division"]),
    "SSC %": pick(row, ["SSC %", "SSC", "10th", "10th %", "tenth"]),
    "10+2 / Diploma": pick(row, ["10+2 / Diploma", "stream", "diploma", "hsc"]),
    "10+2 / Diploma %": pick(row, ["10+2 / Diploma %", "12th %", "hsc %", "diploma %"]),
    "Entrance Exam": pick(row, ["Entrance Exam", "entrance", "exam"]),
    "Entrance Score": pick(row, ["Entrance Score", "cet", "jee", "percentile"]),
    "FY CGPA": pick(row, ["FY CGPA", "fy cgpa"]),
    "SY CGPA": pick(row, ["SY CGPA", "sy cgpa"]),
    "TY CGPA": pick(row, ["TY CGPA", "ty cgpa"]),
    "LY CGPA": pick(row, ["LY CGPA", "ly cgpa", "final cgpa"]),
    C: pick(row, ["C", "skill c"]),
    "C++": pick(row, ["C++", "cpp"]),
    "OOM (Java)": pick(row, ["OOM (Java)", "Java", "OOP"]),
    "NLDS / Data Structures": pick(row, ["NLDS / Data Structures", "DSA", "Data Structures"]),
    DBMS: pick(row, ["DBMS"]),
    "Computer Networks": pick(row, ["Computer Networks", "CN", "Networks"]),
    Python: pick(row, ["Python"]),
    AI: pick(row, ["AI"]),
    ML: pick(row, ["ML"]),
    DL: pick(row, ["DL"]),
    "No. of Internships": pick(row, ["No. of Internships", "internships", "internship count"]),
    "Target Domain": pick(row, ["Target Domain", "domain"]),
  };

  for (let i = 1; i <= 3; i++) {
    out[`Internship ${i} - Company`] = pick(row, [
      `Internship ${i} - Company`,
      `Internship ${i} Company`,
    ]);
    out[`Internship ${i} - Role`] = pick(row, [`Internship ${i} - Role`, `Internship ${i} Role`]);
    out[`Internship ${i} - Type`] = pick(row, [`Internship ${i} - Type`, `Internship ${i} Type`]);
    out[`Internship ${i} - Duration (Months)`] = pick(row, [
      `Internship ${i} - Duration (Months)`,
      `Internship ${i} Duration`,
    ]);
  }
  // Canonical year/batch codes for portal filters
  out.yearLevel = normalizeYearLevel(out["Current Year"]) || null;
  out.batch = normalizeBatch(out.Batch) || normalizeBatch(String(out.Batch || "")) || null;
  return out;
}

export async function parsePlacementFeaturesFromFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName =
    wb.SheetNames.find((n) => /student|feature|train|data/i.test(n)) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const students = [];
  const seen = new Set();
  for (const row of rows) {
    const m = mapPlacementFeatureSheetRow(row);
    if (!m || seen.has(m.prn)) continue;
    seen.add(m.prn);
    students.push(m);
  }
  return {
    students,
    meta: { sheet: sheetName, rawRows: rows.length, unique: students.length },
  };
}
