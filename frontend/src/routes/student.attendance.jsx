import { SectionCard } from "@/components/portal/PortalShell";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth";
import { studentPortalData, useDerived } from "@/lib/upload-stats";

function lecturesNeededFor75(present, total) {
  if (total == null || present == null || total <= 0) return null;
  const pct = (present / total) * 100;
  if (pct >= 75) return 0;
  // need present/total >= 0.75 → present >= 0.75 * total
  // after k more present lectures: (present+k)/(total+k) >= 0.75
  // present+k >= 0.75 total + 0.75 k → present - 0.75 total >= -0.25 k → k >= (0.75 total - present)/0.25
  const k = Math.ceil((0.75 * total - present) / 0.25);
  return k > 0 ? k : 0;
}

export default function AttendancePage() {
  const { session } = useSession();
  const { students, source } = useDerived();
  const student = studentPortalData(students, session?.id);
  const att = student.attendance;
  const hasAtt = att != null && student.hasAcademicRecord;
  const donut = hasAtt
    ? [
        { name: "Present", value: Math.max(0, att), color: "oklch(0.65 0.18 145)" },
        { name: "Absent", value: Math.max(0, 100 - att), color: "oklch(0.62 0.22 25)" },
      ]
    : [
        { name: "No data", value: 1, color: "oklch(0.85 0.02 250)" },
      ];

  const subjectRows = (student.subjects || []).filter((s) => s.name);
  const lowSubjects = subjectRows
    .map((s) => {
      const pct =
        s.attendancePct != null
          ? s.attendancePct
          : s.total
            ? Math.round((s.present / s.total) * 1000) / 10
            : null;
      return { ...s, pct };
    })
    .filter((s) => s.pct != null && s.pct < 75)
    .sort((a, b) => a.pct - b.pct);

  const tips = lowSubjects.slice(0, 5).map((s) => {
    if (s.total > 0 && s.total !== 100) {
      const need = lecturesNeededFor75(s.present, s.total);
      if (need != null && need > 0) {
        return `You need about ${need} more present lecture(s) to reach 75% in ${s.name} (now ${s.pct}%).`;
      }
    }
    return `${s.name} attendance is ${s.pct}% (below 75%). Improve presence in upcoming sessions.`;
  });

  const totalLectures = subjectRows.reduce((sum, s) => sum + (s.total && s.total !== 100 ? s.total : 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Live data from the academic cohort ({source || "server"}).{" "}
          {student.hasAcademicRecord
            ? `${student.name} · PRN ${student.prn}`
            : "No academic record found for your PRN yet — ask HOD to upload attendance/marks Excel."}
        </p>
      </div>

      <Tabs defaultValue="subject">
        <TabsList>
          <TabsTrigger value="overall">Overall</TabsTrigger>
          <TabsTrigger value="subject">Subject wise</TabsTrigger>
        </TabsList>

        <TabsContent value="overall" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <SectionCard title="Overall attendance">
              {hasAtt ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Overall attendance: <b className="text-navy">{att}%</b>
                    {att >= 75
                      ? " — You meet the typical 75% threshold for feedback eligibility."
                      : " — Below 75%; focus on regular presence."}
                  </p>
                  {student.theoryAttendance != null && (
                    <p className="mt-2 text-sm">Theory: <b>{student.theoryAttendance}%</b></p>
                  )}
                  {student.labAttendance != null && (
                    <p className="text-sm">Lab: <b>{student.labAttendance}%</b></p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Attendance percentage is not available for your PRN in the uploaded cohort.
                </p>
              )}
            </SectionCard>
            <SectionCard title="Snapshot">
              <div className="relative mx-auto h-48 w-48">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={donut} innerRadius={55} outerRadius={80} dataKey="value" stroke="none">
                      {donut.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="text-2xl font-bold text-navy">{hasAtt ? `${att}%` : "—"}</span>
                </div>
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="subject" className="mt-4">
          <SectionCard title="Subject-wise attendance">
            {!subjectRows.length ? (
              <p className="text-sm text-muted-foreground">
                No per-subject attendance rows for your PRN. Overall attendance may still show if the Excel only
                had a total percentage.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2">Subject</th>
                      <th className="py-2">Present</th>
                      <th className="py-2">Absent</th>
                      <th className="py-2">Total</th>
                      <th className="py-2">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectRows.map((s) => {
                      const pct =
                        s.attendancePct != null
                          ? s.attendancePct
                          : s.total
                            ? Math.round((s.present / s.total) * 1000) / 10
                            : null;
                      const low = pct != null && pct < 75;
                      return (
                        <tr key={s.name} className="border-b last:border-b-0">
                          <td className="py-3 font-medium text-navy">{s.name}</td>
                          <td className="py-3">{s.present}</td>
                          <td className="py-3">{s.absent}</td>
                          <td className="py-3">{s.total || "—"}</td>
                          <td className={`py-3 font-semibold ${low ? "text-danger" : "text-success"}`}>
                            {pct != null ? `${pct}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {tips.length > 0 && (
              <div className="mt-4 space-y-2">
                {tips.map((tip) => (
                  <div key={tip} className="rounded-md bg-gold-soft/50 p-3 text-sm text-navy">
                    {tip}
                  </div>
                ))}
              </div>
            )}
            {totalLectures > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Total scheduled sessions across subjects (when provided): {totalLectures}
              </p>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
