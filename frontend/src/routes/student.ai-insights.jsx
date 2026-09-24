import { SectionCard } from "@/components/portal/PortalShell";
import { Sparkles } from "lucide-react";
import { useSession } from "@/lib/auth";
import { studentPortalData, useDerived } from "@/lib/upload-stats";
import { useStudentPrediction, statusBadgeClass } from "@/lib/ml-predict";
import { useStudentExplanation } from "@/lib/explain-model";

export default function Page() {
  const { session } = useSession();
  const { students } = useDerived();
  const student = studentPortalData(students, session?.id);
  const { prediction } = useStudentPrediction(student);

  const tips = [];

  const lowSubjects = (student.subjects || [])
    .map((s) => ({
      name: s.name,
      pct: s.attendancePct != null ? s.attendancePct : s.total ? Math.round((s.present / s.total) * 100) : null,
    }))
    .filter((s) => s.pct != null && s.pct < 75)
    .sort((a, b) => a.pct - b.pct);
  for (const s of lowSubjects.slice(0, 3)) {
    tips.push(`Subject attendance alert: ${s.name} is at ${s.pct}% (below 75%).`);
  }
  const failMarks = (student.marks || []).filter((m) => String(m.status || "").toUpperCase() === "FAIL");
  for (const m of failMarks.slice(0, 3)) {
    tips.push(`Marks alert: ${m.subject} is marked ${m.status}.`);
  }

  tips.push(
    `Predicted Status (Early-Warning): ${prediction.status}. Current Academic Status is shown separately from uploaded marks.`
  );
  if (prediction.predicted_average_pct != null) {
    tips.push(
      `Predicted overall average: ${prediction.predicted_average_pct}%${
        prediction.source === "ml" ? " (Random Forest machine learning model)" : ""
      }.`
    );
  }
  if (student.attendance == null) {
    tips.push("Attendance not available in cohort for your PRN yet.");
  } else if (student.attendance < 75) {
    tips.push(`Attendance is ${student.attendance}%. Aim for at least 75% to stay exam-eligible.`);
  } else {
    tips.push(`Attendance at ${student.attendance}% — good standing.`);
  }
  if (student.cgpa != null) {
    if (student.cgpa >= 8) tips.push(`CGPA ${student.cgpa} is strong — keep up the momentum.`);
    else if (student.cgpa >= 7) tips.push(`CGPA ${student.cgpa} is solid. Push a bit more to cross 8.`);
    else tips.push(`CGPA ${student.cgpa} needs attention. Focus on weaker subjects.`);
  } else if (student.averagePercentage != null) {
    tips.push(`Current average percentage is ${student.averagePercentage}%.`);
  }

  const fails = (student.marks || []).filter((m) => m.status === "FAIL");
  if (fails.length) {
    tips.push(`Failing assessments in: ${fails.map((m) => m.subject).join(", ")}. Prioritise these.`);
  } else if (student.marks?.length) {
    tips.push("No failing assessments detected — excellent consistency.");
  }

  const weakest = [...(student.marks || [])]
    .filter((m) => m.percentage != null || m.average != null)
    .sort((a, b) => (a.percentage ?? a.average ?? 0) - (b.percentage ?? b.average ?? 0))[0];
  if (weakest) {
    tips.push(`Lowest subject signal: ${weakest.subject}. Schedule extra practice there.`);
  }

  while (tips.length < 4) {
    tips.push("Insights refresh when new Excel data is uploaded by admin.");
  }

  const { report: explain, isLoading: explainLoading } = useStudentExplanation(student);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">Artificial Intelligence Insights</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SectionCard title="Predicted Status (Early-Warning)">
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${statusBadgeClass(
              prediction.status
            )}`}
          >
            {prediction.status}
          </span>
          <p className="mt-2 text-xs text-muted-foreground">
            {prediction.source === "ml"
              ? "Random Forest early-warning model (UT-1 + attendance)"
              : prediction.source === "error"
                ? "Waiting for machine learning service…"
                : "Rule-based early-warning estimate"}
          </p>
        </SectionCard>
        <SectionCard title="Current Academic Status">
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${statusBadgeClass(
              student.academicStatus || "Average"
            )}`}
          >
            {student.academicStatus || "—"}
          </span>
          <p className="mt-2 text-xs text-muted-foreground">From uploaded marks + attendance rules</p>
        </SectionCard>
        <SectionCard title="Predicted Average %">
          <p className="text-3xl font-bold text-navy">
            {prediction.predicted_average_pct != null ? `${prediction.predicted_average_pct}%` : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Model estimate of overall performance</p>
        </SectionCard>
        <SectionCard title="Current Average %">
          <p className="text-3xl font-bold text-navy">
            {student.averagePercentage != null ? `${student.averagePercentage}%` : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">From uploaded Excel</p>
        </SectionCard>
      </div>

      {prediction.probabilities && (
        <SectionCard title="Model confidence">
          <div className="flex flex-wrap gap-4 text-sm">
            {Object.entries(prediction.probabilities).map(([label, p]) => (
              <div key={label}>
                <span className="text-muted-foreground">{label}: </span>
                <b className="text-navy">{(p * 100).toFixed(1)}%</b>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* enriched */ tips.slice(0, 8).map((tip) => (
          <div key={tip} className="rounded-xl border border-gold bg-gold-soft p-5 shadow-sm">
            <Sparkles className="h-5 w-5 text-navy" />
            <p className="mt-2 text-sm text-navy">{tip}</p>
          </div>
        ))}
      </div>
      <SectionCard title="Note">
        <p className="text-sm text-muted-foreground">
          <b>Current Academic Status</b> uses uploaded marks and attendance rules.
          <b>Predicted Status (Early-Warning)</b> uses the Random Forest model on early signals (UT-1 + attendance) only.
          Labels: At Risk, Average, Good. Predicted status and explanations appear only after the Random Forest model responds — there is no rule-based substitute.
        </p>
      </SectionCard>
    
      <SectionCard title="Why this status (explainable)">
        {explain ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-navy">{explain.headline}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  explain.source === "model"
                    ? "bg-success/15 text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {explain?.source === "model" ? "via machine learning model (Shapley)" : explainLoading ? "loading model…" : "model unavailable"}
              </span>
            </div>
            <ul className="list-disc space-y-1 pl-4 text-sm text-navy/85">
              {(explain.whyDegraded || []).slice(0, 4).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {explain.recommendations?.[0] && (
              <p className="mt-3 text-sm text-navy/80">
                <b>Next step:</b> {explain.recommendations[0].detail}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {explainLoading ? "Loading explanation…" : "No explanation available."}
          </p>
        )}
      </SectionCard>

    </div>
  );
}
