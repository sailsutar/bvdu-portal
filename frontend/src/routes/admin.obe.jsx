import { useMemo } from "react";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import {
  cohortCOSummary,
  predictStudentCOAttainment,
  getObeMap,
} from "@/lib/academic-intelligence";
import { NoData } from "@/components/portal/NoData";

export default function AdminObe() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const summary = useMemo(() => cohortCOSummary(students), [students]);
  const map = getObeMap();

  if (!allStudents.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Predictive Outcome-Based Education</h1>
        <NoData message="Upload data to forecast CO attainment." />
      </div>
    );
  }

  const below = summary.filter((c) => c.meanPredicted != null && c.meanPredicted < c.targetPct).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Predictive Outcome-Based Education</h1>
        <p className="text-sm text-muted-foreground">
          Mid-term <b>Course Outcome attainment forecasts</b> from Unit Test 1/Unit Test 2 + attendance — before
          final assessments. Program: {map.program}.
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


      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard value={String(summary.length)} label="Tracked Course Outcomes" />
        <StatCard value={String(below)} label="Course Outcomes below target (predicted)" />
        <StatCard value={String(students.length)} label="Students in forecast" />
      </div>

      <SectionCard title="Cohort CO forecast">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Course Outcome</th>
              <th className="py-2">Title</th>
              <th className="py-2">Mean predicted %</th>
              <th className="py-2">Target %</th>
              <th className="py-2">Students below target</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((c) => (
              <tr key={c.coId} className="border-b last:border-b-0">
                <td className="py-2 font-semibold text-navy">{c.label || c.coId}</td>
                <td className="py-2">{c.title}</td>
                <td
                  className={`py-2 font-semibold ${
                    c.meanPredicted != null && c.meanPredicted < c.targetPct
                      ? "text-danger"
                      : "text-success"
                  }`}
                >
                  {c.meanPredicted ?? "—"}
                </td>
                <td className="py-2">{c.targetPct}</td>
                <td className="py-2">{c.pctStudentsBelow ?? "—"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="Course Outcome breakdown by student">
        <div className="max-h-[32rem] space-y-4 overflow-y-auto">
          {students.map((s) => (
            <div key={s.prn} className="rounded border p-3 text-sm">
              <div className="mb-2 font-medium text-navy">
                {s.name} <span className="text-xs text-muted-foreground">({s.prn})</span>
              </div>
              <ul className="grid gap-1 sm:grid-cols-3">
                {predictStudentCOAttainment(s).map((row) => (
                  <li key={row.coId}>
                    {row.label || row.coId}:{" "}
                    <b className={row.onTrack ? "text-success" : "text-danger"}>
                      {row.predictedPct}%
                    </b>{" "}
                    <span className="text-xs text-muted-foreground">
                      → {(row.poLinks || []).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
