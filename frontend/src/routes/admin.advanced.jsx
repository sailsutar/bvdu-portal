import { useMemo, useState } from "react";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import {
  detectWeakTopics,
  detectStructuralRisks,
  detectMarksAnomalies,
  buildObeEvidenceDocument,
  buildCohortDigest,
  propagateCurriculumRisk,
  getCurriculumGraph,
  draftTeacherCoachingNotes,
  listCoachingNotes,
  getMlopsState,
  registerCandidateModel,
  evaluateAndPromoteCandidate,
  rollbackProduction,
} from "@/lib/advanced-intelligence";
import { authHeaders } from "@/lib/auth";
import { NoData } from "@/components/portal/NoData";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function AdminAdvanced() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const [tab, setTab] = useState("topics");
  const [tick, setTick] = useState(0);
  const [evidence, setEvidence] = useState(null);
  const [coachMsg, setCoachMsg] = useState("");

  const weak = useMemo(() => detectWeakTopics(students, { allStudents }), [students, allStudents, tick]);
  const structural = useMemo(() => detectStructuralRisks(students), [students, tick]);
  const anomalies = useMemo(() => detectMarksAnomalies(students), [students, tick]);
  const curriculum = useMemo(() => propagateCurriculumRisk(students, { allStudents }), [students, allStudents, tick]);
  const graphMeta = useMemo(() => getCurriculumGraph(students, allStudents), [students, allStudents, tick]);
  const mlops = getMlopsState();
  const coaching = listCoachingNotes();

  if (!allStudents.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Advanced Intelligence</h1>
        <NoData message="Upload cohort data to unlock advanced modules." />
      </div>
    );
  }

  const tabs = [
    { id: "topics", label: "Weak topics" },
    { id: "structure", label: "Structural risk" },
    { id: "curriculum", label: "Curriculum graph" },
    { id: "anomalies", label: "Anomalies" },
    { id: "obe", label: "OBE evidence" },
    { id: "digest", label: "Cohort digest" },
    { id: "coaching", label: "Feedback coaching" },
    { id: "mlops", label: "Model operations" },
  ];

  async function runCoaching() {
    setCoachMsg("Loading feedback…");
    try {
      const r = await fetch(`${API_BASE}/api/feedback?limit=500`, {
        headers: { ...authHeaders() },
      });
      const data = await r.json().catch(() => ([]));
      const list = Array.isArray(data) ? data : data.items || data.feedbacks || [];
      const notes = draftTeacherCoachingNotes(list);
      setTick((x) => x + 1);
      setCoachMsg(
        notes.length
          ? `Drafted ${notes.length} coaching note(s) from ${list.length} feedback item(s).`
          : list.length
            ? "Feedback loaded but no negative themes to cluster yet."
            : "No feedback in database yet. Students must submit feedback first."
      );
    } catch (e) {
      draftTeacherCoachingNotes([]);
      setTick((x) => x + 1);
      setCoachMsg(`Could not load feedback: ${e.message || e}`);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Advanced Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Weak topics, curriculum risk from your Excel subjects, feedback coaching, and model registry.
          Structural risk, anomalies, and curriculum links are <b>heuristic estimates</b> from uploaded marks — not an
          official syllabus graph.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Showing {students.length} of {allStudents.length} students
          {year !== "All" ? ` · ${year}` : ""}
          {batch !== "All" ? ` · batch ${batch}` : ""}
        </p>
        <YearBatchFilter {...filterProps} />
      </div>


      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              tab === t.id ? "border-gold bg-gold-soft text-navy" : "bg-background text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "topics" && (
        <SectionCard title={`Weak topics (${year}${batch !== "All" ? " · " + batch : " · all"}) — from filtered cohort`}>
          <ul className="space-y-1 text-sm">
            {(weak || []).slice(0, 20).map((t) => (
              <li key={t.subject || t.id} className="flex justify-between border-b py-1">
                <span>{t.subject}</span>
                <span className="text-muted-foreground">
                  mean {t.meanUt ?? t.mean ?? "—"}
                  {t.weak ? " · weak" : ""}
                </span>
              </li>
            ))}
            {!weak?.length && (
              <li className="text-muted-foreground">No weak topics detected from current marks.</li>
            )}
          </ul>
        </SectionCard>
      )}

      {tab === "structure" && (
        <SectionCard title={`Structural risk — ${year}${batch !== "All" ? " · Batch " + batch : ""}`}>
          <p className="mb-4 text-xs text-muted-foreground">
            Batch-level concentration of at-risk students for the current year/batch filter only.
          </p>
          {!(Array.isArray(structural) && structural.length) ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No structural risks flagged for this selection.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(Array.isArray(structural) ? structural : []).slice(0, 24).map((r, i) => {
                const severity = r.severity || (String(r.message || r.msg || "").toLowerCase().includes("underperform") ? "high" : "medium");
                const border =
                  severity === "high" || r.atRiskRate >= 0.4
                    ? "border-danger/40 bg-danger/5"
                    : severity === "medium" || (r.atRiskRate >= 0.25)
                      ? "border-warning/40 bg-warning/5"
                      : "border-border bg-card";
                return (
                  <div key={i} className={`rounded-xl border p-4 shadow-sm ${border}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-navy">
                          {r.batch ? `Batch ${r.batch}` : r.title || r.type || "Risk signal"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.year || year} · n={r.n ?? r.count ?? "—"}
                        </p>
                      </div>
                      {r.atRiskRate != null && (
                        <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-bold text-navy">
                          {(r.atRiskRate * 100).toFixed(0)}% at risk
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm text-foreground/90">
                      {r.message || r.msg || r.detail || r.reason || "Structural underperformance signal."}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {tab === "curriculum" && (
        <SectionCard title="Curriculum graph (from Excel subjects)">
          <p className="mb-2 text-xs text-muted-foreground">
            Subjects only from the selected year/batch filter. Edges = theory→lab and same-year sequence. Risk propagates
            from weak performance. Source: {graphMeta?.source || "—"}.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Subject</th>
                <th className="py-2">Year band</th>
                <th className="py-2">Weak students</th>
                <th className="py-2">Risk score (%)</th>
                <th className="py-2">Downstream</th>
              </tr>
            </thead>
            <tbody>
              {curriculum.map((n) => (
                <tr key={n.id} className="border-b last:border-b-0">
                  <td className="py-2 font-medium text-navy">
                    {n.label}
                    {n.isLab ? " (lab)" : ""}
                  </td>
                  <td className="py-2">{n.year || "—"}</td>
                  <td className="py-2">{n.directWeakness}</td>
                  <td className="py-2 font-semibold tabular-nums">
                    {n.riskScore != null ? `${n.riskScore}%` : "—"}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {(n.downstream || []).slice(0, 3).join(", ") || "—"}
                  </td>
                </tr>
              ))}
              {!curriculum.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-muted-foreground">
                    No subjects found in marks. Upload an Excel with subject columns.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </SectionCard>
      )}

      {tab === "anomalies" && (
        <SectionCard title={`Marks anomalies (${year}${batch !== "All" ? " · " + batch : ""})`}>
          <p className="mb-3 text-xs text-muted-foreground">
            ↑ higher than expected · ↓ lower than expected. Compared to class average or the student&apos;s own typical
            scores for this year/batch filter only.
          </p>
          <ul className="space-y-2 text-sm">
            {(Array.isArray(anomalies) ? anomalies : []).slice(0, 50).map((a, i) => {
              const arrow = a.arrow || (a.direction === "up" ? "↑" : a.direction === "down" ? "↓" : "•");
              const arrowCls =
                a.direction === "up"
                  ? "text-success"
                  : a.direction === "down"
                    ? "text-danger"
                    : "text-muted-foreground";
              return (
                <li key={i} className="rounded-lg border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-lg font-bold ${arrowCls}`}>{arrow}</span>
                    <span className="font-medium text-navy">{a.name || a.studentName || a.prn}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.prn} · {a.subject || "—"} · {a.assessment || a.type || ""}
                    </span>
                    {a.score != null && (
                      <span className="ml-auto text-xs font-semibold tabular-nums">
                        Score {a.score}
                        {a.classMean != null ? ` vs class ${a.classMean}` : ""}
                        {a.selfMean != null ? ` vs self ${a.selfMean}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.detail || a.reason || a.message || "Unusual mark pattern."}
                  </p>
                </li>
              );
            })}
            {!(Array.isArray(anomalies) && anomalies.length) && (
              <li className="text-muted-foreground">No anomalies detected for this filter.</li>
            )}
          </ul>
        </SectionCard>
      )}

      {tab === "obe" && (
        <SectionCard title="Outcome-Based Education evidence">
          <button
            type="button"
            className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy"
            onClick={() => setEvidence(buildObeEvidenceDocument(students))}
          >
            Generate evidence pack
          </button>
          {evidence?.markdown && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-3 text-xs">
              {evidence.markdown}
            </pre>
          )}
        </SectionCard>
      )}

      {tab === "digest" && (
        <SectionCard title="Cohort digest">
          <button
            type="button"
            className="mb-3 rounded border px-3 py-1.5 text-xs"
            onClick={() => {
              buildCohortDigest(students);
              setTick((x) => x + 1);
            }}
          >
            Build digest
          </button>
          <p className="text-sm text-muted-foreground">
            Digest uses current cohort risk counts and stores a snapshot for the Head of Department.
          </p>
        </SectionCard>
      )}

      {tab === "coaching" && (
        <SectionCard title="Feedback → teacher coaching notes">
          <p className="mb-2 text-xs text-muted-foreground">
            Loads feedback from MongoDB, clusters negative themes (pace, clarity, assignments…), and
            drafts private coaching notes per teacher.
          </p>
          <button
            type="button"
            className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy"
            onClick={runCoaching}
          >
            Cluster feedback and draft notes
          </button>
          {coachMsg && <p className="mb-2 text-xs text-muted-foreground">{coachMsg}</p>}
          <ul className="space-y-2 text-sm">
            {coaching.map((n) => (
              <li key={n.id} className="rounded border p-2">
                <div className="font-semibold text-navy">Teacher {n.teacherId}</div>
                <div className="text-xs text-muted-foreground">
                  Themes: {n.themeSummary} · Negative items: {n.negativeCount}
                </div>
                <p className="mt-1">{n.note}</p>
              </li>
            ))}
            {!coaching.length && (
              <li className="text-muted-foreground">No coaching notes yet. Click the button above.</li>
            )}
          </ul>
        </SectionCard>
      )}

      {tab === "mlops" && (
        <SectionCard title="Model operations registry">
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-3">
            <StatCard value={mlops.production?.version || "—"} label="Production model" />
            <StatCard value={String(mlops.candidates?.length || 0)} label="Candidates" />
            <StatCard value={String(mlops.rejections?.length || 0)} label="Auto-rejections" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy"
              onClick={() => {
                registerCandidateModel({
                  version: `cand_${Date.now()}`,
                  metrics: { holdout: 0.87, fairnessGap: 0.05 },
                  notes: "Candidate after term close",
                });
                setTick((x) => x + 1);
              }}
            >
              Register sample candidate
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs"
              onClick={() => {
                const v = mlops.candidates?.[0]?.version;
                if (v) evaluateAndPromoteCandidate(v);
                setTick((x) => x + 1);
              }}
            >
              Evaluate top candidate
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs"
              onClick={() => {
                rollbackProduction();
                setTick((x) => x + 1);
              }}
            >
              Rollback production
            </button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
