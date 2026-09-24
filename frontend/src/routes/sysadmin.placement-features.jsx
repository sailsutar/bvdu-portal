import { useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { parsePlacementFeaturesFromFile } from "@/lib/placement-features-import";
import { Upload, FileSpreadsheet } from "lucide-react";

export default function SysadminPlacementFeatures() {
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState([]);
  const [meta, setMeta] = useState(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [runTade, setRunTade] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    await handleFiles([file]);
  }

  async function handleFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    setFileName(files.map((f) => f.name).join(", "));
    setMsg("");
    try {
      const byPrn = new Map();
      let rawRows = 0;
      let sheetNames = [];
      for (const file of files) {
        const { students, meta: m } = await parsePlacementFeaturesFromFile(file);
        rawRows += Number(m?.rawRows) || students.length;
        if (m?.sheet) sheetNames.push(m.sheet);
        for (const s of students || []) {
          const prn = String(s.prn || s.PRN || "").trim();
          if (!prn) continue;
          const prev = byPrn.get(prn) || {};
          byPrn.set(prn, { ...prev, ...s, prn });
        }
      }
      const students = Array.from(byPrn.values());
      setMeta({
        sheet: sheetNames.join(" + ") || "merged",
        rawRows,
        unique: students.length,
        files: files.length,
      });
      setTotal(students.length);
      setPreview(students.slice(0, 15));
      window.__sysadminPlacementFeatures = students;
      setMsg(
        students.length
          ? `Ready: ${students.length} unique PRN(s) from ${files.length} file(s). Commit saves profiles for Placement coordinator / head and can run TADE.`
          : "No PRN + name rows found. Use the placement features Excel format."
      );
    } catch (e) {
      setMsg(e.message || "Failed to read file");
    }
  }

  async function commit() {
    const students = window.__sysadminPlacementFeatures || [];
    if (!students.length) {
      setMsg("Upload a file first.");
      return;
    }
    setBusy(true);
    const size = runTade ? 25 : 80;
    let upserted = 0;
    let tadeScored = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < students.length; i += size) {
        const chunk = students.slice(i, i + size);
        setMsg(
          `Saving ${Math.min(i + chunk.length, students.length)} / ${students.length}` +
            (runTade ? " (TADE on TY/LY only)…" : "…")
        );
        const r = await api("/api/admin-master/placement-features", {
          method: "POST",
          body: JSON.stringify({ students: chunk, runTade }),
        });
        upserted += Number(r.upserted) || 0;
        tadeScored += Number(r.tadeScored) || 0;
        skipped += Number(r.skipped) || 0;
      }
      setMsg(`Saved ${upserted} profile(s) to Atlas. TADE scored ${tadeScored}. Skipped ${skipped}.`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy">Placement features upload</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Upload the placement feature Excel (Permanent Registration Number, year, SSC, CGPA path, skills,
          internships). Data is stored for Placement portals and merged with any student-filled profile. Full TADE domain prediction runs for Third Year / Last Year only; First / Second Year rows get preparation guidance
          when enabled.
        </p>
      </div>

      <SectionCard title="Excel file">
        <div
          className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
            dragOver ? "border-navy bg-navy/5" : "border-muted"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <FileSpreadsheet className="mx-auto h-10 w-10 text-navy/70" />
          <p className="mt-2 text-sm font-medium text-navy">{fileName || "Drop one or more placement Excel files here"}</p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white">
            <Upload className="h-4 w-4" />
            Choose file(s)
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={runTade} onChange={(e) => setRunTade(e.target.checked)} />
          Run TADE domain scoring on commit (requires ML service on port 8001)
        </label>
        {meta && (
          <p className="mt-2 text-xs text-muted-foreground">
            Sheet “{meta.sheet}”: {meta.rawRows} rows → {meta.unique} unique PRNs
          </p>
        )}
        {msg && <p className="mt-3 text-sm text-navy">{msg}</p>}
        <button
          type="button"
          disabled={busy || !total}
          onClick={commit}
          className="mt-4 rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-navy disabled:opacity-50"
        >
          {busy ? "Working…" : `Commit ${total || ""} to database`}
        </button>
      </SectionCard>

      {preview.length > 0 && (
        <SectionCard title="Preview">
          <div className="overflow-x-auto text-xs">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">PRN</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Year</th>
                  <th className="p-2">Batch</th>
                  <th className="p-2">Internships</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((s) => (
                  <tr key={s.prn} className="border-b border-muted/50">
                    <td className="p-2 font-mono">{s.prn}</td>
                    <td className="p-2">{s.name}</td>
                    <td className="p-2">{s["Current Year"]}</td>
                    <td className="p-2">{s.Batch}</td>
                    <td className="p-2">{s["No. of Internships"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
