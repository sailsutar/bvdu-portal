import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import {
  snapshotCohort,
  listDriftSnapshots,
  driftDelta,
  getAuditLog,
  fairnessReport,
} from "@/lib/academic-intelligence";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

export default function AdminModelHealth() {
  const { students } = useDerived();
  const [tick, setTick] = useState(0);
  const [mlHealth, setMlHealth] = useState(null);
  const [mlMetrics, setMlMetrics] = useState(null);

  useEffect(() => {
    api("/api/ml/health")
      .then((d) => setMlHealth(d))
      .catch((e) => setMlHealth({ ok: false, error: e.message || "ML service unreachable" }));
    api("/api/ml/metrics")
      .then((d) => setMlMetrics(d))
      .catch(() => setMlMetrics(null));
    api("/api/ml/model-health")
      .then((d) => setMlMetrics((prev) => ({ ...(prev || {}), modelHealth: d })))
      .catch(() => {});
  }, [tick]);
  const snaps = listDriftSnapshots();
  const delta = driftDelta();
  const audit = getAuditLog().slice(0, 40);
  const fairness = useMemo(() => fairnessReport(students), [students, tick]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Model health & audit</h1>
        <p className="text-sm text-muted-foreground">
          Cross-upload drift signals, fairness by batch, and an audit trail of intelligence actions.
        </p>
      </div>

      <SectionCard title="Machine learning service">
        {mlHealth == null ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : mlHealth.ok ? (
          <p className="text-sm text-success">
            ML service healthy
            {mlHealth.ml?.pipelines ? ` · pipelines: ${JSON.stringify(mlHealth.ml.pipelines)}` : ""}
          </p>
        ) : (
          <p className="text-sm text-danger">
            ML service unavailable: {mlHealth.error || mlHealth.detail || "unreachable"}. Early-warning
            predicted status stays blank until the service is restored (no rule-based substitute).
          </p>
        )}
        {mlMetrics && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs">
            {JSON.stringify(mlMetrics, null, 2)}
          </pre>
        )}
      </SectionCard>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard value={String(snaps.length)} label="Cohort snapshots" />
        <StatCard
          value={delta?.alert ? "ALERT" : snaps.length >= 2 ? "Stable" : "—"}
          label="Drift status"
        />
        <StatCard value={String(audit.length)} label="Recent audit events (showing)" />
      </div>

      <SectionCard title="Ensemble stack, calibration & fairness">
        <p className="mb-2 text-xs text-muted-foreground">
          Production stack: Random Forest + Histogram Gradient Boosting (soft vote), isotonic
          probability calibration, SHAP on RF base. Adaptive Unit Tests (UT-1 only if UT-2 blank).
        </p>
        {mlMetrics?.modelHealth?.years ? (
          <div className="space-y-3 text-sm">
            {Object.entries(mlMetrics.modelHealth.years).map(([year, y]) => (
              <div key={year} className="rounded border p-2">
                <div className="font-semibold text-navy">{String(year).toUpperCase()}</div>
                <div className="text-xs text-muted-foreground">
                  Holdout {(y.accuracy_holdout != null ? (y.accuracy_holdout * 100).toFixed(1) : "—")}% ·
                  CV {(y.cv_accuracy_mean != null ? (y.cv_accuracy_mean * 100).toFixed(1) : "—")}% ·
                  SHAP {y.shap ? "yes" : "no"} · mode {y.mode || "—"}
                </div>
                {y.stack?.length > 0 && (
                  <div className="mt-1 text-xs">Stack: {y.stack.join(" → ")}</div>
                )}
                {y.conformal?.q_hat != null && (
                  <div className="mt-1 text-xs">
                    Conformal α={y.conformal.alpha ?? 0.1}: coverage holdout{" "}
                    {y.conformal.empirical_coverage != null
                      ? `${(y.conformal.empirical_coverage * 100).toFixed(1)}%`
                      : "—"}{" "}
                    · mean set {y.conformal.mean_set_size ?? "—"}
                  </div>
                )}
                {y.cost_policy?.at_risk_probability_threshold != null && (
                  <div className="text-xs">
                    Cost-sensitive τ(At Risk)={Number(y.cost_policy.at_risk_probability_threshold).toFixed(3)}
                  </div>
                )}
                {y.fairness_slices?.length > 0 && (
                  <ul className="mt-1 text-xs">
                    {y.fairness_slices.map((s) => (
                      <li key={s.slice}>
                        {s.slice}: n={s.n}, acc={(s.accuracy * 100).toFixed(1)}%
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Retrain ML service to populate ensemble metrics (`python train_multi_year.py`).
          </p>
        )}
      </SectionCard>

      <SectionCard title="MLOps promote / rollback">
        <p className="mb-2 text-xs text-muted-foreground">
          Production registry only accepts models that pass holdout, overfit-gap, and conformal checks.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy"
            onClick={() => {
              api("/api/ml/mlops/promote", { method: "POST", body: "{}" })
                .then((d) => {
                  alert(JSON.stringify(d.results || d, null, 2));
                  setTick((x) => x + 1);
                })
                .catch((e) => alert(String(e.message || e)));
            }}
          >
            Promote candidates
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-xs"
            onClick={() => {
              api("/api/ml/mlops/rollback", { method: "POST", body: "{}" })
                .then((d) => {
                  alert("Rolled back");
                  setTick((x) => x + 1);
                })
                .catch((e) => alert(String(e.message || e)));
            }}
          >
            Rollback all years
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-xs"
            onClick={() => {
              api("/api/ml/mlops/registry")
                .then((d) => alert(JSON.stringify(d, null, 2)))
                .catch((e) => alert(String(e.message || e)));
            }}
          >
            View registry
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Drift control">
        <button
          type="button"
          className="mb-3 rounded-md bg-gold px-3 py-2 text-sm font-semibold text-navy"
          onClick={() => {
            snapshotCohort(students, "health-page");
            setTick((t) => t + 1);
          }}
        >
          Take cohort snapshot now
        </button>
        {delta && (
          <p className="mb-3 text-sm">
            vs previous: at-risk Δ <b>{(delta.dAtRiskRate * 100).toFixed(1)} pp</b>
            {delta.dMeanUt != null && (
              <>
                , mean unit test Δ <b>{delta.dMeanUt.toFixed(2)}</b>
              </>
            )}
            {delta.dAttendance != null && (
              <>
                , attendance Δ <b>{delta.dAttendance.toFixed(1)}</b>
              </>
            )}
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">When</th>
              <th className="py-2">N</th>
              <th className="py-2">Mean att</th>
              <th className="py-2">Mean Unit Test</th>
              <th className="py-2">At-risk rate</th>
            </tr>
          </thead>
          <tbody>
            {snaps.map((s) => (
              <tr key={s.id} className="border-b last:border-b-0">
                <td className="py-2 text-xs">{new Date(s.ts).toLocaleString()}</td>
                <td className="py-2">{s.n}</td>
                <td className="py-2">{s.meanAttendance?.toFixed?.(1) ?? "—"}</td>
                <td className="py-2">{s.meanUt?.toFixed?.(2) ?? "—"}</td>
                <td className="py-2">{((s.atRiskRate || 0) * 100).toFixed(1)}%</td>
              </tr>
            ))}
            {!snaps.length && (
              <tr>
                <td colSpan={5} className="py-4 text-muted-foreground">
                  No snapshots yet — capture after each major upload.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="Fairness (batch)">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Batch</th>
              <th className="py-2">N</th>
              <th className="py-2">At-risk %</th>
              <th className="py-2">Slow %</th>
            </tr>
          </thead>
          <tbody>
            {fairness.map((g) => (
              <tr key={g.batch} className="border-b last:border-b-0">
                <td className="py-2">{g.batch}</td>
                <td className="py-2">{g.n}</td>
                <td className="py-2">{(g.atRiskRate * 100).toFixed(0)}%</td>
                <td className="py-2">{(g.slowRate * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="Audit log">
        <ul className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
          {audit.map((e) => (
            <li key={e.id}>
              {e.ts} · <b>{e.type}</b> · {JSON.stringify({ ...e, id: undefined, ts: undefined, type: undefined })}
            </li>
          ))}
          {!audit.length && <li className="text-muted-foreground">Empty — actions will appear here.</li>}
        </ul>
      </SectionCard>
    </div>
  );
}
