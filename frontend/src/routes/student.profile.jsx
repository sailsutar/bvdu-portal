import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth";
import { initials, preferredAssessmentOrder, studentPortalData, useDerived } from "@/lib/upload-stats";

function StatusBadge({ status }) {
  if (!status) return null;
  const ok = status === "PASS";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
      {status}
    </span>
  );
}

function ProfilePage() {
  const { session } = useSession();
  const { students } = useDerived();
  const student = studentPortalData(students, session?.id);
  const keys = preferredAssessmentOrder(student.assessmentKeys?.length ? student.assessmentKeys : ["Unit Test 1", "Unit Test 2"]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6 rounded-xl border bg-card p-6 shadow-sm">
        <div className="grid h-24 w-24 place-items-center rounded-full bg-gold-soft text-3xl font-bold text-navy">
          {initials(student.name)}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-navy">{student.name}</h2>
          <p className="text-sm text-muted-foreground">PRN: {student.prn}</p>
          <p className="text-sm text-muted-foreground">Class: {student.className}</p>
          <p className="text-sm text-muted-foreground">Email: {student.email}</p>
          <p className="text-sm text-muted-foreground">Phone: {student.phone}</p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="marks">Marks</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
            <StatCard value={`${student.attendance}%`} label="Attendance" tone="good" />
            <StatCard value={student.cgpa != null ? student.cgpa : "—"} label="CGPA" />
            <StatCard value={student.sgpa != null ? student.sgpa : "—"} label="SGPA (Current)" />
            <StatCard value={student.academicStatus || "—"} label="Academic Status" />
            <StatCard value={student.predictedAveragePct != null ? `${student.predictedAveragePct}%` : "—"} label="Predicted Avg %" />
            <StatCard value={student.backlogs} label="Backlogs" tone="excellent" />
            <SectionCard title="AI Summary">
              <p className="text-sm text-navy/80">
                Risk: <b>{student.risk}</b>.{" "}
                {student.name.split(" ")[0]} has {student.attendance}% attendance{student.cgpa != null ? ` and CGPA ${student.cgpa}` : ""}.
                {student.averagePercentage != null ? ` Average percentage: ${student.averagePercentage}%.` : ""}
              </p>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="attendance">
          <SectionCard>
            <p className="text-sm text-muted-foreground">See the Attendance page for details.</p>
          </SectionCard>
        </TabsContent>

        <TabsContent value="marks" className="mt-4">
          <SectionCard title="Subject-wise performance">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-2">Subject</th>
                    {keys.slice(0, 6).map((k) => (
                      <th key={k} className="py-2 pr-2 whitespace-nowrap">{k}</th>
                    ))}
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(student.marks || []).map((m) => (
                    <tr key={m.subject} className="border-b last:border-b-0">
                      <td className="py-2 pr-2 font-medium text-navy">{m.subject}</td>
                      {keys.slice(0, 6).map((k) => (
                        <td key={k} className="py-2 pr-2">{m.assessments?.[k] != null ? m.assessments[k] : "—"}</td>
                      ))}
                      <td className="py-2"><StatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="assignments">
          <SectionCard>
            <p className="text-sm text-muted-foreground">See the Assignments page for details.</p>
          </SectionCard>
        </TabsContent>
        <TabsContent value="performance">
          <SectionCard>
            <p className="text-sm text-muted-foreground">Semester-wise performance trend.</p>
          </SectionCard>
        </TabsContent>
        <TabsContent value="feedback">
          <SectionCard>
            <p className="text-sm text-muted-foreground">See the Feedback page for details.</p>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ProfilePage;
