import { Link, useParams } from "react-router-dom";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { findStudentByPrn, initials, rawEntries, useDerived } from "@/lib/upload-stats";
import { NoData } from "@/components/portal/NoData";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";
import { severityClass, priorityClass } from "@/lib/explain-performance";
import { useStudentExplanation } from "@/lib/explain-model";
import {
  useStudentPrediction,
  currentStatusOf,
  statusBadgeClass,
} from "@/lib/ml-predict";

function Badge({ status }) {
  if (!status || status === "—") return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass(status)}`}>
      {status}
    </span>
  );
}

function ImpactBar({ share, positive }) {
  const w = Math.max(4, Math.min(100, share || 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full ${positive ? "bg-success" : "bg-destructive"}`}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function ExplainableAIPanel({ student }) {
  const { prediction, isLoading: predLoading, isError: predError } = useStudentPrediction(student);
  const { report, isLoading: explainLoading, isError: explainError, error: explainErr } = useStudentExplanation(student);

  const current = currentStatusOf(student);
  const predicted = prediction?.status || null;
  const differs = predicted != null && current && predicted !== current;
  const waiting = (predLoading && !prediction?.status) || (explainLoading && !report);

  if (waiting) {
    return (
      <div className="rounded-xl border border-navy/10 bg-navy/5 p-6 text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-navy border-t-transparent" />
        <p className="text-sm font-medium text-navy">Waiting for Random Forest model…</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Predicted status and Shapley explanations appear only after the machine learning service responds.
        </p>
      </div>
    );
  }

  if (predError || explainError || !report) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Machine learning service did not return a result.
        {explainErr?.message ? ` ${explainErr.message}` : " Ensure the ML service is running on port 8001."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div
        className={`rounded-xl border p-4 ${
          report.degraded ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"
        }`}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Explainable Artificial Intelligence
          </span>
          <Badge status={current} />
          <span className="text-xs text-muted-foreground">current</span>
          <span className="text-muted-foreground">→</span>
          <Badge status={predicted} />
          <span className="text-xs text-muted-foreground">predicted</span>
          {differs && (
            <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-navy">
              Status may change
            </span>
          )}
        </div>
        <p className="text-base font-semibold text-navy">{report.headline}</p>
        {report.trend !== "unknown" && (
          <p className="mt-1 text-sm text-navy/80">
            Unit Test trajectory: <b className="capitalize">{report.trend}</b>
            {report.meanUt1 != null && report.meanUt2 != null && (
              <>
                {" "}
                (mean unit test-1 {report.meanUt1.toFixed(1)} → Unit Test 2 {report.meanUt2.toFixed(1)}
                {report.trendDelta != null && (
                  <>
                    , Δ {report.trendDelta > 0 ? "+" : ""}
                    {report.trendDelta}
                  </>
                )}
                )
              </>
            )}
          </p>
        )}
        {prediction?.source && (
          <p className="mt-1 text-xs text-muted-foreground">
            Prediction source: Random Forest machine learning model
            {prediction.confidence != null && ` · confidence available`}
          </p>
        )}
        {report?.source && (
          <p className="mt-1 text-xs text-muted-foreground">
            Explanation source:{" "}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                report.source === "model"
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              via machine learning model (Shapley explanations)
            </span>
          </p>
        )}
      </div>

      {/* Why degraded / key reasons */}
      <SectionCard title="Why performance looks this way">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-navy/90">
          {report.whyDegraded.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </SectionCard>

      {/* Factor contributions */}
      <SectionCard title="Risk / performance factors (ranked)">
        <p className="mb-3 text-xs text-muted-foreground">
          Each factor shows an estimated contribution share toward the current risk picture
          (explainable weights from attendance, fails, averages, trends, and consistency — not a black box).
        </p>
        <ul className="space-y-3">
          {report.drivers.map((d) => (
            <li key={d.id} className="rounded-lg border p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-navy">{d.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${severityClass(d.severity)}`}>
                    {d.severity}
                  </span>
                </div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  value: <b className="text-navy">{d.value}</b> · share ~{d.share}%
                </div>
              </div>
              <ImpactBar share={d.share} positive={d.positive} />
              <p className="mt-2 text-sm text-navy/85">{d.reason}</p>
            </li>
          ))}
          {!report.drivers.length && (
            <li className="text-sm text-muted-foreground">Not enough uploaded data to rank factors.</li>
          )}
        </ul>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionCard title="Protective strengths">
          {report.strengths.length ? (
            <ul className="list-disc space-y-1 pl-4 text-sm text-navy/90">
              {report.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No strong protective factors flagged.</p>
          )}
        </SectionCard>

        <SectionCard title="Subject signals">
          <div className="space-y-2 text-sm">
            {report.failingSubjects?.length > 0 && (
              <p>
                <span className="font-semibold text-destructive">Failing: </span>
                {report.failingSubjects.join(", ")}
              </p>
            )}
            {report.decliningSubjects?.length > 0 && (
              <p>
                <span className="font-semibold text-navy">Declining UT: </span>
                {report.decliningSubjects
                  .map((d) => `${d.subject} (${d.u1}→${d.u2})`)
                  .join(", ")}
              </p>
            )}
            {report.improvingSubjects?.length > 0 && (
              <p>
                <span className="font-semibold text-success">Improving UT: </span>
                {report.improvingSubjects
                  .map((d) => `${d.subject} (${d.u1}→${d.u2})`)
                  .join(", ")}
              </p>
            )}
            {report.weakSubjects?.length > 0 && (
              <p>
                <span className="font-semibold text-navy">Weak (&lt;50%): </span>
                {report.weakSubjects.map((w) => `${w.subject} (${w.score.toFixed(0)}%)`).join(", ")}
              </p>
            )}
            {!report.failingSubjects?.length &&
              !report.decliningSubjects?.length &&
              !report.weakSubjects?.length && (
                <p className="text-muted-foreground">No critical subject-level red flags.</p>
              )}
          </div>
        </SectionCard>
      </div>

      {/* Teacher actions */}
      <SectionCard title="Recommended teacher actions">
        <ul className="space-y-2">
          {report.recommendations.map((r, i) => (
            <li
              key={i}
              className={`rounded-lg border px-3 py-2 text-sm ${priorityClass(r.priority)}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {r.priority} priority
                </span>
                <span className="font-semibold text-navy">{r.action}</span>
              </div>
              <p className="mt-1 text-navy/85">{r.detail}</p>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function StudentDetail() {
  const { prn } = useParams();
  const { students } = useDerived();
  const s = findStudentByPrn(students, prn);

  if (!s) {
    return (
      <div className="space-y-6">
        <Link to="/admin/students" className="inline-flex items-center gap-1 text-sm text-navy hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Students
        </Link>
        <NoData message={`No record found for Permanent Registration Number ${prn} in uploaded data.`} />
      </div>
    );
  }

  const current = currentStatusOf(s);

  return (
    <div className="space-y-6">
      <Link to="/admin/students" className="inline-flex items-center gap-1 text-sm text-navy hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Students
      </Link>

      <div className="flex items-center gap-6 rounded-xl border bg-card p-6 shadow-sm">
        <div className="grid h-24 w-24 place-items-center rounded-full bg-gold-soft text-3xl font-bold text-navy">
          {initials(s.name)}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-navy">{s.name}</h2>
          <p className="text-sm text-muted-foreground">PRN: {s.prn}</p>
          <p className="text-sm text-muted-foreground">Class: {s.cls || "—"}</p>
          <p className="text-sm text-muted-foreground">
            Email: {s.email || `${(s.name || "student").split(" ")[0].toLowerCase()}@bvu.edu.in`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge status={current} />
            <span className="text-xs text-muted-foreground">Academic status from uploaded data</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="explain">
        <TabsList>
          <TabsTrigger value="explain">Explainable Artificial Intelligence</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="marks">Marks</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="explain" className="mt-4">
          <ExplainableAIPanel student={s} />
        </TabsContent>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
            <StatCard
              value={s.attendanceKnown ? `${s.attendance}%` : "—"}
              label="Attendance"
              tone={s.attendanceKnown && s.attendance < 75 ? "warn" : "good"}
            />
            <StatCard value={s.cgpaKnown && s.cgpa != null ? s.cgpa : "—"} label="CGPA" />
            <StatCard
              value={s.averagePercentage != null ? `${s.averagePercentage}%` : "—"}
              label="Avg %"
            />
            <StatCard value={current} label="Status" />
            <SectionCard title="Quick note">
              <p className="text-sm text-navy/80">
                Open the <b>Explainable Artificial Intelligence</b> tab for ranked reasons, UT trends, and recommended actions.
              </p>
            </SectionCard>
          </div>
        </TabsContent>

        {["attendance", "marks", "assignments", "performance", "feedback"].map((v) => (
          <TabsContent key={v} value={v} className="mt-4">
            <SectionCard>
              <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
                Raw uploaded row
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {rawEntries(s.raw).map(([k, v2]) => (
                      <tr key={k} className="border-b last:border-b-0">
                        <td className="py-2 pr-4 font-medium text-navy">{k}</td>
                        <td className="py-2">{v2}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default StudentDetail;
