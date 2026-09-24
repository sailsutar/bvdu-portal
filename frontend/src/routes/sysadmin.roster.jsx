import { useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { parseIdentityRosterFromFile } from "@/lib/roster-identity";
import { Upload, CheckCircle2, FileSpreadsheet } from "lucide-react";

export default function SysadminRoster() {
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState([]);
  const [meta, setMeta] = useState(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    setMsg("");
    setMeta(null);
    setPreview([]);
    setTotal(0);
    try {
      const { students, meta: m } = await parseIdentityRosterFromFile(file);
      setMeta(m);
      setTotal(students.length);
      setPreview(students.slice(0, 25));
      window.__sysadminRoster = students;
      if (!students.length) {
        setMsg(
          "No Permanent Registration Number found. Use any attendance, marks, or combined Excel that includes PRN and student name."
        );
      } else {
        setMsg(
          `Ready to save ${students.length} unique student(s). Only Permanent Registration Number and name will be stored.`
        );
      }
    } catch (err) {
      setMsg(err.message || "Failed to read file");
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    await handleFile(file);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }

  async function commit() {
    const students = window.__sysadminRoster || [];
    if (!students.length) {
      setMsg("Upload a file first.");
      return;
    }
    setBusy(true);
    try {
      const r = await api("/api/admin-master/roster", {
        method: "POST",
        body: JSON.stringify({ students }),
      });
      setMsg(
        `Committed ${r.upserted} student(s) to the database (skipped ${r.skipped}). Existing 10th / 12th / CET / diploma values were kept.`
      );
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy">Student register</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Optional if academic Excel already has PRN and name. Use only to add students before academic upload. For phones use <b>Contact details</b> (matched by PRN only — does not change academic names).</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="font-semibold text-navy">1. Choose file</p>
          <p className="mt-1 text-xs text-muted-foreground">.xlsx, .xls, .csv or VMedulife HTML export</p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="font-semibold text-navy">2. Preview</p>
          <p className="mt-1 text-xs text-muted-foreground">Confirm PRN + name; other columns are dropped</p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="font-semibold text-navy">3. Commit</p>
          <p className="mt-1 text-xs text-muted-foreground">Save to database without wiping background factors</p>
        </div>
      </div>

      <SectionCard title="Upload file">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
            dragOver ? "border-navy bg-navy/5" : "border-navy/20 bg-muted/30"
          }`}
        >
          <Upload className="mb-3 h-10 w-10 text-navy/70" />
          <p className="text-sm font-semibold text-navy">Drag and drop Excel here</p>
          <p className="mt-1 text-xs text-muted-foreground">or click to browse</p>
          <label className="mt-4 cursor-pointer rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white">
            Choose file
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
          </label>
          {fileName && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" />
              {fileName}
            </p>
          )}
        </div>

        {msg && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-navy/10 bg-muted/40 px-3 py-2 text-sm text-navy/90">
            {total > 0 && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />}
            <span>{msg}</span>
          </p>
        )}

        {meta && (
          <p className="mt-2 text-xs text-muted-foreground">
            Source: {meta.source} · Sheets scanned: {meta.sheetsScanned} · Rows seen: {meta.rowsSeen}
            {meta.ignoredColumnsSample?.length
              ? ` · Ignored columns (sample): ${meta.ignoredColumnsSample.join(", ")}`
              : ""}
          </p>
        )}

        <button
          type="button"
          disabled={busy || !total}
          onClick={commit}
          className="mt-4 rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Committing…" : "Commit roster to database"}
        </button>
      </SectionCard>

      {preview.length > 0 && (
        <SectionCard title={`Preview (${total} unique students)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2">Permanent Registration Number</th>
                  <th>Name</th>
                  <th>Year</th>
                  <th>Batch</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((s) => (
                  <tr key={s.prn} className="border-b">
                    <td className="py-2 font-mono tabular-nums">{s.prn}</td>
                    <td>{s.name}</td>
                    <td>{s.yearLevel || "—"}</td>
                    <td>{s.batch || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Showing first {preview.length} of {total}. Attendance and marks columns were not imported.
            </p>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
