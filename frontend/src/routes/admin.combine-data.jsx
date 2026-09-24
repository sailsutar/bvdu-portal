import { useRef, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { FileSpreadsheet, Download, Link2, Upload, X } from "lucide-react";
import {
  parseAttendanceSide,
  parseMarksWorkbook,
  mergeAttendanceSides,
  combineAttendanceAndMarks,
  combinedRowsToXlsxArrayBuffer,
  downloadArrayBuffer,
} from "@/lib/combine-academic-export";

/**
 * HOD tool: multiple batch attendance files + one master UT marks Excel
 * → join on Permanent Registration Number → download combined sheet
 * → upload that on Upload Academic Data.
 */
export default function AdminCombineData() {
  const attRef = useRef(null);
  const marksRef = useRef(null);
  const [attFiles, setAttFiles] = useState([]); // { file, side }
  const [marksFile, setMarksFile] = useState(null);
  const [marksSide, setMarksSide] = useState(null);
  const [combined, setCombined] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onAttendanceFiles(fileList) {
    setError(null);
    setCombined(null);
    const files = [...(fileList || [])];
    if (!files.length) return;
    setBusy(true);
    try {
      const next = [...attFiles];
      for (const file of files) {
        if (next.some((x) => x.file.name === file.name && x.file.size === file.size)) continue;
        const buf = await file.arrayBuffer();
        const side = await parseAttendanceSide(buf, file.name);
        if (!side.studentCount) {
          setError(`No students with valid Permanent Registration Number in “${file.name}”.`);
          continue;
        }
        next.push({ file, side });
      }
      setAttFiles(next);
    } catch (e) {
      setError(e?.message || "Failed to read attendance file.");
    } finally {
      setBusy(false);
      if (attRef.current) attRef.current.value = "";
    }
  }

  function removeAttFile(idx) {
    setCombined(null);
    setAttFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onMarksFile(file) {
    if (file) await onMarksFiles([file]);
  }

  async function onMarksFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    setError(null);
    setCombined(null);
    if (!files.length) return;
    setBusy(true);
    try {
      const byPrn = new Map();
      let teachers = [];
      const names = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const side = parseMarksWorkbook(buf, file.name);
        names.push(file.name);
        for (const t of side.teachers || []) teachers.push(t);
        for (const s of side.students || []) {
          const prn = String(s.prn || "").trim();
          if (!prn) continue;
          const prev = byPrn.get(prn) || { prn, name: s.name, marks: [], subjects: [] };
          const markMap = new Map();
          for (const m of prev.marks || []) {
            if (m?.subject) markMap.set(String(m.subject), m);
          }
          for (const m of s.marks || []) {
            if (!m?.subject) continue;
            const key = String(m.subject);
            const ex = markMap.get(key);
            if (!ex) markMap.set(key, m);
            else {
              markMap.set(key, {
                ...ex,
                assessments: { ...(ex.assessments || {}), ...(m.assessments || {}) },
                statuses: { ...(ex.statuses || {}), ...(m.statuses || {}) },
              });
            }
          }
          byPrn.set(prn, {
            ...prev,
            ...s,
            prn,
            name: s.name || prev.name,
            marks: Array.from(markMap.values()),
          });
        }
      }
      const students = Array.from(byPrn.values());
      if (!students.length) {
        setError("No students with valid Permanent Registration Number found in the marks file(s).");
        setMarksSide(null);
        setMarksFile(null);
        return;
      }
      setMarksFile({ name: names.join(", "), size: files.reduce((n, f) => n + (f.size || 0), 0) });
      setMarksSide({
        students,
        studentCount: students.length,
        teachers,
        meta: { files: files.length },
      });
    } catch (e) {
      setError(e?.message || "Failed to read marks file.");
      setMarksSide(null);
    } finally {
      setBusy(false);
    }
  }

  function runCombine() {
    setError(null);
    if (!attFiles.length || !marksSide?.studentCount) {
      setError("Add at least one attendance file and one UT marks Excel first.");
      return;
    }
    try {
      const attSide = mergeAttendanceSides(attFiles.map((x) => x.side));
      if (!attSide.studentCount) {
        setError("Merged attendance has no students.");
        return;
      }
      const result = combineAttendanceAndMarks(attSide, marksSide);
      setCombined(result);
    } catch (e) {
      setError(e?.message || "Combine failed.");
    }
  }

  function downloadCombined() {
    if (!combined) return;
    const buf = combinedRowsToXlsxArrayBuffer(combined);
    const y = combined.summary.year || "MULTI";
    const b = combined.summary.batch || "ALL";
    downloadArrayBuffer(buf, `Combined_${y}_${b}_attendance_marks.xlsx`);
  }

  const attCount = attFiles.reduce((n, x) => n + (x.side?.studentCount || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Combine attendance and marks</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Use when attendance and unit-test marks are in <strong>separate files</strong>. Upload{" "}
          <strong>one or more</strong> batch attendance exports (for example Second Year A, Second Year B,
          Second Year C) and <strong>one master marks Excel</strong>. Rows are joined on Permanent
          Registration Number. Download the combined workbook, then open{" "}
          <strong>Upload academic data</strong> and commit that file.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Attendance files (one or more batches)">
          <p className="mb-3 text-xs text-muted-foreground">
            VMedulife attendance report per batch. You can select several files at once. Same Permanent
            Registration Number from a later file updates attendance if both appear.
          </p>
          <input
            ref={attRef}
            type="file"
            accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            className="hidden"
            onChange={(e) => onAttendanceFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => attRef.current?.click()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white"
          >
            <Upload className="h-4 w-4" />
            {busy ? "Reading…" : "Add attendance file(s)"}
          </button>
          <ul className="mt-3 space-y-2">
            {attFiles.map((x, i) => (
              <li
                key={`${x.file.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  <FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" />
                  {x.file.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {x.side.studentCount} students
                    {x.side.meta?.year ? ` · ${x.side.meta.year}` : ""}
                    {x.side.meta?.batch && x.side.meta.batch !== "—"
                      ? ` · Batch ${x.side.meta.batch}`
                      : ""}
                    {x.side.teachers?.length ? ` · ${x.side.teachers.length} faculty` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  onClick={() => removeAttFile(i)}
                  aria-label="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
            {!attFiles.length && (
              <li className="text-xs text-muted-foreground">No attendance files yet.</li>
            )}
          </ul>
          {attFiles.length > 0 && (
            <p className="mt-2 text-xs font-medium text-navy">
              {attFiles.length} file(s) · ~{attCount} student rows before Permanent Registration Number
              merge
            </p>
          )}
        </SectionCard>

        <SectionCard title="Master marks Excel (unit tests)">
          <p className="mb-3 text-xs text-muted-foreground">
            One marks workbook for the year (or multiple batches). Permanent Registration Number column
            is required so each row can match attendance.
          </p>
          <input
            ref={marksRef}
            type="file"
            accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            multiple
            onChange={(e) => {
              onMarksFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => marksRef.current?.click()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy"
          >
            <Upload className="h-4 w-4" />
            {marksFile ? "Replace marks file(s)" : "Choose marks file(s)"}
          </button>
          {marksFile && (
            <p className="mt-3 text-sm">
              <FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" />
              {marksFile.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {marksSide?.studentCount || 0} students with Permanent Registration Number
              </span>
            </p>
          )}
        </SectionCard>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !attFiles.length || !marksSide}
          onClick={runCombine}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gold px-5 py-2 text-sm font-bold text-navy disabled:opacity-50"
        >
          <Link2 className="h-4 w-4" />
          Merge on Permanent Registration Number
        </button>
        <button
          type="button"
          disabled={!combined}
          onClick={downloadCombined}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-5 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Download combined Excel
        </button>
      </div>

      {combined && (
        <SectionCard title="Merge result">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Total rows</div>
              <div className="text-xl font-bold text-navy">{combined.summary.total}</div>
            </div>
            <div className="rounded-lg bg-success/10 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Matched in both</div>
              <div className="text-xl font-bold text-navy">{combined.summary.both}</div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Attendance only</div>
              <div className="text-xl font-bold text-navy">{combined.summary.attendanceOnly}</div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Marks only</div>
              <div className="text-xl font-bold text-navy">{combined.summary.marksOnly}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Attendance sources:{" "}
            {(combined.summary.attendanceFiles || [combined.summary.attendanceFile]).filter(Boolean).join(", ")}
            {combined.summary.teachers?.length
              ? ` · Faculty in-charge rows kept: ${combined.summary.teachers.length}`
              : ""}
          </p>
          <p className="mt-2 text-sm text-navy">
            Next: download the combined Excel → <strong>Upload academic data</strong> → Commit. Faculty
            names and unit-test columns travel with the file when present.
          </p>
        </SectionCard>
      )}
    </div>
  );
}
