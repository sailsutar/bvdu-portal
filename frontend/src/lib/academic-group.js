/**
 * Parse year level, programme, and batch letter from class strings
 * e.g. "SY CSE A", "FYCSE-C SEM 1", "Third Year … B"
 */

import { normalizeYearLevel, normalizeBatch } from "@/lib/year-batch";

export function parseAcademicGroup(className) {
  const raw = String(className || "").trim();
  const upper = raw.toUpperCase();

  // Prefer shared year-batch logic (handles FYCSE-C SEM 1 correctly)
  const yearCode = normalizeYearLevel(raw);
  const batch = normalizeBatch(raw);

  let yearLevel = "Unspecified year";
  if (yearCode === "FY") yearLevel = "First Year";
  else if (yearCode === "SY") yearLevel = "Second Year";
  else if (yearCode === "TY") yearLevel = "Third Year";
  else if (yearCode === "LY") yearLevel = "Last Year";

  let programme = raw
    .replace(/\b(FY|SY|TY|TE|BE|FE|LY|FIRST|SECOND|THIRD|FOURTH|FINAL)\s*YEAR\b/gi, "")
    .replace(/\b(FY|SY|TY|TE|BE|FE|LY)CSE\b/gi, "CSE")
    .replace(/\b(FY|SY|TY|TE|BE|FE|LY)\b/gi, "")
    .replace(/\bSEM(?:ESTER)?\s*[1-8]\b/gi, "")
    .replace(/\b(BATCH|DIVISION|SECTION|GROUP)\s*[-_.]?\s*[A-H]\b/gi, "")
    .replace(/\b[A-H]\b\s*$/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!programme) programme = "CSE";

  const batchLabel = batch ? `Batch ${batch}` : "Batch not specified";
  const displayGroup = `${yearLevel} · ${programme}${batch ? ` · ${batchLabel}` : ""}`;

  return {
    yearLevel,
    yearCode: yearCode || null,
    programme,
    batch,
    batchLabel,
    className: raw || "Class not specified",
    displayGroup,
  };
}

export function groupKeyFromStudent(student) {
  const g = parseAcademicGroup(student?.cls || student?.className || student?.group || "");
  return `${g.yearLevel}||${g.programme}||${g.batch || "-"}`;
}
