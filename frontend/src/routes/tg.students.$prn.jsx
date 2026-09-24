import { Link, useParams, Navigate } from "react-router-dom";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { findStudentByPrn, useDerived } from "@/lib/upload-stats";
import { useSession } from "@/lib/auth";
import { useTgMentees, tgBatchLabel, learnerSignals } from "@/lib/tg-assign";
import { NoData } from "@/components/portal/NoData";
import { ArrowLeft } from "lucide-react";
import { severityClass } from "@/lib/explain-performance";
import { useStudentExplanation } from "@/lib/explain-model";
import {
  useStudentPrediction,
  currentStatusOf,
  statusBadgeClass,
} from "@/lib/ml-predict";
import { MessageParentButton } from "@/components/portal/MessageParentModal";

function Badge({ status }) {
  if (!status || status === "—") return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass(status)}`}
    >
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

function ExplainPanel({ student }) {
  const { prediction } = useStudentPrediction(student);
  const { report, isLoading } = useStudentExplanation(student);
  const current = currentStatusOf(student);
  const predicted = prediction?.status || student.academicStatus || current;
  const differs = predicted && current && predicted !== current;
  const sig = learnerSignals(student);

  if (isLoading && !report) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        Loading explainable artificial intelligence report…
      </div>
    );
  }
  if (!report) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        No explanation available.
      </div>
    );
  }

  return (
    <div className="space-y-5">
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
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              report.source === "model"
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {report?.source === "model" ? "via machine learning model" : "waiting for model"}
          </span>
        </div>
        <p className="text-base font-semibold text-navy">{report.headline}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Unit Test basis for learning signals:{" "}
          <b>{sig.utBasis === "none" ? "no UT marks yet" : sig.utBasis}</b>
          {sig.meanUt != null && ` · mean unit test ${sig.meanUt.toFixed(1)}/20`}
          {prediction?.source &&
            ` · prediction: ${prediction?.source === "ml" ? "Random Forest" : "loading"}`}
        </p>
      </div>

      <SectionCard title="Why this looks this way">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-navy/90">
          {(report.whyDegraded || []).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
          {!(report.whyDegraded || []).length && (
            <li className="text-muted-foreground">No major degradation drivers listed.</li>
          )}
        </ol>
      </SectionCard>

      <SectionCard title="Risk / performance factors (ranked)">
        <ul className="space-y-3">
          {(report.drivers || []).map((d) => (
            <li key={d.id || d.label} className="rounded-lg border p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-navy">{d.label}</span>
                  {d.severity && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${severityClass(d.severity)}`}
                    >
                      {d.severity}
                    </span>
                  )}
                </div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  value: <b className="text-navy">{d.value}</b>
                  {d.share != null && <> · share ~{d.share}%</>}
                </div>
              </div>
              {d.share != null && <ImpactBar share={d.share} positive={d.positive} />}
              {d.reason && <p className="mt-2 text-sm text-navy/85">{d.reason}</p>}
            </li>
          ))}
          {!(report.drivers || []).length && (
            <li className="text-sm text-muted-foreground">Not enough data to rank factors.</li>
          )}
        </ul>
      </SectionCard>

      {(report.recommendations || []).length > 0 && (
        <SectionCard title="Recommendations">
          <ul className="list-disc space-y-1 pl-5 text-sm text-navy/90">
            {report.recommendations.map((r, i) => (
              <li key={i}>
                <b>{r.title || r.action || "Tip"}:</b> {r.detail || r.text || ""}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

export default function TgStudentDetail() {
  const { prn } = useParams();
  const { session } = useSession();
  const { students } = useDerived();
  const { mentees: mine } = useTgMentees(students, session?.tgIndex);
  const student = findStudentByPrn(students, prn);

  if (!student) {
    return (
      <div className="space-y-6">
        <Link to="/tg/students" className="inline-flex items-center gap-1 text-sm text-navy hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to my students
        </Link>
        <NoData message="Student not found." />
      </div>
    );
  }

  // Teacher Guide may only open their own mentees
  const allowed = mine.some((s) => String(s.prn) === String(student.prn));
  if (!allowed) {
    return <Navigate to="/tg/students" replace />;
  }

  const current = currentStatusOf(student);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/tg/students"
            className="inline-flex items-center gap-1 text-sm text-navy hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to my students
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-navy">{student.name}</h1>
          <p className="text-sm text-muted-foreground">
            Permanent Registration Number {student.prn} · {student.cls || "—"} · {tgBatchLabel(session?.tgIndex)}
          </p>
        </div>
        <MessageParentButton student={student} mode="full" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          value={student.attendanceKnown ? `${student.attendance}%` : "—"}
          label="Attendance"
        />
        <StatCard
          value={student.averagePercentage != null ? `${student.averagePercentage}%` : "—"}
          label="Avg %"
        />
        <StatCard value={<Badge status={current} />} label="Current status" />
        <StatCard value={String((student.marks || []).length)} label="Subjects" />
      </div>

      <ExplainPanel student={student} />
    </div>
  );
}
