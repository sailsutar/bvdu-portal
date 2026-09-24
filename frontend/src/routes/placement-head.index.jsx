import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";

export default function PhIndex() {
  const [year, setYear] = useState("All");
  const [dash, setDash] = useState(null);
  const [years, setYears] = useState(["FY", "SY", "TY", "LY"]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const q = year !== "All" ? `?year=${encodeURIComponent(year)}` : "";
    Promise.all([api(`/api/placement/dashboard${q}`), api("/api/placement/profiles")])
      .then(([d, p]) => {
        setDash(d && typeof d === "object" ? d : { summary: {}, topGaps: [], byYear: {} });
        setYears(p?.years?.length ? p.years : ["FY", "SY", "TY", "LY"]);
        setMsg("");
      })
      .catch((e) => setMsg(e.message || String(e)));
  }, [year]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Placement Head</h1>
      <p className="text-sm text-muted-foreground">
        Dynamic employability predictions by year. When last-3-year placement outcomes are uploaded, this layer can
        switch from readiness rules to trained ML.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch="All" setBatch={() => {}} years={years} batches={[]} />
      {msg && <p className="text-sm text-danger">{msg}</p>}
      {dash && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={String(dash.summary?.total ?? 0)} label="In view" />
            <StatCard value={String(dash.summary?.verified ?? 0)} label="Verified / locked" />
            <StatCard value={String(dash.summary?.driveReady ?? 0)} label="Drive ready" />
            <StatCard value={String(dash.summary?.inconsistent ?? 0)} label="Inconsistent (KT)" />
            <StatCard value={String(dash.summary?.avgReadiness ?? 0)} label="Avg readiness" />
            <StatCard value={String(dash.summary?.high ?? 0)} label="High band" />
          </div>
          <SectionCard title="Top gaps (dynamic)">
            <ul className="text-sm">
              {(dash.topGaps || []).map((g) => (
                <li key={g.gap} className="border-b py-1">
                  {g.gap} <span className="text-muted-foreground">({g.count})</span>
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title="By year">
            <pre className="text-xs">{JSON.stringify(dash.byYear, null, 2)}</pre>
          </SectionCard>
        </>
      )}
      <div className="flex gap-4 text-sm">
        <Link className="font-semibold text-navy underline" to="/placement-head/profiles">
          Excel grid — verified
        </Link>
        <Link className="font-semibold text-navy underline" to="/placement-head/ready">
          Drive ready list
        </Link>
      </div>
    </div>
  );
}
