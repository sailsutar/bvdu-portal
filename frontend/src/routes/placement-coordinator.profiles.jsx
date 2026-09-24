import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { PlacementExcelGrid, PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";
import { authHeaders } from "@/lib/auth";

export default function PcProfiles() {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [status, setStatus] = useState("All");
  const [rows, setRows] = useState([]);
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [summary, setSummary] = useState(null);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (year !== "All") params.set("year", year);
    if (batch !== "All") params.set("batch", batch);
    if (status !== "All") params.set("status", status);
    const r = await api(`/api/placement/profiles?${params}`);
    setRows(r.profiles || []);
    setYears(r.years || []);
    setBatches(r.batches || []);
    setSummary(r.summary || null);
  }, [year, batch, status]);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  async function syncCohort() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api("/api/placement/sync-from-cohort", { method: "POST", body: "{}" });
      setMsg(`Synced from academic Excel: created ${r.created}, updated ${r.updated} (cohort ${r.totalAcademic}).`);
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatusPrn(prn, next, note) {
    try {
      await api(`/api/placement/profiles/${encodeURIComponent(prn)}/status`, {
        method: "POST",
        body: JSON.stringify({ status: next, coordinatorNote: note || "" }),
      });
      setMsg(`${prn} → ${next}`);
      await load();
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">Student profiles (Excel view)</h1>
          <p className="text-sm text-muted-foreground">
            Combined from HOD academic Excel + System Admin background + student placement form. Predictions
            recompute live (readiness, consistency, employability).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={syncCohort}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Syncing…" : "Sync from academic Excel"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-navy/30 px-4 py-2 text-sm font-semibold text-navy"
            onClick={() => {
              const q = new URLSearchParams();
              if (year !== "All") q.set("year", year);
              if (batch !== "All") q.set("batch", batch);
              fetch(`/api/placement/export.csv?${q}`, { headers: authHeaders() })
                .then((r) => r.blob())
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "placement_export.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                });
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />

      <div className="flex flex-wrap gap-2">
        {["All", "draft", "submitted", "returned", "verified", "locked"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              status === s ? "bg-navy text-white" : "bg-muted text-navy"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {summary && (
        <p className="text-xs text-muted-foreground">
          Rows {summary.total} · Avg readiness {summary.avgReadiness} · Drive ready {summary.driveReady} ·
          Inconsistent (KT) {summary.inconsistent} · Avg completeness {summary.avgCompleteness}%
        </p>
      )}
      {msg && <p className="text-sm text-navy/90">{msg}</p>}

      <PlacementExcelGrid
        rows={rows}
        selectedPrn={selected?.prn}
        onRowClick={setSelected}
        showActions
        onVerify={(prn) => setStatusPrn(prn, "verified")}
        onReturn={(prn) => setStatusPrn(prn, "returned", "Please complete missing fields.")}
        onLock={(prn) => setStatusPrn(prn, "locked")}
      />

      {selected && (
        <SectionCard title={`Gaps & detail — ${selected.prn} ${selected.name || ""}`}>
          <p className="text-sm font-semibold text-navy">{selected.employablePrediction}</p>
          {selected.primaryDomain && (
            <p className="mt-1 text-sm">
              <span className="font-semibold">AI domain:</span> {selected.primaryDomain}
              {selected.primaryDomainFit != null ? ` (fit ${selected.primaryDomainFit})` : ""}
            </p>
          )}
          {(selected.suggestedDomains || []).length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
              {selected.suggestedDomains.map((d) => (
                <li key={d.domain}>
                  {d.domain} — {d.fitScore}: {(d.reasons || []).slice(0, 2).join("; ")}
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-2 list-inside list-disc text-sm">
            {(selected.gaps || []).map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Sources: academic Excel {selected.sourceAcademic ? "yes" : "no"} · background{" "}
            {selected.sourceBackground ? "yes" : "no"} · placement form {selected.sourceProfile ? "yes" : "no"}
          </p>
        </SectionCard>
      )}
    </div>
  );
}
