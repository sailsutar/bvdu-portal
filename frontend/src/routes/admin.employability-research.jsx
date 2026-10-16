import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SectionCard } from "@/components/portal/PortalShell";

export default function AdminEmployabilityResearchPage() {
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    api("/api/employability/evaluation/status")
      .then(setStatus)
      .catch((e) => setErr(e.message));
    api("/api/employability/evaluation/runs")
      .then((d) => setRuns(d.runs || []))
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const runEval = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api("/api/employability/evaluation/run", { method: "POST", body: "{}" });
      refresh();
      if (r.evaluationId) {
        const full = await api(`/api/employability/evaluation/runs/${r.evaluationId}`);
        setSelected(full);
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const openRun = async (id) => {
    try {
      const full = await api(`/api/employability/evaluation/runs/${id}`);
      setSelected(full);
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Employability research evaluation</h1>
        <p className="text-sm text-muted-foreground">
          Observed historical evaluation harness (S10). Does not fabricate outcomes. Labels results as
          observational, not causal.
        </p>
      </div>

      {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{err}</div> : null}

      <SectionCard title="Data sufficiency">
        {!status ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>Intervention results in DB: {status.data?.interventionResults ?? "—"}</p>
            <p>Assessments: {status.data?.assessments ?? "—"}</p>
            <p>Min samples for VALID metrics: {status.minSamplesForValid}</p>
            <p>
              Arm D (S7 ML): <strong>{status.armD?.status}</strong> ({status.armD?.registryStatus})
            </p>
            <p className="text-xs text-muted-foreground">{status.note}</p>
            <button
              type="button"
              disabled={busy}
              onClick={runEval}
              className="mt-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Running…" : "Run evaluation (admin)"}
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Evaluation runs">
        {!runs.length ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {runs.map((r) => (
              <li key={r.evaluationId}>
                <button type="button" className="text-navy underline" onClick={() => openRun(r.evaluationId)}>
                  {r.evaluationId}
                </button>
                <span className="ml-2 text-xs text-muted-foreground">
                  {r.status} · {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {selected ? (
        <SectionCard title={`Report: ${selected.run?.evaluationId}`}>
          <p className="mb-2 text-xs text-muted-foreground">
            Status: {selected.run?.status} · Version: {selected.run?.evaluationVersion}
          </p>
          <p className="mb-2 text-xs">Cohort intervention results: {selected.run?.cohort?.interventionResults}</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="py-1 pr-2">Arm</th>
                  <th className="py-1 pr-2">Metric</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1 pr-2">Valid n</th>
                  <th className="py-1">Value</th>
                </tr>
              </thead>
              <tbody>
                {(selected.results || []).map((row) => (
                  <tr key={`${row.arm}-${row.metric}`} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{row.arm}</td>
                    <td className="py-1 pr-2">{row.metric}</td>
                    <td className="py-1 pr-2">{row.status}</td>
                    <td className="py-1 pr-2">{row.validCount}</td>
                    <td className="py-1 font-mono">{row.value == null ? "—" : JSON.stringify(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            <div className="font-semibold">Limitations</div>
            <ul className="list-disc pl-4">
              {(selected.run?.limitations || []).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
