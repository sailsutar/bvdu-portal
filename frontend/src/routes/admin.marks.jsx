import { SectionCard } from "@/components/portal/PortalShell";
import { useDerived, preferredAssessmentOrder } from "@/lib/upload-stats";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import { NoData } from "@/components/portal/NoData";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MessageParentButton } from "@/components/portal/MessageParentModal";
import { subjectPrimaryYearMap, filterMarksForYear, filterSubjectsForYear, parseYearBatch } from "@/lib/year-batch";
import {
  useStudentPredictions,
  currentStatusOf,
  statusBadgeClass,
} from "@/lib/ml-predict";

function StatusBadge({ status }) {
  if (!status) return null;
  const ok = status === "PASS";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
      }`}
    >
      {status}
    </span>
  );
}

function AcademicBadge({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(status)}`}>
      {status}
    </span>
  );
}

function isGenericColumnName(name) {
  return /^column\s*\d+$/i.test(String(name || "").trim());
}

function splitKeys(keys) {
  const summarySet = new Set(["Average", "Avg", "Pct", "Percentage", "Total", "LAB_Pct", "LAB_Total"]);
  const score = keys.filter((k) => !summarySet.has(k));
  const summary = keys.filter((k) => summarySet.has(k));
  return { score, summary };
}

function StudentMarksTable({ marks, assessmentKeys }) {
  const { score, summary } = splitKeys(assessmentKeys);
  const cols = [
    ...score.filter((k) => ["Unit Test 1", "UT1", "Unit Test 2", "UT2", "RE-UT", "REUT", "RE-Unit Test 20"].includes(k)),
    ...score.filter((k) => !["Unit Test 1", "UT1", "Unit Test 2", "UT2", "RE-UT", "REUT", "RE-Unit Test 20"].includes(k)),
    ...summary.filter((k) => ["Average", "Avg"].includes(k)),
    ...summary.filter((k) => ["Pct", "Percentage"].includes(k)),
    ...summary.filter((k) => k === "Total"),
    ...summary.filter((k) => ["LAB_Pct", "LAB_Total"].includes(k)),
  ];
  const seen = new Set();
  const columns = cols.filter((k) => (seen.has(k) ? false : (seen.add(k), true)));

  if (!marks.length) {
    return <p className="py-2 text-xs text-muted-foreground">No subject marks for this student.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="sticky left-0 bg-muted/40 px-3 py-2.5 font-semibold text-navy">Subject</th>
            {columns.map((k) => (
              <th key={k} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                {k}
              </th>
            ))}
            <th className="px-3 py-2.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {marks.map((m) => (
            <tr key={m.subject} className="border-b last:border-b-0 hover:bg-muted/20">
              <td className="sticky left-0 whitespace-nowrap bg-card px-3 py-2.5 font-medium text-navy">
                {m.subject}
              </td>
              {columns.map((k) => {
                let val = m.assessments?.[k];
                if (val == null) {
                  if (k === "Average" || k === "Avg") val = m.average;
                  else if (k === "Pct" || k === "Percentage") val = m.percentage;
                  else if (k === "Total") val = m.total;
                }
                return (
                  <td key={k} className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {val != null ? val : <span className="text-muted-foreground">—</span>}
                  </td>
                );
              })}
              <td className="px-3 py-2.5">
                <StatusBadge status={m.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarksPage() {
  const { students: allStudents, detectedSubjects, detectedAssessments, hasData } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const { predictions, predSource, isLoading: mlLoading, isError: mlError, error: mlErr } = useStudentPredictions(students);

  const assessmentKeys = preferredAssessmentOrder(
    detectedAssessments.length ? detectedAssessments : ["Unit Test 1", "Unit Test 2"]
  );

  const primaryMap = useMemo(() => subjectPrimaryYearMap(allStudents), [allStudents]);

  const realSubjects = useMemo(() => {
    const base = (detectedSubjects || []).filter((s) => !isGenericColumnName(s));
    return filterSubjectsForYear(base, year, primaryMap);
  }, [detectedSubjects, year, primaryMap]);

  const filtered = useMemo(() => {
    let list = students;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || String(s.prn).toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, search]);

  function toggle(prn) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(prn)) next.delete(prn);
      else next.add(prn);
      return next;
    });
  }

  if (!hasData || allStudents.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Marks</h1>
        <NoData message="Upload an Excel with Permanent Registration Number and subject assessment columns to see marks." />
      </div>
    );
  }

  const gridCols =
    "md:grid-cols-[28px_110px_minmax(120px,1fr)_64px_64px_80px_100px_100px_72px]";

  if (mlLoading) {
    return (
      <div className="flex min-h-[20rem] flex-col items-center justify-center gap-4 rounded-xl border bg-card p-10">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-navy/20 border-t-gold" />
        <p className="text-sm font-medium text-navy">Loading Random Forest predictions…</p>
        <p className="text-xs text-muted-foreground">Marks view waits for the Random Forest model before showing predicted status.</p>
      </div>
    );
  }
  if (mlError) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-sm">
        <p className="font-semibold text-danger">Machine learning unavailable</p>
        <p className="mt-1 text-muted-foreground">{mlErr?.message || "Start ML service on port 8001."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Marks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current status is from uploaded marks. Predicted status is At Risk / Average / Good only (ML model)
          {predSource === "ml" ? " (Random Forest model online)" : predSource === "error" ? " (model unavailable)" : " (loading model…)"}.
          Click a row for subject-wise marks.
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


      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Permanent Registration Number or name…"
          className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
        />
        {realSubjects.length > 0 && (
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-gold"
          >
            <option value="">All subjects</option>
            {realSubjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setExpanded(new Set(filtered.map((s) => s.prn)))}
            className="rounded-md border px-3 py-1.5 text-xs font-medium text-navy hover:bg-muted"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setExpanded(new Set())}
            className="rounded-md border px-3 py-1.5 text-xs font-medium text-navy hover:bg-muted"
          >
            Collapse all
          </button>
        </div>
      </div>

      <SectionCard>
        <div className="divide-y">
          <div
            className={`hidden gap-2 px-2 py-2 text-xs font-semibold text-muted-foreground md:grid ${gridCols}`}
          >
            <span />
            <span>Permanent Registration Number</span>
            <span>Name</span>
            <span>CGPA</span>
            <span>Avg %</span>
            <span>Attendance</span>
            <span>Current Status</span>
            <span>Predicted</span>
            <span>Subjects</span>
          </div>

          {filtered.map((s) => {
            let marks = (s.marks || []).filter((m) => !isGenericColumnName(m.subject));
            // Strict year lock: LY students never show TY subjects (and vice versa)
            const lockYear = year && year !== "All" ? year : parseYearBatch(s).year;
            if (lockYear) {
              marks = filterMarksForYear(marks, lockYear, primaryMap);
            }
            if (subjectFilter) marks = marks.filter((m) => m.subject === subjectFilter);
            const isOpen = expanded.has(s.prn);
            const subjectCount = marks.length;
            const current = currentStatusOf(s);
            const pred = predictions.get(String(s.prn));
            const predictedStatus = pred?.status || s.academicStatus || current || "—";
            const differs = pred && pred.status && pred.status !== current;

            return (
              <div key={s.prn} className="group">
                <button
                  type="button"
                  onClick={() => toggle(s.prn)}
                  className={`grid w-full grid-cols-1 items-center gap-1 px-2 py-3 text-left transition-colors hover:bg-muted/30 md:gap-2 ${gridCols}`}
                >
                  <span className="text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                  <span className="text-sm tabular-nums text-navy">{s.prn}</span>
                  <span className="text-sm font-semibold text-navy">{s.name}</span>
                  <span className="text-sm tabular-nums">
                    {s.cgpaKnown && s.cgpa != null ? s.cgpa : "—"}
                  </span>
                  <span className="text-sm tabular-nums">
                    {s.averagePercentage != null ? `${s.averagePercentage}%` : "—"}
                  </span>
                  <span className="text-sm tabular-nums">
                    {s.attendanceKnown ? `${s.attendance}%` : "—"}
                  </span>
                  <span className="text-xs">
                    <AcademicBadge status={current} />
                  </span>
                  <span className="text-xs">
                    <span className="inline-flex flex-col items-start gap-0.5">
                      <AcademicBadge status={predictedStatus} />
                      {differs && (
                        <span className="text-[10px] font-medium text-warning">Differs</span>
                      )}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {subjectCount} subject{subjectCount === 1 ? "" : "s"}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t bg-muted/10 px-3 py-4 md:px-6">
                    <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                        {s.name} — subject-wise marks
                      </span>
                      <span className="text-muted-foreground">|</span>
                      <span>
                        Current: <AcademicBadge status={current} />
                      </span>
                      <span>
                        Predicted: <AcademicBadge status={predictedStatus} />
                      </span>
                      <span className="ml-auto">
                        <MessageParentButton student={s} mode="marks" />
                      </span>
                    </div>
                    <StudentMarksTable marks={marks} assessmentKeys={assessmentKeys} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

export default MarksPage;
