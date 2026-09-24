import { SectionCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import { NoData } from "@/components/portal/NoData";
import { MessageParentButton } from "@/components/portal/MessageParentModal";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";

function AttendancePage() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);

  if (!allStudents.length)
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Attendance</h1>
        <NoData message="Upload an Excel with a Permanent Registration Number and Attendance column to see attendance." />
      </div>
    );

  const sorted = [...students].sort((a, b) => {
    const aa = a.attendance == null ? 999 : Number(a.attendance);
    const bb = b.attendance == null ? 999 : Number(b.attendance);
    return aa - bb;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Attendance</h1>
          <p className="text-sm text-muted-foreground">
            {year}
            {batch !== "All" ? ` · batch ${batch}` : ""} · {students.length} students (lowest first)
          </p>
        </div>
        <YearBatchFilter {...filterProps} />
      </div>
      <SectionCard>
        <p className="mb-3 text-xs text-muted-foreground">
          Use <b>Message</b> to email the parent an attendance-only letter (editable before send).
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Permanent Registration Number</th>
              <th className="py-2">Name</th>
              <th className="py-2">Class</th>
              <th className="py-2">Attendance</th>
              <th className="py-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.prn} className="border-b last:border-b-0">
                <td className="py-3">{s.prn}</td>
                <td className="py-3 font-medium text-navy">{s.name}</td>
                <td className="py-3">{s.cls || s.className}</td>
                <td
                  className={`py-3 font-semibold ${
                    !s.attendanceKnown && s.attendance == null
                      ? "text-muted-foreground"
                      : Number(s.attendance) < 75
                        ? "text-danger"
                        : "text-success"
                  }`}
                >
                  {s.attendance != null ? `${s.attendance}%` : "—"}
                </td>
                <td className="py-3">
                  <MessageParentButton student={s} mode="attendance" />
                </td>
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No students for this year/batch filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}

export default AttendancePage;
