import { useMemo, useState, useEffect } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import { analyzeBunkPatterns } from "@/lib/vmedulife-attendance";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import { filterByYearBatch } from "@/lib/year-batch";

export default function AdminBunkAnalysis() {
  const { students: allStudents } = useDerived();
  const { students, filterProps, year, batch } = useYearBatchStudents(allStudents);
  const [stored, setStored] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bvu.vmedulife.last");
      if (raw) setStored(JSON.parse(raw));
    } catch {
      setStored(null);
    }
  }, []);

  const sourceStudents = useMemo(() => {
    // Prefer rows that still carry per-subject session data (VMedulife)
    const fromCohort = (students || []).filter((s) => (s.subjectAttendance || []).length > 0);
    if (fromCohort.length) return fromCohort;
    const storedList = stored?.students || [];
    if (storedList.length) {
      return filterByYearBatch(storedList, year, batch);
    }
    return students || [];
  }, [students, stored, year, batch]);

  const from =
    stored?.meta?.dateRange?.from ||
    sourceStudents.find((s) => s.reportFrom)?.reportFrom ||
    null;
  const to =
    stored?.meta?.dateRange?.to ||
    sourceStudents.find((s) => s.reportTo)?.reportTo ||
    null;

  const report = useMemo(
    () => analyzeBunkPatterns(sourceStudents, { from, to }),
    [sourceStudents, from, to]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Bunk analysis</h1>
          <p className="text-sm text-muted-foreground">
            Session-based absence pressure from VMedulife attendance exports. Sundays are excluded from
            the teaching-day calendar. Per-day values are estimates when the export has no daily roll.
          </p>
        </div>
        <YearBatchFilter {...filterProps} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SectionCard title="Teaching days">
          <p className="text-2xl font-semibold text-navy">{report.teachingDays}</p>
          <p className="text-xs text-muted-foreground">Sundays excluded: {report.sundaysExcluded}</p>
        </SectionCard>
        <SectionCard title="Overall absence rate">
          <p className="text-2xl font-semibold text-navy">
            {report.overallAbsentRate != null ? `${Math.round(report.overallAbsentRate * 1000) / 10}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {report.totalAbsentSessions} absent / {report.totalScheduledSessions} scheduled sessions
          </p>
        </SectionCard>
        <SectionCard title="Report range">
          <p className="text-sm font-medium text-navy">
            {from || "—"} → {to || "—"}
          </p>
        </SectionCard>
        <SectionCard title="High-risk students">
          <p className="text-2xl font-semibold text-navy">{report.highRiskStudents.length}</p>
          <p className="text-xs text-muted-foreground">Attendance under 75% or bunk rate ≥ 35%</p>
        </SectionCard>
      </div>

      <SectionCard title="Method">
        <p className="text-sm text-muted-foreground">{report.method}</p>
      </SectionCard>

      <SectionCard title="Subjects with highest absence rates (includes labs)">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pr-3">Subject</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Absent sessions</th>
                <th className="py-2 pr-3">Scheduled</th>
                <th className="py-2">Absent rate</th>
              </tr>
            </thead>
            <tbody>
              {report.subjectRanking.slice(0, 20).map((s) => (
                <tr key={s.subject} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium text-navy">{s.subject}</td>
                  <td className="py-2 pr-3">{s.isLab ? "Lab" : "Theory"}</td>
                  <td className="py-2 pr-3">{s.absent}</td>
                  <td className="py-2 pr-3">{s.total}</td>
                  <td className="py-2">{Math.round(s.absentRate * 1000) / 10}%</td>
                </tr>
              ))}
              {!report.subjectRanking.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-muted-foreground">
                    Upload a VMedulife attendance export to see subject-level absence rates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Estimated bunk pressure by teaching day">
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Weekday</th>
                <th className="py-2 pr-3">Est. absent sessions</th>
                <th className="py-2 pr-3">Relative pressure</th>
                <th className="py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {report.perDay.map((d) => (
                <tr key={d.date} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium">{d.date}</td>
                  <td className="py-2 pr-3">{d.weekday}</td>
                  <td className="py-2 pr-3">{d.estimatedAbsentSessions}</td>
                  <td className="py-2 pr-3">{Math.round(d.bunkProbability * 100)}%</td>
                  <td className="py-2 text-xs text-muted-foreground">{d.note}</td>
                </tr>
              ))}
              {!report.perDay.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-muted-foreground">
                    No date range available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Students with elevated bunk risk">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pr-3">PRN</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Attendance</th>
                <th className="py-2 pr-3">Lab attendance</th>
                <th className="py-2 pr-3">Bunk rate</th>
                <th className="py-2">Absent sessions</th>
              </tr>
            </thead>
            <tbody>
              {report.highRiskStudents.map((s) => (
                <tr key={s.prn} className="border-b border-border/60">
                  <td className="py-2 pr-3">{s.prn}</td>
                  <td className="py-2 pr-3 font-medium text-navy">{s.name}</td>
                  <td className="py-2 pr-3">{s.attendance != null ? `${s.attendance}%` : "—"}</td>
                  <td className="py-2 pr-3">{s.labAttendance != null ? `${s.labAttendance}%` : "—"}</td>
                  <td className="py-2 pr-3">
                    {s.bunkRate != null ? `${Math.round(s.bunkRate * 1000) / 10}%` : "—"}
                  </td>
                  <td className="py-2">{s.absentSessions ?? "—"}</td>
                </tr>
              ))}
              {!report.highRiskStudents.length && (
                <tr>
                  <td colSpan={6} className="py-4 text-muted-foreground">
                    No high-risk students in this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
