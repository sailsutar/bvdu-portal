import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SectionCard } from "@/components/portal/PortalShell";
import { useSession } from "@/lib/auth";
import { useDerived } from "@/lib/upload-stats";
import { useTgMentees, tgBatchLabel } from "@/lib/tg-assign";
import {
  useStudentPredictions,
  currentStatusOf,
  statusBadgeClass,
} from "@/lib/ml-predict";
import { MessageParentButton } from "@/components/portal/MessageParentModal";
import { NoData } from "@/components/portal/NoData";
import { Eye } from "lucide-react";

function Badge({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(status)}`}
    >
      {status}
    </span>
  );
}

function yearOf(student) {
  const s = String(student?.cls || student?.className || student?.yearLevel || "").toUpperCase();
  if (/\b(FY|FE|FIRST)\b/.test(s) || s.startsWith("FY")) return "FY";
  if (/\b(SY|SE|SECOND)\b/.test(s) || s.startsWith("SY")) return "SY";
  if (/\b(TY|TE|THIRD)\b/.test(s) || s.startsWith("TY")) return "TY";
  if (/\b(LY|BE|FINAL|LAST)\b/.test(s) || s.includes("FINAL")) return "LY";
  return "Other";
}

export default function TgStudents() {
  const { session } = useSession();
  const { students } = useDerived();
  const [yearFilter, setYearFilter] = useState("All");
  const { mentees: mineAll } = useTgMentees(students, session?.tgIndex);
  const mine = useMemo(() => {
    if (yearFilter === "All") return mineAll;
    return mineAll.filter((s) => yearOf(s) === yearFilter);
  }, [mineAll, yearFilter]);
  const { predictions, predSource, isLoading: mlLoading, isError: mlError, error: mlErr } =
    useStudentPredictions(mine);

  if (!students.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">My Students</h1>
        <NoData message="No uploaded students yet." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">My Students</h1>
        <p className="text-sm text-muted-foreground">
          {tgBatchLabel(session?.tgIndex)} · {mine.length} mentee
          {mine.length === 1 ? "" : "s"}
          {yearFilter !== "All" ? ` · ${yearFilter}` : ""} · Prediction source:{" "}
          {predSource === "ml"
            ? "Random Forest machine learning model"
            : predSource === "error"
              ? "Model unavailable"
              : "Loading model…"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only students assigned to you by System Administrator. Year filter is view-only — assignment
          lasts from First Year through Last Year.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["All", "FY", "SY", "TY", "LY"].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYearFilter(y)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                yearFilter === y ? "bg-navy text-white" : "bg-muted text-navy"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
      {mlLoading && (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm text-navy">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy/20 border-t-gold" />
          Loading Random Forest predictions…
        </div>
      )}
      {mlError && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {mlErr?.message || "Machine learning service unavailable."}
        </div>
      )}
      <SectionCard>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2">PRN</th>
              <th>Name</th>
              <th>Class</th>
              <th>Attendance</th>
              <th>Average</th>
              <th>Current</th>
              <th>Predicted</th>
              <th>Message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mine.map((s) => {
              const current = currentStatusOf(s);
              const pred = predictions.get(String(s.prn));
              const predicted = pred?.status || null;
              const differs = predicted != null && predicted !== current;
              return (
                <tr key={s.prn} className="border-b last:border-b-0">
                  <td className="py-3 tabular-nums">{s.prn}</td>
                  <td className="py-3 font-medium text-navy">{s.name}</td>
                  <td className="py-3">{s.cls || "—"}</td>
                  <td
                    className={`py-3 font-semibold ${
                      !s.attendanceKnown
                        ? "text-muted-foreground"
                        : s.attendance < 75
                          ? "text-danger"
                          : "text-success"
                    }`}
                  >
                    {s.attendanceKnown ? `${s.attendance}%` : "—"}
                  </td>
                  <td className="py-3 tabular-nums">
                    {s.averagePercentage != null ? `${s.averagePercentage}%` : "—"}
                  </td>
                  <td className="py-3">
                    <Badge status={current} />
                  </td>
                  <td className="py-3">
                    <div className="flex flex-col items-start gap-0.5">
                      <Badge status={predicted} />
                      {differs && (
                        <span className="text-[10px] font-medium text-warning">Differs</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3">
                    <MessageParentButton student={s} mode="full" />
                  </td>
                  <td className="py-3">
                    <Link
                      to={`/tg/students/${encodeURIComponent(s.prn)}`}
                      className="inline-flex items-center gap-1 text-navy hover:underline"
                      title="Explainable Artificial Intelligence"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!mine.length && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-muted-foreground">
                  No mentees assigned to you
                  {yearFilter !== "All" ? ` in ${yearFilter}` : ""}. System Administrator assigns
                  students.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
