import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";

export default function PcIndex() {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [summary, setSummary] = useState(null);
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (year !== "All") params.set("year", year);
    if (batch !== "All") params.set("batch", batch);
    api(`/api/placement/profiles?${params}`)
      .then((r) => {
        setSummary(r.summary);
        setYears(r.years || []);
        setBatches(r.batches || []);
      })
      .catch((e) => setMsg(e.message));
  }, [year, batch]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Placement Coordinator</h1>
      <p className="text-sm text-muted-foreground">
        Year-wise collection, live completeness / readiness predictions, Excel-style grids. Sync from academic Excel
        so every PRN appears even before the student opens the form.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />
      {msg && <p className="text-sm text-danger">{msg}</p>}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard value={String(summary.total)} label="Students in view" />
          <StatCard value={String(summary.submitted)} label="Awaiting verify" />
          <StatCard value={String(summary.driveReady)} label="Drive ready" />
          <StatCard value={String(summary.inconsistent)} label="Inconsistent (KT)" />
          <StatCard value={String(summary.avgReadiness)} label="Avg readiness score" />
          <StatCard value={`${summary.avgCompleteness}%`} label="Avg completeness" />
          <StatCard value={String(summary.missingResume)} label="Missing resume" />
          <StatCard value={String(summary.high)} label="High band" />
        </div>
      )}
      <SectionCard title="Actions">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-navy underline" to="/placement-coordinator/profiles">
            Excel grid — all profiles
          </Link>
          <Link className="font-semibold text-navy underline" to="/placement-coordinator/queue">
            Missing data queue
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
