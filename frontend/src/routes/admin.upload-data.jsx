import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  resolveMarksHeader,
  parseAttendanceSide,
  parseMarksWorkbook,
  parseCollegeUtMarksAoa,
  mergeAttendanceSides,
  combineAttendanceAndMarks,
} from "@/lib/combine-academic-export";
import { SectionCard } from "@/components/portal/PortalShell";
import { Upload, FileSpreadsheet, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  createUploadRecord,
  loadUploads,
  saveUploads,
  deriveAll,
  analyzeUploadMapping,
  preprocessUpload,
} from "@/lib/upload-stats";
import { runDataQualityAgent, evaluateUploadGate, getUploadGateOverride } from "@/lib/agents";
import { authHeaders } from "@/lib/auth";
import {
  isVmedulifeAttendanceBuffer,
  parseVmedulifeAttendanceHtml,
  isVmedulifeAttendanceAoa,
  parseVmedulifeAttendanceAoa,
} from "@/lib/vmedulife-attendance";

const API_BASE = import.meta.env.VITE_API_URL || "";

async function syncRosterToServer(uploadList, richStudents = null) {
  try {
    const { students: derived } = deriveAll(uploadList);
    // Merge VMedulife-rich fields (subjectAttendance, lab, bunk) onto derived roster
    let students = derived;
    if (Array.isArray(richStudents) && richStudents.length) {
      const byPrn = new Map(richStudents.map((s) => [String(s.prn), s]));
      students = derived.map((s) => {
        const rich = byPrn.get(String(s.prn));
        if (!rich) return s;
        return {
          ...s,
          labAttendance: rich.labAttendance ?? s.labAttendance,
          theoryAttendance: rich.theoryAttendance ?? s.theoryAttendance,
          subjectAttendance: rich.subjectAttendance || s.subjectAttendance || [],
          absentSessions: rich.absentSessions ?? s.absentSessions,
          scheduledSessions: rich.scheduledSessions ?? s.scheduledSessions,
          bunkRate: rich.bunkRate ?? s.bunkRate,
          reportFrom: rich.reportFrom || s.reportFrom,
          reportTo: rich.reportTo || s.reportTo,
          source: rich.source || s.source,
          yearLevel: rich.yearLevel || s.yearLevel,
          batch: rich.batch || s.batch,
          cls: rich.cls || s.cls,
          className: rich.className || s.className,
        };
      });
      // Include any rich-only PRNs not in derived (should be rare)
      for (const r of richStudents) {
        if (!students.some((s) => String(s.prn) === String(r.prn))) students.push(r);
      }
    }
    const { syncCohortToServer, fetchCohortFromServer } = await import("@/lib/cohort-store");
    const cohort = await syncCohortToServer(students, (p) => {
      try {
        window.dispatchEvent(
          new CustomEvent("bvu.cohort.sync.progress", {
            detail: p,
          })
        );
      } catch {
        /* ignore */
      }
    });
    await fetchCohortFromServer({ force: true });
    const res = await fetch(`${API_BASE}/api/auth/sync-students`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        students: students.map((s) => ({
          prn: s.prn,
          name: s.name,
          attendance: s.attendance,
          email: s.email,
          phone: s.phone,
          className: s.cls || s.className,
          cls: s.cls,
        })),
      }),
    });
    const accounts = res.ok ? await res.json() : null;
    return { ok: true, cohort, accounts, created: cohort?.createdAccounts ?? accounts?.created, studentCount: students.length };
  } catch (e) {
    console.warn("Roster sync unavailable", e);
    return { ok: false, error: e?.message || String(e) };
  }
}

function normalizeCell(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (/^#N\/?A$/i.test(s) || /^n\/?a$/i.test(s) || /^defaulter$/i.test(s)) return "";
  return s;
}

function UploadData() {
  const [uploads, setUploads] = useState([]);
  const [pending, setPending] = useState(null); // dry-run package
  const [syncProgress, setSyncProgress] = useState("");
  useEffect(() => {
    const h = (e) => {
      const d = e.detail || {};
      if (d.total)
        setSyncProgress(`Saving to Atlas: ${d.done}/${d.total} (chunk ${d.chunkIndex}/${d.chunkTotal})`);
    };
    window.addEventListener("bvu.cohort.sync.progress", h);
    return () => window.removeEventListener("bvu.cohort.sync.progress", h);
  }, []);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [committing, setCommitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setUploads(loadUploads());
  }, []);

  function persist(next) {
    setUploads(saveUploads(next));
  }

  async function handleFile(file) {
    setError(null);
    setStatusMsg(null);
    setPending(null);
    const ok = /\.(xlsx|xls|csv|html|htm)$/i.test(file.name);
    if (!ok) {
      setError("Please upload an .xlsx, .xls, .csv or VMedulife HTML attendance export.");
      return;
    }
    try {
      const buf = await file.arrayBuffer();

      // VMedulife attendance report (.xls saved as HTML)
      if (isVmedulifeAttendanceBuffer(buf) || /vmedu|attendance\s*report/i.test(file.name)) {
        const html = new TextDecoder("utf-8").decode(buf);
        const parsed = parseVmedulifeAttendanceHtml(html);
        if (!parsed.rows?.length) {
          setError("Could not read students from VMedulife attendance file.");
          return;
        }
        const headers = parsed.headers;
        // Only rows with a real PRN (parser already skips blank PRN; double-filter)
        const allRows = parsed.rows
          .filter((r) => /^\d{6,}$/.test(String(r.PRN || r.prn || "").trim()))
          .map((r) => ({ ...r, __sheet: "VMedulife" }));
        if (!allRows.length) {
          setError(
            "No students with a valid Permanent Registration Number in this VMedulife file. Fill the PRN Number column and re-export."
          );
          return;
        }
        const overall = analyzeUploadMapping(headers, allRows);
        overall.format = "vmedulife-attendance";
        overall.canCommit = true;
        overall.confidence = "high";
        const quality = runDataQualityAgent({ headers, rows: allRows, fileName: file.name });
        // VMedulife is a known schema — do not hard-block on residual mapping noise
        if (Array.isArray(quality.findings)) {
          quality.findings = quality.findings.map((f) =>
            f.level === "error" && f.code !== "duplicate_prn"
              ? { ...f, level: "warn" }
              : f
          );
        }
        if (parsed.meta?.skippedNoPrn > 0) {
          quality.findings = quality.findings || [];
          quality.findings.push({
            level: "warn",
            code: "skipped_blank_prn",
            message: `${parsed.meta.skippedNoPrn} row(s) skipped (blank or invalid PRN Number).`,
          });
        }
        quality.vmedulife = parsed.meta;
        quality.teachers = parsed.teachers;
        quality.bunkReady = true;
        quality.canCommit = true;
        const gate = evaluateUploadGate(quality);
        setPending({
          name: file.name,
          size: file.size,
          sheetNames: ["VMedulife Attendance"],
          headers,
          sheets: [
            {
              sheetName: "VMedulife Attendance",
              headers,
              rows: allRows.map((o) => headers.map((h) => o[h] ?? "")),
              objects: allRows,
              headerRowIndex: 0,
              analysis: overall,
            },
          ],
          total: allRows.length,
          allRows,
          analysis: overall,
          quality,
          gate,
          vmedulife: parsed,
        });
        return;
      }

      let wb;
      try {
        wb = XLSX.read(buf, { type: "array" });
      } catch (xe) {
        // HTML .xls that was not detected as VMedulife
        const asText = new TextDecoder("utf-8").decode(buf);
        if (isVmedulifeAttendanceHtml(asText) || /<table/i.test(asText)) {
          const parsed = parseVmedulifeAttendanceHtml(asText);
          if (parsed.rows?.length) {
            const headers = parsed.headers;
            const allRows = parsed.rows
              .filter((r) => /^\d{6,}$/.test(String(r.PRN || "").trim()))
              .map((r) => ({ ...r, __sheet: "VMedulife" }));
            const overall = analyzeUploadMapping(headers, allRows);
            overall.format = "vmedulife-attendance";
            overall.canCommit = true;
            overall.confidence = "high";
            const quality = runDataQualityAgent({ headers, rows: allRows, fileName: file.name });
            if (Array.isArray(quality.findings)) {
              quality.findings = quality.findings.map((f) =>
                f.level === "error" && f.code !== "duplicate_prn" ? { ...f, level: "warn" } : f
              );
            }
            quality.vmedulife = parsed.meta;
            quality.teachers = parsed.teachers;
            setPending({
              name: file.name,
              size: file.size,
              sheetNames: ["VMedulife Attendance"],
              headers,
              sheets: [{ sheetName: "VMedulife Attendance", headers, rows: allRows.map((o) => headers.map((h) => o[h] ?? "")), objects: allRows, headerRowIndex: 0, analysis: overall }],
              total: allRows.length,
              allRows,
              analysis: overall,
              quality,
              gate: evaluateUploadGate(quality),
              vmedulife: parsed,
            });
            return;
          }
        }
        throw xe;
      }

      // --- Unit-test / college marks FIRST (never steal as VMedulife attendance) ---
      {
        const marksSheets = [];
        for (const sheetName of wb.SheetNames) {
          const n = String(sheetName).toLowerCase().trim();
          if (/merge\s*summary|readme|^summary$|instructions|subject\s*teachers/.test(n)) continue;
          const sheet = wb.Sheets[sheetName];
          if (!sheet) continue;
          const aoa = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: "",
            raw: false,
            blankrows: false,
          });
          const college = parseCollegeUtMarksAoa(aoa, sheetName);
          if (college?.objects?.length) {
            const headerRow = college.headers;
            const objects = college.objects.map((o) => {
              const row = { ...o, __sheet: sheetName };
              if (college.meta?.year) {
                row.Year = row.Year || college.meta.year;
                row.yearLevel = row.yearLevel || college.meta.year;
              }
              if (college.meta?.batch) {
                row.Batch = row.Batch || college.meta.batch;
                row.batch = row.batch || college.meta.batch;
              }
              if (!row.cls && (row.Year || row.yearLevel)) {
                row.cls = `${row.Year || row.yearLevel} CSE ${row.Batch || row.batch || ""}`.trim();
                row.Class = row.cls;
              }
              return row;
            });
            const analysis = analyzeUploadMapping(headerRow, objects);
            analysis.format = "college-ut-marks";
            analysis.canCommit = true;
            analysis.confidence = "high";
            marksSheets.push({
              sheetName,
              headers: headerRow,
              rows: objects.map((o) => headerRow.map((h) => o[h] ?? "")),
              objects,
              headerRowIndex: 0,
              analysis,
              collegeMeta: college.meta,
            });
          }
        }
        if (marksSheets.length) {
          const headers = [];
          marksSheets.forEach((s) =>
            s.headers.forEach((h) => {
              if (!headers.includes(h)) headers.push(h);
            })
          );
          let allRows = marksSheets.flatMap((s) => s.objects);
          allRows = allRows.filter((row) => {
            const prn = String(row.PRN ?? row.prn ?? "").replace(/\s/g, "").trim();
            return /^\d{6,14}$/.test(prn);
          });
          const overall = analyzeUploadMapping(headers, allRows);
          overall.format = "college-ut-marks";
          overall.canCommit = true;
          overall.confidence = "high";
          // Count academic UT columns for preview
          const utCols = headers.filter((h) => /ut\s*-?\s*[123]|ut\s*-?\s*(i|ii|iii)/i.test(String(h)));
          const quality = runDataQualityAgent({ headers, rows: allRows, fileName: file.name });
          quality.findings = quality.findings || [];
          quality.findings.unshift({
            level: "info",
            code: "college_ut_marks",
            message: `Unit-test marks layout: ${allRows.length} students, ${utCols.length} mark columns (Subject + UT). Year/batch from CLASS/DIVISION when present.`,
          });
          if (Array.isArray(quality.findings)) {
            quality.findings = quality.findings.map((f) =>
              f.level === "error" && f.code !== "duplicate_prn" ? { ...f, level: "warn" } : f
            );
          }
          setPending({
            name: file.name,
            size: file.size,
            sheetNames: marksSheets.map((s) => s.sheetName),
            headers,
            sheets: marksSheets,
            total: allRows.length,
            allRows,
            analysis: overall,
            quality,
            gate: evaluateUploadGate(quality),
          });
          return;
        }
      }

      // Real .xlsx VMedulife attendance: multi-row header + Faculty Incharge (not only HTML .xls)
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
        if (!parsed?.rows?.length && !parsed?.students?.length) continue;
        const headers = parsed.headers?.length
          ? parsed.headers
          : ["PRN", "Student Name", "Section", "Total Attendance (%)"];
        const allRows = (parsed.rows || [])
          .filter((r) => /^\d{6,}$/.test(String(r.PRN || "").replace(/\s/g, "").trim()))
          .map((r) => ({ ...r, __sheet: sheetName }));
        if (!allRows.length && parsed.students?.length) {
          // fall back: build from students objects
          for (const s of parsed.students) {
            if (!/^\d{6,}$/.test(String(s.prn || "").trim())) continue;
            const flat = {
              PRN: s.prn,
              "Student Name": s.name,
              Name: s.name,
              Section: s.cls || s.className,
              Class: s.cls || s.className,
              Attendance: s.attendance,
              "Total Attendance (%)": s.attendance,
              __sheet: sheetName,
            };
            for (const sa of s.subjectAttendance || []) {
              if (sa.subject && sa.pct != null) flat[`${sa.subject} Attendance %`] = sa.pct;
              if (sa.teacherName) flat[`${sa.subject} Teacher`] = sa.teacherName;
            }
            allRows.push(flat);
          }
        }
        if (!allRows.length) continue;
        const overall = analyzeUploadMapping(headers, allRows);
        overall.format = "vmedulife-attendance";
        overall.canCommit = true;
        overall.confidence = "high";
        const quality = runDataQualityAgent({ headers, rows: allRows, fileName: file.name });
        if (Array.isArray(quality.findings)) {
          quality.findings = quality.findings.map((f) =>
            f.level === "error" && f.code !== "duplicate_prn" ? { ...f, level: "warn" } : f
          );
        }
        quality.vmedulife = parsed.meta;
        quality.teachers = parsed.teachers || [];
        quality.findings = quality.findings || [];
        quality.findings.push({
          level: "info",
          code: "faculty_from_attendance",
          message: `${(parsed.teachers || []).length} faculty in-charge name(s) read from attendance header.`,
        });
        setPending({
          name: file.name,
          size: file.size,
          sheetNames: [sheetName],
          headers,
          sheets: [
            {
              sheetName,
              headers,
              rows: allRows.map((o) => headers.map((h) => o[h] ?? "")),
              objects: allRows,
              headerRowIndex: 0,
              analysis: overall,
            },
          ],
          total: allRows.length,
          allRows,
          analysis: overall,
          quality,
          gate: evaluateUploadGate(quality),
          vmedulife: parsed,
        });
        return;
      }

      // Extract subject teachers sheet before filtering student sheets
      let extractedTeachers = [];
      let extractedYear = null;
      let extractedBatch = null;
      for (const sheetName of wb.SheetNames) {
        if (!/^subject\s*teachers$/i.test(String(sheetName).trim())) continue;
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
          header: 1, defval: "", raw: false, blankrows: false,
        });
        if (!aoa.length) continue;
        const h = (aoa[0] || []).map((x) => String(x || "").toLowerCase());
        const iSub = h.findIndex((x) => x.includes("subject"));
        const iTeach = h.findIndex((x) => x.includes("teacher"));
        const iYear = h.findIndex((x) => x.includes("year"));
        const iBatch = h.findIndex((x) => x.includes("batch"));
        const iLab = h.findIndex((x) => x.includes("lab"));
        for (const row of aoa.slice(1)) {
          const subject = iSub >= 0 ? String(row[iSub] || "").trim() : "";
          const teacherName = iTeach >= 0 ? String(row[iTeach] || "").trim() : "";
          if (!subject || !teacherName) continue;
          const year = iYear >= 0 ? String(row[iYear] || "").trim() : "";
          const batch = iBatch >= 0 ? String(row[iBatch] || "").trim() : "";
          if (year) extractedYear = year;
          if (batch) extractedBatch = batch;
          extractedTeachers.push({
            subject,
            teacherName,
            year: year || null,
            batch: batch || null,
            isLab: iLab >= 0 && /yes|true|1|lab/i.test(String(row[iLab] || "")),
          });
        }
      }

      const sheets = wb.SheetNames.filter((sheetName) => {
        // Skip non-student helper sheets (keep "Subject teachers" only for extraction above)
        const n = String(sheetName).toLowerCase().trim();
        if (/merge\s*summary|readme|^summary$|instructions|subject\s*teachers/.test(n)) return false;
        return true;
      }).map((sheetName) => {
        const sheet = wb.Sheets[sheetName];
        const aoa = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw: false,
          blankrows: false,
        });

        // College UT marks: CLASS / DIVISION / UT-I / UT-II / UT-III bands
        const college = parseCollegeUtMarksAoa(aoa, sheetName);
        if (college?.objects?.length) {
          const headerRow = college.headers;
          const objects = college.objects.map((o) => ({ ...o, __sheet: sheetName }));
          // Stamp year/batch from CLASS/DIVISION onto every row for filters
          for (const o of objects) {
            if (college.meta?.year && !o.Year) o.Year = college.meta.year;
            if (college.meta?.batch && !o.Batch) o.Batch = college.meta.batch;
          }
          const analysis = analyzeUploadMapping(headerRow, objects);
          analysis.format = "college-ut-marks";
          analysis.canCommit = true;
          return {
            sheetName,
            headers: headerRow,
            rows: objects.map((o) => headerRow.map((h) => o[h] ?? "")),
            objects,
            headerRowIndex: 0,
            analysis,
            collegeMeta: college.meta,
          };
        }

        const { headers: headerRow, dataStart, headerIdx } = resolveMarksHeader(aoa);

        const bodyRows = aoa.slice(dataStart).map((row) =>
          headerRow.map((_, i) => normalizeCell(row[i]))
        );

        const objects = bodyRows
          .filter((row) => row.some((c) => c !== ""))
          .map((row) => {
            const obj = { __sheet: sheetName };
            headerRow.forEach((h, i) => {
              // Normalize UT roman headers into Subject already in cell keys when possible
              let key = h;
              obj[key] = row[i];
            });
            // Content fallback: copy first 6–14 digit token into PRN if missing
            const hasPrnHeader = headerRow.some((h) => /prn|registration/i.test(String(h)));
            let found = null;
            for (const c of row) {
              const s = String(c ?? "").replace(/[\s\-_/]/g, "");
              if (/^\d{6,14}$/.test(s)) {
                found = s;
                break;
              }
            }
            if (found) {
              if (!obj.PRN && !obj.prn) obj.PRN = found;
              // Also set under actual PRN header key if present
              for (const h of headerRow) {
                if (/prn|permanent\s*registration|registration\s*(no|number)/i.test(String(h))) {
                  if (!obj[h]) obj[h] = found;
                }
              }
            }
            return obj;
          });

        const analysis = analyzeUploadMapping(headerRow, objects);

        return {
          sheetName,
          headers: headerRow,
          rows: bodyRows,
          objects,
          headerRowIndex: headerIdx,
          analysis,
        };
      });

      const headers = [];
      sheets.forEach((s) =>
        s.headers.forEach((h) => {
          if (!headers.includes(h)) headers.push(h);
        })
      );
      let allRows = sheets.flatMap((s) => s.objects);
      // Drop blank identity rows before quality gate (empty Excel tail / summary leakage)
      const beforeFilter = allRows.length;
      allRows = allRows.filter((row) => {
        const prn = String(row.PRN ?? row["PRN Number"] ?? row.prn ?? "").trim();
        const roll = String(row["Roll No."] ?? row["Roll No"] ?? row.Roll ?? "").trim();
        const name = String(row["Student Name"] ?? row.Name ?? row.name ?? "").trim();
        // keep if has PRN, or roll+name (marks-only edge), drop pure empties
        if (/^\d{6,}$/.test(prn.replace(/\s/g, ""))) return true;
        if (roll && name) return true;
        return false;
      });
      const droppedEmpty = beforeFilter - allRows.length;

      const overall = analyzeUploadMapping(headers, allRows);
      const quality = runDataQualityAgent({
        headers,
        rows: allRows,
        fileName: file.name,
      });
      if (droppedEmpty > 0) {
        quality.findings = quality.findings || [];
        quality.findings.push({
          level: "info",
          code: "dropped_empty_rows",
          message: `Dropped ${droppedEmpty} non-student row(s) (blank PRN or merge-summary leakage).`,
        });
      }
      // Empty-PRN errors are only critical if they remain after filtering
      if (Array.isArray(quality.findings)) {
        quality.findings = quality.findings.map((f) =>
          f.code === "missing_id" ? { ...f, level: "warn" } : f
        );
      }
      const gate = evaluateUploadGate(quality);

      if (extractedTeachers.length) {
        quality.teachers = extractedTeachers;
        quality.findings = quality.findings || [];
        quality.findings.push({
          level: "info",
          code: "teachers_from_sheet",
          message: `${extractedTeachers.length} subject teacher(s) loaded from “Subject teachers” sheet.`,
        });
      }

      setPending({
        name: file.name,
        size: file.size,
        sheetNames: sheets.map((s) => s.sheetName),
        headers,
        sheets,
        total: allRows.length,
        allRows,
        analysis: overall,
        quality,
        gate,
        // Same shape as VMedulife path so commit auto-maps teachers
        vmedulife: extractedTeachers.length
          ? {
              teachers: extractedTeachers,
              meta: { year: extractedYear, batch: extractedBatch, format: "combined-excel" },
              students: [],
            }
          : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file.");
    }
  }


  /**
   * Multiple files at once: several attendance batch reports + one UT marks master.
   * Joins on Permanent Registration Number (same as Combine page) and opens one dry-run.
   */
  async function handleFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    if (files.length === 1) {
      await handleFile(files[0]);
      return;
    }

    setError(null);
    setStatusMsg(null);
    setPending(null);
    setCommitting(false);

    try {
      setStatusMsg(`Reading ${files.length} files…`);
      const attSides = [];
      const marksSides = [];
      const notes = [];

      for (const file of files) {
        const buf = await file.arrayBuffer();
        const u8 = new Uint8Array(buf);
        let classified = null;

        // Prefer VMedulife / attendance detection
        try {
          const att = await parseAttendanceSide(buf, file.name);
          const kind = String(att.kind || "");
          const looksAtt =
            kind.includes("vmedulife") ||
            kind === "merged-attendance" ||
            (att.teachers && att.teachers.length > 0) ||
            (att.meta && (att.meta.subjectCount || att.meta.format === "vmedulife-attendance"));
          // Heuristic: attendance files usually have Total Attendance or subjectAttendance on rows
          let hasAttField = false;
          if (att.byPrn && att.byPrn.size) {
            const sample = [...att.byPrn.values()][0];
            hasAttField =
              sample?.["Total Attendance (%)"] != null ||
              sample?.Attendance != null ||
              (Array.isArray(sample?.subjectAttendance) && sample.subjectAttendance.length > 0);
          }
          if (att.studentCount > 0 && (looksAtt || hasAttField || kind === "workbook")) {
            // If workbook has UT columns and almost no attendance, treat as marks
            const sample = att.byPrn.size ? [...att.byPrn.values()][0] : {};
            const keys = Object.keys(sample || {});
            const utKeys = keys.filter((k) => /\\but[-\\s]?[123]\\b|\\bre[-\\s]?ut\\b/i.test(k));
            const attKeys = keys.filter((k) => /attendance/i.test(k));
            if (utKeys.length >= 2 && attKeys.length === 0 && !looksAtt) {
              classified = "marks";
            } else if (looksAtt || hasAttField || attKeys.length > 0) {
              attSides.push(att);
              notes.push(`${file.name}: attendance (${att.studentCount} PRNs)`);
              classified = "attendance";
            }
          }
        } catch (e) {
          /* try marks */
        }

        if (!classified) {
          try {
            const marks = parseMarksWorkbook(buf, file.name);
            if (marks.studentCount > 0) {
              marksSides.push(marks);
              notes.push(`${file.name}: marks (${marks.studentCount} PRNs)`);
              classified = "marks";
            }
          } catch (e) {
            notes.push(`${file.name}: skipped (${e?.message || "unreadable"})`);
          }
        } else if (classified === "marks") {
          const marks = parseMarksWorkbook(buf, file.name);
          if (marks.studentCount > 0) {
            marksSides.push(marks);
            notes.push(`${file.name}: marks (${marks.studentCount} PRNs)`);
          }
        }
      }

      if (!attSides.length && !marksSides.length) {
        setError("None of the files produced students with a valid Permanent Registration Number.");
        setStatusMsg(null);
        return;
      }

      // Attendance only
      if (attSides.length && !marksSides.length) {
        const merged = mergeAttendanceSides(attSides);
        const headers = [
          "PRN",
          "Student Name",
          "Section",
          "Class",
          "Year",
          "Batch",
          "Total Attendance (%)",
          "Attendance",
        ];
        const allRows = [];
        for (const [prn, a] of merged.byPrn) {
          const row = {
            PRN: prn,
            "Student Name": a.name || "",
            Section: a.section || "",
            Class: a.section || "",
            Year: a.yearLevel || a.year || merged.meta?.year || "",
            Batch: a.batch || merged.meta?.batch || "",
            "Total Attendance (%)": a["Total Attendance (%)"] ?? a.Attendance ?? "",
            Attendance: a["Total Attendance (%)"] ?? a.Attendance ?? "",
          };
          for (const sa of a.subjectAttendance || []) {
            if (sa.subject && sa.pct != null) row[`${sa.subject} Attendance %`] = sa.pct;
            if (sa.teacherName) row[`${sa.subject} Teacher`] = sa.teacherName;
          }
          for (const te of merged.teachers || []) {
            if (te.subject && te.teacherName) {
              const col = `${te.subject} Teacher`;
              if (!row[col]) row[col] = te.teacherName;
            }
          }
          allRows.push(row);
          for (const k of Object.keys(row)) {
            if (!headers.includes(k)) headers.push(k);
          }
        }
        const overall = analyzeUploadMapping(headers, allRows);
        overall.format = "multi-attendance";
        overall.canCommit = true;
        overall.confidence = "high";
        const quality = runDataQualityAgent({ headers, rows: allRows, fileName: "multi-attendance" });
        quality.teachers = merged.teachers || [];
        quality.findings = quality.findings || [];
        quality.findings.push({
          level: "info",
          code: "multi_attendance",
          message: `Merged ${attSides.length} attendance file(s) by Permanent Registration Number (${merged.studentCount} students). Upload UT marks later or include a marks file in the same selection.`,
        });
        setPending({
          name: `Multi attendance (${attSides.length} files)`,
          size: files.reduce((n, f) => n + (f.size || 0), 0),
          sheetNames: ["Merged attendance"],
          headers,
          sheets: [],
          total: allRows.length,
          allRows,
          analysis: overall,
          quality,
          gate: evaluateUploadGate(quality),
          vmedulife: {
            teachers: merged.teachers || [],
            meta: merged.meta || {},
            students: [...merged.byPrn.values()].map((a) => ({
              prn: a.prn,
              name: a.name,
              attendance: a["Total Attendance (%)"] ?? a.Attendance,
              cls: a.section,
              batch: a.batch,
              yearLevel: a.yearLevel || a.year,
              subjectAttendance: a.subjectAttendance || [],
            })),
          },
        });
        setStatusMsg(notes.join(" · "));
        return;
      }

      // Marks only (multiple mark sheets merge by PRN via last parseMarks - combine maps)
      if (!attSides.length && marksSides.length) {
        // merge marks maps
        const byPrn = new Map();
        for (const side of marksSides) {
          for (const [prn, row] of side.byPrn) {
            byPrn.set(prn, { ...(byPrn.get(prn) || {}), ...row, prn });
          }
        }
        const headers = ["PRN", "Student Name"];
        const allRows = [];
        for (const [prn, m] of byPrn) {
          const row = { PRN: prn, "Student Name": m.name || m["Student Name"] || "" };
          for (const [k, v] of Object.entries(m)) {
            if (k === "prn" || k === "name") continue;
            if (v == null || v === "") continue;
            row[k] = v;
            if (!headers.includes(k)) headers.push(k);
          }
          allRows.push(row);
        }
        const overall = analyzeUploadMapping(headers, allRows);
        overall.format = "multi-marks";
        overall.canCommit = true;
        const quality = runDataQualityAgent({ headers, rows: allRows, fileName: "multi-marks" });
        setPending({
          name: `Multi marks (${marksSides.length} files)`,
          size: files.reduce((n, f) => n + (f.size || 0), 0),
          sheetNames: ["Merged marks"],
          headers,
          sheets: [],
          total: allRows.length,
          allRows,
          analysis: overall,
          quality,
          gate: evaluateUploadGate(quality),
        });
        setStatusMsg(notes.join(" · "));
        return;
      }

      // Attendance + marks → full combine
      const attMerged = mergeAttendanceSides(attSides);
      // If several marks files, merge maps first
      let marksSide = marksSides[0];
      if (marksSides.length > 1) {
        const byPrn = new Map();
        for (const side of marksSides) {
          for (const [prn, row] of side.byPrn) {
            byPrn.set(prn, { ...(byPrn.get(prn) || {}), ...row, prn });
          }
        }
        marksSide = {
          ...marksSides[0],
          byPrn,
          studentCount: byPrn.size,
          fileName: marksSides.map((s) => s.fileName).join(" + "),
        };
      }

      const combined = combineAttendanceAndMarks(attMerged, marksSide);
      const headers = combined.headers;
      const allRows = combined.rows;
      const overall = analyzeUploadMapping(headers, allRows);
      overall.format = "multi-attendance-marks";
      overall.canCommit = true;
      overall.confidence = "high";
      const quality = runDataQualityAgent({ headers, rows: allRows, fileName: "multi-upload" });
      quality.teachers = combined.summary?.teachers || attMerged.teachers || [];
      quality.findings = quality.findings || [];
      quality.findings.push({
        level: "info",
        code: "multi_join_prn",
        message: `Joined ${attSides.length} attendance file(s) + ${marksSides.length} marks file(s) on Permanent Registration Number: ${combined.summary.both} matched both, ${combined.summary.attendanceOnly} attendance only, ${combined.summary.marksOnly} marks only.`,
      });
      if (quality.teachers?.length) {
        quality.findings.push({
          level: "info",
          code: "faculty_multi",
          message: `${quality.teachers.length} faculty in-charge name(s) carried from attendance.`,
        });
      }

      const richStudents = [...attMerged.byPrn.values()].map((a) => ({
        prn: a.prn,
        name: a.name,
        attendance: a["Total Attendance (%)"] ?? a.Attendance,
        cls: a.section,
        batch: a.batch,
        yearLevel: a.yearLevel || a.year,
        subjectAttendance: a.subjectAttendance || [],
        labAttendance: a["Lab Attendance (%)"],
        theoryAttendance: a["Theory Attendance (%)"],
      }));

      setPending({
        name: `Multi upload (${attSides.length} attendance + ${marksSides.length} marks)`,
        size: files.reduce((n, f) => n + (f.size || 0), 0),
        sheetNames: ["Combined by PRN"],
        headers,
        sheets: [],
        total: allRows.length,
        allRows,
        analysis: overall,
        quality,
        gate: evaluateUploadGate(quality),
        vmedulife: {
          teachers: quality.teachers,
          meta: attMerged.meta || {},
          students: richStudents,
        },
      });
      setStatusMsg(notes.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Multi-file upload failed.");
      setStatusMsg(null);
    }
  }

  async function commitPending() {
    if (!pending) return;
    const gate = evaluateUploadGate(pending.quality);
    const override = getUploadGateOverride();
    if (gate.blocked && !override?.approved) {
      setError("Upload blocked by data quality agent (critical errors). Approve override under AI Agents → Upload quality gate, or fix the file.");
      return;
    }
    if (pending.analysis && pending.analysis.canCommit === false && !override?.approved) {
      setError("Mapping confidence too low to commit without quality-gate override.");
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      // Commit only preprocessed rows (needed columns); ignore the rest of the sheet
      const pre = preprocessUpload(pending.headers, pending.allRows);
      const record = createUploadRecord({
        name: pending.name,
        size: pending.size,
        sheets: pending.sheetNames,
        data: pre.rows,
      });
      record.preprocess = {
        keptHeaderCount: pre.keptHeaderCount,
        ignoredHeaderCount: pre.ignoredHeaderCount,
        ignoredColumns: pre.ignoredColumns.slice(0, 40),
        keptRowCount: pre.keptRowCount,
        droppedRowCount: pre.droppedRowCount,
        cleanedCellCount: pre.cleanedCellCount,
      };
      const next = [record, ...uploads];
      persist(next);
      const sync = await syncRosterToServer(next, pending.vmedulife?.students || null);
      // Auto-map teachers from VMedulife faculty row OR combined "Subject teachers" sheet
      let teacherMsg = "";
      const teacherList =
        pending.vmedulife?.teachers?.length > 0
          ? pending.vmedulife.teachers
          : pending.quality?.teachers || [];
      if (teacherList.length) {
        try {
          const assignments = teacherList.map((t) => {
            const y = t.year || pending.vmedulife?.meta?.year || null;
            let b = t.batch || pending.vmedulife?.meta?.batch || null;
            if (b === "—" || b === "All" || b === "-") b = null;
            return {
              subject: t.subject,
              teacherName: t.teacherName,
              yearLevel: y || null,
              batch: b || null,
            };
          });
          const tr = await fetch(`${API_BASE}/api/teacher-subjects`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ assignments }),
          });
          if (tr.ok) {
            const td = await tr.json().catch(() => ({}));
            teacherMsg = ` · ${td.upserted ?? assignments.length} subject teachers auto-filled from report`;
          }
        } catch (e) {
          console.warn("Teacher auto-map failed", e);
        }
        try {
          localStorage.setItem(
            "bvu.vmedulife.last",
            JSON.stringify({
              meta: pending.vmedulife.meta,
              students: pending.vmedulife.students,
              at: new Date().toISOString(),
            })
          );
        } catch { /* ignore */ }
      }
      if (sync?.ok) {
        setStatusMsg(
          `Committed ${pending.name}: ${sync.studentCount ?? pre.keptRowCount} students · ${sync.created ?? 0} new accounts · kept ${pre.keptHeaderCount} cols, ignored ${pre.ignoredHeaderCount}${teacherMsg}`
        );
        setPending(null);
      } else {
        setStatusMsg(`Saved locally. Server sync issue: ${sync?.error || "unknown"}${teacherMsg}`);
        setPending(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed.");
    } finally {
      setCommitting(false);
    }
  }

  function remove(id) {
    persist(uploads.filter((u) => u.id !== id));
  }

  const confColor = {
    high: "text-success",
    medium: "text-amber-700",
    low: "text-danger",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Upload Academic Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Files are analysed and preprocessed first (dry-run). Only needed columns are kept; the rest are ignored. Review mapping, then commit to MongoDB. This runs in the System Admin workspace so Head of Department focuses on analytics and mentoring; Teacher Guide assignment is also under System Admin.
        </p>
      </div>

      <SectionCard>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const list = e.dataTransfer.files;
            if (list?.length) handleFiles(list);
          }}
          className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${dragOver ? "border-gold bg-gold-soft/60" : "border-gold/60 bg-gold-soft/30"}`}
        >
          <Upload className="mx-auto h-8 w-8 text-navy" />
          <p className="mt-3 text-sm font-medium text-navy">
            Drop one or more Excel/CSV files here, or click to browse
          </p>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>
              All paths join on Permanent Registration Number. A later file fills missing fields and
              does <strong>not</strong> wipe the other half (attendance-only keeps existing marks;
              marks-only keeps existing attendance).
            </p>
            <ul className="list-inside list-disc">
              <li>
                <strong>Combined file</strong> — already has attendance + UT marks (e.g. from{" "}
                <a className="font-medium text-navy underline" href="/sysadmin/combine-data">
                  Combine attendance and marks
                </a>
                ). Preferred when you have both sources.
              </li>
              <li>
                <strong>VMedulife attendance only</strong> — HTML/.xls report (theory/lab sessions,
                faculty, dates). Commit now; upload marks when ready.
              </li>
              <li>
                <strong>UT marks Excel only</strong> — PRN + subject UT columns. Merges onto roster
                already loaded from VMedulife or a previous upload.
              </li>
              <li>
                <strong>Several files together</strong> — select multiple attendance batch reports
                plus one master UT marks Excel in one go. They are joined on Permanent Registration
                Number automatically (same result as Combine, without a separate step).
              </li>
            </ul>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-soft"
          >
            Choose file(s)
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.html,.htm"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}
                {statusMsg && !error && (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> {statusMsg}
          </div>
        )}
      </SectionCard>


      {syncProgress && (
        <p className="text-sm font-medium text-navy">{syncProgress}</p>
      )}
      {pending && (
        <SectionCard title={`Dry-run preview — ${pending.name} (${pending.total} rows)`}>
          <div className="mb-4 space-y-3">
            <p className="text-sm">
              Mapping confidence:{" "}
              <b className={confColor[pending.analysis.confidence] || ""}>
                {pending.analysis.confidence.toUpperCase()}
              </b>
            </p>

            <div>
              <h3 className="mb-1 text-sm font-semibold text-navy">Detected columns</h3>
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {pending.analysis.detected.map((d) => (
                  <li key={d.role} className="rounded border px-2 py-1">
                    <span className="text-muted-foreground">{d.label}:</span>{" "}
                    <b>{d.column}</b>
                  </li>
                ))}
                {pending.analysis.detected.length === 0 && (
                  <li className="text-muted-foreground">No standard columns detected.</li>
                )}
              </ul>
            </div>

            {pending.analysis.warnings.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-navy">Warnings</h3>
                <ul className="space-y-1 text-sm">
                  {pending.analysis.warnings.map((w, i) => (
                    <li
                      key={i}
                      className={`flex gap-2 rounded px-2 py-1 ${
                        w.level === "error"
                          ? "bg-danger/10 text-danger"
                          : w.level === "warn"
                            ? "bg-amber-50 text-amber-900"
                            : "bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{w.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pending.analysis.issues.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-navy">Sample messy cells</h3>
                <ul className="max-h-32 overflow-auto text-xs text-muted-foreground">
                  {pending.analysis.issues.map((iss, i) => (
                    <li key={i}>
                      <b>{iss.column}</b>: “{iss.value}” — {iss.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pending.quality?.findings?.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-navy">Data quality agent</h3>
                <p className="mb-1 text-xs text-muted-foreground">
                  Unique IDs: {pending.quality.uniqueIds} · Agent canCommit:{" "}
                  {pending.quality.canCommit ? "yes" : "no"}
                </p>
                <ul className="space-y-1 text-sm">
                  {pending.quality.findings.map((f, i) => (
                    <li
                      key={i}
                      className={`rounded px-2 py-1 text-xs ${
                        f.level === "error"
                          ? "bg-danger/10 text-danger"
                          : f.level === "warn"
                            ? "bg-amber-50 text-amber-900"
                            : "bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <span className="font-semibold uppercase">{f.level}</span> — {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-navy/15 bg-muted/30 p-3">
              <h3 className="mb-2 text-sm font-semibold text-navy">Data preprocessing</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Only columns needed for the portal are kept. Other Excel/CSV columns are ignored on commit.
                Messy values (#N/A, Defaulter, Absent markers) are cleared. Rows without a student identity
                are dropped (except pure timetable sheets).
              </p>
              {pending.analysis?.preprocess ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-success">
                      Kept ({pending.analysis.preprocess.keptHeaderCount} columns →{" "}
                      {pending.analysis.preprocess.keptRowCount} rows)
                    </div>
                    <ul className="max-h-40 overflow-auto text-xs">
                      {(pending.analysis.preprocess.keptColumns || []).map((c) => (
                        <li key={c.header} className="border-b border-border/40 py-0.5">
                          <span className="font-medium text-navy">{c.header}</span>
                          <span className="text-muted-foreground"> — {c.role}</span>
                        </li>
                      ))}
                      {(pending.analysis.preprocess.keptColumns || []).length === 0 && (
                        <li className="text-danger">No usable columns detected.</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      Ignored ({pending.analysis.preprocess.ignoredHeaderCount} columns)
                    </div>
                    <ul className="max-h-40 overflow-auto text-xs text-muted-foreground">
                      {(pending.analysis.preprocess.ignoredColumns || []).slice(0, 60).map((h) => (
                        <li key={h} className="border-b border-border/30 py-0.5">
                          {h}
                        </li>
                      ))}
                      {(pending.analysis.preprocess.ignoredColumns || []).length === 0 && (
                        <li>Nothing ignored — all columns mapped as needed.</li>
                      )}
                      {(pending.analysis.preprocess.ignoredColumns || []).length > 60 && (
                        <li>
                          …and {pending.analysis.preprocess.ignoredColumns.length - 60} more
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Preprocess summary unavailable.</p>
              )}
              {pending.analysis?.preprocess?.cleanedCellCount > 0 && (
                <p className="mt-2 text-xs text-amber-800">
                  {pending.analysis.preprocess.cleanedCellCount} messy cells will be cleared.
                </p>
              )}
              {pending.analysis?.preprocess?.droppedRowCount > 0 && (
                <p className="mt-1 text-xs text-amber-800">
                  {pending.analysis.preprocess.droppedRowCount} empty / no-identity rows will be
                  dropped.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={committing}
                onClick={commitPending}
                className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
              >
                {committing ? "Committing…" : "Commit to MongoDB"}
              </button>
              <button
                type="button"
                disabled={committing}
                onClick={() => setPending(null)}
                className="rounded-md border px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
            {!pending.analysis.canCommit && (
              <p className="text-sm text-danger">
                Fix identity columns (PRN) before committing. Re-export the sheet or rename headers.
              </p>
            )}
          </div>

          {pending.sheets.map((s) => (
            <div key={s.sheetName} className="mb-6 last:mb-0">
              {pending.sheets.length > 1 && (
                <h3 className="mb-2 text-sm font-semibold text-navy">Sheet: {s.sheetName}</h3>
              )}
              {s.headerRowIndex > 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Header row auto-detected at Excel row {s.headerRowIndex + 1} (skipped title/group rows above).
                </p>
              )}
              <div className="max-h-[40vh] overflow-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b text-left text-muted-foreground">
                      {s.headers.map((h, i) => (
                        <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.slice(0, 30).map((r, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        {s.headers.map((_, j) => (
                          <td key={j} className="whitespace-nowrap px-3 py-2 align-top">
                            {r[j] === "" ? "—" : r[j]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {s.objects.length} data rows · {s.headers.length} columns
                {s.rows.length > 30 ? " · preview shows first 30 rows" : ""}
              </p>
            </div>
          ))}
        </SectionCard>
      )}

      <SectionCard title="Committed uploads">
        {uploads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data uploaded yet.</p>
        ) : (
          <ul className="divide-y">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-gold-soft text-navy">
                    <FileSpreadsheet className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-navy">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.rows} rows · {(u.size / 1024).toFixed(1)} KB ·{" "}
                      {new Date(u.uploadedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(u.id)}
                  className="rounded-md p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  aria-label="Remove upload"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

export default UploadData;
