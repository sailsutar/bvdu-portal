/**
 * Parse class label into year (FY|SY|TY|LY), programme, batch.
 * Uses the same rules as year-cohort.js
 */
import { normalizeYear, normalizeBatch } from "./year-cohort.js";

export function parseAcademicGroup(rawInput) {
  const raw = String(rawInput || "").trim();
  const upper = raw.toUpperCase();
  const yearCode = normalizeYear(raw) || null;
  const yearLabels = {
    FY: "First Year",
    SY: "Second Year",
    TY: "Third Year",
    LY: "Last Year",
  };
  const yearLevel = yearCode ? yearLabels[yearCode] : "Unspecified year";
  const batch = normalizeBatch(raw);

  let programme = raw
    .replace(/\b(FY|SY|TY|TE|BE|LY|FE|SE|FIRST|SECOND|THIRD|FOURTH|FINAL|LAST)\s*YEAR\b/gi, "")
    .replace(/\b(BATCH|DIVISION|SECTION|GROUP)\s*[-_.]?\s*[A-H]\b/gi, "")
    .replace(/\b[A-H]\b\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim() || "General";

  return {
    yearCode,
    yearLevel,
    programme,
    batch,
    batchLabel: batch ? `Batch ${batch}` : "Batch not specified",
    className: raw || "Class not specified",
    displayGroup: `${yearLevel} · ${programme}${batch ? ` · Batch ${batch}` : ""}`,
  };
}
