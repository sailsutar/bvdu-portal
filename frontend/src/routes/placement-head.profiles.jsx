import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { PlacementExcelGrid, PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";
import { authHeaders } from "@/lib/auth";

export default function PhProfiles() {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [rows, setRows] = useState([]);
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState("");
  const [tade, setTade] = useState(null);
  const [tadeLoading, setTadeLoading] = useState(false);
  const [gap, setGap] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ verifiedOnly: "1" });
    if (year !== "All") params.set("year", year);
    if (batch !== "All") params.set("batch", batch);
    const r = await api(`/api/placement/profiles?${params}`);
    setRows(r.profiles || []);
    setYears(r.years || []);
    setBatches(r.batches || []);
  }, [year, batch]);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  useEffect(() => {
    if (!selected?.prn) {
      setTade(null);
      setGap(null);
      return;
    }
    setTadeLoading(true);
    api("/api/placement/tade/predict-profile", {
      method: "POST",
      body: JSON.stringify({ prn: selected.prn }),
    })
      .then((r) => {
        setTade(r.tade || r);
        return api("/api/placement/tade/gap-plan", {
          method: "POST",
          body: JSON.stringify(r.payload || { prn: selected.prn }),
        }).catch(() => null);
      })
      .then((g) => setGap(g))
      .catch((e) => setMsg(e.message || "TADE error"))
      .finally(() => setTadeLoading(false));
  }, [selected?.prn]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">Verified profiles (Excel view)</h1>
      <p className="text-sm text-muted-foreground">
        Coordinator-verified rows with live employability prediction, readiness score, and academic signals from Excel.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />
      <button
        type="button"
        className="rounded-lg border border-navy/30 px-4 py-2 text-sm font-semibold text-navy"
        onClick={() => {
          const q = new URLSearchParams({ verifiedOnly: "1" });
          if (year !== "All") q.set("year", year);
          if (batch !== "All") q.set("batch", batch);
          fetch(`/api/placement/export.csv?${q}`, { headers: authHeaders() })
            .then((r) => r.blob())
            .then((blob) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "placement_verified.csv";
              a.click();
              URL.revokeObjectURL(url);
            });
        }}
      >
        Export CSV
      </button>
      {msg && <p className="text-sm text-danger">{msg}</p>}
      <PlacementExcelGrid rows={rows} selectedPrn={selected?.prn} onRowClick={setSelected} />
      {selected && (
        <SectionCard title={`Prediction detail — ${selected.prn}`}>
          <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/80 p-3 text-sm">
            <p className="font-bold text-indigo-900">TADE — Trajectory-Aware Domain Engine</p>
            {tadeLoading && <p className="text-xs text-indigo-700">Running domain model…</p>}
            {tade && (
              <>
                <p className="mt-1 font-semibold text-navy">
                  Top domain: {tade.top_domain}{" "}
                  <span className="text-xs font-normal text-muted-foreground">({tade.source})</span>
                </p>
                <p className="text-xs">
                  Readiness {tade.readiness} · Conformal set:{" "}
                  {(tade.domain_set || []).join(", ") || "—"}
                </p>
                <ul className="mt-1 max-h-24 overflow-auto text-xs">
                  {Object.entries(tade.probabilities || [])
                    .slice(0, 7)
                    .map(([d, p]) => (
                      <li key={d}>
                        {d}: {(Number(p) * 100).toFixed(1)}%
                      </li>
                    ))}
                </ul>
              </>
            )}
            {gap?.gap_plan?.length > 0 && (
              <div className="mt-2 border-t border-indigo-200 pt-2">
                <p className="text-xs font-semibold text-indigo-900">Gap plan (counterfactual)</p>
                <ul className="list-inside list-disc text-xs">
                  {gap.gap_plan.slice(0, 3).map((g, i) => (
                    <li key={i}>
                      {g.action}{" "}
                      <span className="text-muted-foreground">
                        (Δdomain {g.target_domain_prob_delta}, Δready {g.readiness_delta})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="font-semibold text-navy">{selected.employablePrediction}</p>
          {selected.primaryDomain && (
            <p className="mt-1 text-sm font-semibold text-navy">
              AI domain: {selected.primaryDomain} ({selected.primaryDomainFit})
            </p>
          )}
          <p className="text-sm">
            Band {selected.readinessBand} · Score {selected.readinessScore} · Consistency {selected.consistency}
          </p>
          {(selected.suggestedDomains || []).length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs">
              {selected.suggestedDomains.map((d) => (
                <li key={d.domain}>
                  {d.domain} ({d.fitScore}) — {(d.reasons || []).slice(0, 2).join("; ")}
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-2 list-inside list-disc text-sm">
            {(selected.gaps || []).map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
